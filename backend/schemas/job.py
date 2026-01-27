from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class JobResponse(BaseModel):
    id: int
    job_type: str
    status: str
    attempts: int
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    items: List[JobResponse]
