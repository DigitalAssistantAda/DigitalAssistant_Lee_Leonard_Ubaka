"""
Middleware for authorization and request logging
"""
import json
import logging
import time
from functools import wraps

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from errors import error_payload

logger = logging.getLogger("app.request")
if not logger.handlers:
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(stream_handler)
logger.setLevel(logging.INFO)
logger.propagate = False


class SafeRequestLogMiddleware(BaseHTTPMiddleware):
    SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie"}
    HEADER_ALLOWLIST = {"x-request-id", "request-id", "user-agent", "content-type", "accept", "host"}

    def _get_request_id(self, request: Request) -> str | None:
        request_id = getattr(request.state, "request_id", None)
        if request_id:
            return str(request_id)
        return request.headers.get("x-request-id") or request.headers.get("request-id")

    def _sanitize_headers(self, request: Request) -> dict[str, str]:
        safe_headers: dict[str, str] = {}
        for header_name, header_value in request.headers.items():
            header_name_lower = header_name.lower()
            if header_name_lower in self.SENSITIVE_HEADERS:
                safe_headers[header_name_lower] = "[REDACTED]"
            elif header_name_lower in self.HEADER_ALLOWLIST:
                safe_headers[header_name_lower] = header_value
        return safe_headers

    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        request_id = self._get_request_id(request)
        headers = self._sanitize_headers(request)

        try:
            response = await call_next(request)
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            log_payload = {
                "event": "http_request",
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "elapsed_ms": elapsed_ms,
                "request_id": request_id,
                "headers": headers,
            }
            logger.info(json.dumps(log_payload, default=str))
            return response
        except Exception:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            log_payload = {
                "event": "http_request_error",
                "method": request.method,
                "path": request.url.path,
                "status_code": status.HTTP_500_INTERNAL_SERVER_ERROR,
                "elapsed_ms": elapsed_ms,
                "request_id": request_id,
                "headers": headers,
            }
            logger.exception(json.dumps(log_payload, default=str))
            raise


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
                content=error_payload("UNAUTHORIZED", "Unauthorized access."),
            )
        
        # Token should be in format: "Bearer <token>"
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content=error_payload("UNAUTHORIZED", "Unauthorized access."),
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
