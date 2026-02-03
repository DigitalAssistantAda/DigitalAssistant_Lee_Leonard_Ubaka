from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from fastapi import HTTPException, status

# In-memory rate limiting and lockout tracking
# NOTE: This is per-process and resets on restart. Use Redis for production.
RATE_LIMIT_BUCKETS: Dict[str, List[datetime]] = {}
FAILED_LOGIN_TRACKER: Dict[str, Tuple[int, datetime]] = {}

DEFAULT_LOCKOUT_THRESHOLD = 5
DEFAULT_LOCKOUT_MINUTES = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """Simple fixed-window rate limiting."""
    now = _now()
    window_start = now - timedelta(seconds=window_seconds)

    bucket = RATE_LIMIT_BUCKETS.get(key, [])
    bucket = [ts for ts in bucket if ts > window_start]
    if len(bucket) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later."
        )

    bucket.append(now)
    RATE_LIMIT_BUCKETS[key] = bucket


def check_lockout(key: str) -> None:
    """Check if account is locked out."""
    if key not in FAILED_LOGIN_TRACKER:
        return

    attempts, locked_until = FAILED_LOGIN_TRACKER[key]
    if locked_until and locked_until > _now():
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Account temporarily locked due to failed login attempts."
        )


def record_failed_login(key: str, threshold: int = DEFAULT_LOCKOUT_THRESHOLD) -> None:
    now = _now()
    attempts, locked_until = FAILED_LOGIN_TRACKER.get(key, (0, None))

    if locked_until and locked_until > now:
        return

    attempts += 1
    if attempts >= threshold:
        locked_until = now + timedelta(minutes=DEFAULT_LOCKOUT_MINUTES)
    FAILED_LOGIN_TRACKER[key] = (attempts, locked_until)


def clear_failed_login(key: str) -> None:
    if key in FAILED_LOGIN_TRACKER:
        del FAILED_LOGIN_TRACKER[key]
