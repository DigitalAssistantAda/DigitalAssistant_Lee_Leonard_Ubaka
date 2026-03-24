from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from database import init_db
from errors import register_exception_handlers
from middleware import authorization_middleware, SafeRequestLogMiddleware

from models.user import User
from models.document import Document
from models.container import Container
from models.workspace import Workspace, WorkspaceMember
from api import (
    auth_router,
    users_router,
    workspaces_router,
    containers_router,
    documents_router,
    search_router,
    summaries_router,
    audit_logs_router,
    embeddings_router,
)
from api.dashboard import router as dashboard_router
from api.messages import router as messages_router
from api.tasks import router as tasks_router
from api.conversations import router as conversations_router
from api.deletion_requests import router as deletion_requests_router
from api.ws import router as ws_router

app = FastAPI(
    title="Digital Assistant API",
    description="Secure digital assistant for academic and professional knowledge work",
    version="1.0.0"
)

register_exception_handlers(app)

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
cors_origin_regex = os.getenv("CORS_ORIGIN_REGEX", r"https://.*\.ngrok-free\.app")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add authorization middleware for request-level checks
app.middleware("http")(authorization_middleware)

# Add logging middleware for all requests
app.add_middleware(SafeRequestLogMiddleware)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()


class HealthResponse(BaseModel):
    status: str
    message: str


@app.get("/")
async def root():
    """Hello world endpoint"""
    return {"message": "Ada's on the way..."}


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        message="API is running"
    )


# Include all API routers under /api/v1 prefix
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(workspaces_router, prefix="/api/v1")
app.include_router(containers_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(search_router, prefix="/api/v1")
app.include_router(summaries_router, prefix="/api/v1")
app.include_router(audit_logs_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(messages_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(embeddings_router, prefix="/api/v1")
app.include_router(conversations_router, prefix="/api/v1")
app.include_router(deletion_requests_router, prefix="/api/v1")
app.include_router(ws_router, prefix="/api/v1")
