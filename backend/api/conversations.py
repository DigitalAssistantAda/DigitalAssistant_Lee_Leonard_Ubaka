"""
Conversation endpoints for AI assistant
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_
from datetime import datetime
import json
import re
import logging
from database import get_db
from models.user import User
from models.conversation import Conversation, AIMessage, MessageRole
from models.document import Document, DocumentStatus
from models.document_chunk import DocumentChunk
from schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationListResponse,
    MessageCreate,
    MessageResponse,
)
from utils.auth import get_current_user
from utils.authorization import require_workspace_access
from utils.embeddings import embeddings_service
from utils.text_generation import summary_generation_service
from config import settings

router = APIRouter(prefix="/conversations", tags=["Conversations"])
logger = logging.getLogger(__name__)


def _is_summary_request(query_text: str) -> bool:
    text = (query_text or "").lower()
    summary_terms = ["summarize", "summary", "tldr", "tl;dr", "overview", "recap"]
    return any(term in text for term in summary_terms)


def _is_affirmative_followup(query_text: str) -> bool:
    text = (query_text or "").strip().lower()
    text = re.sub(r"[^a-z\s]", "", text)
    affirmatives = {
        "yes",
        "yeah",
        "yep",
        "sure",
        "ok",
        "okay",
        "please",
        "go ahead",
        "do it",
        "please do",
    }
    return text in affirmatives


def _is_detailed_summary_request(query_text: str) -> bool:
    text = (query_text or "").lower()
    detailed_terms = ["long", "longer", "detailed", "detail", "full", "expand", "elaborate"]
    return any(term in text for term in detailed_terms)


def _is_summary_followup(conversation_id: int | None, db: Session) -> bool:
    if not conversation_id:
        return False

    last_assistant = db.query(AIMessage).filter(
        AIMessage.conversation_id == conversation_id,
        AIMessage.role == MessageRole.ASSISTANT,
    ).order_by(AIMessage.created_at.desc()).first()

    if not last_assistant or not last_assistant.content:
        return False

    lower = last_assistant.content.lower()
    triggers = [
        "concise summary",
        "longer structured summary",
        "summary from",
    ]
    return any(token in lower for token in triggers)


def _simple_summary(text: str, max_sentences: int = 3, max_chars: int = 560) -> str:
    clean = " ".join((text or "").split())
    if not clean:
        return ""

    raw_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", clean) if s.strip()]
    candidate_sentences = [
        sentence for sentence in raw_sentences
        if 30 <= len(sentence) <= 260
    ]

    chosen = candidate_sentences[:max_sentences] if candidate_sentences else raw_sentences[:max_sentences]

    if chosen:
        summary = " ".join(chosen).strip()
    else:
        summary = clean

    return summary[:max_chars].strip()


def _format_summary_block(filename: str, summary_text: str, detailed: bool) -> str:
    if not detailed:
        return f"{filename}: {summary_text}"

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", summary_text) if s.strip()]
    overview = sentences[0] if sentences else summary_text
    key_points = sentences[1:4] if len(sentences) > 1 else []

    lines = [f"{filename}", f"Overview: {overview}"]
    if key_points:
        lines.append("Key points:")
        lines.extend([f"- {point}" for point in key_points])
    return "\n".join(lines)


def _build_assistant_message_content(
    user_query: str,
    workspace_id: int,
    db: Session,
    requested_document_ids: list[int] | None = None,
    conversation_id: int | None = None,
) -> tuple[str, list[int], list[int]]:
    """Build an assistant response grounded in workspace documents."""
    query_text = (user_query or "").strip()
    if not query_text:
        return ("Please provide a question so I can search your workspace documents.", [], [])

    scoped_document_ids = []
    if requested_document_ids:
        scoped_docs = db.query(Document.id).filter(
            Document.workspace_id == workspace_id,
            Document.id.in_(requested_document_ids),
            Document.status != DocumentStatus.DELETED,
        ).all()
        scoped_document_ids = [row[0] for row in scoped_docs]

    followup_summary_request = _is_affirmative_followup(query_text) and _is_summary_followup(conversation_id, db)
    is_summary_request = _is_summary_request(query_text) or followup_summary_request
    detailed_summary_request = _is_detailed_summary_request(query_text) or followup_summary_request

    try:
        query_embedding = embeddings_service.generate_embedding(query_text)
        similar_docs = embeddings_service.find_similar_embeddings(
            query_embedding,
            workspace_id,
            limit=5,
            threshold=0.2,
            db=db,
        )
        if scoped_document_ids:
            similar_docs = [
                (chunk_id, doc_id, score)
                for chunk_id, doc_id, score in similar_docs
                if doc_id in scoped_document_ids
            ]
    except Exception:
        db.rollback()
        similar_docs = []

    # Map doc_id → best matched chunk_id from vector search
    vector_chunk_for_doc: dict[int, int] = {}
    for chunk_id, doc_id, _score in similar_docs:
        if doc_id not in vector_chunk_for_doc:
            vector_chunk_for_doc[doc_id] = chunk_id

    document_ids = []
    if is_summary_request and scoped_document_ids:
        document_ids = scoped_document_ids[:6]
    else:
        for _chunk_id, doc_id, _score in similar_docs:
            if doc_id not in document_ids:
                document_ids.append(doc_id)
            if len(document_ids) == 3:
                break

        if not document_ids:
            pattern = f"%{query_text}%"
            chunk_query = db.query(DocumentChunk, Document).join(
                Document, Document.id == DocumentChunk.document_id
            ).filter(
                Document.workspace_id == workspace_id,
                Document.status != DocumentStatus.DELETED,
                or_(
                    DocumentChunk.text.ilike(pattern),
                    Document.filename.ilike(pattern),
                ),
            )

            if scoped_document_ids:
                chunk_query = chunk_query.filter(Document.id.in_(scoped_document_ids))

            keyword_rows = chunk_query.order_by(DocumentChunk.id.desc()).limit(6).all()

            if keyword_rows:
                for chunk, doc in keyword_rows:
                    if doc.id not in document_ids:
                        document_ids.append(doc.id)
                    if len(document_ids) == 3:
                        break

    if not document_ids:
        if scoped_document_ids:
            scoped_docs = db.query(Document).filter(
                Document.id.in_(scoped_document_ids)
            ).all()
            pending_docs = [
                doc.filename for doc in scoped_docs
                if doc.status != DocumentStatus.READY
            ]
            if pending_docs:
                preview_names = ", ".join(pending_docs[:3])
                more_count = max(0, len(pending_docs) - 3)
                suffix = f" (+{more_count} more)" if more_count else ""
                return (
                    f"I can see your selected file(s) ({preview_names}{suffix}), but they are still processing and not searchable yet. Please wait until document status is ready, then try again.",
                    [],
                    [],
                )

        selected_scope_note = " in the selected documents" if scoped_document_ids else " in this workspace"
        return (
            f"I couldn't find relevant content{selected_scope_note} yet. Try a different query or make sure your documents are processed.",
            [],
            [],
        )

    docs = db.query(Document).filter(Document.id.in_(document_ids)).all()
    doc_map = {doc.id: doc for doc in docs}
    # Use the exact matched chunks from vector search when available;
    # fall back to chunk 0 for documents found only via keyword search.
    chunk_map: dict[int, DocumentChunk] = {}
    vector_matched_chunk_ids = [
        vector_chunk_for_doc[doc_id]
        for doc_id in document_ids
        if doc_id in vector_chunk_for_doc
    ]
    if vector_matched_chunk_ids:
        vector_chunks = db.query(DocumentChunk).filter(
            DocumentChunk.id.in_(vector_matched_chunk_ids)
        ).all()
        for chunk in vector_chunks:
            chunk_map[chunk.document_id] = chunk
    # Fetch chunk 0 for any docs not covered by vector search
    keyword_only_doc_ids = [did for did in document_ids if did not in chunk_map]
    if keyword_only_doc_ids:
        fallback_chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id.in_(keyword_only_doc_ids),
            DocumentChunk.chunk_index == 0,
        ).all()
        for chunk in fallback_chunks:
            chunk_map[chunk.document_id] = chunk

    doc_summaries_map = {}
    if is_summary_request:
        all_chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id.in_(document_ids)
        ).order_by(
            DocumentChunk.document_id.asc(),
            DocumentChunk.chunk_index.asc(),
        ).all()

        chunks_by_doc = {}
        for chunk in all_chunks:
            chunks_by_doc.setdefault(chunk.document_id, []).append(chunk.text or "")

        for doc_id, chunk_texts in chunks_by_doc.items():
            joined_text = "\n".join(chunk_texts[:14])
            max_sentences = 5 if detailed_summary_request else 3
            doc_summaries_map[doc_id] = _simple_summary(joined_text, max_sentences=max_sentences)

    chunk_ids = []
    lines = []
    used_summary_keys = set()
    for doc_id in document_ids:
        document = doc_map.get(doc_id)
        chunk = chunk_map.get(doc_id)
        if not document:
            continue
        snippet = doc_summaries_map.get(doc_id) if is_summary_request else None
        if not snippet:
            snippet = (chunk.text if chunk else "") or "No preview available"
            snippet = " ".join(snippet.split())[:220]
        if chunk:
            chunk_ids.append(chunk.id)
        if is_summary_request:
            dedupe_key = (document.filename.lower(), re.sub(r"\s+", " ", snippet.lower())[:180])
            if dedupe_key in used_summary_keys:
                continue
            used_summary_keys.add(dedupe_key)
            summary_block = _format_summary_block(document.filename, snippet, detailed_summary_request)
            line_number = len(lines) + 1
            lines.append(f"{line_number}. {summary_block}")
        else:
            line_number = len(lines) + 1
            lines.append(f"{line_number}. {document.filename}: {snippet}")

    if not lines:
        return (
            "I found related documents but couldn't extract a preview yet. Please try again.",
            document_ids,
            chunk_ids,
        )

    if is_summary_request:
        intro = "Here is a concise summary from the most relevant document(s):"
        if scoped_document_ids:
            intro = "Here is a concise summary of the selected document(s):"
        if detailed_summary_request:
            intro = "Here is a longer structured summary from the most relevant document(s):"
            if scoped_document_ids:
                intro = "Here is a longer structured summary of the selected document(s):"
        content = (
            f"{intro}\n\n"
            + "\n".join(lines)
            + ("\n\nIf you want, I can break this into action items and risks next." if detailed_summary_request else "\n\nIf you want, I can produce a longer structured summary next.")
        )
    else:
        content = (
            "I searched your workspace and found these relevant snippets:\n\n"
            + "\n".join(lines)
            + "\n\nIf you want, ask a follow-up and I can narrow this down further."
        )
    return (content, document_ids, chunk_ids)


@router.post("/{workspace_id}", response_model=ConversationResponse)
async def create_conversation(
    workspace_id: int,
    request: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new conversation in a workspace"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=True,
    )
    
    # Create conversation
    conversation = Conversation(
        workspace_id=workspace_id,
        created_by=current_user.id,
        title=request.title or f"Conversation started {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )
    
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    
    return ConversationResponse.model_validate(conversation)


@router.get("/{workspace_id}", response_model=ConversationListResponse)
async def list_conversations(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all conversations in a workspace"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    conversations = db.query(Conversation).filter(
        Conversation.workspace_id == workspace_id
    ).order_by(desc(Conversation.last_message_at)).all()
    
    return ConversationListResponse(
        items=[ConversationResponse.model_validate(c) for c in conversations]
    )


@router.get("/{workspace_id}/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    workspace_id: int,
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific conversation with all messages"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    # Get conversation
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Get messages
    messages = db.query(AIMessage).filter(
        AIMessage.conversation_id == conversation_id
    ).order_by(AIMessage.created_at).all()
    
    response = ConversationResponse.model_validate(conversation)
    response.messages = [MessageResponse.model_validate(m) for m in messages]
    
    return response


@router.post("/{workspace_id}/{conversation_id}/messages", response_model=MessageResponse)
async def send_message(
    workspace_id: int,
    conversation_id: int,
    request: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message in a conversation"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    # Verify conversation exists and belongs to workspace
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Create user message
    user_message = AIMessage(
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=request.content
    )
    
    db.add(user_message)
    db.commit()
    db.refresh(user_message)
    
    # Generate assistant response grounded in workspace documents
    assistant_content, assistant_doc_ids, assistant_chunk_ids = _build_assistant_message_content(
        request.content,
        workspace_id,
        db,
        request.document_ids or [],
        conversation_id,
    )

    assistant_source = "retrieval"
    if summary_generation_service.is_available():
        try:
            assistant_content = summary_generation_service.generate_grounded_response(
                user_query=request.content,
                retrieved_context=assistant_content,
            )
            assistant_source = settings.summary_llm_provider.lower()
        except Exception as exc:
            logger.warning("Conversation LLM unavailable; using retrieval response: %s: %s", type(exc).__name__, exc)

    assistant_message = AIMessage(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=assistant_content,
        document_refs=json.dumps(assistant_doc_ids) if assistant_doc_ids else None,
        chunk_refs=json.dumps(assistant_chunk_ids) if assistant_chunk_ids else None,
        model_used=assistant_source,
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    # Update conversation's last_message_at
    conversation.last_message_at = datetime.utcnow()
    db.commit()

    return MessageResponse.model_validate(assistant_message)
