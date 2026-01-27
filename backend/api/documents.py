from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from database import get_db
from models.user import User
from models.document import Document, DocumentStatus
from models.workspace import WorkspaceMember, MemberStatus
from schemas.document import (
    DocumentResponse,
    DocumentListResponse,
    UpdateDocumentRequest,
    DownloadResponse,
)
from schemas.auth import SuccessResponse
from utils.auth import get_current_user, create_audit_log

router = APIRouter(tags=["Documents"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_MIME_TYPES = [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]


def check_document_access(document_id: int, user: User, db: Session) -> Document:
    """Check if user has access to a document"""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Check workspace membership
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == document.workspace_id,
        WorkspaceMember.user_id == user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    return document


@router.post("/workspaces/{workspace_id}/documents", response_model=DocumentResponse)
async def upload_document(
    workspace_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Uploads a document to a workspace"""
    
    # Check workspace membership
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    # Validate file
    if not file.content_type or file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}"
        )
    
    # Read file content to check size
    content = await file.read()
    size_bytes = len(content)
    
    if size_bytes > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024}MB"
        )
    
    # TODO: Actually upload to storage (S3/MinIO)
    # For now, just create a placeholder storage path
    storage_path = f"workspaces/{workspace_id}/documents/{file.filename}"
    
    # Create document record
    document = Document(
        workspace_id=workspace_id,
        uploaded_by=current_user.id,
        filename=file.filename,
        mime_type=file.content_type,
        size_bytes=size_bytes,
        storage_path=storage_path,
        status=DocumentStatus.PENDING
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    
    create_audit_log(db, current_user, "document.uploaded", "document", document.id)
    
    # TODO: Trigger background job for processing
    
    return DocumentResponse.model_validate(document)


@router.get("/workspaces/{workspace_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists documents in a workspace"""
    
    # Check workspace membership
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    documents = db.query(Document).filter(
        Document.workspace_id == workspace_id
    ).order_by(Document.created_at.desc()).all()
    
    return DocumentListResponse(
        items=[DocumentResponse.model_validate(d) for d in documents]
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves document metadata"""
    
    document = check_document_access(document_id, current_user, db)
    return DocumentResponse.model_validate(document)


@router.put("/documents/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int,
    request: UpdateDocumentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates document metadata"""
    
    document = check_document_access(document_id, current_user, db)
    
    if request.filename:
        document.filename = request.filename
    
    db.commit()
    db.refresh(document)
    
    create_audit_log(db, current_user, "document.updated", "document", document.id)
    
    return DocumentResponse.model_validate(document)


@router.get("/documents/{document_id}/download", response_model=DownloadResponse)
async def download_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Downloads a document or returns a pre-signed URL"""
    
    document = check_document_access(document_id, current_user, db)
    
    create_audit_log(db, current_user, "document.downloaded", "document", document.id)
    
    # TODO: Generate actual pre-signed URL from S3/MinIO
    # For now, return a placeholder
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    
    return DownloadResponse(
        url=f"/storage/{document.storage_path}",
        expires_at=expires_at
    )


@router.delete("/documents/{document_id}", response_model=SuccessResponse)
async def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a document"""
    
    document = check_document_access(document_id, current_user, db)
    
    # TODO: Delete from storage (S3/MinIO)
    
    db.delete(document)
    db.commit()
    
    create_audit_log(db, current_user, "document.deleted", "document", document_id)
    
    return SuccessResponse()
