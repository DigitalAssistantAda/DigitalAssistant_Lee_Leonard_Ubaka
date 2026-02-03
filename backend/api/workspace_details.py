"""
Workspace details endpoint - provides sidebar data for workspace page
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, MemberStatus
from models.document import Document
from models.audit_log import AuditLog
from utils.auth import get_current_user
from typing import Dict, Any, List
from datetime import datetime, timezone

router = APIRouter(prefix="/workspace-details", tags=["Workspace Details"])


@router.get("/sidebar")
async def get_workspace_sidebar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Get sidebar data: recent documents, members, and activity across user's workspaces"""
    
    # Get all workspace IDs the user has access to
    user_workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        and_(
            WorkspaceMember.user_id == current_user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE
        )
    ).all()
    workspace_ids = [w[0] for w in user_workspace_ids]
    
    if not workspace_ids:
        return {
            "recent_documents": [],
            "members": [],
            "recent_activity": []
        }
    
    # Get recent documents across all user's workspaces
    recent_docs = db.query(
        Document.id,
        Document.filename,
        Document.workspace_id,
        Document.created_at,
        Workspace.name.label("workspace_name"),
        User.username.label("uploaded_by_username")
    ).join(
        Workspace, Document.workspace_id == Workspace.id
    ).join(
        User, Document.uploaded_by == User.id
    ).filter(
        Document.workspace_id.in_(workspace_ids)
    ).order_by(desc(Document.created_at)).limit(5).all()
    
    documents = [
        {
            "id": doc.id,
            "filename": doc.filename,
            "workspace_name": doc.workspace_name,
            "uploaded_by": doc.uploaded_by_username,
            "created_at": doc.created_at.isoformat()
        }
        for doc in recent_docs
    ]
    
    # Get workspace members (excluding current user, show 5 most recent)
    members_query = db.query(
        User.id,
        User.username,
        User.email,
        WorkspaceMember.role,
        WorkspaceMember.joined_at,
        Workspace.name.label("workspace_name")
    ).join(
        WorkspaceMember, User.id == WorkspaceMember.user_id
    ).join(
        Workspace, WorkspaceMember.workspace_id == Workspace.id
    ).filter(
        and_(
            WorkspaceMember.workspace_id.in_(workspace_ids),
            WorkspaceMember.status == MemberStatus.ACTIVE,
            User.id != current_user.id
        )
    ).order_by(desc(WorkspaceMember.joined_at)).limit(5).all()
    
    members = [
        {
            "id": m.id,
            "username": m.username,
            "email": m.email,
            "role": m.role,
            "workspace_name": m.workspace_name,
            "joined_at": m.joined_at.isoformat()
        }
        for m in members_query
    ]
    
    # Get recent activity in user's workspaces
    recent_activity = db.query(AuditLog).filter(
        AuditLog.tenant_id == current_user.tenant_id
    ).order_by(desc(AuditLog.created_at)).limit(8).all()
    
    activities = []
    for log in recent_activity:
        # Calculate time ago
        time_diff = datetime.now(timezone.utc) - log.created_at
        if time_diff.total_seconds() < 3600:
            time_ago = f"{int(time_diff.total_seconds() / 60)}m ago"
        elif time_diff.total_seconds() < 86400:
            time_ago = f"{int(time_diff.total_seconds() / 3600)}h ago"
        else:
            time_ago = f"{int(time_diff.total_seconds() / 86400)}d ago"
        
        # Get actor username
        actor = db.query(User).filter(User.id == log.actor_user_id).first()
        actor_name = actor.username if actor else "Unknown"
        
        activities.append({
            "action": log.action,
            "actor": actor_name,
            "object_type": log.object_type,
            "time_ago": time_ago,
            "created_at": log.created_at.isoformat()
        })
    
    return {
        "recent_documents": documents,
        "members": members,
        "recent_activity": activities
    }
