from pydantic import BaseModel, field_validator
from typing import Optional
import re


_HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


class UserPreferencesResponse(BaseModel):
    user_id: int
    accent_color: Optional[str] = None

    class Config:
        from_attributes = True


class UpdateUserPreferencesRequest(BaseModel):
    accent_color: Optional[str] = None

    @field_validator("accent_color")
    @classmethod
    def validate_accent_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not _HEX_COLOR_PATTERN.match(value):
            raise ValueError("Accent color must be a hex value like #RRGGBB")
        return value
