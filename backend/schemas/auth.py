from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime


# Auth Schemas
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("Password must be at least 12 characters long")
        if not any(c.islower() for c in value):
            raise ValueError("Password must include a lowercase letter")
        if not any(c.isupper() for c in value):
            raise ValueError("Password must include an uppercase letter")
        if not any(c.isdigit() for c in value):
            raise ValueError("Password must include a number")
        if not any(c in "!@#$%^&*()-_=+[]{};:,.?/" for c in value):
            raise ValueError("Password must include a special character")
        return value


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("Password must be at least 12 characters long")
        if not any(c.islower() for c in value):
            raise ValueError("Password must include a lowercase letter")
        if not any(c.isupper() for c in value):
            raise ValueError("Password must include an uppercase letter")
        if not any(c.isdigit() for c in value):
            raise ValueError("Password must include a number")
        if not any(c in "!@#$%^&*()-_=+[]{};:,.?/" for c in value):
            raise ValueError("Password must include a special character")
        return value


class LoginRequest(BaseModel):
    email_or_username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    status_message: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class RegisterResponse(BaseModel):
    user: UserResponse
    access_token: str
    refresh_token: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse


class SuccessResponse(BaseModel):
    success: bool = True
