"""
Messages/Chat endpoints for workspace communication
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from database import get_db
from models.user import User
from models.message import Message
from utils.auth import get_current_user
from utils.authorization import require_workspace_access
from utils.audit import create_audit_log, AuditActions
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter(prefix="/messages", tags=["Messages"])


def _build_message_response(message: Message, sender: User) -> "MessageResponse":
    return MessageResponse(
        id=message.id,
        workspace_id=message.workspace_id,
        sender_id=message.sender_id,
        sender_username=sender.username,
        sender_email=sender.email,
        content=message.content,
        is_edited=message.is_edited,
        created_at=message.created_at,
        updated_at=message.updated_at
    )


class MessageCreate(BaseModel):
    workspace_id: int
    content: str


class MessageResponse(BaseModel):
    id: int
    workspace_id: int
    sender_id: int
    sender_username: str
    sender_email: str
    content: str
    is_edited: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageUpdate(BaseModel):
    content: str


@router.post("/", response_model=MessageResponse)
async def send_message(
    message_data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message to a workspace"""
    
    # Verify user is a member of the workspace
    require_workspace_access(
        workspace_id=message_data.workspace_id,
        user=current_user,
        db=db,
        not_member_detail="You are not a member of this workspace",
        check_workspace_exists=False,
    )
    
    # Create message
    new_message = Message(
        workspace_id=message_data.workspace_id,
        sender_id=current_user.id,
        content=message_data.content
    )
    
    db.add(new_message)
    db.commit()
    db.refresh(new_message)
    
    # Create audit log
    create_audit_log(
        db=db,
        user=current_user,
        action=AuditActions.MESSAGE_SENT,
        object_type="message",
        object_id=new_message.id,
        metadata={"workspace_id": message_data.workspace_id},
        workspace_id=message_data.workspace_id
    )
    
    return _build_message_response(new_message, current_user)


@router.get("/workspace/{workspace_id}", response_model=List[MessageResponse])
async def get_workspace_messages(
    workspace_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get messages for a specific workspace"""
    
    # Verify user is a member of the workspace
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        not_member_detail="You are not a member of this workspace",
        check_workspace_exists=False,
    )
    
    # Get messages
    messages = db.query(Message, User).join(
        User, Message.sender_id == User.id
    ).filter(
        Message.workspace_id == workspace_id
    ).order_by(desc(Message.created_at)).limit(limit).all()
    
    return [_build_message_response(msg, user) for msg, user in messages]


@router.put("/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: int,
    update_data: MessageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Edit a message (only by sender)"""
    
    message = db.query(Message).filter(Message.id == message_id).first()
    
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
    
    if message.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own messages"
        )
    
    message.content = update_data.content
    message.is_edited = True
    
    db.commit()
    db.refresh(message)
    
    return _build_message_response(message, current_user)


@router.delete("/{message_id}")
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message (only by sender)"""
    
    message = db.query(Message).filter(Message.id == message_id).first()
    
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
    
    if message.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own messages"
        )
    
    db.delete(message)
    db.commit()
    
    return {"message": "Message deleted successfully"}
