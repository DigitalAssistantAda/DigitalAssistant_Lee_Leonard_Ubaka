from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class CreateWorkspaceRequest(BaseModel):
    name: str


class WorkspaceResponse(BaseModel):
    id: int
    name: str
    tenant_id: int
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


class UpdateWorkspaceRequest(BaseModel):
    name: str


class WorkspaceListResponse(BaseModel):
    items: List[WorkspaceResponse]
    next_cursor: Optional[str] = None


class WorkspaceMemberResponse(BaseModel):
    user_id: int
    role: str
    joined_at: datetime
    status: str

    class Config:
        from_attributes = True


class WorkspaceMemberListResponse(BaseModel):
    items: List[WorkspaceMemberResponse]
    next_cursor: Optional[str] = None


class AddMemberRequest(BaseModel):
    email_or_user_id: str
    role: str


class UpdateMemberRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None
