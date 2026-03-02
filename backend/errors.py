import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def error_payload(code: str, message: str) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
        }
    }


def _status_code_to_error_code(status_code: int) -> str:
    if status_code == status.HTTP_400_BAD_REQUEST:
        return "BAD_REQUEST"
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "UNAUTHORIZED"
    if status_code == status.HTTP_403_FORBIDDEN:
        return "FORBIDDEN"
    if status_code == status.HTTP_404_NOT_FOUND:
        return "NOT_FOUND"
    if status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        return "METHOD_NOT_ALLOWED"
    if status_code == status.HTTP_409_CONFLICT:
        return "CONFLICT"
    if status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        return "VALIDATION_ERROR"
    if status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        return "RATE_LIMITED"
    if status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return "INTERNAL_SERVER_ERROR"
    return "HTTP_ERROR"


def _safe_message_for_status(status_code: int) -> str:
    if status_code == status.HTTP_400_BAD_REQUEST:
        return "Invalid request."
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "Unauthorized access."
    if status_code == status.HTTP_403_FORBIDDEN:
        return "Forbidden."
    if status_code == status.HTTP_404_NOT_FOUND:
        return "Resource not found."
    if status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        return "Method not allowed."
    if status_code == status.HTTP_409_CONFLICT:
        return "Conflict detected."
    if status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        return "Invalid request."
    if status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        return "Too many requests. Please try again later."
    if status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return "An unexpected error occurred. Please try again later."
    return "Request could not be processed."


class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning(
        "AppError on %s %s: %s - %s",
        request.method,
        request.url.path,
        exc.code,
        exc.message,
    )
    safe_message = exc.message if exc.status_code < status.HTTP_500_INTERNAL_SERVER_ERROR else _safe_message_for_status(exc.status_code)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(exc.code, safe_message),
    )


async def http_exception_handler(request: Request, exc: HTTPException | StarletteHTTPException) -> JSONResponse:
    status_code = exc.status_code
    error_code = _status_code_to_error_code(status_code)
    safe_message = _safe_message_for_status(status_code)

    if status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        logger.exception(
            "HTTPException %s on %s %s",
            status_code,
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=status_code,
            content=error_payload(error_code, safe_message),
        )

    logger.info(
        "HTTPException %s on %s %s",
        status_code,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=status_code,
        content=error_payload(error_code, safe_message),
    )


async def unexpected_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
    )

    message = _safe_message_for_status(status.HTTP_500_INTERNAL_SERVER_ERROR)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_payload("INTERNAL_SERVER_ERROR", message),
    )


async def request_validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.info(
        "RequestValidationError on %s %s: %s",
        request.method,
        request.url.path,
        exc.errors(),
    )
    details = []
    for item in exc.errors():
        loc = item.get("loc", [])
        filtered_loc = [value for value in loc if value not in {"body", "query", "path"}]
        details.append(
            {
                "field": filtered_loc[-1] if filtered_loc else None,
                "message": item.get("msg", "Invalid value."),
            }
        )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": _safe_message_for_status(status.HTTP_422_UNPROCESSABLE_ENTITY),
                "details": details,
            }
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)
