from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from database import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)  # Order of chunk in document
    text = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=False)  # For cost tracking
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
