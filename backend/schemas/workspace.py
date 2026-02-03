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
    member_count: Optional[int] = 0
    document_count: Optional[int] = 0

    class Config:
        from_attributes = True


class UpdateWorkspaceRequest(BaseModel):
    name: str


class WorkspaceListResponse(BaseModel):
    items: List[WorkspaceResponse]
    next_cursor: Optional[str] = None


class WorkspaceMemberResponse(BaseModel):
    id: int
    user_id: int
    username: Optional[str] = None
    email: Optional[str] = None
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
