"""
Embeddings utility module - vector generation and similarity search.
Supports local models (Sentence Transformers) for fine-tuning and Voyage AI as optional API.
"""
from typing import List, Tuple, Optional
import logging
from config import settings
from database import SessionLocal
from models.chunk_embedding import ChunkEmbedding
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Max chars per text for embedding (Sentence Transformers typically handle 512 tokens ~ 2000 chars)
MAX_TEXT_LENGTH = 8000


class BaseEmbeddingsService:
    """Base interface for embedding services."""

    @property
    def model_name(self) -> str:
        raise NotImplementedError

    @property
    def embedding_dimension(self) -> int:
        raise NotImplementedError

    def generate_embedding(self, text: str) -> List[float]:
        raise NotImplementedError

    def generate_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError

    def find_similar_embeddings(
        self,
        query_embedding: List[float],
        workspace_id: int,
        limit: int = 10,
        threshold: float = 0.7,
        db: Session = None,
        user_id: Optional[int] = None,
    ) -> List[Tuple[int, int, float]]:
        """Find documents with similar embeddings using pgvector (cosine)."""
        owns_session = db is None
        if db is None:
            db = SessionLocal()

        vector_param = "[" + ",".join(str(value) for value in query_embedding) + "]"

        if user_id is not None:
            where_clause = (
                "(d.workspace_id = :workspace_id OR (d.workspace_id IS NULL AND d.uploaded_by = :user_id))"
            )
            params = {
                "query_embedding": vector_param,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "threshold": threshold,
                "model_name": self.model_name,
                "limit": limit,
            }
        else:
            where_clause = "d.workspace_id = :workspace_id"
            params = {
                "query_embedding": vector_param,
                "workspace_id": workspace_id,
                "threshold": threshold,
                "model_name": self.model_name,
                "limit": limit,
            }

        try:
            stmt_str = f"""
                SELECT
                    dc.id as chunk_id,
                    dc.document_id,
                    1 - (CAST(ce.embedding AS vector) <=> CAST(:query_embedding AS vector)) as similarity
                FROM chunk_embeddings ce
                JOIN document_chunks dc ON ce.chunk_id = dc.id
                JOIN documents d ON dc.document_id = d.id
                WHERE {where_clause}
                    AND 1 - (CAST(ce.embedding AS vector) <=> CAST(:query_embedding AS vector)) > :threshold
                    AND ce.model_name = :model_name
                ORDER BY similarity DESC
                LIMIT :limit
            """
            stmt = text(stmt_str).bindparams(**params)
            results = db.execute(stmt)
            return results.fetchall()
        finally:
            if owns_session and db:
                db.close()

    def check_duplicate(
        self,
        new_embedding: List[float],
        workspace_id: int,
        similarity_threshold: float = 0.95,
        db: Session = None,
    ) -> Tuple[bool, Optional[int], float]:
        """Check if a new document is a duplicate of existing documents."""
        similar = self.find_similar_embeddings(
            new_embedding,
            workspace_id,
            limit=1,
            threshold=similarity_threshold,
            db=db,
        )
        if similar:
            _chunk_id, doc_id, similarity = similar[0]
            return (True, doc_id, float(similarity))
        return (False, None, 0.0)


def _resolve_local_model_path() -> str:
    """Resolve which model path to use: explicit path, fine-tuned output, or hub name."""
    if settings.local_embedding_model_path.strip():
        return settings.local_embedding_model_path.strip()
    import os
    out_dir = getattr(settings, "embedding_finetune_output_dir", "") or "./data/embedding_model"
    # Prefer fine-tuned model if it exists (saved by fine-tune task)
    for sub in ("latest", ""):
        path = os.path.join(out_dir, sub) if sub else out_dir
        if os.path.isdir(path) and os.path.isfile(os.path.join(path, "config.json")):
            return path
    return settings.local_embedding_model


class LocalEmbeddingsService(BaseEmbeddingsService):
    """Service using a local Sentence Transformers (or HuggingFace) model. Supports fine-tuning."""

    def __init__(self):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError(
                "sentence-transformers is required for local embeddings. Install with: pip install sentence-transformers"
            )
        model_path = _resolve_local_model_path()
        self._model = SentenceTransformer(model_path)
        self._model_name = model_path.split("/")[-1] if "/" in model_path else model_path
        # Get dimension from model
        dim = self._model.get_sentence_embedding_dimension()
        self._embedding_dimension = settings.embedding_dimensions if settings.embedding_dimensions > 0 else dim
        logger.info(
            "Initialized local embeddings (model=%s, dimension=%s)",
            self._model_name,
            self._embedding_dimension,
        )

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def embedding_dimension(self) -> int:
        return self._embedding_dimension

    def generate_embedding(self, text: str) -> List[float]:
        if not text or not text.strip():
            raise ValueError("Cannot embed empty text")
        if len(text) > MAX_TEXT_LENGTH:
            raise ValueError(f"Text too long for embedding (max ~{MAX_TEXT_LENGTH} chars)")
        vec = self._model.encode(text, normalize_embeddings=True)
        return vec.tolist()

    def generate_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        for t in texts:
            if not t or not t.strip():
                raise ValueError("Cannot embed empty text in batch")
            if len(t) > MAX_TEXT_LENGTH:
                raise ValueError(f"Text too long in batch (max ~{MAX_TEXT_LENGTH} chars per text)")
        matrix = self._model.encode(texts, normalize_embeddings=True)
        return [row.tolist() for row in matrix]


class VoyageEmbeddingsService(BaseEmbeddingsService):
    """Service for Voyage AI API (optional, when EMBEDDING_SERVICE=voyage)."""

    def __init__(self):
        import requests
        self._requests = requests
        if not settings.voyage_api_key:
            raise ValueError("VOYAGE_API_KEY environment variable not set when using voyage service")
        self._api_key = settings.voyage_api_key
        self._model_name = settings.voyage_model
        self._embedding_dimension = (
            settings.embedding_dimensions if settings.embedding_dimensions > 0 else 1024
        )
        self._api_url = "https://api.voyageai.com/v1/embeddings"
        logger.info("Initialized Voyage AI embeddings (model=%s)", self._model_name)

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def embedding_dimension(self) -> int:
        return self._embedding_dimension

    def generate_embedding(self, text: str) -> List[float]:
        if not text or not text.strip():
            raise ValueError("Cannot embed empty text")
        if len(text) > MAX_TEXT_LENGTH:
            raise ValueError(f"Text too long for embedding (max ~{MAX_TEXT_LENGTH} chars)")
        try:
            response = self._requests.post(
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model_name,
                    "input": text,
                    "input_type": "document",
                },
                timeout=30,
            )
            if response.status_code != 200:
                raise RuntimeError(f"Voyage AI API error ({response.status_code}): {response.text}")
            data = response.json()
            embedding = data["data"][0]["embedding"]
            if len(embedding) != self._embedding_dimension:
                raise ValueError(f"Unexpected embedding dimension: {len(embedding)}")
            return embedding
        except self._requests.exceptions.Timeout:
            raise RuntimeError("Voyage AI request timeout")
        except Exception as e:
            raise RuntimeError(f"Failed to generate Voyage AI embedding: {str(e)}")

    def generate_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        for t in texts:
            if not t or not t.strip():
                raise ValueError("Cannot embed empty text in batch")
            if len(t) > MAX_TEXT_LENGTH:
                raise ValueError(f"Text too long in batch (max ~{MAX_TEXT_LENGTH} chars per text)")
        try:
            response = self._requests.post(
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model_name,
                    "input": texts,
                    "input_type": "document",
                },
                timeout=60,
            )
            if response.status_code != 200:
                raise RuntimeError(f"Voyage AI API error ({response.status_code}): {response.text}")
            data = response.json()
            embeddings = sorted(data["data"], key=lambda x: x["index"])
            return [item["embedding"] for item in embeddings]
        except self._requests.exceptions.Timeout:
            raise RuntimeError("Voyage AI batch request timeout")
        except Exception as e:
            raise RuntimeError(f"Failed to generate Voyage AI batch embeddings: {str(e)}")


def get_embeddings_service() -> BaseEmbeddingsService:
    """Return the configured embedding service (local or voyage)."""
    if settings.embedding_service.lower() == "voyage":
        return VoyageEmbeddingsService()
    return LocalEmbeddingsService()


# Lazy singleton
_embeddings_service: Optional[BaseEmbeddingsService] = None


def _get_cached_service() -> BaseEmbeddingsService:
    global _embeddings_service
    if _embeddings_service is None:
        _embeddings_service = get_embeddings_service()
    return _embeddings_service


def reset_embeddings_service() -> None:
    """Clear the cached embedding service (e.g. after fine-tuning so next use loads new model)."""
    global _embeddings_service
    _embeddings_service = None


# Backward compatibility: code uses embeddings_service.model_name, .generate_embedding(), etc.
class _EmbeddingsServiceProxy:
    def __getattr__(self, name):
        return getattr(_get_cached_service(), name)


embeddings_service = _EmbeddingsServiceProxy()
