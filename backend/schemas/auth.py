from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


# Auth Schemas
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str
    tenant_name: Optional[str] = None


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
    tenant_id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class TenantResponse(BaseModel):
    id: int
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


class RegisterResponse(BaseModel):
    user: UserResponse
    tenant: TenantResponse
    access_token: str
    refresh_token: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserResponse


class MeResponse(BaseModel):
    user: UserResponse
    tenant: TenantResponse


class SuccessResponse(BaseModel):
    success: bool = True
