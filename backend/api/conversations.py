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
from tasks.chat import generate_grounded_response as celery_generate_grounded_response
from tasks.chat import generate_summary as celery_generate_summary
from config import settings

router = APIRouter(prefix="/conversations", tags=["Conversations"])
logger = logging.getLogger(__name__)

COMMON_QUERY_STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "what", "when", "where", "which",
    "about", "into", "your", "you", "are", "can", "could", "would", "should", "want", "need", "needs", "needed",
    "does", "have", "has", "had", "was", "were", "how", "why", "who", "will", "make", "making",
    "doing", "just", "please", "tell", "show", "give", "there", "their", "them", "then", "than",
    "summarize", "summary", "find", "create", "draft", "compare", "explain", "review", "analyze",
    "current", "required", "much", "prepare", "prepared", "preparing", "start", "starting", "started",
    "before", "begin", "begins", "beginning",
}


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
    candidate_sentences = [sentence for sentence in raw_sentences if 30 <= len(sentence) <= 260]
    ranked_pool = candidate_sentences if candidate_sentences else raw_sentences

    scored: list[tuple[float, int, str]] = []
    for idx, sentence in enumerate(ranked_pool):
        words = [w for w in re.split(r"[^a-z0-9]+", sentence.lower()) if w]
        word_count = len(words)
        unique_ratio = (len(set(words)) / word_count) if word_count else 0.0

        # Prefer substantive, information-dense sentences without domain hardcoding.
        score = 0.0
        if 8 <= word_count <= 42:
            score += 2.0
        elif word_count > 42:
            score += 1.0
        score += unique_ratio * 2.5
        if any(ch.isdigit() for ch in sentence):
            score += 1.0
        if sentence.strip().endswith((".", "!", "?")):
            score += 0.5

        scored.append((score, idx, sentence))

    if scored:
        top = sorted(scored, key=lambda item: (item[0], -item[1]), reverse=True)[:max_sentences]
        chosen = [sentence for _score, idx, sentence in sorted(top, key=lambda item: item[1])]
    else:
        chosen = raw_sentences[:max_sentences]

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


def _build_summary_generation_context(
    db: Session,
    document_ids: list[int],
    detailed: bool = False,
) -> str:
    if not document_ids:
        return ""

    docs = db.query(Document).filter(Document.id.in_(document_ids)).all()
    doc_map = {doc.id: doc for doc in docs}

    all_chunks = db.query(DocumentChunk).filter(
        DocumentChunk.document_id.in_(document_ids)
    ).order_by(
        DocumentChunk.document_id.asc(),
        DocumentChunk.chunk_index.asc(),
    ).all()

    chunks_by_doc: dict[int, list[str]] = {}
    for chunk in all_chunks:
        chunks_by_doc.setdefault(chunk.document_id, []).append(chunk.text or "")

    per_doc_limit = 5000 if detailed else 3200
    blocks: list[str] = []
    for doc_id in document_ids:
        chunk_texts = chunks_by_doc.get(doc_id, [])
        if not chunk_texts:
            continue

        if len(chunk_texts) <= 24:
            sample_chunks = chunk_texts
        else:
            head = chunk_texts[:8]
            mid_start = max(0, (len(chunk_texts) // 2) - 4)
            middle = chunk_texts[mid_start:mid_start + 8]
            tail = chunk_texts[-8:]
            sample_chunks = head + middle + tail

        excerpt = "\n".join(sample_chunks)
        normalized = " ".join(excerpt.split())[:per_doc_limit]
        document = doc_map.get(doc_id)
        filename = document.filename if document else f"Document {doc_id}"
        blocks.append(f"{filename}:\n{normalized}")

    max_total_chars = getattr(settings, "summary_llm_max_input_chars", 12000) - 1200
    return "\n\n".join(blocks)[:max_total_chars]


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


def _recent_turns_for_retrieval(
    conversation_id: int | None,
    db: Session,
    limit: int = 6,
    include_assistant: bool = False,
) -> str:
    """Compact recent transcript tail for retrieval, usually using user turns only."""
    if not conversation_id or limit <= 0:
        return ""

    fetch_limit = max(limit * 3, limit + 4)
    rows = (
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at.desc())
        .limit(fetch_limit)
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
        if m.role != MessageRole.USER and not include_assistant:
            continue
        label = "User" if m.role == MessageRole.USER else "Assistant"
        if len(text) > 2000:
            text = text[:1997] + "..."
        parts.append(f"{label}:\n{text}")
        if len(parts) >= limit:
            break
    return "\n\n".join(parts)


def _conversation_memory_window(
    conversation_id: int | None,
    db: Session,
    limit: int,
    max_chars: int,
    exclude_message_ids: set[int] | None = None,
    include_assistant: bool = True,
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
        if msg.role != MessageRole.USER and not include_assistant:
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


def _clean_fallback_snippet(text: str, max_chars: int = 420) -> str:
    clean = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    # Replace filled checkmark symbols inside brackets: [✓] → [x]; bare ✓ → x
    clean = re.sub(r"\[([✓✔☑])\]", "[x]", clean)
    clean = re.sub(r"[✓✔☑]", "x", clean)
    clean = re.sub(r"(?:[ \t]*[-–—_=|/\\]{2,}[ \t]*)+", " ", clean)
    # Collapse horizontal whitespace only (preserve newlines)
    clean = re.sub(r"[ \t]+", " ", clean)
    # Collapse 3+ consecutive newlines to 2
    clean = re.sub(r"\n{3,}", "\n\n", clean)
    # Re-insert newlines before checklist items that got squashed onto one line
    # e.g. "foo [ ] bar" → "foo\n[ ] bar"
    clean = re.sub(r"(?<!\n)([ \t]*\[ ?[xX ]?\])", r"\n\1", clean)
    clean = clean.strip(" \t\n-:;,.")
    if not clean:
        return "No readable excerpt available."
    if len(clean) <= max_chars:
        return clean

    clipped = clean[:max_chars]
    sentence_end = max(clipped.rfind(". "), clipped.rfind("? "), clipped.rfind("! "))
    if sentence_end >= max_chars // 2:
        return clipped[:sentence_end + 1].strip()
    word_end = clipped.rfind(" ")
    if word_end >= max_chars // 2:
        clipped = clipped[:word_end]
    return clipped.rstrip(" ,;:") + "..."


def _extract_answer_preview(user_query: str, snippets: list[str], max_sentences: int = 2) -> str:
    cleaned_snippets = [snippet for snippet in (_clean_fallback_snippet(s, max_chars=320) for s in snippets) if snippet]
    if not cleaned_snippets:
        return "I found relevant evidence below."

    query_terms = _extract_retrieval_terms(user_query, max_terms=8)
    ranked_sentences: list[tuple[int, str]] = []
    for snippet in cleaned_snippets[:3]:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", snippet) if s.strip()]
        if not sentences:
            sentences = [snippet]
        for sentence in sentences:
            lowered = sentence.lower()
            score = sum(1 for term in query_terms if term and term in lowered)
            if any(ch.isdigit() for ch in sentence):
                score += 1
            ranked_sentences.append((score, sentence))

    ranked_sentences.sort(key=lambda item: item[0], reverse=True)
    chosen: list[str] = []
    seen: set[str] = set()
    for _score, sentence in ranked_sentences:
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        chosen.append(sentence)
        if len(chosen) >= max_sentences:
            break

    if not chosen:
        return cleaned_snippets[0]
    return " ".join(chosen)


def _query_wants_table(query_text: str) -> bool:
    text = (query_text or "").lower()
    if not text:
        return False
    markers = (
        "table",
        "tabular",
        "matrix",
        "put it in a table",
        "format as a table",
        "compare",
        "columns",
        "rows",
    )
    return any(marker in text for marker in markers)


def _query_wants_list(query_text: str) -> bool:
    text = (query_text or "").lower()
    if not text:
        return False
    markers = (
        "list",
        "bullet",
        "itemize",
        "items",
        "steps",
        "step by step",
        "numbered",
        "checklist",
    )
    return any(marker in text for marker in markers)


def _query_wants_numbered_list(query_text: str) -> bool:
    text = (query_text or "").lower()
    if not text:
        return False
    markers = (
        "numbered",
        "steps",
        "step by step",
        "step-by-step",
        "checklist",
    )
    return any(marker in text for marker in markers)


def _has_markdown_table(text: str) -> bool:
    if not text:
        return False
    has_row = re.search(r"(?m)^\s*\|.+\|\s*$", text) is not None
    has_separator = re.search(r"(?m)^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$", text) is not None
    return has_row and has_separator


def _has_markdown_list(text: str) -> bool:
    if not text:
        return False
    return re.search(r"(?m)^\s*(?:[-*+]\s+|\d+\.\s+)", text) is not None


def _markdown_table_from_rows(rows: list[list[str]]) -> str:
    if len(rows) < 2:
        return ""
    col_count = len(rows[0])
    if col_count < 2:
        return ""
    if any(len(row) != col_count for row in rows):
        return ""

    header = [cell.strip() or f"Column {idx + 1}" for idx, cell in enumerate(rows[0])]
    separator = ["---"] * col_count
    body = [[cell.strip() or "-" for cell in row] for row in rows[1:]]

    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(separator) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines)


def _try_delimited_text_to_table(content: str) -> str:
    lines = [line.strip() for line in (content or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return ""

    # Try to convert plain pipe rows without markdown separator.
    if all("|" in line for line in lines) and not _has_markdown_table(content):
        rows = [[cell.strip() for cell in line.strip("|").split("|")] for line in lines]
        table = _markdown_table_from_rows(rows)
        if table:
            return table

    # Try tab or comma delimited rows with consistent column count.
    delimiter = "\t" if all("\t" in line for line in lines) else None
    if delimiter is None and all("," in line and line.count(",") <= 6 and not line.endswith(".") for line in lines
    ):
        delimiter = ","

    if delimiter:
        rows = []
        for line in lines:
            raw_cells = [cell.strip().strip('"\'') for cell in line.split(delimiter)]
            rows.append(raw_cells)
        table = _markdown_table_from_rows(rows)
        if table:
            return table

    return ""


def _try_key_value_lines_to_table(content: str) -> str:
    lines = [line.strip() for line in (content or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return ""

    pairs: list[tuple[str, str]] = []
    prefix_lines: list[str] = []
    for line in lines:
        candidate = re.sub(r"^[-*+]\s+", "", line)
        match = re.match(r"^([^:]{1,80}):\s+(.+)$", candidate)
        if match:
            key = match.group(1).strip()
            value = match.group(2).strip()
            if key and value:
                pairs.append((key, value))
        else:
            prefix_lines.append(line)

    if len(pairs) < 2:
        return ""

    table_lines = [
        "| Item | Value |",
        "|---|---|",
    ]
    table_lines.extend(f"| {key} | {value} |" for key, value in pairs)
    table = "\n".join(table_lines)

    if prefix_lines:
        return f"{prefix_lines[0]}\n\n{table}"
    return table


def _split_list_candidates(content: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", content or "").strip()
    if not normalized:
        return []

    parts = re.split(
        r"\s*(?:\n+|\[\s?[xX]?\s?\]\s+|(?<!\S)\d+\.\s+|(?<!\S)[-*+]\s+)",
        normalized,
    )

    candidates: list[str] = []
    for part in parts:
        for subpart in re.split(r"\s+(?=\d+\.\s+[A-Z])", part):
            cleaned = subpart.strip(" -:;,.\t\n")
            if len(cleaned) >= 8:
                candidates.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _render_markdown_list(items: list[str], numbered: bool) -> str:
    if not items:
        return ""
    if numbered:
        return "\n".join(f"{idx + 1}. {item}" for idx, item in enumerate(items))
    return "\n".join(f"- {item}" for item in items)


def _normalize_answer_section_to_list(user_query: str, section_text: str) -> str:
    if _has_markdown_list(section_text) or _has_markdown_table(section_text):
        return section_text

    numbered = _query_wants_numbered_list(user_query)
    items = _split_list_candidates(section_text)
    if len(items) >= 2:
        return _render_markdown_list(items[:10], numbered)

    sentence_parts = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+", section_text)
        if part.strip()
    ]
    if len(sentence_parts) >= 2:
        return _render_markdown_list(sentence_parts[:8], numbered)

    return section_text


def _normalize_assistant_markdown(user_query: str, assistant_content: str) -> str:
    content = (assistant_content or "").strip()
    if not content:
        return assistant_content

    wants_table = _query_wants_table(user_query)
    wants_list = _query_wants_list(user_query)

    # Preserve already-correct markdown structures.
    if wants_table and not _has_markdown_table(content):
        table_from_kv = _try_key_value_lines_to_table(content)
        if table_from_kv:
            content = table_from_kv
        else:
            table_from_delimited = _try_delimited_text_to_table(content)
            if table_from_delimited:
                content = table_from_delimited

    if wants_list:
        evidence_split = re.split(r"\n(?=#+\s+Evidence\b|Evidence\b)", content, maxsplit=1)
        leading = evidence_split[0]
        trailing = f"\n{evidence_split[1]}" if len(evidence_split) > 1 else ""

        answer_match = re.match(r"^(.*?)(#+\s+Answer\b\s*\n|Answer\b\s*\n)(.*)$", leading, flags=re.DOTALL)
        if answer_match:
            prefix = answer_match.group(1)
            answer_heading = answer_match.group(2)
            answer_body = answer_match.group(3).strip()
            normalized_answer = _normalize_answer_section_to_list(user_query, answer_body)
            content = f"{prefix}{answer_heading}{normalized_answer}{trailing}".strip()
        elif not _has_markdown_list(content) and not _has_markdown_table(content):
            content = _normalize_answer_section_to_list(user_query, content)

    return content


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


def _is_followup_refinement_request(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False
    patterns = [
        r"\bnarrow (it|this|that) down\b",
        r"\bnarrow (it|this|that) down further\b",
        r"\bany more key points\b",
        r"\bwhat else\b",
        r"\bdidn'?t mention\b",
        r"\bshorten (it|this|that)\b",
        r"\bmake (it|this|that) (shorter|clearer|simpler)\b",
        r"\bsummar(?:ize|y) (it|this|that)\b",
        r"\belaborate\b",
        r"\bexpand (it|this|that)\b",
        r"\bclarify (it|this|that)\b",
        r"\bbe more specific\b",
        r"\bgive me fewer points\b",
    ]
    return any(re.search(pattern, text) for pattern in patterns)


def _is_explicit_document_query(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False
    doc_markers = (
        "document",
        "file",
        "selected file",
        "selected document",
        "pdf",
        "checklist",
    )
    return any(marker in text for marker in doc_markers)


def _is_context_dependent_followup(query_text: str) -> bool:
    text = " ".join((query_text or "").strip().lower().split())
    if not text:
        return False

    if _is_followup_refinement_request(text) or _is_affirmative_followup(text):
        return True

    followup_starts = (
        "and ",
        "also ",
        "then ",
        "so ",
        "what about",
        "how about",
        "what else",
        "anything else",
        "tell me more",
        "explain that",
        "clarify that",
        "expand on that",
    )
    if text.startswith(followup_starts):
        return True

    tokens = re.findall(r"[a-z0-9']+", text)
    if not tokens:
        return False

    referential_terms = {
        "it", "this", "that", "these", "those", "they", "them",
        "one", "ones", "former", "latter", "same", "earlier", "previous",
    }
    has_reference = any(token in referential_terms for token in tokens)
    short_context_question = len(tokens) <= 10 and has_reference
    if short_context_question:
        return True

    if len(tokens) <= 6 and text.endswith("?"):
        short_question_starts = (
            "why", "when", "where", "which", "who", "how", "what about",
        )
        if text.startswith(short_question_starts):
            return True

    return False


def _should_include_memory_for_llm(query_text: str, intent: str) -> bool:
    if intent in {"memory_store", "memory_recall", "conversation_summary"}:
        return True
    if _is_explicit_document_query(query_text):
        return False
    if _is_context_dependent_followup(query_text):
        return True
    return len(_tokenize_for_match(query_text)) <= 6


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

    # Follow-up refinement commands should continue answer flow, not memory-store ack.
    if _is_followup_refinement_request(text):
        return False

    # Let explicit document summary/list/search flows continue to document QA/catalog.
    if _is_summary_request(text) or _is_workspace_catalog_query(text):
        return False

    # Task style requests often omit a question mark but should still be treated as document QA.
    task_request_starts = (
        "find ",
        "show ",
        "list ",
        "compare ",
        "explain ",
        "tell me ",
        "give me ",
        "draft ",
        "create ",
        "write ",
        "analyze ",
        "review ",
        "search ",
        "look up ",
        "outline ",
    )
    if text.startswith(task_request_starts):
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

    # Only treat clearly user/project factual statements as memory updates.
    fact_like_starts = (
        "i ",
        "we ",
        "my ",
        "our ",
        "this project ",
        "this document ",
        "this file ",
    )
    return text.startswith(fact_like_starts)


def _detect_conversation_intent(query_text: str, requested_document_ids: list[int] | None = None) -> str:
    if _is_simple_greeting_or_small_talk(query_text):
        return "small_talk"
    if _is_memory_store_instruction(query_text):
        return "memory_store"
    if _is_conversation_summary_query(query_text):
        return "conversation_summary"
    if _is_memory_recall_query(query_text):
        return "memory_recall"
    if _is_followup_refinement_request(query_text):
        return "document_qa"
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


def _recent_grounded_document_ids(
    conversation_id: int | None,
    db: Session,
    max_messages: int = 4,
) -> list[int]:
    if not conversation_id:
        return []

    rows = (
        db.query(AIMessage)
        .filter(
            AIMessage.conversation_id == conversation_id,
            AIMessage.role == MessageRole.ASSISTANT,
        )
        .order_by(AIMessage.created_at.desc())
        .limit(max_messages)
        .all()
    )

    for msg in rows:
        raw_refs = (msg.document_refs or "").strip()
        if not raw_refs:
            continue
        try:
            parsed = json.loads(raw_refs)
        except Exception:
            continue
        if not isinstance(parsed, list):
            continue
        doc_ids: list[int] = []
        for value in parsed:
            try:
                doc_ids.append(int(value))
            except (TypeError, ValueError):
                continue
        if doc_ids:
            return doc_ids

    return []


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


def _filename_stem(filename: str) -> str:
    base = (filename or "").strip().lower()
    if "." in base:
        base = base.rsplit(".", 1)[0]
    return re.sub(r"[^a-z0-9\s_-]", "", base)


def _tokenize_for_match(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) >= 3]


def _extract_retrieval_terms(query_text: str, max_terms: int = 8) -> list[str]:
    tokens = _tokenize_for_match(query_text)
    filtered = [t for t in tokens if t not in COMMON_QUERY_STOPWORDS]
    # Fallback to raw tokens so short queries still work.
    selected = filtered if filtered else tokens

    # Generic, non-domain specific light normalization so direct evidence like
    # singular/plural or basic tense variants still counts as grounded support.
    expanded: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        t = (term or "").strip().lower()
        if not t or t in seen or len(t) < 3:
            return
        seen.add(t)
        expanded.append(t)

    for base in selected[:max_terms]:
        add(base)

        if base.endswith("ies") and len(base) > 4:
            add(base[:-3] + "y")
        if base.endswith("s") and len(base) > 3:
            add(base[:-1])
        else:
            add(base + "s")

        if base.endswith("ing") and len(base) > 5:
            add(base[:-3])
        if base.endswith("ed") and len(base) > 4:
            add(base[:-2])
        if base.endswith("y") and len(base) > 3:
            add(base[:-1] + "ies")

    return expanded[: max(max_terms * 2, max_terms)]


def _extract_focus_terms(query_text: str, max_terms: int = 6) -> list[str]:
    """Query terms for attribution: favor topical words, not broad helper words."""
    tokens = _tokenize_for_match(query_text)
    low_signal_terms = {
        "long", "time", "times", "much", "many", "need", "needs", "needed",
        "require", "required", "requires", "using", "used",
        "avoid", "avoids", "avoiding",
        "prepare", "prepared", "preparing", "start", "starting", "started",
        "before", "begin", "begins", "beginning",
    }
    focused = [t for t in tokens if t not in COMMON_QUERY_STOPWORDS and t not in low_signal_terms]
    selected = focused if focused else [t for t in tokens if t not in COMMON_QUERY_STOPWORDS]

    expanded: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        t = (term or "").strip().lower()
        if not t or t in seen or len(t) < 3:
            return
        seen.add(t)
        expanded.append(t)

    for base in selected[:max_terms]:
        add(base)
        if base.endswith("ies") and len(base) > 4:
            add(base[:-3] + "y")
        if base.endswith("s") and len(base) > 3:
            add(base[:-1])
        else:
            add(base + "s")
        if base.endswith("ing") and len(base) > 5:
            add(base[:-3])
        if base.endswith("ed") and len(base) > 4:
            add(base[:-2])
        if base.endswith("y") and len(base) > 3:
            add(base[:-1] + "ies")

    return expanded[: max(max_terms * 2, max_terms)]


def _is_implication_question(query_text: str) -> bool:
    q = (query_text or "").lower()
    if not q:
        return False
    patterns = (
        "what happens if",
        "what if",
        "if someone",
        "if we",
        "if i",
        "consequence",
        "consequences",
        "outcome",
        "penalty",
        "penalties",
        "result if",
    )
    return any(p in q for p in patterns)


def _is_duration_question(query_text: str) -> bool:
    q = (query_text or "").lower()
    if not q:
        return False
    patterns = (
        "how long",
        "how much time",
        "how many days",
        "how many weeks",
        "how many months",
        "how many years",
        "duration",
        "timeframe",
        "timeline",
        "deadline",
        "by when",
        "when is it due",
    )
    return any(p in q for p in patterns)


def _expand_terms_for_implication(query_terms: list[str], implication_query: bool) -> list[str]:
    if not implication_query:
        return query_terms

    # Generic, non-domain specific expansion: lightweight morphological variants
    merged: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        t = (term or "").strip().lower()
        if not t or t in seen or len(t) < 3:
            return
        seen.add(t)
        merged.append(t)

    for base in query_terms:
        add(base)

        # Singular/plural variants
        if base.endswith("s") and len(base) > 3:
            add(base[:-1])
        else:
            add(base + "s")

        # Simple stem/tense variants
        if base.endswith("ing") and len(base) > 5:
            add(base[:-3])
        if base.endswith("ed") and len(base) > 4:
            add(base[:-2])
        if base.endswith("tion"):
            add(base + "s")
        if base.endswith("y") and len(base) > 3:
            add(base[:-1] + "ies")

    return merged[:16]


def _expand_terms_for_duration(query_terms: list[str], duration_query: bool) -> list[str]:
    if not duration_query:
        return query_terms

    merged: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        t = (term or "").strip().lower()
        if not t or t in seen or len(t) < 3:
            return
        seen.add(t)
        merged.append(t)

    for base in query_terms:
        add(base)

    generic_time_terms = (
        "time",
        "duration",
        "timeline",
        "timeframe",
        "deadline",
        "period",
        "within",
        "complete",
        "completion",
        "finish",
        "finished",
        "days",
        "weeks",
        "months",
        "years",
        "hours",
    )
    for term in generic_time_terms:
        add(term)

    return merged[:24]


def _has_temporal_signal(text: str) -> bool:
    t = (text or "").lower()
    if not t:
        return False
    if re.search(r"\b\d+\s*(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)\b", t):
        return True
    if re.search(r"\b(within|by|before|after|until|deadline|timeframe|timeline|duration|per\s+week|per\s+month)\b", t):
        return True
    return False


def _build_query_phrases(query_text: str, terms: list[str], max_phrases: int = 4) -> list[str]:
    phrase_terms = _tokenize_for_match(query_text)
    phrase_terms = [t for t in phrase_terms if t in set(terms)]
    phrases: list[str] = []
    for idx in range(len(phrase_terms) - 1):
        a = phrase_terms[idx]
        b = phrase_terms[idx + 1]
        if a == b:
            continue
        phrase = f"{a} {b}"
        if phrase not in phrases:
            phrases.append(phrase)
        if len(phrases) >= max_phrases:
            break
    return phrases


def _rank_documents_by_keyword_hits(
    workspace_id: int,
    db: Session,
    current_user_id: int | None,
    query_terms: list[str],
    query_phrases: list[str],
    scoped_document_ids: list[int] | None = None,
    limit: int = 6,
) -> list[int]:
    if not query_terms and not query_phrases:
        return []

    doc_scope = (
        (Document.workspace_id == workspace_id)
        | ((Document.workspace_id.is_(None)) & (Document.uploaded_by == current_user_id))
    ) if current_user_id else (Document.workspace_id == workspace_id)

    keyword_conditions = []
    for term in query_terms[:8]:
        pat = f"%{term}%"
        keyword_conditions.append(DocumentChunk.text.ilike(pat))
        keyword_conditions.append(Document.filename.ilike(pat))
    for phrase in query_phrases[:4]:
        pat = f"%{phrase}%"
        keyword_conditions.append(DocumentChunk.text.ilike(pat))
        keyword_conditions.append(Document.filename.ilike(pat))

    if not keyword_conditions:
        return []

    chunk_query = db.query(DocumentChunk, Document).join(
        Document, Document.id == DocumentChunk.document_id
    ).filter(
        doc_scope,
        Document.status == DocumentStatus.READY,
        Document.status != DocumentStatus.DELETED,
        or_(*keyword_conditions),
    )

    if scoped_document_ids:
        chunk_query = chunk_query.filter(Document.id.in_(scoped_document_ids))

    rows = chunk_query.order_by(DocumentChunk.id.desc()).limit(140).all()
    if not rows:
        return []

    scored: dict[int, int] = {}
    for chunk, doc in rows:
        text = (chunk.text or "").lower()
        filename = (doc.filename or "").lower()
        score = 0
        for term in query_terms:
            if term in text:
                score += 4
            if term in filename:
                score += 5
        for phrase in query_phrases:
            if phrase in text:
                score += 10
            if phrase in filename:
                score += 12
        if score:
            scored[doc.id] = max(scored.get(doc.id, 0), score)

    ranked = sorted(scored.items(), key=lambda item: item[1], reverse=True)
    return [doc_id for doc_id, _ in ranked[:limit]]


def _is_counterfactual_or_missing_item_question(query_text: str) -> bool:
    q = (query_text or "").strip().lower()
    if not q:
        return False
    patterns = (
        "what if",
        "if i don't have",
        "if i dont have",
        "if i do not have",
        "without ",
        "instead of",
        "substitute",
        "replacement",
        "alternative",
    )
    return any(p in q for p in patterns)


def _context_has_counterfactual_support(context_text: str) -> bool:
    """Check if context explicitly guides on counterfactual scenarios.
    
    Must have positive outcome signals (can still/will still work/may still be good)
    paired with counterfactual language (without/omit/substitute).
    Negative-only consequences (will fail/collapse/not work) without positive continuity
    do NOT count as support.
    """
    t = (context_text or "").lower()
    if not t:
        return False

    negative_only_patterns = (
        r"\b(?:will\s+(?:be\s+)?(?:fail|collapse|not\s+work|be\s+broken|not\s+possible)|cannot|can't|does?n't\s+work|won't\s+work|required|must\s+have|essential|crucial|impossible)\b",
    )
    if any(re.search(pattern, t) for pattern in negative_only_patterns):
        return False

    positive_continuity = (
        r"\b(?:can\s+still|will\s+still|may\s+still|might\s+still|can\s+still\s+be|will\s+still\s+be|can\s+(?:make|bake|prepare|try))\b",
        r"\b(?:still\s+(?:delicious|good|work|be|come\s+out|turn\s+out))\b",
        r"\b(?:and\s+(?:they|it|the)\s+(?:will|may|can)\s+still)\b",
    )
    has_positive = any(re.search(pattern, t) for pattern in positive_continuity)

    counterfactual_language = (
        r"\b(?:without|omit|omitted|substitute|substitut|replace|replac|instead\s+of|alternative|if\s+(?:you|i)\s+(?:don't|do not|skip|leave out))\b",
    )
    has_counterfactual = any(re.search(pattern, t) for pattern in counterfactual_language)

    return has_positive and has_counterfactual


def _snippet_match_score(snippet_text: str, query_terms: list[str], query_phrases: list[str]) -> int:
    lower = (snippet_text or "").lower()
    if not lower:
        return 0

    score = 0
    for phrase in query_phrases:
        if phrase and phrase in lower:
            score += 5
    for term in query_terms:
        if term and term in lower:
            score += 2
    return score


def _retrieved_context_has_direct_signal(context_text: str, query_terms: list[str], query_phrases: list[str]) -> bool:
    haystack = (context_text or "").lower()
    if not haystack:
        return False
    if any(phrase in haystack for phrase in query_phrases if phrase):
        return True
    term_hits = sum(1 for term in query_terms if term and term in haystack)
    return term_hits >= 2


def _extract_evidence_lines(context_text: str, query_terms: list[str], query_phrases: list[str], max_items: int = 3) -> list[str]:
    hits: list[str] = []
    for raw_line in (context_text or "").splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        # Keep the informative content after the first colon, which usually contains the excerpt.
        excerpt = line.split(":", 1)[1].strip()
        if not excerpt:
            continue
        if _snippet_match_score(excerpt, query_terms, query_phrases) < 4:
            continue
        compact = " ".join(excerpt.split())
        if compact and compact not in hits:
            hits.append(compact[:260])
        if len(hits) >= max_items:
            break
    return hits


def _best_matching_excerpt(text: str, query_terms: list[str], query_phrases: list[str], max_chars: int = 180) -> str:
    compact = " ".join((text or "").split())
    if not compact:
        return ""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", compact) if s.strip()]
    if not sentences:
        return compact[:max_chars]

    best_sentence = ""
    best_score = 0
    for sentence in sentences:
        score = _snippet_match_score(sentence, query_terms, query_phrases)
        if score > best_score:
            best_score = score
            best_sentence = sentence

    if best_sentence:
        return best_sentence[:max_chars]
    return ""


def _select_best_chunk_for_document(
    db: Session,
    doc_id: int,
    query_terms: list[str],
    query_phrases: list[str],
    vector_similarity_by_chunk: dict[int, float],
    vector_candidate_ids: list[int] | None = None,
    implication_query: bool = False,
    duration_query: bool = False,
) -> DocumentChunk | None:
    candidate_ids = list(dict.fromkeys(vector_candidate_ids or []))[:10]
    candidates: list[DocumentChunk] = []
    seen_ids: set[int] = set()

    if candidate_ids:
        for chunk in db.query(DocumentChunk).filter(DocumentChunk.id.in_(candidate_ids)).all():
            if chunk.id not in seen_ids:
                candidates.append(chunk)
                seen_ids.add(chunk.id)

    keyword_filters = []
    for kw in query_terms[:6]:
        keyword_filters.append(DocumentChunk.text.ilike(f"%{kw}%"))
    for phrase in query_phrases[:4]:
        keyword_filters.append(DocumentChunk.text.ilike(f"%{phrase}%"))

    if keyword_filters:
        keyword_chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id == doc_id,
            or_(*keyword_filters),
        ).order_by(DocumentChunk.chunk_index.asc()).limit(12).all()
        for chunk in keyword_chunks:
            if chunk.id not in seen_ids:
                candidates.append(chunk)
                seen_ids.add(chunk.id)

    # Always include chunk 0 as a fallback anchor.
    chunk_zero = db.query(DocumentChunk).filter(
        DocumentChunk.document_id == doc_id,
        DocumentChunk.chunk_index == 0,
    ).first()
    if chunk_zero and chunk_zero.id not in seen_ids:
        candidates.append(chunk_zero)
        seen_ids.add(chunk_zero.id)

    if not candidates:
        return None

    best_chunk = None
    best_score = float("-inf")
    for chunk in candidates:
        keyword_score = float(_snippet_match_score(chunk.text or "", query_terms, query_phrases))
        vector_score = float(vector_similarity_by_chunk.get(chunk.id, 0.0))
        density_bonus = 0.0
        if implication_query and len((chunk.text or "").split()) > 18:
            density_bonus = 0.5
        temporal_bonus = 0.0
        if duration_query and _has_temporal_signal(chunk.text or ""):
            temporal_bonus = 1.5
        score = (vector_score * 8.0) + (keyword_score * 2.5) + density_bonus + temporal_bonus
        if score > best_score:
            best_score = score
            best_chunk = chunk

    return best_chunk


def _extract_numeric_tokens(text: str) -> list[str]:
    normalized = (text or "").lower().replace("—", "-").replace("–", "-")
    # Capture exact numeric claims including rangeS, percentages, and decimals.
    pattern = r"\b\d+(?:\.\d+)?(?:\s*%|\s*(?:-|to)\s*\d+(?:\.\d+)?)?\b"
    return [" ".join(token.split()) for token in re.findall(pattern, normalized)]


def _has_ungrounded_numeric_claims(answer_text: str, context_text: str) -> bool:
    answer_tokens = _extract_numeric_tokens(answer_text)
    if not answer_tokens:
        return False

    context_normalized = (context_text or "").lower().replace("—", "-").replace("–", "-")
    for token in answer_tokens:
        raw = token.strip()
        if not raw:
            continue
        variants = {raw, raw.replace(" to ", "-")}
        if "-" in raw:
            variants.add(raw.replace("-", " to "))
        if not any(v and v in context_normalized for v in variants):
            return True
    return False


def _build_direct_grounded_fallback(
    context_text: str,
    query_terms: list[str],
    query_phrases: list[str],
) -> str | None:
    lines = _extract_evidence_lines(context_text, query_terms, query_phrases, max_items=2)
    if not lines:
        return None

    primary = lines[0].strip()
    if not primary:
        return None

    if len(lines) == 1:
        return primary
    secondary = lines[1].strip()
    if not secondary:
        return primary
    return f"{primary} {secondary}"


def _prefers_single_document_summary(query_text: str) -> bool:
    q = (query_text or "").strip().lower()
    if not q:
        return False

    multi_markers = (
        "both",
        "all",
        "compare",
        "comparison",
        "versus",
        " vs ",
        "together",
        "across",
    )
    if any(marker in q for marker in multi_markers):
        return False

    # If the query explicitly joins two targets, avoid forcing single doc focus.
    if " and " in q and ("document" in q or "file" in q or "guide" in q or "handbook" in q):
        return False

    return True


def _find_explicit_document_mentions(
    query_text: str,
    workspace_id: int,
    db: Session,
    current_user_id: int | None,
    scoped_document_ids: list[int] | None = None,
    max_matches: int = 4,
) -> list[int]:
    """Best-effort filename matching so users can ask about a file without manually selecting context."""
    query = (query_text or "").strip().lower()
    if not query:
        return []

    scope_filter = (
        (Document.workspace_id == workspace_id)
        | ((Document.workspace_id.is_(None)) & (Document.uploaded_by == current_user_id))
    ) if current_user_id else (Document.workspace_id == workspace_id)

    docs_query = db.query(Document).filter(
        Document.status == DocumentStatus.READY,
        Document.status != DocumentStatus.DELETED,
        scope_filter,
    )
    if scoped_document_ids:
        docs_query = docs_query.filter(Document.id.in_(scoped_document_ids))

    docs = docs_query.order_by(Document.created_at.desc()).limit(300).all()
    if not docs:
        return []

    query_tokens = set(_tokenize_for_match(query))
    quoted_terms = [
        m.group(1).strip().lower()
        for m in re.finditer(r'"([^"\\]{3,120})"', query)
        if m.group(1).strip()
    ]

    scored: list[tuple[int, int]] = []
    for doc in docs:
        filename = (doc.filename or "").lower()
        stem = _filename_stem(doc.filename or "")
        if not filename:
            continue

        score = 0
        if stem and stem in query:
            score += 120

        for term in quoted_terms:
            if term and (term in filename or term in stem):
                score += 100

        name_tokens = set(_tokenize_for_match(stem))
        if name_tokens and query_tokens:
            overlap = len(name_tokens.intersection(query_tokens))
            if overlap:
                score += overlap * 18
            if len(name_tokens) <= 6 and name_tokens.issubset(query_tokens):
                score += 70

        if score > 0:
            scored.append((doc.id, score))

    scored.sort(key=lambda item: item[1], reverse=True)
    if not scored:
        return []

    top_score = scored[0][1]
    score_cutoff = max(18, int(top_score * 0.45))
    filtered = [doc_id for doc_id, score in scored if score >= score_cutoff]
    return filtered[:max_matches]


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
    implication_query = _is_implication_question(query_text)
    duration_query = _is_duration_question(query_text)
    query_focus_terms = _extract_focus_terms(query_text, max_terms=6)
    explicit_doc_ids = _find_explicit_document_mentions(
        query_text=query_text,
        workspace_id=workspace_id,
        db=db,
        current_user_id=current_user_id,
        scoped_document_ids=scoped_document_ids if requested_scope else None,
        max_matches=4,
    )

    include_assistant_history = _is_context_dependent_followup(query_text)
    history_for_embedding = _recent_turns_for_retrieval(
        conversation_id,
        db,
        limit=6,
        include_assistant=include_assistant_history,
    )

    continuity_document_ids: list[int] = []
    if (
        not requested_scope
        and not explicit_doc_ids
        and conversation_id
        and (len(query_focus_terms) <= 1 or include_assistant_history)
    ):
        continuity_document_ids = _recent_grounded_document_ids(conversation_id, db, max_messages=3)

    effective_document_scope_ids = scoped_document_ids if requested_scope else (continuity_document_ids or None)
    retrieval_seed_text = query_text
    if len(query_focus_terms) <= 1 and history_for_embedding:
        retrieval_seed_text = f"{query_text}\n\nRecent conversation:\n{history_for_embedding}"[:12000]
        query_focus_terms = _extract_focus_terms(retrieval_seed_text, max_terms=6)

    query_focus_phrases = _build_query_phrases(retrieval_seed_text, query_focus_terms, max_phrases=3)

    query_keywords = _extract_retrieval_terms(retrieval_seed_text, max_terms=8)
    query_keywords = _expand_terms_for_implication(query_keywords, implication_query)
    query_keywords = _expand_terms_for_duration(query_keywords, duration_query)
    query_phrases = _build_query_phrases(retrieval_seed_text, query_keywords, max_phrases=4)

    embedding_text = query_text
    if history_for_embedding:
        embedding_text = f"{query_text}\n\n---\nRecent conversation:\n{history_for_embedding}"[:12000]

    # One best chunk per document (cosine), then rank documents — no global threshold that drops
    # whole files whose top match is weaker than a single dominant document.
    if not requested_scope:
        max_docs_from_vector = 10
    else:
        max_docs_from_vector = 6

    vector_similarity_by_chunk: dict[int, float] = {}
    vector_chunks_by_doc: dict[int, list[int]] = {}

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
                document_ids_filter=effective_document_scope_ids,
                max_documents=max_docs_from_vector,
                min_similarity=0.0,
            )

            # Lightweight chunk level candidate pool for reranking: mix semantic proximity
            # with keyword overlap instead of relying on one strategy alone.
            similar_chunks = embeddings_service.find_similar_embeddings(
                query_embedding,
                workspace_id,
                limit=180,
                threshold=0.0,
                db=db,
                user_id=current_user_id,
            )
            for chunk_id, doc_id, sim in similar_chunks:
                c_id = int(chunk_id)
                d_id = int(doc_id)
                score = float(sim)
                vector_similarity_by_chunk[c_id] = max(vector_similarity_by_chunk.get(c_id, 0.0), score)
                vector_chunks_by_doc.setdefault(d_id, []).append(c_id)
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
        keyword_ranked_doc_ids = _rank_documents_by_keyword_hits(
            workspace_id=workspace_id,
            db=db,
            current_user_id=current_user_id,
            query_terms=query_keywords,
            query_phrases=query_phrases,
            scoped_document_ids=effective_document_scope_ids,
            limit=6,
        )

        for doc_id in explicit_doc_ids:
            if doc_id not in document_ids:
                document_ids.append(doc_id)
        for doc_id in keyword_ranked_doc_ids:
            if doc_id not in document_ids:
                document_ids.append(doc_id)

        # If we already found strong keyword ranked matches, keep the set focused to avoid
        # unrelated snippets diluting the answer. Otherwise, expand using vector matches.
        if keyword_ranked_doc_ids:
            document_ids = document_ids[:4]
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
            for kw in query_keywords[:6]:
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

                if effective_document_scope_ids:
                    chunk_query = chunk_query.filter(Document.id.in_(effective_document_scope_ids))

                keyword_rows = chunk_query.order_by(DocumentChunk.id.desc()).limit(12).all()

                if keyword_rows:
                    for chunk, doc in keyword_rows:
                        if doc.id not in document_ids:
                            document_ids.append(doc.id)
                        if len(document_ids) == 6:
                            break

    if is_summary_request and document_ids:
        if explicit_doc_ids:
            # Keep summary scope aligned to explicitly mentioned filenames when present.
            focused_ids = [doc_id for doc_id in explicit_doc_ids if doc_id in document_ids]
            if focused_ids:
                if _prefers_single_document_summary(query_text):
                    document_ids = focused_ids[:1]
                else:
                    document_ids = focused_ids
        summary_doc_cap = 6 if detailed_summary_request else 3
        document_ids = document_ids[:summary_doc_cap]

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
                document_ids_filter=effective_document_scope_ids,
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
    chunk_map: dict[int, DocumentChunk] = {}
    for doc_id in document_ids:
        best_chunk = _select_best_chunk_for_document(
            db=db,
            doc_id=doc_id,
            query_terms=query_keywords,
            query_phrases=query_phrases,
            vector_similarity_by_chunk=vector_similarity_by_chunk,
            vector_candidate_ids=vector_chunks_by_doc.get(doc_id, []),
            implication_query=implication_query,
            duration_query=duration_query,
        )
        if best_chunk:
            chunk_map[doc_id] = best_chunk

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

    # Add up to two extra chunks per document using keyword hits so answers are grounded in the
    # relevant section, not only the first chunk.
    supplemental_chunks_by_doc: dict[int, list[DocumentChunk]] = {}
    if not is_summary_request and document_ids:
        for doc_id in document_ids[:8]:
            primary_ids = {
                chunk_map[doc_id].id if doc_id in chunk_map else None,
                next_chunk_map[doc_id].id if doc_id in next_chunk_map else None,
            }

            chunk_q = db.query(DocumentChunk).filter(DocumentChunk.document_id == doc_id)
            if query_keywords:
                keyword_filters = [DocumentChunk.text.ilike(f"%{kw}%") for kw in query_keywords[:6]]
                chunk_q = chunk_q.filter(or_(*keyword_filters))

            extra = (
                chunk_q
                .order_by(DocumentChunk.chunk_index.asc())
                .limit(20)
                .all()
            )

            # Add semantic nearest chunks for this document into the same candidate pool.
            vector_candidate_ids = vector_chunks_by_doc.get(doc_id, [])[: (12 if (implication_query or duration_query) else 6)]
            vector_candidates = []
            if vector_candidate_ids:
                vector_candidates = db.query(DocumentChunk).filter(
                    DocumentChunk.id.in_(vector_candidate_ids)
                ).all()

            combined_candidates: list[DocumentChunk] = []
            seen_candidate_ids: set[int] = set()
            for candidate in extra + vector_candidates:
                if candidate.id in seen_candidate_ids:
                    continue
                seen_candidate_ids.add(candidate.id)
                combined_candidates.append(candidate)

            scored_extra: list[tuple[int, DocumentChunk]] = []
            for c in combined_candidates:
                if c.id in primary_ids:
                    continue

                keyword_score = float(_snippet_match_score(c.text or "", query_keywords, query_phrases))
                vector_score = float(vector_similarity_by_chunk.get(c.id, 0.0))
                proximity_bonus = 0.0
                if doc_id in chunk_map:
                    if abs(c.chunk_index - chunk_map[doc_id].chunk_index) <= 2:
                        proximity_bonus = 1.0

                temporal_bonus = 0.0
                if duration_query and _has_temporal_signal(c.text or ""):
                    temporal_bonus = 1.5

                composite_score = (keyword_score * 2.0) + (vector_score * 8.0) + proximity_bonus + temporal_bonus
                if composite_score > 0:
                    scored_extra.append((int(composite_score * 1000), c))

            scored_extra.sort(key=lambda item: (item[0], -item[1].chunk_index), reverse=True)
            target_extra_count = 4 if implication_query else 2
            filtered_extra = [c for _score, c in scored_extra[:target_extra_count]]

            # For implication style questions, include small neighboring context windows from
            # the same matched document so downstream generation can infer related sections.
            if implication_query and len(filtered_extra) < target_extra_count and doc_id in chunk_map:
                anchor_idx = chunk_map[doc_id].chunk_index
                neighbor_rows = db.query(DocumentChunk).filter(
                    DocumentChunk.document_id == doc_id,
                    DocumentChunk.chunk_index.in_([
                        anchor_idx - 6, anchor_idx - 5, anchor_idx - 4, anchor_idx - 3,
                        anchor_idx - 2, anchor_idx - 1, anchor_idx + 1, anchor_idx + 2,
                        anchor_idx + 3, anchor_idx + 4, anchor_idx + 5, anchor_idx + 6,
                    ]),
                ).order_by(DocumentChunk.chunk_index.asc()).all()

                for neighbor in neighbor_rows:
                    if neighbor.id in primary_ids or any(existing.id == neighbor.id for existing in filtered_extra):
                        continue
                    filtered_extra.append(neighbor)
                    if len(filtered_extra) >= target_extra_count:
                        break

            if filtered_extra:
                supplemental_chunks_by_doc[doc_id] = filtered_extra

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
            if len(chunk_texts) <= 24:
                sample_chunks = chunk_texts
            else:
                head = chunk_texts[:8]
                mid_start = max(0, (len(chunk_texts) // 2) - 4)
                middle = chunk_texts[mid_start:mid_start + 8]
                tail = chunk_texts[-8:]
                sample_chunks = head + middle + tail

            joined_text = "\n".join(sample_chunks)
            max_sentences = 8 if detailed_summary_request else 5
            doc_summaries_map[doc_id] = _simple_summary(joined_text, max_sentences=max_sentences)

    chunk_ids = []
    kept_document_ids: list[int] = []
    lines = []
    source_rows: list[str] = []
    seen_source_rows: set[str] = set()
    used_summary_keys = set()
    source_terms = query_focus_terms if query_focus_terms else query_keywords[:6]
    source_phrases = query_focus_phrases if query_focus_phrases else query_phrases[:2]
    prepared_rows: list[dict[str, object]] = []

    for doc_id in document_ids:
        document = doc_map.get(doc_id)
        chunk = chunk_map.get(doc_id)
        next_chunk = next_chunk_map.get(doc_id)
        anchor_chunk = chunk or next_chunk
        chunk_index_value = str(int(anchor_chunk.chunk_index) + 1) if anchor_chunk and anchor_chunk.chunk_index is not None else "n/a"
        if not document:
            continue
        snippet = doc_summaries_map.get(doc_id) if is_summary_request else None
        if not snippet:
            primary_text = (chunk.text if chunk else "") or ""
            next_chunk = next_chunk_map.get(doc_id)
            supplemental_text = " ".join((c.text or "") for c in supplemental_chunks_by_doc.get(doc_id, []))
            combined = primary_text
            if next_chunk:
                combined = f"{combined} {next_chunk.text or ''}"
            if supplemental_text:
                combined = f"{combined} {supplemental_text}"
            # Keep a richer contiguous snippet so exact instructions (numbers/ranges) are not lost.
            max_snippet_chars = 1500 if implication_query else 900
            if combined.strip():
                # Collapse horizontal whitespace per line but preserve newlines so
                # checklist items ([ ] ...) and table rows remain on separate lines.
                cleaned_lines = [re.sub(r"[ \t]+", " ", line).strip() for line in combined.splitlines()]
                snippet = "\n".join(line for line in cleaned_lines if line)[:max_snippet_chars]
            else:
                snippet = "No preview available"

        source_match_score = _snippet_match_score(snippet or "", source_terms, source_phrases)
        prepared_rows.append({
            "doc_id": doc_id,
            "document": document,
            "chunk": chunk,
            "next_chunk": next_chunk,
            "snippet": snippet,
            "preview": _clean_fallback_snippet(snippet),
            "chunk_index_value": chunk_index_value,
            "source_match_score": source_match_score,
        })

    has_positive_source_match = any(int(item["source_match_score"]) > 0 for item in prepared_rows)
    top_source_match_score = max((int(item["source_match_score"]) for item in prepared_rows), default=0)
    if has_positive_source_match:
        prepared_rows.sort(key=lambda item: int(item["source_match_score"]), reverse=True)

    for item in prepared_rows:
        doc_id = int(item["doc_id"])
        document = item["document"]
        chunk = item["chunk"]
        next_chunk = item["next_chunk"]
        snippet = str(item["snippet"])
        preview = str(item["preview"])
        chunk_index_value = str(item["chunk_index_value"])
        source_match_score = int(item["source_match_score"])

        relative_match_ok = (
            not has_positive_source_match
            or top_source_match_score < 5
            or source_match_score >= max(2, top_source_match_score - 2)
        )
        should_keep_doc = (
            doc_id in explicit_doc_ids
            or (source_match_score >= 2 and relative_match_ok)
            or len(document_ids) == 1
            or not has_positive_source_match
        )
        if not should_keep_doc:
            continue

        if doc_id not in kept_document_ids:
            kept_document_ids.append(doc_id)

        source_row = (
            f"- {document.filename} (section {chunk_index_value})"
            if chunk_index_value != "n/a"
            else f"- {document.filename}"
        )
        if source_row not in seen_source_rows:
            seen_source_rows.add(source_row)
            source_rows.append(source_row)

        if chunk:
            chunk_ids.append(chunk.id)
        if next_chunk:
            chunk_ids.append(next_chunk.id)
        if supplemental_chunks_by_doc.get(doc_id):
            chunk_ids.extend([c.id for c in supplemental_chunks_by_doc[doc_id]])
        if is_summary_request:
            dedupe_key = (document.filename.lower(), re.sub(r"\s+", " ", snippet.lower())[:180])
            if dedupe_key in used_summary_keys:
                continue
            used_summary_keys.add(dedupe_key)
            summary_block = _format_summary_block(document.filename, snippet, detailed_summary_request)
            line_number = len(lines) + 1
            lines.append(
                f"{line_number}. {summary_block}\n"
                f"   Source: {document.filename}, section {chunk_index_value if chunk_index_value != 'n/a' else 'n/a'}"
            )
        else:
            section_label = f", section {chunk_index_value}" if chunk_index_value != "n/a" else ""
            # If the preview contains checklist-style lines, format them as a nested
            # markdown list so ReactMarkdown renders each item on its own line.
            has_checklist = bool(re.search(r"\[ ?[xX ]?\]", preview))
            if "\n" in preview and has_checklist:
                nested: list[str] = []
                for pline in preview.split("\n"):
                    pline = pline.strip()
                    if not pline:
                        continue
                    if re.match(r"\[ ?[xX ]?\]", pline):
                        nested.append(f"  - {pline}")
                    else:
                        nested.append(f"  {pline}")
                formatted = "\n".join(nested)
                lines.append(f"- **{document.filename}**{section_label}:\n{formatted}")
            else:
                indented_preview = preview.replace("\n", "\n  ")
                lines.append(f"- **{document.filename}**{section_label}: {indented_preview}")

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
            + pending_scope_note
        )
    else:
        answer_preview = _extract_answer_preview(
            query_text,
            [str(item["snippet"]) for item in prepared_rows[:3]],
        )
        scope_label = "selected documents" if requested_scope else "workspace documents"
        content = (
            f"### Answer\n{answer_preview}\n\n"
            + f"### Evidence\n"
            + "\n".join(lines)
            + f"\n\nSource scope: {scope_label}."
            + pending_scope_note
        )
    return (content, kept_document_ids or document_ids, chunk_ids, False)


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
    include_assistant_memory = intent in {"memory_store", "memory_recall", "conversation_summary"} or _is_context_dependent_followup(request.content)
    if settings.conversation_memory_window_enabled:
        memory_window_context = _conversation_memory_window(
            conversation_id=conversation_id,
            db=db,
            limit=max(settings.conversation_memory_window_messages, 0),
            max_chars=max(settings.conversation_memory_window_max_chars, 0),
            exclude_message_ids={user_message.id},
            include_assistant=include_assistant_memory,
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

    retrieval_context = assistant_content
    query_terms = _extract_retrieval_terms(request.content, max_terms=8)
    query_phrases = _build_query_phrases(request.content, query_terms, max_phrases=4)
    has_direct_context_signal = _retrieved_context_has_direct_signal(retrieval_context, query_terms, query_phrases)
    needs_counterfactual_support = _is_counterfactual_or_missing_item_question(request.content)
    has_counterfactual_support = _context_has_counterfactual_support(retrieval_context)
    effective_direct_context_signal = has_direct_context_signal and (
        (not needs_counterfactual_support) or has_counterfactual_support
    )
    has_grounded_context = bool(assistant_doc_ids or assistant_chunk_ids)
    followup_summary_request = _is_affirmative_followup(request.content) and _is_summary_followup(conversation_id, db)
    summary_request = _is_summary_request(request.content) or followup_summary_request
    detailed_summary_request = _is_detailed_summary_request(request.content) or followup_summary_request
    base_summary_content = assistant_content
    summary_doc_ids = assistant_doc_ids[: (6 if detailed_summary_request else 3)] if summary_request else []
    use_llm_summary = summary_request and bool(summary_doc_ids)
    summary_context = None
    if use_llm_summary:
        summary_context = _build_summary_generation_context(
            db,
            summary_doc_ids,
            detailed=detailed_summary_request,
        )

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
        llm_memory_window = memory_window_context if _should_include_memory_for_llm(request.content, intent) else ""
        try:
            if use_llm_summary and summary_context:
                async_result = celery_generate_summary.delay(
                    source_text=summary_context,
                    instructions=request.content,
                )
                assistant_content = async_result.get(timeout=max(10, settings.summary_llm_timeout_seconds + 5))
                assistant_source = f"celery:{settings.summary_llm_provider.lower()}:summary"
            elif not summary_request:
                llm_context = assistant_content
                async_result = celery_generate_grounded_response.delay(
                    user_query=request.content,
                    retrieved_context=llm_context,
                    memory_window=llm_memory_window,
                )
                assistant_content = async_result.get(timeout=max(10, settings.summary_llm_timeout_seconds + 5))
                assistant_source = f"celery:{settings.summary_llm_provider.lower()}"
        except Exception as exc:
            logger.warning("Celery chat generation unavailable; falling back to direct LLM: %s: %s", type(exc).__name__, exc)
            try:
                if use_llm_summary and summary_context:
                    assistant_content = summary_generation_service.summarize(
                        source_text=summary_context,
                        instructions=request.content,
                    )
                    assistant_source = f"{settings.summary_llm_provider.lower()}:summary"
                elif not summary_request:
                    llm_context = assistant_content
                    assistant_content = summary_generation_service.generate_grounded_response(
                        user_query=request.content,
                        retrieved_context=llm_context,
                        memory_window=llm_memory_window,
                    )
                    assistant_source = settings.summary_llm_provider.lower()
            except Exception as llm_exc:
                logger.warning("Conversation LLM unavailable; using retrieval response: %s: %s", type(llm_exc).__name__, llm_exc)

    if summary_request and not assistant_content:
        assistant_content = base_summary_content

    assistant_content = _normalize_assistant_markdown(
        user_query=request.content,
        assistant_content=assistant_content,
    )


    requested_scope = bool(request.document_ids)
    if (
        intent not in {"memory_store", "memory_recall", "conversation_summary"}
        and has_grounded_context
        and not is_greeting_reply
        and not skip_llm_refinement
        and not summary_generation_service.is_available()
    ):
        assistant_source = "retrieval-fallback-ai-off"

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
