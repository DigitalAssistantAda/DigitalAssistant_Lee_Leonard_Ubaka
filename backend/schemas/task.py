from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: str  # "issue" or "deadline"
    status: Optional[str] = "open"
    priority: Optional[str] = None  # "low", "medium", "high"
    assigned_to: Optional[int] = None
    assignees: Optional[List[int]] = None
    due_date: Optional[datetime] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None
    assignees: Optional[List[int]] = None
    due_date: Optional[datetime] = None


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
