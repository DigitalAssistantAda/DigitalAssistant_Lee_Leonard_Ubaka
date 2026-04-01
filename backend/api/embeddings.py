"""
API endpoints for embeddings and AI features
Handles duplicate detection, similarity search, etc.
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
from models.embedding_job import EmbeddingJob, EmbeddingJobStatus
from models.embedding_training_job import (
    EmbeddingTrainingJob,
    EmbeddingTrainingJobType,
    EmbeddingTrainingJobStatus,
)
from utils.embeddings import embeddings_service
from config import settings as config_settings

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


class EmbeddingModelInfo(BaseModel):
    """Current embedding model/service info"""
    service: str
    model_name: str
    embedding_dimension: int
    supports_fine_tune: bool


class RefreshRequest(BaseModel):
    workspace_id: Optional[int] = None


class FineTuneRequest(BaseModel):
    workspace_id: Optional[int] = None
    epochs: int = 1
    trigger_refresh_after: bool = True


class TrainingJobResponse(BaseModel):
    id: int
    job_type: str
    status: str
    workspace_id: Optional[int]
    documents_processed: Optional[int]
    documents_total: Optional[int]
    error_message: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    created_at: str
    celery_task_id: Optional[str]

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
        similar_docs = embeddings_service.find_similar_embeddings(
            embedding.embedding,
            doc.workspace_id,
            limit=limit + 1,  # +1 to exclude the document itself
            threshold=0.7,
            db=db
        )
        
        # Filter out the document itself
        similar_docs = [
            (chunk_id, doc_id, score) for chunk_id, doc_id, score in similar_docs
            if doc_id != document_id
        ][:limit]
        
        # Fetch document info
        doc_ids = [doc_id for _chunk_id, doc_id, _score in similar_docs]
        similar_doc_records = db.query(Document).filter(Document.id.in_(doc_ids)).all()
        
        return {
            "document_id": document_id,
            "similar_documents": [
                {
                    "id": next(d.id for d in similar_doc_records if d.id == doc_id),
                    "filename": next(d.filename for d in similar_doc_records if d.id == doc_id),
                    "similarity_score": score
                }
                for _chunk_id, doc_id, score in similar_docs
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


# ---------- Embedding model management (local model, fine-tune, refresh) ----------


@router.get("/model", response_model=EmbeddingModelInfo)
async def get_embedding_model_info(current_user: User = Depends(get_current_user)):
    """Return current embedding service type, model name, and dimension. Supports fine-tune only when service is local."""
    try:
        svc = embeddings_service
        return EmbeddingModelInfo(
            service=config_settings.embedding_service,
            model_name=svc.model_name,
            embedding_dimension=svc.embedding_dimension,
            supports_fine_tune=config_settings.embedding_service.lower() == "local",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh")
async def trigger_embedding_refresh(
    request: Optional[RefreshRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-embed all documents (optionally in a workspace). Queues a background job; use GET /embeddings/training/jobs to poll status."""
    from tasks.embeddings import refresh_all_embeddings

    req = request if request is not None else RefreshRequest()
    job = EmbeddingTrainingJob(
        job_type=EmbeddingTrainingJobType.REFRESH,
        status=EmbeddingTrainingJobStatus.PENDING,
        workspace_id=req.workspace_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    task = refresh_all_embeddings.delay(
        workspace_id=req.workspace_id,
        training_job_id=job.id,
        triggered_by_user_id=current_user.id,
    )
    return {
        "message": "Refresh queued",
        "training_job_id": job.id,
        "celery_task_id": task.id,
    }


@router.post("/fine-tune")
async def trigger_embedding_fine_tune(
    request: Optional[FineTuneRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fine-tune the local embedding model on document chunks, then optionally re-embed all. Only available when EMBEDDING_SERVICE=local."""
    from tasks.embeddings import run_embedding_fine_tune

    if config_settings.embedding_service.lower() != "local":
        raise HTTPException(
            status_code=400,
            detail="Fine-tuning is only available when using local embeddings (EMBEDDING_SERVICE=local)",
        )
    req = request if request is not None else FineTuneRequest()
    job = EmbeddingTrainingJob(
        job_type=EmbeddingTrainingJobType.FINE_TUNE,
        status=EmbeddingTrainingJobStatus.PENDING,
        workspace_id=req.workspace_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    task = run_embedding_fine_tune.delay(
        workspace_id=req.workspace_id,
        training_job_id=job.id,
        epochs=req.epochs,
        trigger_refresh_after=req.trigger_refresh_after,
    )
    return {
        "message": "Fine-tune queued",
        "training_job_id": job.id,
        "celery_task_id": task.id,
    }


@router.get("/training/jobs", response_model=List[TrainingJobResponse])
async def list_embedding_training_jobs(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List recent embedding training/refresh jobs (most recent first)."""
    jobs = (
        db.query(EmbeddingTrainingJob)
        .order_by(EmbeddingTrainingJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        TrainingJobResponse(
            id=j.id,
            job_type=j.job_type.value,
            status=j.status.value,
            workspace_id=j.workspace_id,
            documents_processed=j.documents_processed,
            documents_total=j.documents_total,
            error_message=j.error_message,
            started_at=j.started_at.isoformat() if j.started_at else None,
            completed_at=j.completed_at.isoformat() if j.completed_at else None,
            created_at=j.created_at.isoformat(),
            celery_task_id=j.celery_task_id,
        )
        for j in jobs
    ]


@router.get("/training/jobs/{job_id}", response_model=TrainingJobResponse)
async def get_embedding_training_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single embedding training/refresh job by id."""
    job = db.query(EmbeddingTrainingJob).filter(EmbeddingTrainingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
    return TrainingJobResponse(
        id=job.id,
        job_type=job.job_type.value,
        status=job.status.value,
        workspace_id=job.workspace_id,
        documents_processed=job.documents_processed,
        documents_total=job.documents_total,
        error_message=job.error_message,
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        created_at=job.created_at.isoformat(),
        celery_task_id=job.celery_task_id,
    )
