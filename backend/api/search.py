from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from database import get_db
from models.user import User
from models.workspace import WorkspaceMember, MemberStatus
from schemas.search import SearchRequest, SearchResponse, SearchResultItem
from utils.auth import get_current_user

router = APIRouter(tags=["Search"])


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Performs keyword or semantic search across authorized documents"""
    
    # Check workspace membership
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == request.workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    # TODO: Implement actual search logic with embeddings/text search
    # For now, return empty results
    
    return SearchResponse(
        query=request.query,
        items=[]
    )
