"""Tracks global embedding training/refresh jobs (re-embed all, fine-tune model)."""
from sqlalchemy import Column, String, Integer, DateTime, Enum, Text
from sqlalchemy.sql import func
from database import Base
import enum


class EmbeddingTrainingJobType(str, enum.Enum):
    REFRESH = "refresh"      # Re-embed all documents with current model
    FINE_TUNE = "fine_tune"  # Fine-tune model on document data, then optionally re-embed


class EmbeddingTrainingJobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


class EmbeddingTrainingJob(Base):
    __tablename__ = "embedding_training_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(
        Enum(EmbeddingTrainingJobType, values_callable=lambda c: [e.value for e in c]),
        nullable=False,
        index=True,
    )
    status = Column(
        Enum(EmbeddingTrainingJobStatus, values_callable=lambda c: [e.value for e in c]),
        default=EmbeddingTrainingJobStatus.PENDING,
        nullable=False,
        index=True,
    )
    workspace_id = Column(Integer, nullable=True, index=True)  # None = all workspaces
    celery_task_id = Column(String, nullable=True, index=True)
    documents_processed = Column(Integer, default=0)
    documents_total = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
