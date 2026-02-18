from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from database import get_db
from models.user import User
from models.document import Document
from models.workspace import WorkspaceMember, MemberStatus
from models.document_chunk import DocumentChunk
from utils.text_extraction import extract_text_from_storage
import re
from schemas.summary import SummaryRequest, SummaryResponse, ErrorResponse, ErrorDetail
from utils.auth import get_current_user

router = APIRouter(tags=["Summaries"])


def _simple_summary(text: str, max_sentences: int = 3, max_chars: int = 800) -> str:
    clean = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", clean)
    summary = " ".join(s for s in sentences if s)[:max_chars]
    if sentences:
        summary = " ".join(sentences[:max_sentences]).strip()
    return summary[:max_chars].strip()


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
    
    try:
        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document.id
        ).order_by(DocumentChunk.chunk_index.asc()).limit(5).all()

        if chunks:
            source_text = "\n".join(chunk.text for chunk in chunks if chunk.text)
        else:
            source_text = await extract_text_from_storage(document)

        if not source_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "SUMMARY_NO_TEXT", "message": "No extractable text"}
            )

        summary_text = _simple_summary(source_text)
        
        return SummaryResponse(
            summary_text=summary_text,
            created_at=datetime.now(timezone.utc)
        )
    except HTTPException:
        raise
    except Exception as e:
        # Return error response
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SUMMARY_GENERATION_FAILED", "message": str(e)}
        )
