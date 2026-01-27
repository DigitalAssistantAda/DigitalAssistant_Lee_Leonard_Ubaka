from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from database import get_db
from models.user import User
from models.document import Document
from models.workspace import WorkspaceMember, MemberStatus
from schemas.summary import SummaryRequest, SummaryResponse, ErrorResponse, ErrorDetail
from utils.auth import get_current_user

router = APIRouter(tags=["Summaries"])


@router.post("/summaries", response_model=SummaryResponse)
async def create_summary(
    request: SummaryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generates an AI-assisted summary of a document or selected chunks"""
    
    # Check document access
    document = db.query(Document).filter(Document.id == request.document_id).first()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == document.workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # TODO: Implement actual AI summarization
    # For now, return a placeholder
    
    try:
        summary_text = "Summary generation is not yet implemented."
        
        return SummaryResponse(
            summary_text=summary_text,
            created_at=datetime.now(timezone.utc)
        )
    except Exception as e:
        # Return error response
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SUMMARY_GENERATION_FAILED", "message": str(e)}
        )
