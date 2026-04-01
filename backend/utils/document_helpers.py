"""
Shared document/container helpers used by api/documents and tasks/embeddings.
Centralizes suggestion confidence, container creation, feedback boosts, and document deletion.
"""
import math
import os
import re
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session
from sqlalchemy import func

from models.container import Container
from models.document import Document, DocumentStatus
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.document_hint import DocumentHint
from models.document_duplicate import DocumentDuplicate
from models.summary import Summary
from models.embedding_job import EmbeddingJob
from models.audit_log import AuditLog

from utils.audit import AuditActions
from utils.storage import storage

if TYPE_CHECKING:
    pass


def parse_storage_uri(storage_uri: str) -> tuple[str, str]:
    """Parse storage URI into (bucket, path). Raises ValueError if invalid."""
    try:
        scheme_split = storage_uri.split("://", 1)
        path_part = scheme_split[1] if len(scheme_split) == 2 else scheme_split[0]
        bucket, path = path_part.split("/", 1)
        return bucket, path
    except (ValueError, IndexError):
        raise ValueError("Invalid storage URI for document")


def confidence_label(score: float) -> str:
    if score >= 0.78:
        return "high"
    if score >= 0.62:
        return "medium"
    return "low"


def confidence_rank(label: str) -> int:
    normalized = (label or "").lower().strip()
    if normalized == "high":
        return 3
    if normalized == "medium":
        return 2
    return 1


_SUGGESTION_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "you",
        "your",
        "are",
        "was",
        "were",
        "has",
        "have",
        "into",
        "about",
        "file",
        "page",
        "pdf",
        "txt",
        "doc",
        "docx",
        "recipe",
        "recipes",
        "document",
        "blog",
        "post",
    }
)


def suggestion_tokens(*parts: str) -> set[str]:
    """Lowercase tokens (len ≥ 3) from text parts for light folder-name matching."""
    blob = " ".join(p or "" for p in parts)
    return {
        t
        for t in re.findall(r"[a-z0-9]+", blob.lower())
        if len(t) >= 3 and t not in _SUGGESTION_STOPWORDS
    }


def filename_as_embedding_hint(filename: str) -> str:
    """Turn filename stem into words so embeddings capture title-like signals (not folder name logic)."""
    base = os.path.basename((filename or "").strip())
    if not base:
        return ""
    stem = base.rsplit(".", 1)[0] if "." in base else base
    hint = re.sub(r"[_\-\.\s]+", " ", stem)
    return re.sub(r"\s+", " ", hint).strip()


def container_name_keyword_boosts(
    doc_tokens: set[str],
    containers: list[Container],
    *,
    max_boost: float,
) -> dict[int, float]:
    """
    Small score bump when folder name tokens appear in document text/filename.
    Requires ≥2 overlapping tokens or one token of length ≥5 to reduce false positives.
    """
    out: dict[int, float] = {}
    if not doc_tokens or max_boost <= 0:
        return out
    for c in containers:
        cname = (c.name or "").strip()
        if not cname:
            continue
        ct = suggestion_tokens(cname)
        if not ct:
            continue
        overlap = doc_tokens & ct
        if not overlap:
            continue
        if len(overlap) < 2 and not any(len(t) >= 5 for t in overlap):
            continue
        dice = 2 * len(overlap) / (len(ct) + len(doc_tokens) + 1e-6)
        boost = min(max_boost, 0.015 + max_boost * min(1.0, dice))
        out[c.id] = float(boost)
    return out


def suggestion_confidence_label(score: float) -> str:
    """Bands tuned for blended semantic + feedback + keyword boosts (slightly softer than confidence_label)."""
    if score >= 0.68:
        return "high"
    if score >= 0.48:
        return "medium"
    return "low"


def max_container_scores_from_embedding_rows(
    db: Session,
    document: Document,
    rows: list,
    container_by_id: dict[int, Container],
) -> dict[int, float]:
    """Aggregate (chunk_id, doc_id, similarity) rows to max similarity per destination container."""
    max_similarity_by_container: dict[int, float] = {}
    workspace_id = document.workspace_id
    if workspace_id is None:
        return max_similarity_by_container
    for _chunk_id, similar_doc_id, similarity in rows:
        if similar_doc_id == document.id:
            continue
        similar_doc = db.query(Document).filter(
            Document.id == similar_doc_id,
            Document.workspace_id == workspace_id,
            Document.status != DocumentStatus.DELETED,
        ).first()
        if not similar_doc or not similar_doc.container_id:
            continue
        cid = similar_doc.container_id
        if cid not in container_by_id:
            continue
        sim = float(similarity)
        max_similarity_by_container[cid] = max(max_similarity_by_container.get(cid, 0.0), sim)
    return max_similarity_by_container


def run_workspace_container_scoring(
    db: Session,
    document: Document,
    workspace_containers: list[Container],
    *,
    combined_text: str,
    body_text: str,
    filename_hint: str,
) -> tuple[dict[int, float], dict[int, float], dict[int, float], bool]:
    """
    Shared ranking for smart organization: per-document neighbors, chunk fallback, feedback + keyword boosts.

    Callers build ``combined_text`` / ``body_text`` / ``filename_hint`` (e.g. from chunks) so audit
    paths can distinguish empty indexed text vs no neighbor match.

    Returns:
        adjusted_scores: final score per container (capped at 1.0)
        raw_semantic: embedding-only max per container
        keyword_boosts: per-container name overlap boosts
        used_chunk_fallback: True if per-doc neighbors were empty and chunk search was used
    """
    from config import settings
    from utils.embeddings import embeddings_service

    container_by_id = {c.id: c for c in workspace_containers}
    workspace_id = document.workspace_id
    if workspace_id is None or not (combined_text or "").strip():
        return {}, {}, {}, False

    query_embedding = embeddings_service.generate_embedding(
        combined_text.strip()[: settings.suggestion_embed_max_chars]
    )
    feedback_boosts = workspace_feedback_boosts(db, workspace_id)

    per_doc_rows = embeddings_service.find_top_chunk_per_document(
        query_embedding,
        workspace_id,
        db=db,
        max_documents=settings.suggestion_neighbor_max_docs,
        min_similarity=settings.suggestion_min_doc_similarity,
    )
    raw = max_container_scores_from_embedding_rows(db, document, per_doc_rows, container_by_id)
    used_fallback = False
    if not raw:
        used_fallback = True
        similar_rows = embeddings_service.find_similar_embeddings(
            query_embedding,
            workspace_id,
            limit=settings.suggestion_fallback_chunk_limit,
            threshold=settings.suggestion_fallback_threshold,
            db=db,
        )
        raw = max_container_scores_from_embedding_rows(db, document, similar_rows, container_by_id)

    doc_tokens = suggestion_tokens(filename_hint, body_text[:2500])
    kw_boosts = container_name_keyword_boosts(
        doc_tokens,
        workspace_containers,
        max_boost=settings.suggestion_keyword_boost_max,
    )

    adjusted_scores: dict[int, float] = {}
    for container_id, rsim in raw.items():
        adjusted_scores[container_id] = min(
            1.0,
            rsim + feedback_boosts.get(container_id, 0.0) + kw_boosts.get(container_id, 0.0),
        )
    return adjusted_scores, raw, kw_boosts, used_fallback


def infer_auto_container_name(document: Document) -> str:
    """Fallback folder name from filename only (no prefix)."""
    stem = os.path.splitext(document.filename or "")[0]
    tokens = [part for part in re.split(r"[^A-Za-z0-9]+", stem) if part]
    if not tokens:
        return "New folder"
    topic = " ".join(tokens[:3]).title().strip()
    return topic if topic else "New folder"


def ensure_workspace_container(
    db: Session,
    workspace_id: int,
    name: str,
    actor_user_id: int,
) -> tuple[Container, bool]:
    """Find or create a workspace container by name. Returns (container, was_created). Caller may create audit log when was_created."""
    existing = db.query(Container).filter(
        Container.workspace_id == workspace_id,
        func.lower(Container.name) == func.lower(name),
    ).first()
    if existing:
        return (existing, False)

    created = Container(
        workspace_id=workspace_id,
        name=name,
        color="#6f93ff",
        created_by=actor_user_id,
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return (created, True)


def workspace_feedback_boosts(db: Session, workspace_id: int, limit: int = 400) -> dict[int, float]:
    """Learn from accepted moves in this workspace and boost likely destination containers."""
    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.workspace_id == workspace_id,
            AuditLog.action == AuditActions.DOCUMENT_CONTAINER_SUGGESTION_APPLIED,
        )
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )

    counts: dict[int, int] = {}
    for row in rows:
        metadata = row.metadata_json or {}
        if isinstance(metadata, str):
            try:
                import json
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            continue
        container_id = metadata.get("new_container_id")
        if not isinstance(container_id, (int, float, str)):
            continue
        try:
            normalized = int(container_id)
        except (TypeError, ValueError):
            continue
        weight = 2 if metadata.get("corrected") else 1
        counts[normalized] = counts.get(normalized, 0) + weight

    return {cid: min(0.18, 0.035 * math.log1p(count)) for cid, count in counts.items()}


async def delete_document_and_relations(db: Session, document: Document) -> tuple[int | None, int | None, str]:
    """
    Delete document, all related DB rows, and storage file. Commits on success.
    Returns (workspace_id, container_id, filename) for audit/notify.
    Raises on failure; caller does not need to rollback (this function does not catch).
    """
    workspace_id = document.workspace_id
    container_id = document.container_id
    filename = document.filename or ""
    bucket, path = parse_storage_uri(document.storage_uri)

    chunk_ids = [row[0] for row in db.query(DocumentChunk.id).filter(
        DocumentChunk.document_id == document.id
    ).all()]

    if chunk_ids:
        db.query(ChunkEmbedding).filter(
            ChunkEmbedding.chunk_id.in_(chunk_ids)
        ).delete(synchronize_session=False)

    db.query(DocumentChunk).filter(
        DocumentChunk.document_id == document.id
    ).delete(synchronize_session=False)

    db.query(DocumentHint).filter(
        DocumentHint.document_id == document.id
    ).delete(synchronize_session=False)

    db.query(EmbeddingJob).filter(
        EmbeddingJob.document_id == document.id
    ).delete(synchronize_session=False)

    db.query(Summary).filter(
        Summary.document_id == document.id
    ).update({Summary.document_id: None}, synchronize_session=False)

    db.query(DocumentDuplicate).filter(
        DocumentDuplicate.duplicate_of_id == document.id
    ).update({DocumentDuplicate.duplicate_of_id: None}, synchronize_session=False)

    db.query(DocumentDuplicate).filter(
        DocumentDuplicate.document_id == document.id
    ).delete(synchronize_session=False)

    db.delete(document)
    db.flush()
    await storage.delete(bucket=bucket, path=path)
    db.commit()

    return (workspace_id, container_id, filename)
