from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from database import get_db
from models.user import User
from models.workspace import WorkspaceMember, MemberStatus
from models.document import Document
from models.document_chunk import DocumentChunk
from utils.embeddings import embeddings_service
from schemas.search import SearchRequest, SearchResponse, SearchResultItem
from utils.auth import get_current_user

router = APIRouter(tags=["Search"])


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Performs keyword or semantic search across authorized documents"""
    
    # Check workspace membership
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == request.workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    query_text = (request.query or "").strip()
    if not query_text:
        return SearchResponse(query=request.query, items=[])

    limit = max(1, min(request.limit or 10, 50))

    try:
        query_embedding = embeddings_service.generate_embedding(query_text)
        similar_docs = embeddings_service.find_similar_embeddings(
            query_embedding,
            request.workspace_id,
            limit=limit,
            threshold=0.2,
            db=db
        )

        doc_ids = [doc_id for doc_id, _ in similar_docs]
        if not doc_ids:
            return SearchResponse(query=request.query, items=[])

        docs = db.query(Document).filter(Document.id.in_(doc_ids)).all()
        doc_map = {doc.id: doc for doc in docs}
        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.document_id.in_(doc_ids),
            DocumentChunk.chunk_index == 0
        ).all()
        chunk_map = {chunk.document_id: chunk for chunk in chunks}

        items = []
        for doc_id, score in similar_docs:
            doc = doc_map.get(doc_id)
            chunk = chunk_map.get(doc_id)
            if not doc or not chunk:
                continue
            snippet = (chunk.text or "").strip()[:280]
            items.append(SearchResultItem(
                document_id=doc.id,
                chunk_id=chunk.id,
                score=float(score),
                snippet=snippet,
                filename=doc.filename,
                created_at=doc.created_at
            ))

        return SearchResponse(query=request.query, items=items)
    except Exception:
        # Fallback to keyword search if embeddings are unavailable
        pattern = f"%{query_text}%"
        results = db.query(DocumentChunk, Document).join(
            Document, Document.id == DocumentChunk.document_id
        ).filter(
            Document.workspace_id == request.workspace_id,
            (DocumentChunk.text.ilike(pattern) | Document.filename.ilike(pattern))
        ).order_by(DocumentChunk.id.desc()).limit(limit).all()

        items = [
            SearchResultItem(
                document_id=doc.id,
                chunk_id=chunk.id,
                score=0.0,
                snippet=(chunk.text or "").strip()[:280],
                filename=doc.filename,
                created_at=doc.created_at
            )
            for chunk, doc in results
        ]

        return SearchResponse(query=request.query, items=items)
