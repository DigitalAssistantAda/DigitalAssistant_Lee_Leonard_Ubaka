from pydantic import BaseModel, Field
from typing import Optional, List, Any, Literal
from datetime import datetime


class SearchRequest(BaseModel):
    workspace_id: int
    query: str
    filters: Optional[dict] = None
    limit: Optional[int] = 10


class SearchResultItem(BaseModel):
    document_id: int
    container_id: Optional[int]
    chunk_id: int
    score: float
    snippet: str
    filename: str
    created_at: datetime


class SearchResponse(BaseModel):
    query: str
    items: List[SearchResultItem]


ClientFilterSearchContext = Literal["documents_browser", "documents_folder", "ai_assistant"]


class ClientFilterSearchLogRequest(BaseModel):
    workspace_id: int = Field(..., ge=1)
    query: str = Field(..., max_length=600)
    context: ClientFilterSearchContext


class ClientFilterSearchLogResponse(BaseModel):
    ok: bool = True
