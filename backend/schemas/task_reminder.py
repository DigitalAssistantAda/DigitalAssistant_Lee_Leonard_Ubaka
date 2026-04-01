from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class TaskReminderResponse(BaseModel):
    id: int
    hint_type: str
    content: str
    ai_suggested: bool
    ai_model_used: Optional[str] = None
    confidence_score: Optional[int] = None
    source_document_id: Optional[int] = None

    class Config:
        from_attributes = True


class TaskRemindersListResponse(BaseModel):
    reminders: List[TaskReminderResponse]
    reminder_generation_error: Optional[str] = None
