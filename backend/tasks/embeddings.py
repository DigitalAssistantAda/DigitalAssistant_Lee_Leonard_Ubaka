"""
Celery tasks for embeddings and document processing
Handles async embedding generation, deduplication, and AI hint generation
Uses local Ollama for embeddings (free, private, no API costs)
"""
from celery import shared_task
from celery.utils.log import get_task_logger
from typing import List
import json
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
from utils.storage import get_storage_backend
from sqlalchemy.orm import Session

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


@shared_task(bind=True, max_retries=3)
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
        
        # Step 1: Extract text (assuming already done during upload, fetch from storage)
        text = _run_async(_extract_text(document, db))
        if not text:
            raise ValueError(f"No extractable text found in document {document_id}")
        
        # Step 2: Chunk the text
        chunks = _chunk_text(text, chunk_size=500, overlap=100)
        if not chunks:
            raise ValueError("Text chunking produced no chunks")
        
        logger.info(f"Created {len(chunks)} chunks for document {document_id}")
        
        # Step 3: Generate embeddings for all chunks
        embeddings = _run_async(embeddings_service.generate_batch_embeddings(chunks))
        
        # Step 4: Store chunks and embeddings in database
        chunk_embeddings = []
        for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
            # Create chunk record
            chunk = DocumentChunk(
                document_id=document_id,
                chunk_index=i,
                text=chunk_text,
                token_count=len(chunk_text.split())  # Rough estimate
            )
            db.add(chunk)
            db.flush()  # Get chunk ID
            
            # Create embedding record
            chunk_emb = ChunkEmbedding(
                chunk_id=chunk.id,
                model_name=embeddings_service.model_name,
                embedding=embedding
            )
            db.add(chunk_emb)
            chunk_embeddings.append(chunk_emb)
        
        db.commit()
        
        logger.info(f"Stored {len(chunk_embeddings)} embeddings for document {document_id}")
        
        # Step 5: Check for duplicates
        _run_async(_check_and_flag_duplicates(document, embeddings, db))
        
        # Step 6: Generate AI hints/suggestions
        _run_async(_generate_hints(document_id, chunks, db))
        
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
            "embeddings_generated": len(chunk_embeddings),
        }
    
    except Exception as e:
        logger.error(f"Error processing document {document_id}: {str(e)}")
        
        # Update job with error
        job = db.query(EmbeddingJob).filter(EmbeddingJob.document_id == document_id).first()
        if job:
            job.status = EmbeddingJobStatus.FAILED
            job.error_message = str(e)
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
            "error": str(e),
            "retries": self.request.retries,
        }
    
    finally:
        db.close()


async def _extract_text(document: Document, db: Session) -> str:
    """Extract text from document (stub - implement based on file type)"""
    # This is a placeholder - real implementation would:
    # 1. Download from storage (S3/MinIO)
    # 2. Parse based on mime_type (PDF, DOCX, TXT, etc.)
    # 3. Return extracted text
    
    logger.info(f"Would extract text from {document.filename}")
    # For now, return empty - this will be implemented separately
    return ""


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
    
    chunks = []
    start = 0
    
    while start < len(text):
        # Find end of chunk
        end = min(start + chunk_size, len(text))
        
        # If not at end of text, try to break at sentence boundary
        if end < len(text):
            # Look for last period, comma, or newline
            for delimiter in ['. ', ', ', '\n']:
                last_delim = text.rfind(delimiter, start, end)
                if last_delim > start:
                    end = last_delim + len(delimiter)
                    break
        
        chunks.append(text[start:end].strip())
        
        # Move start position with overlap
        start = end - overlap
    
    return [chunk for chunk in chunks if chunk]  # Remove empty chunks


async def _check_and_flag_duplicates(document: Document, embeddings: List[List[float]], db: Session) -> None:
    """Check new document against existing ones and flag duplicates"""
    
    # For each embedding, find similar documents
    for embedding in embeddings[:1]:  # Just check first chunk for now
        is_duplicate, dup_doc_id, similarity = await embeddings_service.check_duplicate(
            embedding,
            document.workspace_id,
            similarity_threshold=0.95,
            db=db
        )
        
        if is_duplicate:
            logger.warning(f"Document {document.id} is duplicate of {dup_doc_id} (similarity: {similarity})")
            
            # Create duplicate record
            dup_record = DocumentDuplicate(
                document_id=document.id,
                duplicate_of_id=dup_doc_id,
                similarity_score=similarity,
                status=DuplicateStatus.FLAGGED
            )
            db.add(dup_record)
            db.commit()


async def _generate_hints(document_id: int, chunks: List[str], db: Session) -> None:
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
