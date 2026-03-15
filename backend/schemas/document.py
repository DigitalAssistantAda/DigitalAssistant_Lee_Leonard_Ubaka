from pydantic import BaseModel, Field
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
    container_id: Optional[int] = None


class DownloadResponse(BaseModel):
    url: str
    expires_at: datetime


class ContainerSuggestionOption(BaseModel):
    container_id: int
    container_name: str
    score: float


class SmartContainerSuggestionResponse(BaseModel):
    document_id: int
    suggested_container_id: Optional[int] = None
    suggested_container_name: Optional[str] = None
    confidence: str
    confidence_score: Optional[float] = None
    boost_applied: bool = False
    reason: str
    alternatives: List[ContainerSuggestionOption] = Field(default_factory=list)


class AutoOrganizedDocumentResult(BaseModel):
    document_id: int
    filename: str
    from_container_id: Optional[int] = None
    to_container_id: Optional[int] = None
    to_container_name: Optional[str] = None
    confidence: str
    confidence_score: Optional[float] = None
    boost_applied: bool = False


class AutoOrganizeWorkspaceResponse(BaseModel):
    workspace_id: int
    considered: int
    moved: int
    skipped_low_confidence: int
    skipped_no_suggestion: int
    skipped_already_organized: int
    dry_run: bool = False
    moved_documents: List[AutoOrganizedDocumentResult] = Field(default_factory=list)


class DuplicateUploadCheckResponse(BaseModel):
    is_duplicate: bool
    duplicate_document_id: Optional[int] = None
    duplicate_filename: Optional[str] = None
    duplicate_created_at: Optional[datetime] = None
    message: str

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