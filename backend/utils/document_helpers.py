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
from models.document import Document
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.document_hint import DocumentHint
from models.document_duplicate import DocumentDuplicate
from models.summary import Summary
from models.job import Job
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

    db.query(Job).filter(
        Job.document_id == document.id
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
