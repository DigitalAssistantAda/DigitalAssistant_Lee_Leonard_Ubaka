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
from utils.auth import get_current_user
from utils.authorization import (
    check_workspace_access,
    check_document_access,
    PermissionDenied,
    NotFound,
)
from utils.audit import create_audit_log, AuditActions

router = APIRouter(tags=["Documents"])

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_MIME_TYPES = [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]


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
        storage_uri=storage_path,
        status=DocumentStatus.UPLOADED
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    
    # Log the upload action
    create_audit_log(
        db,
        current_user,
        action=AuditActions.DOCUMENT_UPLOADED,
        object_type="document",
        object_id=document.id,
        metadata={
            "filename": file.filename,
            "size_bytes": size_bytes,
            "workspace_id": workspace_id
        }
    )
    
    # TODO: Trigger background job for processing
    
    return DocumentResponse.model_validate(document)


@router.get("/workspaces/{workspace_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists documents in a workspace (tenant-scoped)"""
    
    # Verify user has access to workspace
    try:
        check_workspace_access(current_user, workspace_id, db)
    except (PermissionDenied, NotFound) as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    
    # Get documents - filtered by workspace and tenant
    documents = db.query(Document).filter(
        (Document.workspace_id == workspace_id) &
        # Verify workspace belongs to user's tenant
        (db.query(WorkspaceMember.workspace_id).filter(
            (WorkspaceMember.workspace_id == workspace_id) &
            (WorkspaceMember.user_id == current_user.id)
        ).exists())
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
    
    old_filename = document.filename
    if request.filename:
        document.filename = request.filename
    
    db.commit()
    db.refresh(document)
    
    # Log the update action with structured metadata
    create_audit_log(
        db,
        current_user,
        action=AuditActions.DOCUMENT_UPDATED,
        object_type="document",
        object_id=document.id,
        metadata={
            "old_filename": old_filename,
            "new_filename": document.filename if request.filename else old_filename,
            "workspace_id": document.workspace_id
        }
    )
    
    return DocumentResponse.model_validate(document)


@router.get("/documents/{document_id}/download", response_model=DownloadResponse)
async def download_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Downloads a document or returns a pre-signed URL"""
    
    document = check_document_access(document_id, current_user, db)
    
    # Log the download action
    create_audit_log(
        db,
        current_user,
        action=AuditActions.DOCUMENT_DOWNLOADED,
        object_type="document",
        object_id=document.id,
        metadata={
            "filename": document.filename,
            "size_bytes": document.size_bytes,
            "workspace_id": document.workspace_id
        }
    )
    
    # TODO: Generate actual pre-signed URL from S3/MinIO
    # For now, return a placeholder
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    
    return DownloadResponse(
        url=f"/storage/{document.storage_uri}",
        expires_at=expires_at
    )


@router.delete("/documents/{document_id}", response_model=SuccessResponse)
async def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a document (soft delete via status change)"""
    
    document = check_document_access(document_id, current_user, db)
    
    # Get document details for audit log before deletion
    workspace_id = document.workspace_id
    filename = document.filename
    
    # Soft delete: mark as deleted instead of hard delete
    document.status = DocumentStatus.DELETED
    db.commit()
    
    # Log the deletion action with structured metadata
    create_audit_log(
        db,
        current_user,
        action=AuditActions.DOCUMENT_DELETED,
        object_type="document",
        object_id=document_id,
        metadata={
            "filename": filename,
            "workspace_id": workspace_id
        }
    )
    
    return SuccessResponse()
