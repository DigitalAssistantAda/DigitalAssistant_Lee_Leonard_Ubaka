from sqlalchemy import Column, Integer, ForeignKey, Float, DateTime, Enum, String
from sqlalchemy.sql import func
from database import Base
import enum


class DuplicateStatus(str, enum.Enum):
    """Status of a potential duplicate"""
    FLAGGED = "flagged"  # Automatically detected, awaiting review
    MERGED = "merged"    # Duplicates merged, primary doc kept
    APPROVED = "approved"  # Confirmed non-duplicate, user approved
    ARCHIVED = "archived"  # One of duplicates archived


class DocumentDuplicate(Base):
    """Tracks potential duplicate documents detected via embedding similarity"""
    __tablename__ = "document_duplicates"

    document_id = Column(Integer, ForeignKey("documents.id"), primary_key=True, nullable=False)
    duplicate_of_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    # If duplicate_of_id is NULL, this document is the primary (kept) document
    
    similarity_score = Column(Float, nullable=False)  # 0.0-1.0, embedding cosine similarity
    
    status = Column(
        Enum(DuplicateStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=DuplicateStatus.FLAGGED,
        nullable=False,
        index=True,
    )
    
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    notes = Column(String, nullable=True)  # Why was it marked as duplicate/not-duplicate?
