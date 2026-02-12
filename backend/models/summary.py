from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, Enum
from sqlalchemy.sql import func
from database import Base
import enum


class SummaryStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True, index=True)  # null if multi-doc
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(500), nullable=True)
    instructions = Column(Text, nullable=True)  # Custom prompt/instructions from user
    summary_text = Column(Text, nullable=True)
    status = Column(
        Enum(SummaryStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=SummaryStatus.PENDING,
        nullable=False,
        index=True,
    )
    error_message = Column(Text, nullable=True)
    model_used = Column(String(100), nullable=True)  # e.g., "gpt-4", "claude-3"
    token_count = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
