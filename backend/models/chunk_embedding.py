from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Float, ARRAY
from sqlalchemy.sql import func
from database import Base


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"

    chunk_id = Column(Integer, ForeignKey("document_chunks.id"), nullable=False, primary_key=True, index=True)
    model_name = Column(String, nullable=False, primary_key=True)  # e.g., "text-embedding-ada-002"
    embedding = Column(ARRAY(Float), nullable=False)  # Vector embedding for semantic search
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
