from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from models.document_deletion_request import DocumentDeletionRequest, DeletionRequestStatus
from models.document import Document, DocumentStatus
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.document_hint import DocumentHint
from models.document_duplicate import DocumentDuplicate
from models.summary import Summary
from models.job import Job
from models.embedding_job import EmbeddingJob
from models.user import User
from models.workspace import Workspace
from models.container import Container
from database import get_db
from utils.auth import get_current_user
from utils.audit import create_audit_log, AuditActions
from utils.storage import storage
from datetime import datetime, timezone
from realtime import connection_manager

router = APIRouter(prefix="/deletion-requests", tags=["deletion-requests"])


def _parse_storage_uri(storage_uri: str) -> tuple[str, str]:
    try:
        scheme_split = (storage_uri or "").split("://", 1)
        path_part = scheme_split[1] if len(scheme_split) == 2 else scheme_split[0]
        bucket, path = path_part.split("/", 1)
        return bucket, path
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid storage URI for document",
        )


def _serialize_deletion_request(request: DocumentDeletionRequest, db: Session):
    """
    Enriched deletion-request payload for Notifications UI.

    Includes:
      - sender username
      - document filename
      - location (workspace name + container name if available)
    """
    sender = db.query(User).filter(User.id == request.requested_by).first()
    document = db.query(Document).filter(Document.id == request.document_id).first()

    workspace = None
    container = None
    container_id = None

    if document is not None:
        if document.workspace_id is not None:
            workspace = db.query(Workspace).filter(Workspace.id == document.workspace_id).first()

        # Document may or may not have container_id depending on your schema
        container_id = getattr(document, "container_id", None)
        if container_id is not None:
            container = db.query(Container).filter(Container.id == container_id).first()
    return {
        "id": request.id,
        "document_id": request.document_id,
        "document": document,
        "requested_by": request.requested_by,
        "requested_by_username": sender.username if sender else None,
        "reason": request.reason,
        "status": request.status,
        "created_at": request.created_at,
        "responded_at": request.responded_at,

        # Document details
        "document_filename": document.filename if document else None,

        # Location details
        "workspace_id": document.workspace_id if document else None,
        "workspace_name": workspace.name if workspace else None,
        "container_id": container_id,
        "container_name": container.name if container else None,
    }



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
        "requests": [_serialize_deletion_request(r, db) for r in requests]
    }


@router.get("/all")
async def get_all_deletion_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all deletion requests for documents owned by current user"""
    requests = db.query(DocumentDeletionRequest).filter(
        DocumentDeletionRequest.document_owner == current_user.id
    ).order_by(DocumentDeletionRequest.created_at.desc()).all()

    return {
        "count": len(requests),
        "requests": [_serialize_deletion_request(r, db) for r in requests]
    }


@router.post("/{request_id}/approve")
async def approve_deletion_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a document deletion request and permanently delete the document."""
    deletion_request = db.query(DocumentDeletionRequest).filter(
        DocumentDeletionRequest.id == request_id
    ).first()

    if not deletion_request:
        raise HTTPException(status_code=404, detail="Deletion request not found")

    if deletion_request.document_owner != current_user.id:
        raise HTTPException(status_code=403, detail="Only document owner can approve")

    document = db.query(Document).filter(Document.id == deletion_request.document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status == DocumentStatus.DELETED:
        raise HTTPException(status_code=404, detail="Document not found")

    deletion_request.status = DeletionRequestStatus.APPROVED
    deletion_request.responded_at = datetime.now(timezone.utc)

    document_id = document.id
    workspace_id = document.workspace_id
    filename = document.filename
    bucket, path = _parse_storage_uri(document.storage_uri)

    try:
        chunk_ids = [
            row[0]
            for row in db.query(DocumentChunk.id).filter(
                DocumentChunk.document_id == document_id
            ).all()
        ]
        if chunk_ids:
            db.query(ChunkEmbedding).filter(
                ChunkEmbedding.chunk_id.in_(chunk_ids)
            ).delete(synchronize_session=False)
        db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document_id
        ).delete(synchronize_session=False)
        db.query(DocumentHint).filter(
            DocumentHint.document_id == document_id
        ).delete(synchronize_session=False)
        db.query(Job).filter(Job.document_id == document_id).delete(synchronize_session=False)
        db.query(EmbeddingJob).filter(
            EmbeddingJob.document_id == document_id
        ).delete(synchronize_session=False)
        db.query(Summary).filter(Summary.document_id == document_id).update(
            {Summary.document_id: None}, synchronize_session=False
        )
        db.query(DocumentDuplicate).filter(
            DocumentDuplicate.duplicate_of_id == document_id
        ).update({DocumentDuplicate.duplicate_of_id: None}, synchronize_session=False)
        db.query(DocumentDuplicate).filter(
            DocumentDuplicate.document_id == document_id
        ).delete(synchronize_session=False)
        db.delete(document)
        db.flush()
        await storage.delete(bucket=bucket, path=path)
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete document: {str(e)}",
        )

    create_audit_log(
        db,
        current_user,
        action=AuditActions.DOCUMENT_DELETION_APPROVED,
        object_type="document",
        object_id=document_id,
        metadata={"filename": filename, "workspace_id": workspace_id},
        workspace_id=workspace_id,
    )
    await connection_manager.send_to_user(
        current_user.id,
        {"type": "notifications.changed", "payload": {}},
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

    create_audit_log(
        db, current_user,
        action=AuditActions.DOCUMENT_DELETION_DENIED,
        object_type="document",
        object_id=deletion_request.document_id
    )
    await connection_manager.send_to_user(
        current_user.id,
        {"type": "notifications.changed", "payload": {}},
    )
    return {"status": "denied", "request_id": request_id}