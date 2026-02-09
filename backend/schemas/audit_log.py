from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class AuditLogResponse(BaseModel):
    """Single audit log entry"""
    id: int
    workspace_id: Optional[int] = None
    actor_user_id: int
    action: str
    object_type: str
    object_id: Optional[int] = None
    metadata_json: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    """List of audit logs with pagination"""
    logs: List[AuditLogResponse]
    total: int
    limit: int
    offset: int
    next_cursor: Optional[str] = None
