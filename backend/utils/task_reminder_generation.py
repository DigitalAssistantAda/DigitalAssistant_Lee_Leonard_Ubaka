"""
Build reminder text from issue/task + optional workspace document excerpts (vector search).
"""
from __future__ import annotations

import logging
from typing import List

from sqlalchemy.orm import Session

from config import settings
from models.document_chunk import DocumentChunk
from models.task import Task
from models.task_reminder import TaskReminder
from utils.document_reminders import (
    extract_llm_reminders,
    extract_rule_based_reminders,
    merge_reminder_batches,
)
from utils.embeddings import embeddings_service
from utils.reminder_cross_encoder import rerank_passage_indices
from utils.reminder_ml_classifier import extract_ml_reminder_candidates
from utils.text_generation import summary_generation_service

logger = logging.getLogger(__name__)

_MAX_QUERY_CHARS = 4000
_MAX_CONTEXT_CHARS = 24000
_MAX_EXCERPT_PER_CHUNK = 1800
_MAX_DOC_GROUPS = 6


def build_task_reminder_context(db: Session, task: Task, user_id: int) -> str:
    """
    Build text for reminder extraction:
    - Issue title + description
    - Workspace document excerpts: bi-encoder retrieval (dense vectors), then optional
      cross-encoder reranking (second neural model for query–passage relevance).
    """
    parts: List[str] = [f"Issue/task: {task.title}", f"Description:\n{task.description or ''}".strip()]
    query = f"{task.title}\n{task.description or ''}".strip()[:_MAX_QUERY_CHARS]
    if not query:
        return "\n\n".join(p for p in parts if p)

    try:
        query_embedding = embeddings_service.generate_embedding(query, input_type="query")
        # Retrieve a wider pool so cross-encoder can rerank beyond bi-encoder ordering
        rows = embeddings_service.find_top_chunk_per_document(
            query_embedding,
            task.workspace_id,
            db=db,
            user_id=user_id,
            max_documents=16,
            min_similarity=0.0,
        )
        chunk_ids = [int(r[0]) for r in rows]
        if not chunk_ids:
            return "\n\n".join(p for p in parts if p)[:_MAX_CONTEXT_CHARS]

        chunks = (
            db.query(DocumentChunk)
            .filter(DocumentChunk.id.in_(chunk_ids))
            .all()
        )
        by_id = {c.id: c for c in chunks}
        passages: List[str] = []
        row_meta: List[tuple] = []
        for chunk_id, doc_id, sim in rows:
            ch = by_id.get(chunk_id)
            if not ch or not (ch.text or "").strip():
                continue
            excerpt = (ch.text or "").strip()[:_MAX_EXCERPT_PER_CHUNK]
            passages.append(excerpt)
            row_meta.append((chunk_id, doc_id, sim, excerpt))

        doc_excerpts: List[str] = []
        if passages:
            if settings.reminder_cross_encoder_enabled and len(passages) > 1:
                order = rerank_passage_indices(
                    query,
                    passages,
                    top_k=min(_MAX_DOC_GROUPS, len(passages)),
                    model_name=settings.reminder_cross_encoder_model,
                )
            else:
                order = list(range(min(_MAX_DOC_GROUPS, len(passages))))
            for i in order:
                if i < 0 or i >= len(row_meta):
                    continue
                _cid, _did, sim, excerpt = row_meta[i]
                doc_excerpts.append(
                    f"[Workspace document excerpt, bi-encoder match ~{float(sim):.2f}]\n{excerpt}"
                )
        if doc_excerpts:
            parts.append("Related workspace document excerpts:\n\n" + "\n\n".join(doc_excerpts))
    except Exception:
        logger.warning(
            "Document context for task reminders failed workspace_id=%s task_id=%s",
            task.workspace_id,
            task.id,
            exc_info=True,
        )

    combined = "\n\n".join(p for p in parts if p)
    return combined[:_MAX_CONTEXT_CHARS]


def generate_and_persist_task_reminders(db: Session, task: Task, actor_user_id: int) -> None:
    """
    Replace pending reminders using: optional generative LLM, trained linear classifier on embeddings,
    and regex rules—merged in priority order (see REMINDER_GENERATIVE_FIRST).
    """
    combined = build_task_reminder_context(db, task, actor_user_id)
    if not combined.strip():
        combined = f"Issue/task: {task.title}\n(No description yet.)"

    db.query(TaskReminder).filter(
        TaskReminder.task_id == task.id,
        TaskReminder.dismissed == False,
        TaskReminder.acknowledged_at.is_(None),
    ).delete(synchronize_session=False)

    rules = extract_rule_based_reminders(combined, max_hints=6)
    llm_items: list = []
    try:
        llm_items = extract_llm_reminders(
            summary_generation_service,
            combined,
            max_lines=settings.reminder_llm_max_suggestions,
            excerpt_max_chars=13000,
        )
    except Exception:
        logger.warning("LLM task reminder extraction failed task_id=%s", task.id, exc_info=True)

    ml_items: list = []
    try:
        ml_items = extract_ml_reminder_candidates(combined)
    except Exception:
        logger.warning("ML classifier reminder extraction failed task_id=%s", task.id, exc_info=True)

    if settings.reminder_generative_first:
        merge_batches = [llm_items, ml_items, rules]
    else:
        merge_batches = [rules, ml_items, llm_items]
    merged = merge_reminder_batches(merge_batches, cap=8)
    if not merged:
        merged = [
            {
                "hint_type": "follow_up",
                "content": "No specific deadline or review phrases were detected from this issue and related documents.",
                "ai_suggested": False,
                "confidence_score": None,
            }
        ]

    model_name = None
    if summary_generation_service.is_available():
        model_name = summary_generation_service.model

    for item in merged:
        db.add(
            TaskReminder(
                task_id=task.id,
                hint_type=item["hint_type"],
                content=item["content"],
                ai_suggested=bool(item.get("ai_suggested")),
                ai_model_used=model_name if item.get("ai_suggested") else None,
                confidence_score=item.get("confidence_score"),
            )
        )

    task.reminders_generation_error = None
    db.commit()
