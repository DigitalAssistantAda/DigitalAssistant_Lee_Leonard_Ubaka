from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
from schemas.color import validate_hex_color


class CreateContainerRequest(BaseModel):
    name: str
    color: Optional[str] = None
    workspace_id: Optional[int] = None
    parent_container_id: Optional[int] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: Optional[str]) -> Optional[str]:
        return validate_hex_color(value)


class ContainerResponse(BaseModel):
    id: int
    name: str
    is_workspace_default: bool = False
    color: Optional[str] = None
    workspace_id: Optional[int] = None
    parent_container_id: Optional[int] = None
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


class ContainerListResponse(BaseModel):
    items: List[ContainerResponse]
    next_cursor: Optional[str] = None


class MoveContainerRequest(BaseModel):
    parent_container_id: Optional[int] = None


class UpdateContainerRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: Optional[str]) -> Optional[str]:
        return validate_hex_color(value)
