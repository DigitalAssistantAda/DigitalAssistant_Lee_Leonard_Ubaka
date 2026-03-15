"""
Celery tasks for embeddings and document processing
Handles async embedding generation, deduplication, and AI hint generation
Uses local Ollama for embeddings (free, private, no API costs)
"""
from celery.utils.log import get_task_logger
from typing import List
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
from models.audit_log import AuditLog
from utils.audit import AuditActions
from utils.embeddings import embeddings_service
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
    stem = os.path.splitext(document.filename or "")[0]
    tokens = [part for part in re.split(r"[^A-Za-z0-9]+", stem) if part]
    if not tokens:
        return "Ada Organizing"
    topic = " ".join(tokens[:3]).title().strip()
    return f"Ada - {topic}" if topic else "Ada Organizing"


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
