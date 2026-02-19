from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import os
import re
import uuid
import logging
import requests
from starlette.concurrency import run_in_threadpool
from database import get_db
from models.user import User
from models.document import Document, DocumentStatus
from models.container import Container
from models.document_chunk import DocumentChunk
from models.chunk_embedding import ChunkEmbedding
from models.document_hint import DocumentHint
from models.document_duplicate import DocumentDuplicate
from models.summary import Summary
from models.job import Job
from models.embedding_job import EmbeddingJob
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
from utils.storage import storage
from config import settings
from tasks.embeddings import process_document_embeddings

router = APIRouter(tags=["Documents"])

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_MIME_TYPES = [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]


def _sanitize_filename(filename: str) -> str:
    base = os.path.basename(filename or "upload")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return safe or "upload"


def _parse_storage_uri(storage_uri: str) -> tuple[str, str]:
    try:
        scheme_split = storage_uri.split("://", 1)
        path_part = scheme_split[1] if len(scheme_split) == 2 else scheme_split[0]
        bucket, path = path_part.split("/", 1)
        return bucket, path
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid storage URI for document"
        )


def _post_n8n_embedding_trigger(payload: dict) -> None:
    if not settings.n8n_embeddings_trigger_url:
        return
    response = requests.post(
        settings.n8n_embeddings_trigger_url,
        json=payload,
        timeout=10
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"n8n trigger failed with {response.status_code}: {response.text}"
        )


def _validate_container_for_workspace(
    db: Session,
    current_user: User,
    workspace_id: int,
    container_id: int,
) -> Container:
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Container not found")

    if container.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Container does not belong to the selected workspace",
        )

    check_workspace_access(current_user, workspace_id, db)
    return container


def _validate_container_access(
    db: Session,
    current_user: User,
    container_id: int,
) -> Container:
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Container not found")

    if container.workspace_id is not None:
        check_workspace_access(current_user, container.workspace_id, db)
    elif container.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    return container


@router.post("/workspaces/{workspace_id}/documents", response_model=DocumentResponse)
async def upload_document(
    workspace_id: int,
    file: UploadFile = File(...),
    container_id: int | None = Form(default=None),
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

    if container_id is not None:
        _validate_container_for_workspace(db, current_user, workspace_id, container_id)
    
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
    
    # Upload to storage (S3/MinIO)
    safe_name = _sanitize_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
    storage_path = f"workspaces/{workspace_id}/documents/{unique_name}"
    try:
        storage_uri = await storage.upload(
            bucket=settings.storage_bucket,
            path=storage_path,
            data=content,
            content_type=file.content_type
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload document to storage: {str(e)}"
        )
    
    # Create document record
    document = Document(
        workspace_id=workspace_id,
        container_id=container_id,
        uploaded_by=current_user.id,
        filename=file.filename,
        mime_type=file.content_type,
        size_bytes=size_bytes,
        storage_uri=storage_uri,
        status=DocumentStatus.UPLOADED
    )
    db.add(document)
    try:
        db.commit()
    except Exception:
        try:
            await storage.delete(bucket=settings.storage_bucket, path=storage_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save document metadata"
        )
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
        },
        workspace_id=workspace_id
    )

    # Trigger embedding workflow
    if settings.n8n_embeddings_trigger_url:
        try:
            await run_in_threadpool(
                _post_n8n_embedding_trigger,
                {
                    "document_id": document.id,
                    "workspace_id": workspace_id,
                    "triggered_by": current_user.id,
                },
            )
        except Exception as exc:
            logger.warning("n8n embedding trigger failed: %s", exc)
    else:
        process_document_embeddings.delay(document.id, current_user.id)
    
    return DocumentResponse.model_validate(document)


@router.get("/workspaces/{workspace_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    workspace_id: int,
    container_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists documents in a workspace"""
    
    # Verify user has access to workspace
    try:
        check_workspace_access(current_user, workspace_id, db)
    except (PermissionDenied, NotFound) as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    
    # Get documents - filtered by workspace
    query = db.query(Document).filter(
        Document.workspace_id == workspace_id,
        Document.status != DocumentStatus.DELETED
    )

    if container_id is not None:
        _validate_container_for_workspace(db, current_user, workspace_id, container_id)
        query = query.filter(Document.container_id == container_id)

    documents = query.order_by(Document.created_at.desc()).all()
    
    return DocumentListResponse(
        items=[DocumentResponse.model_validate(d) for d in documents]
    )


@router.get("/containers/{container_id}/documents", response_model=DocumentListResponse)
async def list_documents_for_container(
    container_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    container = _validate_container_access(db, current_user, container_id)

    query = db.query(Document).filter(
        Document.container_id == container_id,
        Document.status != DocumentStatus.DELETED,
    )

    if container.workspace_id is not None:
        query = query.filter(Document.workspace_id == container.workspace_id)

    documents = query.order_by(Document.created_at.desc()).all()

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
    
    document = check_document_access(current_user, document_id, db)
    if document.status == DocumentStatus.DELETED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return DocumentResponse.model_validate(document)


@router.put("/documents/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int,
    request: UpdateDocumentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates document metadata"""
    
    document = check_document_access(current_user, document_id, db)
    if document.status == DocumentStatus.DELETED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
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
        },
        workspace_id=document.workspace_id
    )
    
    return DocumentResponse.model_validate(document)


@router.get("/documents/{document_id}/download", response_model=DownloadResponse)
async def download_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Downloads a document or returns a pre-signed URL"""
    
    document = check_document_access(current_user, document_id, db)
    if document.status == DocumentStatus.DELETED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
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
        },
        workspace_id=document.workspace_id
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
    """Permanently deletes a document and associated data"""
    
    document = check_document_access(current_user, document_id, db)

    # Get document details for audit log before deletion
    workspace_id = document.workspace_id
    filename = document.filename

    bucket, path = _parse_storage_uri(document.storage_uri)

    try:
        chunk_ids = [row[0] for row in db.query(DocumentChunk.id).filter(
            DocumentChunk.document_id == document_id
        ).all()]

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

        db.query(Job).filter(
            Job.document_id == document_id
        ).delete(synchronize_session=False)

        db.query(EmbeddingJob).filter(
            EmbeddingJob.document_id == document_id
        ).delete(synchronize_session=False)

        db.query(Summary).filter(
            Summary.document_id == document_id
        ).update({Summary.document_id: None}, synchronize_session=False)

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
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to permanently delete document: {str(e)}"
        )

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
        },
        workspace_id=workspace_id
    )
    
    return SuccessResponse()
