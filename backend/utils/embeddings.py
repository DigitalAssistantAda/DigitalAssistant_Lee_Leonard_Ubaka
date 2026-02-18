"""
Embeddings utility module - handles vector generation and similarity search
Uses Voyage AI for high-quality, privacy-conscious embeddings
"""
from typing import List, Tuple
import requests
import logging
from config import settings
from database import SessionLocal
from models.chunk_embedding import ChunkEmbedding
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class EmbeddingsService:
    """Service for generating and managing embeddings using Voyage AI"""
    
    def __init__(self):
        """Initialize embeddings service"""
        if not settings.voyage_api_key:
            raise ValueError("VOYAGE_API_KEY environment variable not set")
        
        self.api_key = settings.voyage_api_key
        self.model_name = settings.voyage_model
        self.embedding_dimension = 1024  # voyage-2 default
        self.api_url = "https://api.voyageai.com/v1/embeddings"
        
        logger.info(f"Initialized Voyage AI embeddings (model: {self.model_name})")
    
    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text chunk using Voyage AI
        
        Args:
            text: Text to embed
            
        Returns:
            1024-dimensional embedding vector
            
        Raises:
            ValueError: If text is too long or API fails
        """
        # Validate input
        if not text or not text.strip():
            raise ValueError("Cannot embed empty text")
        
        if len(text) > 8000:
            raise ValueError("Text too long for embedding (max ~8000 chars)")
        
        try:
            response = requests.post(
                self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model_name,
                    "input": text,
                    "input_type": "document"
                },
                timeout=30
            )
            
            if response.status_code != 200:
                error = response.text
                raise RuntimeError(f"Voyage AI API error ({response.status_code}): {error}")
            
            data = response.json()
            embedding = data["data"][0]["embedding"]
            
            if len(embedding) != self.embedding_dimension:
                raise ValueError(f"Unexpected embedding dimension: {len(embedding)}")
            
            return embedding
            
        except requests.exceptions.Timeout:
            raise RuntimeError("Voyage AI request timeout")
        except Exception as e:
            raise RuntimeError(f"Failed to generate Voyage AI embedding: {str(e)}")
    
    def generate_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts in batch using Voyage AI
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of embedding vectors
        """
        if not texts:
            return []
        
        # Validate inputs
        for text in texts:
            if not text or not text.strip():
                raise ValueError("Cannot embed empty text in batch")
            if len(text) > 8000:
                raise ValueError("Text too long in batch (max ~8000 chars per text)")
        
        try:
            response = requests.post(
                self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model_name,
                    "input": texts,
                    "input_type": "document"
                },
                timeout=60
            )
            
            if response.status_code != 200:
                error = response.text
                raise RuntimeError(f"Voyage AI API error ({response.status_code}): {error}")
            
            data = response.json()
            embeddings = data["data"]
            
            # Sort by index to maintain order
            embeddings = sorted(embeddings, key=lambda x: x['index'])
            return [item['embedding'] for item in embeddings]
            
        except requests.exceptions.Timeout:
            raise RuntimeError("Voyage AI batch request timeout")
        except Exception as e:
            raise RuntimeError(f"Failed to generate Voyage AI batch embeddings: {str(e)}")
    
    def find_similar_embeddings(
        self, 
        query_embedding: List[float],
        workspace_id: int,
        limit: int = 10,
        threshold: float = 0.7,
        db: Session = None
    ) -> List[Tuple[int, float]]:
        """
        Find documents with similar embeddings using pgvector
        Uses cosine similarity
        
        Args:
            query_embedding: Embedding vector to search for
            workspace_id: Workspace to search within
            limit: Max results to return
            threshold: Minimum similarity score (0-1)
            db: Database session
            
        Returns:
            List of (document_id, similarity_score) tuples sorted by similarity DESC
        """
        if db is None:
            db = SessionLocal()
        
        try:
            # PostgreSQL pgvector cosine distance: 1 - (a <=> b) = similarity
            results = db.execute(f"""
                SELECT 
                    dc.document_id,
                    1 - (ce.embedding <=> %s::vector) as similarity
                FROM chunk_embeddings ce
                JOIN document_chunks dc ON ce.chunk_id = dc.id
                JOIN documents d ON dc.document_id = d.id
                WHERE d.workspace_id = %s
                    AND 1 - (ce.embedding <=> %s::vector) > %s
                    AND ce.model_name = %s
                ORDER BY similarity DESC
                LIMIT %s
            """, (query_embedding, workspace_id, query_embedding, threshold, self.model_name, limit))
            
            return results.fetchall()
            
        finally:
            if db:
                db.close()
    
    def check_duplicate(
        self,
        new_embedding: List[float],
        workspace_id: int,
        similarity_threshold: float = 0.95,
        db: Session = None
    ) -> Tuple[bool, int | None, float]:
        """
        Check if a new document is a duplicate of existing documents
        
        Args:
            new_embedding: Embedding of new document
            workspace_id: Workspace to check
            similarity_threshold: Similarity score >= this = duplicate
            db: Database session
            
        Returns:
            (is_duplicate, duplicate_doc_id, similarity_score)
        """
        similar = self.find_similar_embeddings(
            new_embedding,
            workspace_id,
            limit=1,
            threshold=similarity_threshold,
            db=db
        )
        
        if similar:
            doc_id, similarity = similar[0]
            return (True, doc_id, similarity)
        
        return (False, None, 0.0)


# Singleton instance
embeddings_service = EmbeddingsService()

