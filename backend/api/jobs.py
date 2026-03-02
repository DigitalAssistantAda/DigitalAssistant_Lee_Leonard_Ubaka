from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.job import Job
from models.document import Document
from schemas.job import JobResponse, JobListResponse
from utils.auth import get_current_user
from utils.authorization import check_document_access

router = APIRouter(tags=["Jobs"])


@router.get("/documents/{document_id}/jobs", response_model=JobListResponse)
async def list_document_jobs(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists processing jobs associated with a document"""

    # Check document access, including personal container documents
    document = check_document_access(current_user, document_id, db)
    
    jobs = db.query(Job).filter(Job.document_id == document_id).all()
    
    return JobListResponse(
        items=[JobResponse.model_validate(j) for j in jobs]
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves details for a specific processing job"""
    
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    # Check document access, including personal container documents
    check_document_access(current_user, job.document_id, db)

    return JobResponse.model_validate(job)
