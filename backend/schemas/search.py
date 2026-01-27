from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class SearchRequest(BaseModel):
    workspace_id: int
    query: str
    filters: Optional[dict] = None
    limit: Optional[int] = 10


class SearchResultItem(BaseModel):
    document_id: int
    chunk_id: int
    score: float
    snippet: str
    filename: str
    created_at: datetime


class SearchResponse(BaseModel):
    query: str
    items: List[SearchResultItem]
