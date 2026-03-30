from pydantic import BaseModel
from typing import Optional, List, Union
from datetime import datetime


class AuditLogResponse(BaseModel):
    """Single audit log entry"""

    id: int
    workspace_id: Optional[int] = None
    actor_user_id: int
    action: str
    object_type: str
    object_id: Optional[int] = None
    # ORM JSON column is often deserialized to dict/list; older rows may be a JSON string
    metadata_json: Optional[Union[str, dict, list]] = None
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
