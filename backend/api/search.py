from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, or_
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, MemberStatus
from models.document import Document, DocumentStatus
from models.document_chunk import DocumentChunk
from schemas.search import (
    SearchRequest,
    SearchResponse,
    SearchResultItem,
    ClientFilterSearchLogRequest,
    ClientFilterSearchLogResponse,
)
from utils.auth import get_current_user
from utils.audit import create_audit_log, AuditActions

router = APIRouter(tags=["Search"])


def _require_active_workspace_member(db: Session, workspace_id: int, user_id: int) -> None:
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).first()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this workspace",
        )


@router.post("/search/log-client-filter", response_model=ClientFilterSearchLogResponse)
async def log_client_filter_search(
    request: ClientFilterSearchLogRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record client-side list filtering (Documents / AI Assistant) for dashboard activity."""
    _require_active_workspace_member(db, request.workspace_id, current_user.id)

    query_text = (request.query or "").strip()
    if len(query_text) < 2:
        return ClientFilterSearchLogResponse(ok=True)

    query_text = query_text[:500]
    workspace = db.query(Workspace).filter(Workspace.id == request.workspace_id).first()
    create_audit_log(
        db,
        current_user,
        action=AuditActions.SEARCH_PERFORMED,
        object_type="workspace",
        object_id=request.workspace_id,
        workspace_id=request.workspace_id,
        metadata={
            "query": query_text,
            "workspace_name": workspace.name if workspace else None,
            "ui_context": request.context,
        },
    )
    return ClientFilterSearchLogResponse(ok=True)


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Performs keyword or semantic search across authorized documents"""

    _require_active_workspace_member(db, request.workspace_id, current_user.id)
    
    query_text = (request.query or "").strip()
    if not query_text:
        return SearchResponse(query="", items=[])

    limit = max(1, min(request.limit or 10, 50))
    pattern = f"%{query_text}%"

    results = db.query(Document, DocumentChunk).outerjoin(
        DocumentChunk, DocumentChunk.document_id == Document.id
    ).filter(
        Document.workspace_id == request.workspace_id,
        Document.status != DocumentStatus.DELETED,
        or_(
            Document.filename.ilike(pattern),
            DocumentChunk.text.ilike(pattern)
        )
    ).order_by(
        case((Document.filename.ilike(pattern), 0), else_=1),
        case((DocumentChunk.chunk_index.is_(None), 1), else_=0),
        DocumentChunk.chunk_index.asc(),
        Document.id.desc()
    ).limit(limit * 5).all()

    items = []
    seen_document_ids = set()

    for doc, chunk in results:
        if doc.id in seen_document_ids:
            continue
        seen_document_ids.add(doc.id)

        snippet = _build_snippet(chunk.text if chunk else "", query_text)
        items.append(SearchResultItem(
            document_id=doc.id,
            chunk_id=chunk.id if chunk else 0,
            score=1.0 if query_text.lower() in (doc.filename or "").lower() else 0.6,
            snippet=snippet,
            filename=doc.filename,
            created_at=doc.created_at
        ))

        if len(items) >= limit:
            break

    workspace = db.query(Workspace).filter(Workspace.id == request.workspace_id).first()
    create_audit_log(
        db,
        current_user,
        action=AuditActions.SEARCH_PERFORMED,
        object_type="workspace",
        object_id=request.workspace_id,
        workspace_id=request.workspace_id,
        metadata={
            "query": query_text[:500],
            "result_count": len(items),
            "workspace_name": workspace.name if workspace else None,
            "ui_context": "api",
        },
    )

    return SearchResponse(query=query_text, items=items)


def _build_snippet(text: str, query: str, max_length: int = 280) -> str:
    normalized_text = " ".join((text or "").split())
    if not normalized_text:
        return ""

    lower_text = normalized_text.lower()
    lower_query = (query or "").lower().strip()
    match_index = lower_text.find(lower_query) if lower_query else -1

    if match_index < 0 and lower_query:
        for token in lower_query.split():
            if not token:
                continue
            token_index = lower_text.find(token)
            if token_index >= 0:
                match_index = token_index
                break

    if match_index < 0:
        snippet = normalized_text[:max_length]
        return f"{snippet}..." if len(normalized_text) > max_length else snippet

    start = max(0, match_index - 100)
    end = min(len(normalized_text), match_index + max(len(lower_query), 1) + 140)
    snippet = normalized_text[start:end].strip()

    if start > 0:
        snippet = f"... {snippet}"
    if end < len(normalized_text):
        snippet = f"{snippet} ..."

    if len(snippet) > max_length:
        snippet = snippet[:max_length].rstrip()
        if not snippet.endswith("..."):
            snippet = f"{snippet}..."

    return snippet
