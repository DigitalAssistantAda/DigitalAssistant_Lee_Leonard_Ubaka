from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum, Float, Text
from sqlalchemy.sql import func
from database import Base
import enum


class EmbeddingJobStatus(str, enum.Enum):
    """Status of embedding generation job"""
    QUEUED = "queued"          # Waiting to be processed
    PROCESSING = "processing"  # Currently generating embeddings
    COMPLETE = "complete"      # Successfully generated all embeddings
    FAILED = "failed"           # Error occurred during processing
    PARTIAL = "partial"        # Some chunks failed, some succeeded


class EmbeddingJob(Base):
    """Tracks embedding generation jobs for documents"""
    __tablename__ = "embedding_jobs"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    
    status = Column(
        Enum(EmbeddingJobStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=EmbeddingJobStatus.QUEUED,
        nullable=False,
        index=True,
    )
    
    # Progress tracking
    total_chunks = Column(Integer, default=0)
    chunks_processed = Column(Integer, default=0)
    
    # Cost tracking
    model_used = Column(String, nullable=False)  # e.g., "text-embedding-ada-002"
    tokens_used = Column(Integer, default=0)
    estimated_cost = Column(Float, nullable=True)  # USD
    
    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    
    # Error tracking
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    
    # Metadata
    triggered_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Who initiated the job
    celery_task_id = Column(String, nullable=True, index=True)  # Celery async task ID for tracking
