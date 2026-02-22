from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base
import enum

class DeletionRequestStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"

class DocumentDeletionRequest(Base):
    __tablename__ = "document_deletion_requests"
    
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)  # Changed from "user" to "users"
    document_owner = Column(Integer, ForeignKey("users.id"), nullable=False)  # Changed from "user" to "users"
    reason = Column(String(500), nullable=True)
    status = Column(SQLEnum(DeletionRequestStatus), default=DeletionRequestStatus.PENDING)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    responded_at = Column(DateTime, nullable=True)