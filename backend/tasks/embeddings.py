"""
Celery tasks for embeddings and document processing
Handles async embedding generation, deduplication, and AI hint generation
Uses local Ollama for embeddings (free, private, no API costs)
"""
from celery.utils.log import get_task_logger
from typing import List
import asyncio
from datetime import datetime

from database import SessionLocal
from models.document import Document
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.embedding_job import EmbeddingJob, EmbeddingJobStatus
from models.document_duplicate import DocumentDuplicate, DuplicateStatus
from models.document_hint import DocumentHint
from utils.embeddings import embeddings_service
from utils.text_extraction import extract_text_from_storage
from sqlalchemy.orm import Session
from celery_app import celery_app

logger = get_task_logger(__name__)


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
        document.status = "ready"
        db.commit()
        
        logger.info(f"Completed embedding job for document {document_id}")
        
        return {
            "document_id": document_id,
            "status": "success",
            "chunks_processed": len(chunks),
            "embeddings_generated": embeddings_generated,
        }
    
    except Exception as e:
        db.rollback()
        logger.exception("Error processing document_id=%s", document_id)
        
        # Update job with error
        job = db.query(EmbeddingJob).filter(EmbeddingJob.document_id == document_id).first()
        if job:
            job.status = EmbeddingJobStatus.FAILED
            job.error_message = "Document processing failed."
            job.retry_count = self.request.retries
            db.commit()
        
        # Update document status
        document = db.query(Document).filter(Document.id == document_id).first()
        if document:
            document.status = "failed"
            db.commit()
        
        # Retry with exponential backoff
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))
        
        return {
            "document_id": document_id,
            "status": "failed",
            "error": "Document processing failed.",
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
