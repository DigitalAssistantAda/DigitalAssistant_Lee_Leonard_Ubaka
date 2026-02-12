from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum, Text
from sqlalchemy.sql import func
from database import Base
import enum


class TaskType(str, enum.Enum):
    ISSUE = "issue"
    DEADLINE = "deadline"


class TaskStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CLOSED = "closed"


class TaskPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(
        Enum(TaskType, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        nullable=False,
    )  # "issue" or "deadline"
    status = Column(
        Enum(TaskStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=TaskStatus.OPEN,
        nullable=False,
        index=True,
    )
    priority = Column(
        Enum(TaskPriority, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        nullable=True,
    )  # mainly for issues
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    due_date = Column(DateTime(timezone=True), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
