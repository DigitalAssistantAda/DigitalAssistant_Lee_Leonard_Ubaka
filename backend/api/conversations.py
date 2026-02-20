"""
Conversation endpoints for AI assistant
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
import json
from database import get_db
from models.user import User
from models.conversation import Conversation, AIMessage, MessageRole
from models.document import Document
from models.document_chunk import DocumentChunk
from schemas.conversation import (
    ConversationCreate,
    ConversationResponse,
    ConversationListResponse,
    MessageCreate,
    MessageResponse,
)
from utils.auth import get_current_user
from utils.authorization import require_workspace_access
from utils.embeddings import embeddings_service
from config import settings

router = APIRouter(prefix="/conversations", tags=["Conversations"])


def _build_assistant_message_content(user_query: str, workspace_id: int, db: Session) -> tuple[str, list[int], list[int]]:
    """Build an assistant response grounded in workspace documents."""
    query_text = (user_query or "").strip()
    if not query_text:
        return ("Please provide a question so I can search your workspace documents.", [], [])

    try:
        query_embedding = embeddings_service.generate_embedding(query_text)
        similar_docs = embeddings_service.find_similar_embeddings(
            query_embedding,
            workspace_id,
            limit=5,
            threshold=0.2,
            db=db,
        )
    except Exception:
        db.rollback()
        return (
            "I couldn't run semantic retrieval right now. Please try again in a moment.",
            [],
            [],
        )

    document_ids = []
    for doc_id, _score in similar_docs:
        if doc_id not in document_ids:
            document_ids.append(doc_id)
        if len(document_ids) == 3:
            break

    if not document_ids:
        return (
            "I couldn't find relevant indexed content in this workspace yet. Upload and process documents, then try again.",
            [],
            [],
        )

    docs = db.query(Document).filter(Document.id.in_(document_ids)).all()
    doc_map = {doc.id: doc for doc in docs}
    chunks = db.query(DocumentChunk).filter(
        DocumentChunk.document_id.in_(document_ids),
        DocumentChunk.chunk_index == 0,
    ).all()
    chunk_map = {chunk.document_id: chunk for chunk in chunks}

    chunk_ids = []
    lines = []
    for index, doc_id in enumerate(document_ids, start=1):
        document = doc_map.get(doc_id)
        chunk = chunk_map.get(doc_id)
        if not document:
            continue
        snippet = (chunk.text if chunk else "") or "No preview available"
        snippet = " ".join(snippet.split())[:220]
        if chunk:
            chunk_ids.append(chunk.id)
        lines.append(f"{index}. {document.filename}: {snippet}")

    if not lines:
        return (
            "I found related documents but couldn't extract a preview yet. Please try again.",
            document_ids,
            chunk_ids,
        )

    content = (
        "I searched your workspace and found these relevant snippets:\n\n"
        + "\n".join(lines)
        + "\n\nIf you want, ask a follow-up and I can narrow this down further."
    )
    return (content, document_ids, chunk_ids)


@router.post("/{workspace_id}", response_model=ConversationResponse)
async def create_conversation(
    workspace_id: int,
    request: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new conversation in a workspace"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=True,
    )
    
    # Create conversation
    conversation = Conversation(
        workspace_id=workspace_id,
        created_by=current_user.id,
        title=request.title or f"Conversation started {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )
    
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    
    return ConversationResponse.model_validate(conversation)


@router.get("/{workspace_id}", response_model=ConversationListResponse)
async def list_conversations(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all conversations in a workspace"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    conversations = db.query(Conversation).filter(
        Conversation.workspace_id == workspace_id
    ).order_by(desc(Conversation.last_message_at)).all()
    
    return ConversationListResponse(
        items=[ConversationResponse.model_validate(c) for c in conversations]
    )


@router.get("/{workspace_id}/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    workspace_id: int,
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific conversation with all messages"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    # Get conversation
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Get messages
    messages = db.query(AIMessage).filter(
        AIMessage.conversation_id == conversation_id
    ).order_by(AIMessage.created_at).all()
    
    response = ConversationResponse.model_validate(conversation)
    response.messages = [MessageResponse.model_validate(m) for m in messages]
    
    return response


@router.post("/{workspace_id}/{conversation_id}/messages", response_model=MessageResponse)
async def send_message(
    workspace_id: int,
    conversation_id: int,
    request: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message in a conversation"""
    
    # Verify workspace access
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        check_workspace_exists=False,
    )
    
    # Verify conversation exists and belongs to workspace
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Create user message
    user_message = AIMessage(
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=request.content
    )
    
    db.add(user_message)
    db.commit()
    db.refresh(user_message)
    
    # Generate assistant response grounded in workspace documents
    assistant_content, assistant_doc_ids, assistant_chunk_ids = _build_assistant_message_content(
        request.content,
        workspace_id,
        db,
    )

    assistant_message = AIMessage(
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=assistant_content,
        document_refs=json.dumps(assistant_doc_ids) if assistant_doc_ids else None,
        chunk_refs=json.dumps(assistant_chunk_ids) if assistant_chunk_ids else None,
        model_used=settings.voyage_model,
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    # Update conversation's last_message_at
    conversation.last_message_at = datetime.utcnow()
    db.commit()

    return MessageResponse.model_validate(assistant_message)
