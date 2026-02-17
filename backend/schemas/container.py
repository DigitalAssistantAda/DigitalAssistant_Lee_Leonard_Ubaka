from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import re


_HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


class CreateContainerRequest(BaseModel):
    name: str
    color: Optional[str] = None
    workspace_id: Optional[int] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not _HEX_COLOR_PATTERN.match(value):
            raise ValueError("Color must be a hex value like #RRGGBB")
        return value


class ContainerResponse(BaseModel):
    id: int
    name: str
    color: Optional[str] = None
    workspace_id: Optional[int] = None
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


class ContainerListResponse(BaseModel):
    items: List[ContainerResponse]
    next_cursor: Optional[str] = None
