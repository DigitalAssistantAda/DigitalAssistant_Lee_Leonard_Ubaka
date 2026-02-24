from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import logging
from database import get_db
from models.user import User
from models.document import Document
from models.workspace import WorkspaceMember, MemberStatus
from models.document_chunk import DocumentChunk
from errors import AppError
from utils.text_extraction import extract_text_from_storage
from utils.text_generation import summary_generation_service
from config import settings
import re
from schemas.summary import SummaryRequest, SummaryResponse
from utils.auth import get_current_user

router = APIRouter(tags=["Summaries"])
logger = logging.getLogger(__name__)


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
        chunks_query = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document.id
        )

        if request.chunk_ids:
            chunks_query = chunks_query.filter(DocumentChunk.id.in_(request.chunk_ids))

        chunks = chunks_query.order_by(DocumentChunk.chunk_index.asc()).limit(12).all()

        if chunks:
            source_text = "\n".join(chunk.text for chunk in chunks if chunk.text)
        else:
            source_text = await extract_text_from_storage(document)

        if not source_text:
            raise AppError(
                code="DOCUMENT_PARSING_FAILED",
                message="Document content could not be processed.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        bounded_source_text = source_text[:settings.summary_llm_max_input_chars]
        summary_source = "fallback"

        try:
            summary_text = summary_generation_service.summarize(
                source_text=bounded_source_text,
                instructions=request.instructions,
            )
            summary_source = settings.summary_llm_provider.lower()
        except Exception as exc:
            logger.warning("Summary LLM failed (%s: %s); falling back", type(exc).__name__, exc)
            summary_text = _simple_summary(source_text)
        
        return SummaryResponse(
            summary_text=summary_text,
            created_at=datetime.now(timezone.utc),
            summary_source=summary_source,
        )
    except HTTPException:
        raise
    except AppError:
        raise
    except ValueError:
        raise AppError(
            code="DOCUMENT_PARSING_FAILED",
            message="Document content could not be processed.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    except Exception:
        # Return error response
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SUMMARY_GENERATION_FAILED", "message": "An unexpected error occurred. Please try again later."}
        )
