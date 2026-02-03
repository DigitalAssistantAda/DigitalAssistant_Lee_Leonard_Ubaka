from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum, Text
from sqlalchemy.sql import func
from database import Base
import enum


class JobType(str, enum.Enum):
    TEXT_EXTRACTION = "text_extraction"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    SUMMARIZATION = "summarization"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    job_type = Column(Enum(JobType), nullable=False)
    status = Column(Enum(JobStatus), nullable=False, default=JobStatus.QUEUED)
    attempts = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
