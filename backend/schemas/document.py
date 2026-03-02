from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DocumentResponse(BaseModel):
    id: int
    workspace_id: Optional[int] = None
    container_id: Optional[int] = None
    uploaded_by: int
    filename: str
    mime_type: str
    size_bytes: int
    status: str
    created_at: datetime
    # User-friendly status for UI (no internal/security-sensitive details)
    status_label: Optional[str] = None
    status_detail: Optional[str] = None

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    items: List[DocumentResponse]
    next_cursor: Optional[str] = None


class UpdateDocumentRequest(BaseModel):
    filename: Optional[str] = None


class DownloadResponse(BaseModel):
    url: str
    expires_at: datetime

class DocumentDeletionRequestResponse(BaseModel):
    id: int
    document_id: int
    requested_by: int
    document_owner: int
    reason: Optional[str] = None
    status: str  # "pending", "approved", "denied", "cancelled"
    created_at: datetime
    responded_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class DocumentDeletionRequestListResponse(BaseModel):
    items: List[DocumentDeletionRequestResponse]


class RequestDeletionRequest(BaseModel):
    reason: Optional[str] = None