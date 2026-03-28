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


def _owned_workspace_conversation(
    db: Session,
    workspace_id: int,
    conversation_id: int,
    owner_user_id: int,
) -> Conversation | None:
    """Conversation in this workspace started by owner_user_id, or None."""
    return db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id,
        Conversation.created_by == owner_user_id,
    ).first()


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


def _conversation_memory_window(
    conversation_id: int | None,
    db: Session,
    limit: int,
    max_chars: int,
    exclude_message_ids: set[int] | None = None,
) -> str:
    """Last N turns for response continuity, clipped for prompt budget."""
    if not conversation_id or limit <= 0 or max_chars <= 0:
        return ""

    excluded = exclude_message_ids or set()
    fetch_limit = max(limit * 3, limit + len(excluded) + 4)
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at.desc())
        .limit(fetch_limit)
        .all()
    )
    if not rows:
        return ""

    selected: list[AIMessage] = []
    for msg in rows:
        if msg.id in excluded:
            continue
        if not (msg.content or "").strip():
            continue
        selected.append(msg)
        if len(selected) >= limit:
            break

    if not selected:
        return ""

    selected = list(reversed(selected))
    parts: list[str] = []
    for msg in selected:
        label = "User" if msg.role == MessageRole.USER else "Assistant"
        content = " ".join((msg.content or "").split())
        if len(content) > 1200:
            content = content[:1197] + "..."
        parts.append(f"{label}: {content}")

    while parts and len("\n".join(parts)) > max_chars:
        parts.pop(0)

    return "\n".join(parts)


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


def _is_memory_recall_query(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False

    patterns = [
        r"\bwhat did i (say|ask|tell|mention)\b",
        r"\bwhat did i ask you(?: to)? remember\b",
        r"\b(last|previous)\s+(thing|task|request)\s+i\s+asked\b",
        r"\bremind me\b",
        r"\brecall\b",
        r"\bwhat was that again\b",
        r"\bwhat (?:were|are) the\b.*\b(region|regions|things? i said|things? i asked|items? i asked)\b",
    ]
    return any(re.search(pattern, text) for pattern in patterns)


def _is_memory_store_instruction(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False
    patterns = [
        r"\bremember (this|that)\b",
        r"\bplease remember\b",
        r"\bkeep in mind\b",
        r"\bmake a note\b",
        r"\bnote that\b",
        r"\bthis (file|document|project)\b.*\bbelongs to\b",
        r"\bthis (file|document|project)\b.*\bhas\b",
        r"\bthis (file|document|project)\b.*\bis\b",
    ]
    return any(re.search(pattern, text) for pattern in patterns)


def _is_conversation_summary_query(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False
    patterns = [
        r"\bsummar(?:y|ize)\b.*\b(we|our|conversation|chat|discussed)\b",
        r"\brecap\b.*\b(conversation|chat|what we discussed)\b",
        r"\bwhat (did|have) we discuss(?:ed)?\b",
        r"\bsummary of (our|this) (conversation|chat)\b",
    ]
    return any(re.search(pattern, text) for pattern in patterns)


def _is_non_question_assertion_or_directive(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text or "?" in text:
        return False

    # Interrogative phrasing without a trailing question mark should still be treated as a question.
    interrogative_starts = (
        "what ",
        "which ",
        "who ",
        "where ",
        "when ",
        "why ",
        "how ",
        "can ",
        "could ",
        "would ",
        "should ",
        "do ",
        "does ",
        "did ",
        "is ",
        "are ",
        "was ",
        "were ",
    )
    if text.startswith(interrogative_starts):
        return False

    # Let explicit document summary/list/search flows continue to document QA/catalog.
    if _is_summary_request(text) or _is_workspace_catalog_query(text):
        return False

    directive_starts = (
        "set ",
        "mark ",
        "label ",
        "treat ",
        "use ",
        "remember ",
        "store ",
        "note ",
        "keep ",
        "this file ",
        "this document ",
        "this project ",
    )
    if text.startswith(directive_starts):
        return True

    if re.search(r"\b(this|that)\s+(file|document|project)\b", text):
        return True

    # General fallback: treat declarative statements as memory updates.
    # Excludes explicit question/summary/catalog flows above.
    return True


def _detect_conversation_intent(query_text: str, requested_document_ids: list[int] | None = None) -> str:
    if _is_simple_greeting_or_small_talk(query_text):
        return "small_talk"
    if _is_memory_store_instruction(query_text):
        return "memory_store"
    if _is_conversation_summary_query(query_text):
        return "conversation_summary"
    if _is_memory_recall_query(query_text):
        return "memory_recall"
    if _is_workspace_catalog_query(query_text):
        return "workspace_catalog"
    if _is_non_question_assertion_or_directive(query_text):
        return "memory_store"
    if requested_document_ids:
        return "document_qa"
    return "document_qa"


def _extract_memory_candidates(text: str) -> list[str]:
    content = " ".join((text or "").split())
    if not content:
        return []

    candidates: list[str] = []
    patterns = [
        r"\bremember(?: that)?\s+(.+)$",
        r"\bthis (?:file|document|project)\s+belongs to\s+(.+)$",
        r"\bthis (?:file|document|project)\s+has\s+(.+)$",
        r"\bthis (?:file|document|project)\s+is\s+(.+)$",
        r"\b(?:my|our|the)\s+project\s+has\s+(.+)$",
        r"\b(?:my|our)\s+project\s+is\s+(.+)$",
        r"\b(?:we|i)\s+(?:have|need|use|prefer)\s+(.+)$",
    ]
    for pattern in patterns:
        m = re.search(pattern, content, flags=re.IGNORECASE)
        if m:
            fact = m.group(1).strip(" .")
            if fact and len(fact) >= 3:
                candidates.append(fact)

    return candidates


def _conversation_long_term_memory_facts(
    conversation_id: int | None,
    db: Session,
    max_messages: int = 240,
    max_facts: int = 48,
    exclude_message_ids: set[int] | None = None,
) -> list[str]:
    if not conversation_id:
        return []
    excluded = exclude_message_ids or set()
    rows = (
        db.query(AIMessage)
        .filter(
            AIMessage.conversation_id == conversation_id,
            AIMessage.role == MessageRole.USER,
        )
        .order_by(AIMessage.created_at.desc())
        .limit(max_messages)
        .all()
    )
    seen: set[str] = set()
    facts: list[str] = []
    for msg in rows:
        if msg.id in excluded:
            continue
        for candidate in _extract_memory_candidates(msg.content or ""):
            key = re.sub(r"\s+", " ", candidate.lower()).strip()
            if key in seen:
                continue
            seen.add(key)
            facts.append(candidate)
            if len(facts) >= max_facts:
                return facts
    return facts


def _select_relevant_memory_facts(query_text: str, facts: list[str], max_items: int = 4) -> list[str]:
    if not facts:
        return []
    if _is_memory_recall_query(query_text):
        return facts[:max_items]

    query_tokens = {t for t in re.split(r"\W+", (query_text or "").lower()) if len(t) >= 3}
    scored: list[tuple[int, int, str]] = []
    for idx, fact in enumerate(facts):
        fact_tokens = {t for t in re.split(r"\W+", fact.lower()) if len(t) >= 3}
        overlap = len(query_tokens & fact_tokens)
        if overlap <= 0:
            continue
        scored.append((overlap, -idx, fact))

    if not scored:
        return []
    scored.sort(reverse=True)
    return [fact for _, _, fact in scored[:max_items]]


def _conversation_summary_from_memory(memory_window: str, memory_facts: list[str]) -> str | None:
    lines = [line.strip() for line in (memory_window or "").splitlines() if line.strip()]
    if not lines and not memory_facts:
        return None

    user_turns: list[str] = []
    assistant_turns: list[str] = []
    for line in lines:
        if line.startswith("User:"):
            user_turns.append(line.split(":", 1)[1].strip())
        elif line.startswith("Assistant:"):
            assistant_turns.append(line.split(":", 1)[1].strip())

    bullets: list[str] = []
    for fact in memory_facts[:3]:
        bullets.append(f"- You asked me to remember: {fact}")
    for msg in user_turns[-3:]:
        if msg and not any(msg.lower() in f.lower() for f in memory_facts):
            bullets.append(f"- You asked: {msg}")
    for msg in assistant_turns[-2:]:
        if msg:
            bullets.append(f"- I responded: {msg}")

    if not bullets:
        return None

    return "Here is a recap of what we just discussed:\n\n" + "\n".join(bullets[:6])


def _memory_store_acknowledgement(query_text: str) -> str:
    facts = _extract_memory_candidates(query_text)
    if facts:
        return f"Got it. I’ll remember this for our conversation: {facts[0]}."
    cleaned = " ".join((query_text or "").split()).strip(" .")
    if cleaned:
        return f"Got it. I’ll remember that: {cleaned}."
    return "Got it. I’ll remember that for this conversation."


def _memory_recall_answer(query_text: str, memory_window: str, memory_facts: list[str] | None = None) -> str | None:
    if not _is_memory_recall_query(query_text):
        return None
    if (not memory_window or not memory_window.strip()) and not (memory_facts or []):
        return None

    user_lines = []
    for line in memory_window.splitlines():
        if line.startswith("User:"):
            msg = line.split(":", 1)[1].strip()
            if msg:
                user_lines.append(msg)
    for fact in (memory_facts or []):
        if fact:
            user_lines.append(fact)

    if not user_lines:
        return None

    q = (query_text or "").strip().lower()
    if "region" in q:
        patterns = [
            r"(?:has|have|are|is)\s+(?:two|2)\s+regions?\s*[:\-]\s*([^\n.]+)",
            r"regions?\s*(?:are|:)\s*([^\n.]+)",
        ]
        for msg in reversed(user_lines):
            for pattern in patterns:
                m = re.search(pattern, msg, flags=re.IGNORECASE)
                if m:
                    regions = " ".join(m.group(1).split()).strip(" .")
                    if regions:
                        return f"You previously said your project has two regions: {regions}."

    # Generic fallback for recall-style prompts
    latest = user_lines[-1]
    latest = re.sub(r"\bremember that\b", "", latest, flags=re.IGNORECASE).strip(" .")
    if latest:
        return f"From earlier in this conversation, you said: \"{latest}\"."
    return None


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

    # One best chunk per document (cosine), then rank documents — no global threshold that drops
    # whole files whose top match is weaker than a single dominant document.
    if not requested_scope:
        max_docs_from_vector = 14
    else:
        max_docs_from_vector = 6

    try:
        query_embedding = embeddings_service.generate_embedding(embedding_text, input_type="query")
        if is_summary_request and scoped_document_ids:
            similar_docs = []
        else:
            similar_docs = embeddings_service.find_top_chunk_per_document(
                query_embedding,
                workspace_id,
                db=db,
                user_id=current_user_id,
                document_ids_filter=scoped_document_ids if requested_scope else None,
                max_documents=max_docs_from_vector,
                min_similarity=0.0,
            )
    except Exception as exc:
        logger.warning("Vector search failed for workspace_id=%s: %s: %s", workspace_id, type(exc).__name__, exc)
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
            keywords = [w for w in re.split(r"\W+", query_text.lower()) if len(w) >= 3]
            doc_scope = (
                (Document.workspace_id == workspace_id)
                | ((Document.workspace_id.is_(None)) & (Document.uploaded_by == current_user_id))
            ) if current_user_id else (Document.workspace_id == workspace_id)

            keyword_conditions = []
            for kw in keywords[:6]:
                pat = f"%{kw}%"
                keyword_conditions.append(DocumentChunk.text.ilike(pat))
                keyword_conditions.append(Document.filename.ilike(pat))

            if keyword_conditions:
                chunk_query = db.query(DocumentChunk, Document).join(
                    Document, Document.id == DocumentChunk.document_id
                ).filter(
                    doc_scope,
                    Document.status != DocumentStatus.DELETED,
                    or_(*keyword_conditions),
                )

                if scoped_document_ids:
                    chunk_query = chunk_query.filter(Document.id.in_(scoped_document_ids))

                keyword_rows = chunk_query.order_by(DocumentChunk.id.desc()).limit(12).all()

                if keyword_rows:
                    for chunk, doc in keyword_rows:
                        if doc.id not in document_ids:
                            document_ids.append(doc.id)
                        if len(document_ids) == 6:
                            break

    # Transcript-only embedding: helps short follow-ups after a catalog or long assistant reply.
    if (
        not document_ids
        and history_for_embedding
        and len(history_for_embedding) > 80
        and not is_summary_request
    ):
        try:
            fallback_embedding = embeddings_service.generate_embedding(history_for_embedding[:10000], input_type="query")
            similar_fb = embeddings_service.find_top_chunk_per_document(
                fallback_embedding,
                workspace_id,
                db=db,
                user_id=current_user_id,
                document_ids_filter=scoped_document_ids if requested_scope else None,
                max_documents=max_docs_from_vector,
                min_similarity=0.0,
            )
            for chunk_id, doc_id, _score in similar_fb:
                if doc_id not in vector_chunk_for_doc:
                    vector_chunk_for_doc[doc_id] = chunk_id
                if doc_id not in document_ids:
                    document_ids.append(doc_id)
                if len(document_ids) >= max_docs_from_vector:
                    break
        except Exception as exc:
            logger.warning("Transcript fallback search failed for workspace_id=%s: %s: %s", workspace_id, type(exc).__name__, exc)
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
    source_rows: list[str] = []
    seen_source_rows: set[str] = set()
    used_summary_keys = set()
    for doc_id in document_ids:
        document = doc_map.get(doc_id)
        chunk = chunk_map.get(doc_id)
        next_chunk = next_chunk_map.get(doc_id)
        if not document:
            continue
        snippet = doc_summaries_map.get(doc_id) if is_summary_request else None
        if not snippet:
            primary_text = (chunk.text if chunk else "") or ""
            combined = primary_text + (" " + (next_chunk.text or "") if next_chunk else "")
            snippet = " ".join(combined.split())[:700] if combined.strip() else "No preview available"
        if chunk:
            chunk_ids.append(chunk.id)
        if next_chunk:
            chunk_ids.append(next_chunk.id)

        chunk_id_value = chunk.id if chunk else "n/a"
        chunk_index_value = chunk.chunk_index if chunk else "n/a"
        source_row = (
            f"- {document.filename} "
            f"(doc_id={document.id}, chunk_id={chunk_id_value}, chunk_index={chunk_index_value})"
        )
        if source_row not in seen_source_rows:
            seen_source_rows.add(source_row)
            source_rows.append(source_row)

        if is_summary_request:
            dedupe_key = (document.filename.lower(), re.sub(r"\s+", " ", snippet.lower())[:180])
            if dedupe_key in used_summary_keys:
                continue
            used_summary_keys.add(dedupe_key)
            summary_block = _format_summary_block(document.filename, snippet, detailed_summary_request)
            line_number = len(lines) + 1
            lines.append(
                f"{line_number}. {summary_block}\n"
                f"   Source: doc_id={document.id}, chunk_id={chunk_id_value}, chunk_index={chunk_index_value}"
            )
        else:
            line_number = len(lines) + 1
            lines.append(
                f"{line_number}. {document.filename}: {snippet}\n"
                f"   Evidence: doc_id={document.id}, chunk_id={chunk_id_value}, chunk_index={chunk_index_value}"
            )

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
            + "Answer:\n"
            + "\n".join(lines)
            + ("\n\nSources used:\n" + "\n".join(source_rows) if source_rows else "")
            + ("\n\nIf you want, I can break this into action items and risks next." if detailed_summary_request else "\n\nIf you want, I can produce a longer structured summary next.")
            + pending_scope_note
        )
    else:
        content = (
            ("I searched the selected documents and found grounded evidence.\n\n" if requested_scope else "I searched your workspace and found grounded evidence.\n\n")
            + "Evidence:\n"
            + "\n".join(lines)
            + ("\n\nSources used:\n" + "\n".join(source_rows) if source_rows else "")
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
    """List conversations in a workspace for the current user (private per member)."""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    conversations = db.query(Conversation).filter(
        Conversation.workspace_id == workspace_id,
        Conversation.created_by == current_user.id,
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
    
    conversation = _owned_workspace_conversation(
        db, workspace_id, conversation_id, current_user.id
    )
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

    conversation = _owned_workspace_conversation(
        db, workspace_id, conversation_id, current_user.id
    )
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
    
    conversation = _owned_workspace_conversation(
        db, workspace_id, conversation_id, current_user.id
    )
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
    
    requested_document_ids = request.document_ids or []
    intent = _detect_conversation_intent(request.content, requested_document_ids)
    assistant_content = ""
    assistant_doc_ids: list[int] = []
    assistant_chunk_ids: list[int] = []
    skip_llm_refinement = False
    assistant_source = "router"

    memory_window_context = ""
    selected_memory_facts: list[str] = []
    if settings.conversation_memory_window_enabled:
        memory_window_context = _conversation_memory_window(
            conversation_id=conversation_id,
            db=db,
            limit=max(settings.conversation_memory_window_messages, 0),
            max_chars=max(settings.conversation_memory_window_max_chars, 0),
            exclude_message_ids={user_message.id},
        )
        all_facts = _conversation_long_term_memory_facts(
            conversation_id=conversation_id,
            db=db,
            exclude_message_ids={user_message.id},
        )
        selected_memory_facts = _select_relevant_memory_facts(request.content, all_facts, max_items=4)
        if selected_memory_facts:
            facts_block = "\n".join([f"User fact: {fact}" for fact in selected_memory_facts])
            if memory_window_context:
                memory_window_context = f"{memory_window_context}\n\n{facts_block}"
            else:
                memory_window_context = facts_block

    window_turns = len(re.findall(r"^(?:User|Assistant):", memory_window_context, flags=re.MULTILINE))
    if settings.conversation_memory_window_enabled:
        logger.info(
            "conversation memory window: conversation_id=%s intent=%s turns=%s chars=%s facts=%s",
            conversation_id,
            intent,
            window_turns,
            len(memory_window_context),
            len(selected_memory_facts),
        )

    # Hybrid router:
    # - memory_store / memory_recall / conversation_summary -> memory-first
    # - document_qa / workspace_catalog / default -> retrieval-first
    if intent == "memory_store":
        assistant_content = _memory_store_acknowledgement(request.content)
        assistant_source = "memory-window"
        skip_llm_refinement = True
    elif intent == "memory_recall":
        memory_answer = _memory_recall_answer(request.content, memory_window_context, selected_memory_facts)
        if memory_answer:
            assistant_content = memory_answer
        elif selected_memory_facts:
            assistant_content = f"From earlier in this conversation, you asked me to remember: {selected_memory_facts[0]}."
        else:
            assistant_content = "I don’t have enough prior conversation context yet to recall that. Please restate it once and I’ll keep it in mind."
        assistant_source = "memory-window"
        skip_llm_refinement = True
    elif intent == "conversation_summary":
        convo_summary = _conversation_summary_from_memory(memory_window_context, selected_memory_facts)
        assistant_content = convo_summary or "We don’t have enough prior turns in this conversation to summarize yet."
        assistant_source = "memory-window"
        skip_llm_refinement = True
    else:
        assistant_content, assistant_doc_ids, assistant_chunk_ids, skip_llm_refinement = _build_assistant_message_content(
            request.content,
            workspace_id,
            db,
            requested_document_ids,
            conversation_id,
            current_user_id=current_user.id,
        )
        assistant_source = "catalog" if skip_llm_refinement else "retrieval"

    has_grounded_context = bool(assistant_doc_ids or assistant_chunk_ids)
    # With documents selected, still run the LLM so answers target the question — not raw chunk dumps.
    is_greeting_reply = _is_simple_greeting_or_small_talk(request.content) and not assistant_doc_ids
    if (
        intent not in {"memory_store", "memory_recall", "conversation_summary"}
        and
        has_grounded_context
        and not is_greeting_reply
        and not skip_llm_refinement
        and summary_generation_service.is_available()
    ):
        try:
            assistant_content = summary_generation_service.generate_grounded_response(
                user_query=request.content,
                retrieved_context=assistant_content,
                memory_window=memory_window_context,
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
