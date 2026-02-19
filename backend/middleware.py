"""
Middleware for authorization and request logging
"""
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from functools import wraps
from typing import Optional
import logging

logger = logging.getLogger(__name__)


async def authorization_middleware(request: Request, call_next):
    """
    Middleware to verify authorization on protected routes.
    
    Protected routes are those that start with /api/v1/
    except for /api/v1/auth/login and /api/v1/auth/register
    """
    # Public endpoints that don't require auth
    public_paths = [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/callback",
        "/api/v1/webhooks/embeddings/process",
        "/docs",
        "/openapi.json",
        "/favicon.ico",
    ]
    
    # Allow CORS preflight
    if request.method == "OPTIONS":
        return await call_next(request)

    # Check if path requires authentication
    path = request.url.path
    requires_auth = path.startswith("/api/v1/") and path not in public_paths
    
    if requires_auth:
        # Verify token exists in headers
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Missing authorization header"}
            )
        
        # Token should be in format: "Bearer <token>"
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid authorization header format"}
            )
    
    response = await call_next(request)
    return response


def require_auth(func):
    """
    Decorator to mark endpoint as requiring authentication.
    
    Usage:
        @router.get("/protected")
        @require_auth
        async def protected_endpoint(current_user: User = Depends(get_current_user)):
            return {"message": "This is protected"}
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        # Authentication is handled by depends(get_current_user)
        # This decorator just marks the endpoint as requiring it
        return await func(*args, **kwargs)
    return wrapper


async def log_request_middleware(request: Request, call_next):
    """
    Log HTTP request for debugging and monitoring.
    """
    response = await call_next(request)
    logger.info(
        f"{request.method} {request.url.path} - "
        f"Status: {response.status_code} - "
        f"User: {request.headers.get('x-user-id', 'anonymous')}"
    )
    return response
