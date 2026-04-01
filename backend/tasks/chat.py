"""Celery tasks for chat response generation."""
from celery.utils.log import get_task_logger

from celery_app import celery_app
from utils.text_generation import summary_generation_service

logger = get_task_logger(__name__)


@celery_app.task(name="tasks.chat.generate_grounded_response")
def generate_grounded_response(user_query: str, retrieved_context: str) -> str:
    """Generate grounded chat response through configured LLM provider."""
    if not summary_generation_service.is_available():
        raise RuntimeError("Summary LLM service is not configured")

    try:
        return summary_generation_service.generate_grounded_response(
            user_query=user_query,
            retrieved_context=retrieved_context,
        )
    except Exception as exc:
        logger.warning("Celery chat generation failed: %s: %s", type(exc).__name__, exc)
        raise


@celery_app.task(name="tasks.chat.generate_summary")
def generate_summary(source_text: str, instructions: str | None = None) -> str:
    """Generate a document summary through the configured LLM provider."""
    if not summary_generation_service.is_available():
        raise RuntimeError("Summary LLM service is not configured")

    try:
        return summary_generation_service.summarize(
            source_text=source_text,
            instructions=instructions,
        )
    except Exception as exc:
        logger.warning("Celery summary generation failed: %s: %s", type(exc).__name__, exc)
        raise
