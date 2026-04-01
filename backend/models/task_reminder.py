from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from database import Base


class TaskReminder(Base):
    """Follow-up / deadline-style reminders for an issue or task, optionally informed by workspace documents."""

    __tablename__ = "task_reminders"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)

    hint_type = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)

    ai_suggested = Column(Boolean, default=False)
    ai_model_used = Column(String(255), nullable=True)
    confidence_score = Column(Integer, nullable=True)

    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True)

    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)

    dismissed = Column(Boolean, default=False)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
