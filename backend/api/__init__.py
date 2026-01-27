from .auth import router as auth_router
from .users import router as users_router
from .workspaces import router as workspaces_router
from .documents import router as documents_router
from .jobs import router as jobs_router
from .search import router as search_router
from .summaries import router as summaries_router
from .audit_logs import router as audit_logs_router

__all__ = [
    "auth_router",
    "users_router",
    "workspaces_router",
    "documents_router",
    "jobs_router",
    "search_router",
    "summaries_router",
    "audit_logs_router",
]
