from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DocumentResponse(BaseModel):
    id: int
    workspace_id: int
    uploaded_by: int
    filename: str
    mime_type: str
    size_bytes: int
    status: str
    created_at: datetime

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
