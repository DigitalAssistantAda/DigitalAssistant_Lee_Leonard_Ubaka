"""
Celery application setup for background tasks
Handles document embedding, duplicate detection, and other async operations
"""
from celery import Celery
from config import settings
import os

# Create Celery app configured with Redis broker
celery_app = Celery(
    __name__,
    broker=settings.redis_url,
    backend=settings.redis_url,
)

# Configure Celery settings
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minute hard limit
    task_soft_time_limit=28 * 60,  # 28 minute soft limit
    worker_prefetch_multiplier=1,  # Process one task at a time
    worker_max_tasks_per_child=1000,
)

# Auto-discover tasks from all registered modules
celery_app.autodiscover_tasks(['tasks'], force=True)

# Optional: periodic embedding refresh (run Celery Beat to enable)
# Set EMBEDDING_REFRESH_ENABLED=true to schedule weekly refresh (Sunday 03:00 UTC)
from celery.schedules import crontab
if os.getenv("EMBEDDING_REFRESH_ENABLED", "").lower() in ("1", "true", "yes"):
    celery_app.conf.beat_schedule = {
        "embedding-refresh-weekly": {
            "task": "tasks.embeddings.refresh_all_embeddings",
            "schedule": crontab(minute=0, hour=3, day_of_week=0),
            "kwargs": {"workspace_id": None, "training_job_id": None, "triggered_by_user_id": None},
        },
    }
