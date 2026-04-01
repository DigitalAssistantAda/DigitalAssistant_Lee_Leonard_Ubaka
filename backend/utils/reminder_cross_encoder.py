"""
Cross-encoder reranking for reminder context: a second neural model scores (query, passage) pairs,
which is stronger for relevance than bi-encoder cosine similarity alone.
"""
from __future__ import annotations

import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

_model = None
_model_name_loaded: str | None = None


def _get_cross_encoder(model_name: str):
    global _model, _model_name_loaded
    if _model is not None and _model_name_loaded == model_name:
        return _model
    from sentence_transformers import CrossEncoder

    logger.info("Loading cross-encoder for reminder reranking: %s", model_name)
    _model = CrossEncoder(model_name)
    _model_name_loaded = model_name
    return _model


def rerank_passage_indices(
    query: str,
    passages: List[str],
    top_k: int,
    *,
    model_name: str,
) -> List[int]:
    """
    Return up to ``top_k`` indices into ``passages``, ordered by cross-encoder relevance (best first).
    On any failure, returns ``range(min(top_k, len(passages)))`` (original order).
    """
    if not query.strip() or not passages:
        return []
    n = len(passages)
    k = min(top_k, n)
    if k <= 0:
        return []
    try:
        model = _get_cross_encoder(model_name)
        q = query.strip()[:3000]
        pairs = [(q, (p or "")[:3000]) for p in passages]
        scores = model.predict(pairs, show_progress_bar=False, batch_size=16)
        ranked = sorted(range(n), key=lambda i: float(scores[i]), reverse=True)
        return ranked[:k]
    except Exception:
        logger.warning(
            "Cross-encoder rerank failed (model=%s); using bi-encoder retrieval order",
            model_name,
            exc_info=True,
        )
        return list(range(k))
