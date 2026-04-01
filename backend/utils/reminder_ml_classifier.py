"""
Trained linear classifier over embedding vectors for reminder-type hints.
Train with: python scripts/train_reminder_classifier.py
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

import numpy as np

from config import settings
from utils.document_reminders import ALLOWED_HINT_TYPES, _fingerprint
from utils.embeddings import embeddings_service

logger = logging.getLogger(__name__)

_bundle: Optional[Dict[str, Any]] = None
_bundle_path_loaded: Optional[str] = None


def _load_bundle() -> Optional[Dict[str, Any]]:
    global _bundle, _bundle_path_loaded
    path = (settings.reminder_classifier_path or "").strip()
    if not path:
        return None
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return None
    if _bundle is not None and _bundle_path_loaded == path:
        return _bundle
    try:
        import joblib

        _bundle = joblib.load(path)
        _bundle_path_loaded = path
        logger.info("Loaded reminder classifier bundle from %s", path)
        return _bundle
    except Exception:
        logger.warning("Failed to load reminder classifier from %s", path, exc_info=True)
        _bundle = None
        _bundle_path_loaded = None
        return None


def _iter_snippets(blob: str, max_snippets: int) -> List[str]:
    if not blob or not blob.strip():
        return []
    text = blob.replace("\r\n", "\n")
    out: List[str] = []
    for para in re.split(r"\n{2,}", text):
        para = para.strip()
        if not para:
            continue
        parts = re.split(r"(?<=[.!?])\s+", para)
        for sent in parts:
            s = sent.strip()
            if 28 <= len(s) <= 520:
                out.append(s)
                if len(out) >= max_snippets:
                    return out
    return out


def extract_ml_reminder_candidates(combined_text: str) -> List[Dict[str, Any]]:
    """
    Run the trained sklearn classifier on sentence snippets (same embedding model as retrieval).
    Skips predicted ``no_reminder`` and low-confidence rows. Does not replace LLM/rules—merge elsewhere.
    """
    if not getattr(settings, "reminder_classifier_enabled", True):
        return []
    bundle = _load_bundle()
    if not bundle:
        return []

    clf = bundle.get("clf")
    le: Any = bundle.get("label_encoder")
    if clf is None or le is None:
        return []

    snippets = _iter_snippets(combined_text, settings.reminder_classifier_max_snippets)
    if not snippets:
        return []

    try:
        vectors = embeddings_service.generate_batch_embeddings(snippets, input_type="document")
    except Exception:
        logger.warning("Embedding snippets for reminder classifier failed", exc_info=True)
        return []

    X = np.asarray(vectors, dtype=np.float32)
    try:
        probas = clf.predict_proba(X)
    except Exception:
        logger.warning("Classifier predict_proba failed", exc_info=True)
        return []

    classes = getattr(le, "classes_", None)
    if classes is None:
        classes = np.array(bundle.get("classes") or [])

    min_p = float(settings.reminder_classifier_min_prob)
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for i, snippet in enumerate(snippets):
        if i >= probas.shape[0]:
            break
        row = probas[i]
        j = int(np.argmax(row))
        p = float(row[j])
        if p < min_p:
            continue
        label = str(classes[j]) if j < len(classes) else ""
        if not label or label == "no_reminder":
            continue
        if label not in ALLOWED_HINT_TYPES or label == "processing_complete":
            continue
        content = " ".join(snippet.split())
        if len(content) > 300:
            content = content[:297].rstrip() + "…"
        fp = _fingerprint(label, content)
        if fp in seen:
            continue
        seen.add(fp)
        out.append(
            {
                "hint_type": label,
                "content": content,
                "ai_suggested": True,
                "ai_model_used": "reminder_classifier",
                "confidence_score": max(1, min(99, int(round(p * 100)))),
            }
        )
        if len(out) >= settings.reminder_classifier_max_hints:
            break

    return out


def clear_bundle_cache() -> None:
    global _bundle, _bundle_path_loaded
    _bundle = None
    _bundle_path_loaded = None
