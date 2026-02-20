from pydantic import BaseModel, field_validator
from typing import Optional
from schemas.color import validate_hex_color


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
        return validate_hex_color(value, "Accent color")
