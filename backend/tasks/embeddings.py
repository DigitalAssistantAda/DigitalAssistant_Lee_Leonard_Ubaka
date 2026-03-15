"""
Celery tasks for embeddings and document processing
Handles async embedding generation, deduplication, and AI hint generation
Uses local Ollama for embeddings (free, private, no API costs)
"""
from celery.utils.log import get_task_logger
from typing import List, Optional
import asyncio
from datetime import datetime
import os
import re
import math

from database import SessionLocal
from models.document import Document, DocumentStatus
from models.container import Container
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.embedding_job import EmbeddingJob, EmbeddingJobStatus
from models.document_duplicate import DocumentDuplicate, DuplicateStatus
from models.document_hint import DocumentHint
from models.workspace import Workspace
from models.embedding_training_job import (
    EmbeddingTrainingJob,
    EmbeddingTrainingJobType,
    EmbeddingTrainingJobStatus,
)
from models.audit_log import AuditLog
from utils.audit import AuditActions
from utils.embeddings import embeddings_service, reset_embeddings_service
from utils.text_extraction import extract_text_from_storage
from sqlalchemy.orm import Session
from sqlalchemy import func
from celery_app import celery_app

logger = get_task_logger(__name__)


def _confidence_label(score: float) -> str:
    if score >= 0.78:
        return "high"
    if score >= 0.62:
        return "medium"
    return "low"


def _infer_auto_container_name(document: Document) -> str:
    """Fallback folder name from filename (no prefix)."""
    stem = os.path.splitext(document.filename or "")[0]
    tokens = [part for part in re.split(r"[^A-Za-z0-9]+", stem) if part]
    if not tokens:
        return "New folder"
    topic = " ".join(tokens[:3]).title().strip()
    return topic if topic else "New folder"


def _ensure_workspace_container(db: Session, workspace_id: int, name: str, actor_user_id: int) -> Container:
    existing = db.query(Container).filter(
        Container.workspace_id == workspace_id,
        func.lower(Container.name) == func.lower(name),
    ).first()
    if existing:
        return existing

    created = Container(
        workspace_id=workspace_id,
        name=name,
        color="#6f93ff",
        created_by=actor_user_id,
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return created


def _workspace_feedback_boosts(db: Session, workspace_id: int, limit: int = 400) -> dict[int, float]:
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
        if not isinstance(metadata, dict):
            continue
        container_id = metadata.get("new_container_id")
        try:
            normalized = int(container_id)
        except (TypeError, ValueError):
            continue
        counts[normalized] = counts.get(normalized, 0) + 1

    return {cid: min(0.18, 0.035 * math.log1p(count)) for cid, count in counts.items()}


def _auto_organize_document_after_index(document: Document, db: Session, actor_user_id: int | None) -> bool:
    """Move newly indexed doc into best-matching container when workspace autonomous mode is enabled."""
    if not document.workspace_id or document.status != DocumentStatus.READY:
        return False

    workspace = db.query(Workspace).filter(Workspace.id == document.workspace_id).first()
    if not workspace or not workspace.autonomous_organization_enabled:
        return False

    containers = db.query(Container).filter(Container.workspace_id == document.workspace_id).all()
    if not containers:
        inferred_container = _ensure_workspace_container(
            db=db,
            workspace_id=document.workspace_id,
            name=_infer_auto_container_name(document),
            actor_user_id=actor_user_id or document.uploaded_by,
        )
        if document.container_id == inferred_container.id:
            return False
        previous_container_id = document.container_id
        document.container_id = inferred_container.id
        db.commit()

        audit_actor = actor_user_id or document.uploaded_by
        db.add(AuditLog(
            workspace_id=document.workspace_id,
            actor_user_id=audit_actor,
            action=AuditActions.DOCUMENT_CONTAINER_SUGGESTION_APPLIED,
            object_type="document",
            object_id=document.id,
            metadata_json={
                "trigger": "autonomous_organization_auto_create",
                "old_container_id": previous_container_id,
                "new_container_id": inferred_container.id,
                "confidence": "low",
                "score": 0.0,
            },
            created_at=datetime.utcnow(),
        ))
        db.commit()
        return True
    container_ids = {container.id for container in containers}

    chunks = db.query(DocumentChunk).filter(
        DocumentChunk.document_id == document.id,
    ).order_by(DocumentChunk.chunk_index.asc()).limit(4).all()
    combined_text = "\n".join((chunk.text or "") for chunk in chunks).strip()
    if not combined_text:
        return False

    try:
        query_embedding = embeddings_service.generate_embedding(combined_text[:6000])
        similar_rows = embeddings_service.find_similar_embeddings(
            query_embedding=query_embedding,
            workspace_id=document.workspace_id,
            limit=120,
            threshold=0.2,
            db=db,
        )
    except Exception as exc:
        logger.warning(
            "Autonomous organization similarity lookup failed for document_id=%s workspace_id=%s: %s",
            document.id,
            document.workspace_id,
            exc,
        )
        return False

    max_similarity_by_container: dict[int, float] = {}
    feedback_boosts = _workspace_feedback_boosts(db, document.workspace_id)
    for _chunk_id, similar_doc_id, similarity in similar_rows:
        if similar_doc_id == document.id:
            continue
        similar_doc = db.query(Document).filter(
            Document.id == similar_doc_id,
            Document.workspace_id == document.workspace_id,
            Document.status != DocumentStatus.DELETED,
        ).first()
        if not similar_doc or not similar_doc.container_id:
            continue
        if similar_doc.container_id not in container_ids:
            continue
        sim = float(similarity)
        max_similarity_by_container[similar_doc.container_id] = max(
            max_similarity_by_container.get(similar_doc.container_id, 0.0),
            sim,
        )

    if not max_similarity_by_container:
        inferred_container = _ensure_workspace_container(
            db=db,
            workspace_id=document.workspace_id,
            name=_infer_auto_container_name(document),
            actor_user_id=actor_user_id or document.uploaded_by,
        )
        if document.container_id == inferred_container.id:
            return False

        previous_container_id = document.container_id
        document.container_id = inferred_container.id
        db.commit()

        audit_actor = actor_user_id or document.uploaded_by
        db.add(AuditLog(
            workspace_id=document.workspace_id,
            actor_user_id=audit_actor,
            action=AuditActions.DOCUMENT_CONTAINER_SUGGESTION_APPLIED,
            object_type="document",
            object_id=document.id,
            metadata_json={
                "trigger": "autonomous_organization_auto_create",
                "old_container_id": previous_container_id,
                "new_container_id": inferred_container.id,
                "confidence": "low",
                "score": 0.0,
            },
            created_at=datetime.utcnow(),
        ))
        db.commit()
        return True

    adjusted_scores = {
        container_id: score + feedback_boosts.get(container_id, 0.0)
        for container_id, score in max_similarity_by_container.items()
    }

    best_container_id, best_score = max(adjusted_scores.items(), key=lambda item: item[1])
    confidence = _confidence_label(best_score)

    # Autonomous mode only applies high-confidence moves.
    if confidence != "high":
        return False

    if document.container_id == best_container_id:
        return False

    previous_container_id = document.container_id
    document.container_id = best_container_id
    db.commit()

    audit_actor = actor_user_id or document.uploaded_by
    db.add(AuditLog(
        workspace_id=document.workspace_id,
        actor_user_id=audit_actor,
        action=AuditActions.DOCUMENT_CONTAINER_SUGGESTION_APPLIED,
        object_type="document",
        object_id=document.id,
        metadata_json={
            "trigger": "autonomous_organization",
            "old_container_id": previous_container_id,
            "new_container_id": best_container_id,
            "confidence": confidence,
            "score": round(best_score, 3),
        },
        created_at=datetime.utcnow(),
    ))
    db.commit()
    logger.info(
        "Autonomous organization moved document_id=%s workspace_id=%s from_container=%s to_container=%s score=%.3f",
        document.id,
        document.workspace_id,
        previous_container_id,
        best_container_id,
        best_score,
    )
    return True


def _run_async(coro):
    """Helper to run async functions in Celery tasks"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is running, create new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    return loop.run_until_complete(coro)


@celery_app.task(bind=True, max_retries=3)
def process_document_embeddings(self, document_id: int, triggered_by_user_id: int = None) -> dict:
    """
    Main task: Extract text from document, chunk it, and generate embeddings
    
    Args:
        document_id: ID of document to process
        triggered_by_user_id: User who triggered this task
        
    Returns:
        Dict with status and metrics
    """
    db = SessionLocal()
    
    try:
        # Fetch document
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            raise ValueError(f"Document {document_id} not found")
        
        # Create/update embedding job
        job = db.query(EmbeddingJob).filter(EmbeddingJob.document_id == document_id).first()
        if not job:
            job = EmbeddingJob(
                document_id=document_id,
                model_used=embeddings_service.model_name,
                triggered_by=triggered_by_user_id,
                celery_task_id=self.request.id
            )
            db.add(job)
        
        job.status = EmbeddingJobStatus.PROCESSING
        job.started_at = datetime.utcnow()
        db.commit()
        
        logger.info(f"Starting embedding job for document {document_id}")
        
        # Step 1: Extract text from storage
        text = _run_async(extract_text_from_storage(document))
        if not text:
            raise ValueError(f"No extractable text found in document {document_id}")
        logger.info(f"Extracted text for document {document_id} (chars={len(text)})")
        
        # Step 2: Chunk the text
        chunks = _chunk_text(text, chunk_size=500, overlap=100)
        if not chunks:
            raise ValueError("Text chunking produced no chunks")
        
        logger.info(f"Created {len(chunks)} chunks for document {document_id}")
        job.total_chunks = len(chunks)
        job.chunks_processed = 0
        db.commit()
        
        # Step 3/4: Generate and store embeddings in batches
        batch_size = 25
        embeddings_generated = 0
        first_embedding = None

        for start_index in range(0, len(chunks), batch_size):
            end_index = min(start_index + batch_size, len(chunks))
            batch_chunks = chunks[start_index:end_index]
            logger.info(
                "Generating embeddings for document %s chunks %s-%s",
                document_id,
                start_index,
                end_index - 1,
            )

            batch_embeddings = embeddings_service.generate_batch_embeddings(batch_chunks)

            for offset, (chunk_text, embedding) in enumerate(zip(batch_chunks, batch_embeddings)):
                chunk_index = start_index + offset

                chunk = DocumentChunk(
                    document_id=document_id,
                    chunk_index=chunk_index,
                    text=chunk_text,
                    token_count=len(chunk_text.split())
                )
                db.add(chunk)
                db.flush()

                chunk_emb = ChunkEmbedding(
                    chunk_id=chunk.id,
                    model_name=embeddings_service.model_name,
                    embedding=embedding
                )
                db.add(chunk_emb)

                if first_embedding is None:
                    first_embedding = embedding

                embeddings_generated += 1

            job.chunks_processed = embeddings_generated
            db.commit()

        logger.info(f"Stored {embeddings_generated} embeddings for document {document_id}")
        
        # Step 5: Check for duplicates
        if first_embedding is not None:
            try:
                _check_and_flag_duplicates(document, first_embedding, db)
            except Exception:
                db.rollback()
                logger.warning(
                    "Duplicate check failed for document_id=%s workspace_id=%s",
                    document_id,
                    document.workspace_id,
                )
        
        # Step 6: Generate AI hints/suggestions
        try:
            _generate_hints(document_id, chunks, db)
        except Exception:
            db.rollback()
            logger.warning(
                "Hint generation failed for document_id=%s workspace_id=%s",
                document_id,
                document.workspace_id,
            )
        
        # Update job status
        job.status = EmbeddingJobStatus.COMPLETE
        job.chunks_processed = len(chunks)
        job.total_chunks = len(chunks)
        job.completed_at = datetime.utcnow()
        db.commit()
        
        # Update document status
        document.status = DocumentStatus.READY
        db.commit()

        try:
            _auto_organize_document_after_index(document, db, triggered_by_user_id)
        except Exception as exc:
            db.rollback()
            logger.warning(
                "Autonomous organization post-index hook failed for document_id=%s workspace_id=%s: %s",
                document_id,
                document.workspace_id,
                exc,
            )
        
        logger.info(f"Completed embedding job for document {document_id}")
        
        return {
            "document_id": document_id,
            "status": "success",
            "chunks_processed": len(chunks),
            "embeddings_generated": embeddings_generated,
        }
    
    except Exception as e:
        db.rollback()
        error_msg = str(e) or "Document processing failed."
        logger.exception("Error processing document_id=%s: %s", document_id, error_msg)
        
        # Update job with actual error so users can see why it failed
        job = db.query(EmbeddingJob).filter(EmbeddingJob.document_id == document_id).first()
        if job:
            job.status = EmbeddingJobStatus.FAILED
            job.error_message = error_msg[:2000]  # cap length for DB
            job.retry_count = self.request.retries
            db.commit()
        
        # Update document status
        document = db.query(Document).filter(Document.id == document_id).first()
        if document:
            document.status = DocumentStatus.FAILED
            db.commit()
        
        # Retry with exponential backoff
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))
        
        return {
            "document_id": document_id,
            "status": "failed",
            "error": error_msg,
            "retries": self.request.retries,
        }
    
    finally:
        db.close()


def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
    """
    Split text into overlapping chunks for embedding
    
    Args:
        text: Text to chunk
        chunk_size: Target chunk size in characters
        overlap: Overlap between chunks
        
    Returns:
        List of text chunks
    """
    if not text:
        return []
    
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than 0")

    if overlap < 0:
        overlap = 0

    if overlap >= chunk_size:
        overlap = max(0, chunk_size // 5)

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        # Find end of chunk
        end = min(start + chunk_size, text_length)
        
        # If not at end of text, try to break at sentence boundary
        if end < text_length:
            # Look for last period, comma, or newline
            for delimiter in ['. ', ', ', '\n']:
                last_delim = text.rfind(delimiter, start, end)
                if last_delim > start:
                    end = last_delim + len(delimiter)
                    break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= text_length:
            break

        next_start = end - overlap
        if next_start <= start:
            next_start = end
        start = next_start
    
    return [chunk for chunk in chunks if chunk]  # Remove empty chunks


def _check_and_flag_duplicates(document: Document, first_embedding: List[float], db: Session) -> None:
    """Check new document against existing ones and flag duplicates"""
    is_duplicate, dup_doc_id, similarity = embeddings_service.check_duplicate(
        first_embedding,
        document.workspace_id,
        similarity_threshold=0.95,
        db=db
    )

    if is_duplicate:
        logger.warning(f"Document {document.id} is duplicate of {dup_doc_id} (similarity: {similarity})")

        dup_record = DocumentDuplicate(
            document_id=document.id,
            duplicate_of_id=dup_doc_id,
            similarity_score=similarity,
            status=DuplicateStatus.FLAGGED
        )
        db.add(dup_record)
        db.commit()


def _generate_hints(document_id: int, chunks: List[str], db: Session) -> None:
    """Generate AI hints based on document content (stub)"""
    
    # This is a placeholder - would use LLM to analyze chunks
    # Look for keywords like:
    # - "expires", "expiration", "renewal" -> expiration hint
    # - "must review", "to be reviewed" -> review_needed hint
    # - "deadline", "due date" -> action_required hint
    
    logger.info(f"Would generate hints for document {document_id}")
    
    # For now, just create a placeholder hint
    hint = DocumentHint(
        document_id=document_id,
        hint_type="processing_complete",
        content="Document successfully processed and indexed.",
        ai_suggested=False
    )
    db.add(hint)
    db.commit()


# ---------- Embedding refresh and fine-tune tasks ----------


@celery_app.task(bind=True)
def refresh_all_embeddings(
    self,
    workspace_id: Optional[int] = None,
    training_job_id: Optional[int] = None,
    triggered_by_user_id: Optional[int] = None,
) -> dict:
    """
    Re-embed all documents (optionally in a workspace). Clears existing chunks/embeddings
    and re-queues process_document_embeddings for each document.
    """
    db = SessionLocal()
    job = None
    try:
        if training_job_id:
            job = db.query(EmbeddingTrainingJob).filter(EmbeddingTrainingJob.id == training_job_id).first()
            if job:
                job.status = EmbeddingTrainingJobStatus.RUNNING
                job.started_at = datetime.utcnow()
                job.celery_task_id = self.request.id
                db.commit()

        # Documents that are READY (have been indexed) or have chunks
        q = db.query(Document.id).filter(Document.status != DocumentStatus.DELETED)
        if workspace_id is not None:
            q = q.filter(Document.workspace_id == workspace_id)
        doc_ids = [r[0] for r in q.distinct().all()]

        if training_job_id and job:
            job.documents_total = len(doc_ids)
            db.commit()

        processed = 0
        for document_id in doc_ids:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if not doc:
                continue
            # Delete chunk_embeddings for chunks of this document
            chunk_ids = db.query(DocumentChunk.id).filter(DocumentChunk.document_id == document_id).all()
            chunk_ids = [c[0] for c in chunk_ids]
            if chunk_ids:
                db.query(ChunkEmbedding).filter(ChunkEmbedding.chunk_id.in_(chunk_ids)).delete(
                    synchronize_session=False
                )
            db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete(
                synchronize_session=False
            )
            doc.status = DocumentStatus.PENDING
            db.commit()
            process_document_embeddings.delay(document_id, triggered_by_user_id)
            processed += 1
            if training_job_id and job:
                job.documents_processed = processed
                db.commit()

        if training_job_id and job:
            job.status = EmbeddingTrainingJobStatus.COMPLETE
            job.documents_processed = processed
            job.completed_at = datetime.utcnow()
            db.commit()

        return {"status": "ok", "documents_queued": processed}
    except Exception as e:
        if training_job_id:
            job = db.query(EmbeddingTrainingJob).filter(EmbeddingTrainingJob.id == training_job_id).first()
            if job:
                job.status = EmbeddingTrainingJobStatus.FAILED
                job.error_message = str(e)[:2000]
                job.completed_at = datetime.utcnow()
                db.commit()
        logger.exception("refresh_all_embeddings failed: %s", e)
        raise
    finally:
        db.close()


def _build_finetune_dataset(db: Session, workspace_id: Optional[int], max_chunks: int = 50000):
    """Build (anchor, positive) pairs from adjacent chunks in same document for contrastive fine-tuning."""
    q = (
        db.query(DocumentChunk.document_id, DocumentChunk.text)
        .filter(DocumentChunk.text.isnot(None), DocumentChunk.text != "")
        .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
    )
    if workspace_id is not None:
        q = q.join(Document).filter(Document.workspace_id == workspace_id)
    rows = q.limit(max_chunks * 2).all()
    by_doc = {}
    for doc_id, text in rows:
        by_doc.setdefault(doc_id, []).append((text or "").strip())
    pairs = []
    for doc_id, texts in by_doc.items():
        for i in range(len(texts) - 1):
            if texts[i] and texts[i + 1]:
                pairs.append((texts[i], texts[i + 1]))
    return pairs


def _build_correction_pairs(db: Session, workspace_id: Optional[int], limit: int = 500):
    """Build (anchor, positive) pairs from user corrections: doc moved to container -> pair with chunk from that container."""
    from models.audit_log import AuditLog
    from utils.audit import AuditActions

    q = (
        db.query(AuditLog)
        .filter(AuditLog.action == AuditActions.DOCUMENT_CONTAINER_SUGGESTION_APPLIED)
        .order_by(AuditLog.created_at.desc())
        .limit(limit * 2)
    )
    if workspace_id is not None:
        q = q.filter(AuditLog.workspace_id == workspace_id)
    rows = q.all()
    pairs = []
    seen = set()
    for row in rows:
        meta = row.metadata_json or {}
        if isinstance(meta, str):
            try:
                import json
                meta = json.loads(meta)
            except Exception:
                meta = {}
        doc_id = meta.get("object_id") or row.object_id
        container_id = meta.get("new_container_id")
        if not isinstance(doc_id, (int, float)) or not isinstance(container_id, (int, float)):
            continue
        doc_id, container_id = int(doc_id), int(container_id)
        key = (doc_id, container_id)
        if key in seen:
            continue
        seen.add(key)
        chunk_moved = (
            db.query(DocumentChunk.text)
            .filter(DocumentChunk.document_id == doc_id, DocumentChunk.text.isnot(None), DocumentChunk.text != "")
            .order_by(DocumentChunk.chunk_index)
            .limit(1)
            .first()
        )
        if not chunk_moved or not (chunk_moved[0] or "").strip():
            continue
        other_doc = (
            db.query(Document.id)
            .filter(Document.container_id == container_id, Document.id != doc_id, Document.status != DocumentStatus.DELETED)
            .limit(1)
            .first()
        )
        if not other_doc:
            continue
        other_chunk = (
            db.query(DocumentChunk.text)
            .filter(DocumentChunk.document_id == other_doc[0], DocumentChunk.text.isnot(None), DocumentChunk.text != "")
            .order_by(DocumentChunk.chunk_index)
            .limit(1)
            .first()
        )
        if not other_chunk or not (other_chunk[0] or "").strip():
            continue
        a, b = (chunk_moved[0] or "").strip(), (other_chunk[0] or "").strip()
        if a and b:
            pairs.append((a, b))
    return pairs


@celery_app.task(bind=True)
def run_embedding_fine_tune(
    self,
    workspace_id: Optional[int] = None,
    training_job_id: Optional[int] = None,
    epochs: int = 1,
    trigger_refresh_after: bool = True,
) -> dict:
    """
    Fine-tune the local embedding model on document chunks (positive pairs from adjacent chunks),
    then optionally trigger refresh_all_embeddings. Only runs when EMBEDDING_SERVICE=local.
    """
    from config import settings as config_settings
    import os

    db = SessionLocal()
    job = None
    try:
        if config_settings.embedding_service.lower() != "local":
            return {"status": "skipped", "reason": "EMBEDDING_SERVICE is not local"}

        if training_job_id:
            job = db.query(EmbeddingTrainingJob).filter(EmbeddingTrainingJob.id == training_job_id).first()
            if job:
                job.status = EmbeddingTrainingJobStatus.RUNNING
                job.started_at = datetime.utcnow()
                job.celery_task_id = self.request.id
                db.commit()

        pairs = _build_finetune_dataset(db, workspace_id)
        correction_pairs = _build_correction_pairs(db, workspace_id, limit=500)
        pairs = pairs + correction_pairs[:2000]
        if len(pairs) < 10:
            if job:
                job.status = EmbeddingTrainingJobStatus.FAILED
                job.error_message = "Not enough chunk pairs for training (need at least 10)"
                job.completed_at = datetime.utcnow()
                db.commit()
            return {"status": "skipped", "reason": "Not enough document chunks for training", "pairs": len(pairs)}

        try:
            from sentence_transformers import SentenceTransformer
            from sentence_transformers import InputExample, losses
            from torch.utils.data import DataLoader
        except ImportError:
            if job:
                job.status = EmbeddingTrainingJobStatus.FAILED
                job.error_message = "sentence-transformers not installed"
                job.completed_at = datetime.utcnow()
                db.commit()
            return {"status": "failed", "error": "sentence-transformers not installed"}

        base_model = config_settings.local_embedding_model_path.strip() or config_settings.local_embedding_model
        model = SentenceTransformer(base_model)
        train_examples = [InputExample(texts=[a, b]) for a, b in pairs[:20000]]
        train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)
        train_loss = losses.MultipleNegativesRankingLoss(model)
        out_dir = os.path.join(config_settings.embedding_finetune_output_dir, "latest")
        os.makedirs(out_dir, exist_ok=True)
        model.fit(
            train_objectives=[(train_dataloader, train_loss)],
            epochs=epochs,
            output_path=out_dir,
        )
        reset_embeddings_service()

        if job:
            job.status = EmbeddingTrainingJobStatus.COMPLETE
            job.completed_at = datetime.utcnow()
            db.commit()

        if trigger_refresh_after:
            refresh_all_embeddings.delay(workspace_id=workspace_id, triggered_by_user_id=None)

        return {"status": "ok", "pairs_used": len(train_examples), "output_path": out_dir}
    except Exception as e:
        if training_job_id:
            job = db.query(EmbeddingTrainingJob).filter(EmbeddingTrainingJob.id == training_job_id).first()
        if job:
            job.status = EmbeddingTrainingJobStatus.FAILED
            job.error_message = str(e)[:2000]
            job.completed_at = datetime.utcnow()
            db.commit()
        logger.exception("run_embedding_fine_tune failed: %s", e)
        raise
    finally:
        db.close()
