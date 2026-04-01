from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Any, Dict
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: str
    type: str  # "issue" or "deadline"
    status: Optional[str] = "open"
    priority: Optional[str] = None  # "low", "medium", "high"
    assigned_to: Optional[int] = None
    assignees: Optional[List[int]] = None
    due_date: Optional[datetime] = None

    @field_validator("description")
    @classmethod
    def description_required_stripped(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError(
                "Description is required: it helps your team and powers reminder suggestions "
                "(follow-ups, deadlines, reviews) from this issue and related documents."
            )
        return s


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None
    assignees: Optional[List[int]] = None
    due_date: Optional[datetime] = None

    @field_validator("description")
    @classmethod
    def description_not_blank_if_set(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        s = str(v).strip()
        if not s:
            raise ValueError(
                "Description cannot be empty; add context for your team and for reminder suggestions."
            )
        return s


class TaskResponse(BaseModel):
    id: int
    workspace_id: int
    title: str
    description: Optional[str]
    type: str
    status: str
    priority: Optional[str]
    assigned_to: Optional[int]
    assignees: List[int] = []
    due_date: Optional[datetime]
    created_by: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int


class TaskHistoryItem(BaseModel):
    id: int
    actor_user_id: int
    created_at: datetime
    changes: List[Dict[str, Any]]


class TaskHistoryListResponse(BaseModel):
    items: List[TaskHistoryItem]
