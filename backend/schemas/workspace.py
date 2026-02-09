from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import re


_HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


class CreateWorkspaceRequest(BaseModel):
    name: str


class WorkspaceResponse(BaseModel):
    id: int
    name: str
    accent_color: Optional[str] = None
    created_by: int
    created_at: datetime
    member_count: Optional[int] = 0
    document_count: Optional[int] = 0

    class Config:
        from_attributes = True


class UpdateWorkspaceRequest(BaseModel):
    name: str
    accent_color: Optional[str] = None

    @field_validator("accent_color")
    @classmethod
    def validate_accent_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not _HEX_COLOR_PATTERN.match(value):
            raise ValueError("Accent color must be a hex value like #RRGGBB")
        return value


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
