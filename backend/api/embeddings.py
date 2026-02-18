"""
API endpoints for embeddings and AI features
Handles duplicate detection, hints, similarity search, etc.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from utils.auth import get_current_user
from utils.authorization import check_workspace_access
from models.user import User
from models.document_duplicate import DocumentDuplicate, DuplicateStatus
from models.document_hint import DocumentHint
from models.embedding_job import EmbeddingJob, EmbeddingJobStatus
from utils.embeddings import embeddings_service

router = APIRouter(prefix="/embeddings", tags=["Embeddings & AI Features"])


# ============= Pydantic Models =============

class DuplicateCheckRequest(BaseModel):
    """Request to check if a document is a duplicate"""
    document_id: int
    similarity_threshold: float = 0.95


class DuplicateCheckResponse(BaseModel):
    """Response to duplicate check"""
    is_duplicate: bool
    duplicate_of_id: Optional[int] = None
    similarity_score: float = 0.0
    message: str


class DocumentHintResponse(BaseModel):
    """Response for document hints"""
    id: int
    hint_type: str
    content: str
    ai_suggested: bool
    confidence_score: Optional[int]
    dismissed: bool
    
    class Config:
        from_attributes = True


class EmbeddingJobResponse(BaseModel):
    """Response for embedding job status"""
    id: int
    document_id: int
    status: str
    chunks_processed: int
    total_chunks: int
    tokens_used: int
    model_used: str
    error_message: Optional[str]
    
    class Config:
        from_attributes = True


# ============= Endpoints =============

@router.post("/check-duplicate")
async def check_duplicate(
    request: DuplicateCheckRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Check if a document is a duplicate of another document
    
    Returns:
        - is_duplicate: Whether duplicate found
        - duplicate_of_id: ID of the original document (if duplicate)
        - similarity_score: Cosine similarity (0-1)
    """
    # Check workspace access
    from models.document import Document
    doc = db.query(Document).filter(Document.id == request.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    try:
        # Check for existing duplicate record
        existing_dup = db.query(DocumentDuplicate).filter(
            DocumentDuplicate.document_id == request.document_id
        ).first()
        
        if existing_dup and existing_dup.status != DuplicateStatus.FLAGGED:
            return DuplicateCheckResponse(
                is_duplicate=existing_dup.duplicate_of_id is not None,
                duplicate_of_id=existing_dup.duplicate_of_id,
                similarity_score=existing_dup.similarity_score,
                message=f"Duplicate status: {existing_dup.status.value}"
            )
        
        return DuplicateCheckResponse(
            is_duplicate=False,
            similarity_score=0.0,
            message="No duplicates detected"
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error checking duplicates: {str(e)}"
        )


@router.get("/documents/{document_id}/hints", response_model=List[DocumentHintResponse])
async def get_document_hints(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get AI-generated hints and reminders for a document
    
    Includes:
    - Expiration dates detected
    - Action items from content
    - Review reminders
    - Context-specific tips
    """
    from models.document import Document
    
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    hints = db.query(DocumentHint).filter(
        DocumentHint.document_id == document_id,
        DocumentHint.dismissed == False
    ).all()
    
    return hints


@router.post("/documents/{document_id}/hints/{hint_id}/acknowledge")
async def acknowledge_hint(
    document_id: int,
    hint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a hint as acknowledged by the user"""
    from models.document import Document
    from datetime import datetime
    
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    hint = db.query(DocumentHint).filter(
        DocumentHint.id == hint_id,
        DocumentHint.document_id == document_id
    ).first()
    
    if not hint:
        raise HTTPException(status_code=404, detail="Hint not found")
    
    hint.acknowledged_by = current_user.id
    hint.acknowledged_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Hint acknowledged"}


@router.post("/documents/{document_id}/hints/{hint_id}/dismiss")
async def dismiss_hint(
    document_id: int,
    hint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Dismiss a hint (hide it but don't delete)"""
    from models.document import Document
    from datetime import datetime
    
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    hint = db.query(DocumentHint).filter(
        DocumentHint.id == hint_id,
        DocumentHint.document_id == document_id
    ).first()
    
    if not hint:
        raise HTTPException(status_code=404, detail="Hint not found")
    
    hint.dismissed = True
    hint.dismissed_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Hint dismissed"}


@router.get("/jobs/{job_id}", response_model=EmbeddingJobResponse)
async def get_embedding_job_status(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get status of an embedding job"""
    job = db.query(EmbeddingJob).filter(EmbeddingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Check workspace access via document
    from models.document import Document
    doc = db.query(Document).filter(Document.id == job.document_id).first()
    check_workspace_access(current_user, doc.workspace_id, db)
    
    return job


@router.get("/documents/{document_id}/similar")
async def find_similar_documents(
    document_id: int,
    limit: int = 5,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Find documents semantically similar to the given document
    
    Useful for:
    - "See also" recommendations
    - Finding related documents
    - Identifying potential duplicates
    """
    from models.document import Document
    from models.chunk_embedding import ChunkEmbedding
    from models.document_chunk import DocumentChunk
    
    # Verify document exists and user has access
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    # Get first embedding from document
    first_chunk = db.query(DocumentChunk).filter(
        DocumentChunk.document_id == document_id,
        DocumentChunk.chunk_index == 0
    ).first()
    
    if not first_chunk:
        raise HTTPException(status_code=400, detail="Document has no processed chunks")
    
    embedding = db.query(ChunkEmbedding).filter(
        ChunkEmbedding.chunk_id == first_chunk.id
    ).first()
    
    if not embedding:
        raise HTTPException(status_code=400, detail="Document has no embeddings")
    
    try:
        similar_docs = await embeddings_service.find_similar_embeddings(
            embedding.embedding,
            doc.workspace_id,
            limit=limit + 1,  # +1 to exclude the document itself
            threshold=0.7,
            db=db
        )
        
        # Filter out the document itself
        similar_docs = [
            (doc_id, score) for doc_id, score in similar_docs
            if doc_id != document_id
        ][:limit]
        
        # Fetch document info
        doc_ids = [doc_id for doc_id, _ in similar_docs]
        similar_doc_records = db.query(Document).filter(Document.id.in_(doc_ids)).all()
        
        return {
            "document_id": document_id,
            "similar_documents": [
                {
                    "id": next(d.id for d in similar_doc_records if d.id == doc_id),
                    "filename": next(d.filename for d in similar_doc_records if d.id == doc_id),
                    "similarity_score": score
                }
                for doc_id, score in similar_docs
            ]
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error finding similar documents: {str(e)}"
        )


@router.get("/documents/{document_id}/job")
async def get_document_embedding_job(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the embedding job status for a document"""
    from models.document import Document
    
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    check_workspace_access(current_user, doc.workspace_id, db)
    
    job = db.query(EmbeddingJob).filter(
        EmbeddingJob.document_id == document_id
    ).order_by(EmbeddingJob.created_at.desc()).first()
    
    if not job:
        return {"message": "No embedding job found for this document"}
    
    return {
        "job_id": job.id,
        "status": job.status.value,
        "progress": f"{job.chunks_processed}/{job.total_chunks}",
        "error": job.error_message
    }
