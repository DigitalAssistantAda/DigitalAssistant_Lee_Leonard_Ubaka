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
