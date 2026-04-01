"""
Rule- and (optionally) LLM-backed reminder extraction from document text.
Used to extract deadline/review/follow-up signals from text (e.g. task/issue reminders informed by documents).
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Dict, List, Set, Tuple

if TYPE_CHECKING:
    from utils.text_generation import SummaryGenerationService

# Aligned with DocumentHint.hint_type usage
ALLOWED_HINT_TYPES = frozenset(
    {
        "expiration",
        "renewal",
        "review_needed",
        "action_required",
        "follow_up",
        "processing_complete",
    }
)

_RULE_SPECS: List[Tuple[str, re.Pattern[str]]] = [
    (
        "expiration",
        re.compile(
            r"\b(?:expires?|expiry|expiration(?:\s+date)?|valid\s+until|terminate(?:s|d)?\s+on|"
            r"ends?\s+on|end\s+date|not\s+valid\s+after)\b[^.\n]{0,200}",
            re.IGNORECASE,
        ),
    ),
    (
        "renewal",
        re.compile(
            r"\b(?:renewal|renew\s+by|must\s+renew|auto[\s-]?renew|extend(?:ed|ing)?\s+(?:by|before))\b[^.\n]{0,200}",
            re.IGNORECASE,
        ),
    ),
    (
        "review_needed",
        re.compile(
            r"\b(?:review\s+required|must\s+be\s+reviewed|for\s+your\s+review|please\s+review|"
            r"annual\s+review|pending\s+review|subject\s+to\s+review)\b[^.\n]{0,200}",
            re.IGNORECASE,
        ),
    ),
    (
        "action_required",
        re.compile(
            r"\b(?:deadline|due\s+date|due\s+by|submit\s+by|no\s+later\s+than|"
            r"complete\s+by|return\s+by|respond\s+by)\b[^.\n]{0,200}",
            re.IGNORECASE,
        ),
    ),
    (
        "follow_up",
        re.compile(
            r"\b(?:follow[\s-]?up|circle\s+back|touch\s+base|schedule\s+(?:a\s+)?(?:call|meeting)|"
            r"next\s+steps?)\b[^.\n]{0,200}",
            re.IGNORECASE,
        ),
    ),
]


def _normalize_snippet(raw: str) -> str:
    s = " ".join(raw.split())
    if len(s) > 280:
        s = s[:277].rstrip() + "…"
    return s


def _fingerprint(hint_type: str, content: str) -> str:
    return f"{hint_type}:{content[:96].lower()}"


# Rule extraction can echo structured tracker lines (e.g. raw ISO) — drop before showing users.
_SHALLOW_DUE_ECHO = re.compile(r"^\s*due\s+date\s*:\s*", re.IGNORECASE)
_RAW_ISO_PREFIX = re.compile(r"^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def is_shallow_metadata_echo_reminder(content: str) -> bool:
    t = (content or "").strip()
    if len(t) < 8:
        return True
    if _SHALLOW_DUE_ECHO.search(t):
        return True
    if _RAW_ISO_PREFIX.match(t):
        return True
    return False


def filter_echo_reminder_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [it for it in items if not is_shallow_metadata_echo_reminder(it.get("content", ""))]


def extract_rule_based_reminders(text: str, max_hints: int = 6) -> List[Dict[str, Any]]:
    """Scan plain text for deadline/review/follow-up style phrases."""
    if not text or not text.strip():
        return []

    seen: Set[str] = set()
    out: List[Dict[str, Any]] = []

    for hint_type, pattern in _RULE_SPECS:
        for m in pattern.finditer(text):
            snippet = _normalize_snippet(m.group(0))
            if len(snippet) < 12:
                continue
            fp = _fingerprint(hint_type, snippet)
            if fp in seen:
                continue
            seen.add(fp)
            out.append(
                {
                    "hint_type": hint_type,
                    "content": snippet,
                    "ai_suggested": False,
                    "confidence_score": 82,
                }
            )
            if len(out) >= max_hints:
                return out

    return out


def parse_llm_reminder_lines(raw: str) -> List[Tuple[str, str]]:
    """Parse 'TYPE|message' lines from LLM output."""
    lines = []
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line or line.upper() == "NONE":
            continue
        if "|" not in line:
            continue
        hint_type, _, rest = line.partition("|")
        hint_type = hint_type.strip().lower().replace(" ", "_")
        message = rest.strip()
        if hint_type not in ALLOWED_HINT_TYPES or hint_type == "processing_complete":
            continue
        if len(message) < 8 or len(message) > 420:
            continue
        lines.append((hint_type, _normalize_snippet(message)))
    return lines


def extract_llm_reminders(
    service: SummaryGenerationService,
    excerpt: str,
    *,
    max_lines: int = 3,
    excerpt_max_chars: int = 11000,
) -> List[Dict[str, Any]]:
    """Generative ML pass (configured LLM); returns empty list if unavailable or on failure."""
    excerpt = (excerpt or "").strip()
    if len(excerpt) < 80:
        return []
    if not service.is_available():
        return []

    max_lines = max(1, min(max_lines, 8))
    excerpt_max_chars = max(2000, min(excerpt_max_chars, 14000))

    system_prompt = (
        "You extract short, actionable reminders from internal work context (issues and documents). "
        "Use only facts that appear in the excerpt. Do not invent dates or obligations. "
        "Write each message in clear, conversational English for humans. "
        "Never output a line that is only a raw ISO-8601 timestamp; use phrasing like "
        "'Apr 3, 2026' when a date is real and relevant. "
        "If the excerpt states an issue completion target from the tracker, you may reference it once "
        "in natural language (not as a duplicated metadata dump). "
        "If there is nothing actionable, reply with exactly: NONE"
    )
    user_prompt = (
        f"From the excerpt below, list up to {max_lines} reminders. One per line.\n"
        "Each line must be: TYPE|message\n"
        "TYPE is one of: expiration, renewal, review_needed, action_required, follow_up\n"
        "message must be under 140 characters, grounded in the excerpt, and free of naked machine timestamps.\n\n"
        f"Excerpt:\n{excerpt[:excerpt_max_chars]}"
    )

    try:
        raw = service._generate_from_messages(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
    except Exception:
        return []

    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for hint_type, message in parse_llm_reminder_lines(raw):
        fp = _fingerprint(hint_type, message)
        if fp in seen:
            continue
        seen.add(fp)
        out.append(
            {
                "hint_type": hint_type,
                "content": message,
                "ai_suggested": True,
                "confidence_score": 72,
            }
        )
        if len(out) >= max_lines:
            break
    return out


def merge_reminder_batches(
    batches: List[List[Dict[str, Any]]],
    cap: int = 8,
) -> List[Dict[str, Any]]:
    """Merge ordered batches (first batches win on duplicate fingerprints)."""
    seen: Set[str] = set()
    merged: List[Dict[str, Any]] = []
    for batch in batches:
        for item in batch:
            fp = _fingerprint(item["hint_type"], item["content"])
            if fp in seen:
                continue
            seen.add(fp)
            merged.append(item)
            if len(merged) >= cap:
                return merged
    return merged


def merge_reminder_candidates(
    rule_based: List[Dict[str, Any]],
    llm_based: List[Dict[str, Any]],
    cap: int = 8,
    *,
    generative_first: bool = False,
) -> List[Dict[str, Any]]:
    """
    Merge without duplicate content. If ``generative_first`` is True, prefer LLM (generative ML)
    suggestions then regex; otherwise the legacy order (regex first).
    """
    batches = [llm_based, rule_based] if generative_first else [rule_based, llm_based]
    return merge_reminder_batches(batches, cap=cap)
