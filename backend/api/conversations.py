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
from schemas.auth import SuccessResponse
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


def _format_name_preview(names: list[str], max_items: int = 3) -> str:
    items = [name for name in names if name]
    if not items:
        return "your selected documents"
    preview = ", ".join(items[:max_items])
    remaining = len(items) - max_items
    if remaining > 0:
        preview = f"{preview} (+{remaining} more)"
    return preview


def _is_workspace_catalog_query(query_text: str) -> bool:
    """True when the user is asking what exists in the library (files/recipes/docs), not content Q&A."""
    t = (query_text or "").strip().lower()
    if not t or len(t) > 260:
        return False

    workspace_scope = any(
        p in t
        for p in (
            "workspace",
            "uploaded",
            "library",
            "in this folder",
            "my library",
            "here ",
            "do i have",
            "what do i have",
        )
    )
    inventory = any(
        p in t
        for p in (
            "list ",
            "list my",
            "list all",
            "list the",
            "list documents",
            "list files",
            "what documents",
            "what files",
            "which documents",
            "which files",
            "what recipes",
            "which recipes",
            "how many document",
            "how many file",
            "everything in",
            "all my document",
            "all my file",
            "show all document",
            "show all file",
            "anything in ",
        )
    )
    if not inventory:
        if ("what " in t or "which " in t) and "available" in t and workspace_scope:
            return True
        return False

    mentions_files_or_docs = bool(
        workspace_scope
        or "recipe" in t
        or "document" in t
        or re.search(r"\bfiles?\b", t)
    )
    if mentions_files_or_docs:
        return True
    return False


def _answer_workspace_catalog(
    workspace_id: int,
    db: Session,
    current_user_id: int | None,
    limit_to_document_ids: list[int] | None,
) -> tuple[str, list[int], list[int], bool]:
    """List workspace file names (same scope as the chat sidebar's workspace library). skip_llm=True."""
    # Match UI "Available Library" for this workspace — exclude personal uploads without workspace_id
    # so the list never mentions files the sidebar does not show.
    q = db.query(Document).filter(
        Document.status != DocumentStatus.DELETED,
        Document.workspace_id == workspace_id,
    )
    if limit_to_document_ids is not None:
        q = q.filter(Document.id.in_(limit_to_document_ids))

    docs = q.order_by(Document.filename.asc()).all()
    _ = current_user_id  # API symmetry; personal-only docs are intentionally omitted here

    if not docs:
        msg = (
            "There are no documents in this workspace yet. Upload files from Documents to add them here."
            if not limit_to_document_ids
            else "No selected workspace documents are available to list."
        )
        return (msg, [], [], True)

    lines: list[str] = []
    doc_ids: list[int] = []
    for doc in docs:
        doc_ids.append(doc.id)
        name = doc.filename or f"Document {doc.id}"
        if doc.status == DocumentStatus.READY:
            lines.append(f"- {name} (ready to search)")
        else:
            lines.append(f"- {name} (status: {doc.status.value})")

    if limit_to_document_ids is not None:
        header = "Here are the workspace documents you currently have selected for context:"
    else:
        header = "Here are the documents in this workspace (same set as your Context sidebar lists):"

    body = "\n".join(lines)
    content = (
        f"{header}\n\n{body}\n\n"
        "Ask a follow-up about a specific file if you want details from inside it."
    )
    return (content, doc_ids, [], True)


def _recent_turns_for_retrieval(conversation_id: int | None, db: Session, limit: int = 6) -> str:
    """Compact transcript tail so short follow-ups (e.g. \"two regions?\") still retrieve relevant chunks."""
    if not conversation_id:
        return ""
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    if not rows:
        return ""
    rows = list(reversed(rows))
    parts: list[str] = []
    for m in rows:
        text = (m.content or "").strip()
        if not text:
            continue
        label = "User" if m.role == MessageRole.USER else "Assistant"
        if len(text) > 4000:
            text = text[:3997] + "..."
        parts.append(f"{label}:\n{text}")
    return "\n\n".join(parts)


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


def _is_simple_greeting_or_small_talk(text: str) -> bool:
    """Detect short greetings or small talk that don't need document context."""
    t = (text or "").strip().lower()
    if not t or len(t) > 80:
        return False
    # Normalize: only letters and spaces
    normalized = re.sub(r"[^a-z\s]", "", t)
    normalized = " ".join(normalized.split())
    greetings = {
        "hi", "hello", "hey", "hi there", "hello there", "hey there",
        "good morning", "good afternoon", "good evening",
        "thanks", "thank you", "thx", "ok", "okay", "yes", "no",
        "how are you", "whats up", "sup", "yo",
    }
    return normalized in greetings or normalized.startswith(("hi ", "hey ", "hello "))


def _build_assistant_message_content(
    user_query: str,
    workspace_id: int,
    db: Session,
    requested_document_ids: list[int] | None = None,
    conversation_id: int | None = None,
    current_user_id: int | None = None,
) -> tuple[str, list[int], list[int], bool]:
    """Build an assistant response grounded in workspace and user's personal documents.

    Fourth value is skip_llm_refinement: when True, the message should be shown verbatim
    (e.g. a complete file list from the database).
    """
    query_text = (user_query or "").strip()
    if not query_text:
        return ("Please provide a question so I can search your documents.", [], [], False)

    if _is_simple_greeting_or_small_talk(query_text):
        return (
            "Hi! I'm Ada. Ask me anything about your documents—I can search, summarize, or answer questions using what you've uploaded here.",
            [],
            [],
            False,
        )

    requested_scope = bool(requested_document_ids)
    scoped_document_ids = []
    pending_selected_names: list[str] = []
    if requested_scope:
        # Include docs in this workspace OR user's personal (non-workspace) docs they can access
        scope_filter = (
            (Document.workspace_id == workspace_id)
            | ((Document.workspace_id.is_(None)) & (Document.uploaded_by == current_user_id))
        ) if current_user_id else (Document.workspace_id == workspace_id)
        scoped_docs = db.query(Document).filter(
            Document.id.in_(requested_document_ids),
            Document.status != DocumentStatus.DELETED,
            scope_filter,
        ).all()
        scoped_docs_by_id = {doc.id: doc for doc in scoped_docs}
        missing_selected_count = len(set(requested_document_ids)) - len(scoped_docs_by_id)

        for doc in scoped_docs:
            if doc.status == DocumentStatus.READY:
                scoped_document_ids.append(doc.id)
            else:
                pending_selected_names.append(doc.filename or f"Document {doc.id}")

        if not scoped_document_ids:
            if pending_selected_names:
                unavailable_suffix = " Some selected items are unavailable in this workspace." if missing_selected_count else ""
                return (
                    f"I can see your selected file(s) ({_format_name_preview(pending_selected_names)}), but they are still processing and not searchable yet. Please wait until their status is ready, then try again.{unavailable_suffix}",
                    [],
                    [],
                    False,
                )
            return (
                "I couldn't use the selected documents for this chat. Re-select documents from the current workspace or your personal folders, then try again.",
                [],
                [],
                False,
            )

    if _is_workspace_catalog_query(query_text):
        limit_ids = scoped_document_ids if requested_scope else None
        return _answer_workspace_catalog(
            workspace_id,
            db,
            current_user_id,
            limit_ids,
        )

    followup_summary_request = _is_affirmative_followup(query_text) and _is_summary_followup(conversation_id, db)
    is_summary_request = _is_summary_request(query_text) or followup_summary_request
    detailed_summary_request = _is_detailed_summary_request(query_text) or followup_summary_request

    history_for_embedding = _recent_turns_for_retrieval(conversation_id, db, limit=6)
    embedding_text = query_text
    if history_for_embedding:
        embedding_text = f"{query_text}\n\n---\nRecent conversation:\n{history_for_embedding}"[:12000]

    # Unscoped: fetch many embedding hits, then take the first hit per document (global score order).
    # That is each document's best cosine match — avoids one file filling a small LIMIT and hiding others.
    if not requested_scope:
        vec_limit = 72
        vec_threshold = 0.17
        max_docs_from_vector = 8
    else:
        vec_limit = 20
        vec_threshold = 0.2
        max_docs_from_vector = 6

    try:
        query_embedding = embeddings_service.generate_embedding(embedding_text)
        similar_docs = embeddings_service.find_similar_embeddings(
            query_embedding,
            workspace_id,
            limit=vec_limit,
            threshold=vec_threshold,
            db=db,
            user_id=current_user_id,
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

    # Map doc_id → best matched chunk_id (first row per doc = highest similarity for that doc)
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
            if len(document_ids) >= max_docs_from_vector:
                break

        if not document_ids:
            pattern = f"%{query_text}%"
            doc_scope = (
                (Document.workspace_id == workspace_id)
                | ((Document.workspace_id.is_(None)) & (Document.uploaded_by == current_user_id))
            ) if current_user_id else (Document.workspace_id == workspace_id)
            chunk_query = db.query(DocumentChunk, Document).join(
                Document, Document.id == DocumentChunk.document_id
            ).filter(
                doc_scope,
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

    # Transcript-only embedding: helps short follow-ups after a catalog or long assistant reply.
    if (
        not document_ids
        and history_for_embedding
        and len(history_for_embedding) > 80
        and not is_summary_request
    ):
        try:
            fallback_embedding = embeddings_service.generate_embedding(history_for_embedding[:10000])
            similar_fb = embeddings_service.find_similar_embeddings(
                fallback_embedding,
                workspace_id,
                limit=56,
                threshold=0.14,
                db=db,
                user_id=current_user_id,
            )
            if scoped_document_ids:
                similar_fb = [
                    (chunk_id, doc_id, score)
                    for chunk_id, doc_id, score in similar_fb
                    if doc_id in scoped_document_ids
                ]
            for chunk_id, doc_id, _score in similar_fb:
                if doc_id not in vector_chunk_for_doc:
                    vector_chunk_for_doc[doc_id] = chunk_id
                if doc_id not in document_ids:
                    document_ids.append(doc_id)
                if len(document_ids) >= max_docs_from_vector:
                    break
        except Exception:
            db.rollback()

    if not document_ids:
        selected_scope_note = " in the selected documents" if requested_scope else " in this workspace or your personal folders"
        return (
            f"I couldn't find grounded context{selected_scope_note} yet. Try a more specific question, select different documents, or wait for indexing to finish.",
            [],
            [],
            False,
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

    # Optional: add the next chunk per doc for richer context (same doc, chunk_index + 1)
    next_chunk_map: dict[int, DocumentChunk] = {}
    if chunk_map:
        doc_indices = [(doc_id, chunk_map[doc_id].chunk_index + 1) for doc_id in chunk_map]
        for doc_id, next_idx in doc_indices:
            next_chunk = db.query(DocumentChunk).filter(
                DocumentChunk.document_id == doc_id,
                DocumentChunk.chunk_index == next_idx,
            ).first()
            if next_chunk:
                next_chunk_map[doc_id] = next_chunk

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
            primary_text = (chunk.text if chunk else "") or ""
            next_chunk = next_chunk_map.get(doc_id)
            combined = primary_text + (" " + (next_chunk.text or "") if next_chunk else "")
            snippet = " ".join(combined.split())[:700] if combined.strip() else "No preview available"
        if chunk:
            chunk_ids.append(chunk.id)
        if next_chunk_map.get(doc_id):
            chunk_ids.append(next_chunk_map[doc_id].id)
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
            "I found related documents but couldn't extract a usable excerpt yet. Try a narrower question or re-select the documents you want me to use.",
            document_ids,
            chunk_ids,
            False,
        )

    pending_scope_note = ""
    if pending_selected_names:
        pending_scope_note = (
            "\n\nNote: "
            f"{_format_name_preview(pending_selected_names)} "
            "are still processing and were excluded from this answer."
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
            + pending_scope_note
        )
    else:
        content = (
            ("I searched the selected documents and found these relevant snippets:\n\n" if requested_scope else "I searched your workspace and found these relevant snippets:\n\n")
            + "\n".join(lines)
            + "\n\nIf you want, ask a follow-up and I can narrow this down further."
            + pending_scope_note
        )
    return (content, document_ids, chunk_ids, False)


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


@router.delete("/{workspace_id}/{conversation_id}", response_model=SuccessResponse)
async def delete_conversation(
    workspace_id: int,
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a conversation and all its messages"""

    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )

    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id,
    ).first()

    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    db.query(AIMessage).filter(AIMessage.conversation_id == conversation_id).delete(synchronize_session=False)
    db.delete(conversation)
    db.commit()

    return SuccessResponse(message="Conversation deleted successfully")


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
    
    # Generate assistant response grounded in workspace and user's personal documents
    assistant_content, assistant_doc_ids, assistant_chunk_ids, skip_llm_refinement = _build_assistant_message_content(
        request.content,
        workspace_id,
        db,
        request.document_ids or [],
        conversation_id,
        current_user_id=current_user.id,
    )

    assistant_source = "catalog" if skip_llm_refinement else "retrieval"
    has_selected_scope = bool(request.document_ids)
    has_grounded_context = bool(assistant_doc_ids or assistant_chunk_ids)
    is_greeting_reply = _is_simple_greeting_or_small_talk(request.content) and not assistant_doc_ids
    if (
        not has_selected_scope
        and has_grounded_context
        and not is_greeting_reply
        and not skip_llm_refinement
        and summary_generation_service.is_available()
    ):
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
