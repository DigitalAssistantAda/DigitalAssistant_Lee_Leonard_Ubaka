from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from models.document_deletion_request import DocumentDeletionRequest, DeletionRequestStatus
from models.user import User
from database import get_db
from utils.auth import get_current_user
from utils.audit import create_audit_log, AuditActions
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/deletion-requests", tags=["deletion-requests"])

@router.get("/pending")
async def get_pending_deletion_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all pending deletion requests for documents owned by current user"""
    requests = db.query(DocumentDeletionRequest).filter(
        DocumentDeletionRequest.document_owner == current_user.id,
        DocumentDeletionRequest.status == DeletionRequestStatus.PENDING
    ).order_by(DocumentDeletionRequest.created_at.desc()).all()
    
    return {
        "count": len(requests),
        "requests": [
            {
                "id": r.id,
                "document_id": r.document_id,
                "requested_by": r.requested_by,
                "reason": r.reason,
                "status": r.status,
                "created_at": r.created_at
            }
            for r in requests
        ]
    }

@router.post("/{request_id}/approve")
async def approve_deletion_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a document deletion request"""
    deletion_request = db.query(DocumentDeletionRequest).filter(
        DocumentDeletionRequest.id == request_id
    ).first()
    
    if not deletion_request:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    
    if deletion_request.document_owner != current_user.id:
        raise HTTPException(status_code=403, detail="Only document owner can approve")
    
    deletion_request.status = DeletionRequestStatus.APPROVED
    deletion_request.responded_at = datetime.now(timezone.utc)
    
    # TODO: Delete the actual document here
    
    db.commit()
    
    # Log the approval
    create_audit_log(
        db, current_user,
        action=AuditActions.DOCUMENT_DELETION_APPROVED,
        object_type="document",
        object_id=deletion_request.document_id
    )
    
    return {"status": "approved", "request_id": request_id}

@router.post("/{request_id}/deny")
async def deny_deletion_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deny a document deletion request"""
    deletion_request = db.query(DocumentDeletionRequest).filter(
        DocumentDeletionRequest.id == request_id
    ).first()
    
    if not deletion_request:
        raise HTTPException(status_code=404, detail="Deletion request not found")
    
    if deletion_request.document_owner != current_user.id:
        raise HTTPException(status_code=403, detail="Only document owner can deny")
    
    deletion_request.status = DeletionRequestStatus.DENIED
    deletion_request.responded_at = datetime.now(timezone.utc)
    db.commit()
    
    # Log the denial
    create_audit_log(
        db, current_user,
        action=AuditActions.DOCUMENT_DELETION_DENIED,
        object_type="document",
        object_id=deletion_request.document_id
    )
    
    return {"status": "denied", "request_id": request_id}