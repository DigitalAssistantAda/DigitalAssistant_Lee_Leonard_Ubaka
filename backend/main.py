from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from database import init_db
from api import (
    auth_router,
    users_router,
    workspaces_router,
    documents_router,
    jobs_router,
    search_router,
    summaries_router,
    audit_logs_router,
)

app = FastAPI(
    title="Digital Assistant API",
    description="Secure digital assistant for academic and professional knowledge work",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(documents_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(search_router, prefix="/api/v1")
app.include_router(summaries_router, prefix="/api/v1")
app.include_router(audit_logs_router, prefix="/api/v1")
