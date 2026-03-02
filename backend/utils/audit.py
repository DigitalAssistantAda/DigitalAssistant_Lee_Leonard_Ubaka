"""
Audit logging utilities - Track all user actions for compliance and security
"""
from sqlalchemy.orm import Session
from sqlalchemy import text
from models.user import User
from models.audit_log import AuditLog
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import json
import functools
from fastapi import Request


def create_audit_log(
    db: Session,
    user: User,
    action: str,
    object_type: str,
    object_id: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
    workspace_id: Optional[int] = None
) -> AuditLog:
    """
    Create an audit log entry for an action.
    
    Args:
        db: Database session
        user: User performing the action
        action: Action name (e.g., 'document.upload', 'user.login')
        object_type: Type of object affected (e.g., 'document', 'user')
        object_id: ID of affected object (optional)
        metadata: Additional JSON context (optional)
        
    Returns:
        Created AuditLog record
        
    Example:
        create_audit_log(
            db, 
            user,
            action="document.upload",
            object_type="document",
            object_id=doc.id,
            metadata={"filename": "report.pdf", "size_bytes": 1024}
        )
    """
    audit_log = AuditLog(
        workspace_id=workspace_id,
        actor_user_id=user.id,
        action=action,
        object_type=object_type,
        object_id=object_id,
        metadata_json=json.dumps(metadata) if metadata else None,
        created_at=datetime.now(timezone.utc)
    )
    
    db.add(audit_log)
    db.commit()
    db.refresh(audit_log)
    
    return audit_log


def audit_action(action: str, object_type: str):
    """
    Decorator to automatically log endpoint actions.
    
    Usage:
        @router.post("/documents")
        @audit_action("document.upload", "document")
        async def upload_document(
            file: UploadFile,
            current_user: User = Depends(get_current_user),
            db: Session = Depends(get_db)
        ):
            # Your endpoint code
            # Audit log will be created automatically
            pass
    """
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Call the endpoint
            result = await func(*args, **kwargs)
            
            # Extract db and current_user from kwargs
            db = kwargs.get("db")
            current_user = kwargs.get("current_user")
            
            if db and current_user:
                # Extract object_id from result if it's a model with id
                object_id = None
                if hasattr(result, "id"):
                    object_id = result.id
                elif isinstance(result, dict) and "id" in result:
                    object_id = result["id"]
                
                create_audit_log(
                    db,
                    current_user,
                    action=action,
                    object_type=object_type,
                    object_id=object_id
                )
            
            return result
        return wrapper
    return decorator


def get_audit_logs(
    db: Session,
    workspace_ids: list[int],
    limit: int = 100,
    offset: int = 0,
    action_filter: Optional[str] = None,
    object_type_filter: Optional[str] = None,
    user_id_filter: Optional[int] = None
) -> tuple[list[AuditLog], int]:
    """
    Query audit logs with optional filters.
    
    Args:
        db: Database session
        workspace_ids: Workspaces to query logs for
        limit: Number of results to return
        offset: Number of results to skip
        action_filter: Filter by action name (e.g., 'document.%')
        object_type_filter: Filter by object type
        user_id_filter: Filter by user who performed action
        
    Returns:
        Tuple of (logs, total_count)
    """
    query = db.query(AuditLog).filter(AuditLog.workspace_id.in_(workspace_ids))
    
    if action_filter:
        query = query.filter(AuditLog.action.like(action_filter))
    
    if object_type_filter:
        query = query.filter(AuditLog.object_type == object_type_filter)
    
    if user_id_filter:
        query = query.filter(AuditLog.actor_user_id == user_id_filter)
    
    total_count = query.count()
    
    logs = query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset).all()
    
    return logs, total_count


# Audit log action constants for consistency
class AuditActions:
    """Standard audit action names"""
    # User actions
    USER_REGISTERED = "user.registered"
    USER_LOGGED_IN = "user.logged_in"
    USER_LOGGED_OUT = "user.logged_out"
    USER_UPDATED = "user.updated"
    USER_DELETED = "user.deleted"
    
    # Workspace actions
    WORKSPACE_CREATED = "workspace.created"
    WORKSPACE_UPDATED = "workspace.updated"
    WORKSPACE_DELETED = "workspace.deleted"
    WORKSPACE_INVITE_SENT = "workspace.invite_sent"
    WORKSPACE_INVITE_ACCEPTED = "workspace.invite_accepted"
    WORKSPACE_INVITE_DECLINED = "workspace.invite_declined"
    WORKSPACE_MEMBER_ADDED = "workspace.member_added"
    WORKSPACE_MEMBER_REMOVED = "workspace.member_removed"
    
    # Document actions
    DOCUMENT_UPLOADED = "document.uploaded"
    DOCUMENT_DELETED = "document.deleted"
    DOCUMENT_DOWNLOADED = "document.downloaded"
    DOCUMENT_SHARED = "document.shared"
    DOCUMENT_UPDATED = "document.updated"
    DOCUMENT_DELETION_REQUESTED = "document.deletion_requested"
    DOCUMENT_DELETION_APPROVED = "document.deletion_approved"
    DOCUMENT_DELETION_DENIED = "document.deletion_denied"
    
    # Search actions
    SEARCH_PERFORMED = "search.performed"
    
    # AI actions
    SUMMARY_GENERATED = "summary.generated"
    EMBEDDING_CREATED = "embedding.created"
    
    # Processing actions
    PROCESSING_STARTED = "processing.started"
    PROCESSING_COMPLETED = "processing.completed"
    PROCESSING_FAILED = "processing.failed"
    
    # Message actions
    MESSAGE_SENT = "message.sent"
    MESSAGE_MENTIONED = "message.mentioned"
    MESSAGE_EDITED = "message.edited"
    MESSAGE_DELETED = "message.deleted"
