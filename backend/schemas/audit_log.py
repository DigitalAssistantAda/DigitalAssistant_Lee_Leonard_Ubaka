from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class AuditLogResponse(BaseModel):
    id: int
    actor_user_id: int
    action: str
    object_type: str
    object_id: Optional[int] = None
    metadata_json: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    next_cursor: Optional[str] = None
