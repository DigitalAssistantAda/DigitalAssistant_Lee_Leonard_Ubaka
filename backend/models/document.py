from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum, BigInteger
from sqlalchemy.sql import func
from database import Base
import enum


class DocumentStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    DELETED = "deleted"


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    container_id = Column(Integer, ForeignKey("containers.id"), nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    storage_uri = Column(String, nullable=False)  # s3://bucket/path or minio://path
    status = Column(
        Enum(DocumentStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        nullable=False,
        default=DocumentStatus.UPLOADED,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
