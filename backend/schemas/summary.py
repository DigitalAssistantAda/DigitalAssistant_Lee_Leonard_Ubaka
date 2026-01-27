from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SummaryRequest(BaseModel):
    document_id: int
    chunk_ids: Optional[List[int]] = None
    instructions: Optional[str] = None


class SummaryResponse(BaseModel):
    summary_text: str
    created_at: datetime


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
