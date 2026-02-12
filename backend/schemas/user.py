from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional


class UpdateUserRequest(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    status_message: Optional[str] = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Username cannot be empty")
        if len(cleaned) < 3:
            raise ValueError("Username must be at least 3 characters")
        if len(cleaned) > 50:
            raise ValueError("Username must be 50 characters or fewer")
        return cleaned

    @field_validator("status_message")
    @classmethod
    def validate_status_message(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) > 160:
            raise ValueError("Status message must be 160 characters or fewer")
        return cleaned
