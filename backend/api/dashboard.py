"""
Dashboard statistics endpoint - provides user stats and recent activity
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, MemberStatus
from models.document import Document
from models.task import Task, TaskType, TaskStatus
from models.audit_log import AuditLog
from utils.auth import get_current_user
from typing import Dict, Any, List
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Get dashboard statistics for the current user"""
    
    # Count workspaces user is a member of
    workspace_count = db.query(func.count(WorkspaceMember.id)).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).scalar() or 0
    
    # Count total documents across user's workspaces
    user_workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).subquery()
    
    document_count = db.query(func.count(Document.id)).filter(
        Document.workspace_id.in_(user_workspace_ids)
    ).scalar() or 0
    
    # Count recent documents (uploaded in last 7 days)
    recent_items = db.query(func.count(Document.id)).filter(
        Document.workspace_id.in_(user_workspace_ids),
        Document.created_at >= datetime.now() - timedelta(days=7)
    ).scalar() or 0
    
    # Recent activity count (last 24 hours)
    recent_activity_count = db.query(func.count(AuditLog.id)).filter(
        AuditLog.actor_user_id == current_user.id,
        AuditLog.created_at >= datetime.now() - timedelta(hours=24)
    ).scalar() or 0
    
    return {
        "workspaces": workspace_count,
        "documents": document_count,
        "recent_items": recent_items,
        "recent_activity_count": recent_activity_count,
        "member_since": current_user.created_at.strftime("%B %Y"),
        "email": current_user.email,
        "username": current_user.username or current_user.email.split('@')[0]
    }


@router.get("/activity")
async def get_recent_activity(
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, List[Dict[str, Any]]]:
    """Get recent activity for the current user"""
    
    # Get recent audit logs
    logs = db.query(AuditLog).filter(
        AuditLog.actor_user_id == current_user.id
    ).order_by(desc(AuditLog.created_at)).limit(limit).all()
    
    activities = []
    for log in logs:
        # Calculate time ago
        time_diff = datetime.now(timezone.utc) - log.created_at
        if time_diff.total_seconds() < 3600:
            time_ago = f"{int(time_diff.total_seconds() / 60)} minutes ago"
        elif time_diff.total_seconds() < 86400:
            time_ago = f"{int(time_diff.total_seconds() / 3600)} hours ago"
        else:
            time_ago = f"{int(time_diff.total_seconds() / 86400)} days ago"
        
        # Map action to user-friendly title and type
        action_map = {
            "document.uploaded": {"type": "upload", "title": "Document uploaded"},
            "document.viewed": {"type": "search", "title": "Document viewed"},
            "document.downloaded": {"type": "upload", "title": "Document downloaded"},
            "workspace.accessed": {"type": "access", "title": "Workspace accessed"},
            "workspace.created": {"type": "success", "title": "Workspace created"},
            "user.login": {"type": "success", "title": "Logged in"},
        }
        
        mapping = action_map.get(log.action, {"type": "success", "title": log.action})
        
        activities.append({
            "type": mapping["type"],
            "title": mapping["title"],
            "meta": log.object_type,
            "time": time_ago,
            "status": "success",
            "action": log.action
        })
    
    return {"items": activities}


@router.get("/issues")
async def get_dashboard_issues(
    limit: int = 5,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, List[Dict[str, Any]]]:
    """Get recent open issues for workspaces the user is a member of"""
    
    # Get user's workspace IDs
    user_workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).subquery()
    
    # Get recent open issues
    issues = db.query(Task).filter(
        Task.workspace_id.in_(user_workspace_ids),
        Task.type == TaskType.ISSUE.value,
        Task.status.in_([TaskStatus.OPEN.value, TaskStatus.IN_PROGRESS.value])
    ).order_by(desc(Task.created_at)).limit(limit).all()
    
    issues_data = []
    for issue in issues:
        issues_data.append({
            "id": issue.id,
            "number": issue.id,  # Use ID as issue number
            "title": issue.title,
            "status": issue.status,
            "priority": issue.priority or "medium",
            "workspace_id": issue.workspace_id
        })
    
    return {"items": issues_data}


@router.get("/deadlines")
async def get_dashboard_deadlines(
    limit: int = 5,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, List[Dict[str, Any]]]:
    """Get upcoming deadlines for workspaces the user is a member of"""
    
    # Get user's workspace IDs
    user_workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).subquery()
    
    # Get upcoming deadlines (not completed, ordered by due_date)
    deadlines = db.query(Task).filter(
        Task.workspace_id.in_(user_workspace_ids),
        Task.type == TaskType.DEADLINE.value,
        Task.status != TaskStatus.COMPLETED.value
    ).order_by(Task.due_date).limit(limit).all()
    
    deadlines_data = []
    for deadline in deadlines:
        # Calculate days until deadline
        if deadline.due_date:
            days_until = (deadline.due_date - datetime.utcnow()).days
            if days_until < 0:
                due_in = f"Overdue by {abs(days_until)} days"
            elif days_until == 0:
                due_in = "Due today"
            elif days_until == 1:
                due_in = "Due tomorrow"
            else:
                due_in = f"Due in {days_until} days"
        else:
            due_in = "No due date"
        
        deadlines_data.append({
            "id": deadline.id,
            "title": deadline.title,
            "due_date": deadline.due_date.isoformat() if deadline.due_date else None,
            "due_in": due_in,
            "status": deadline.status,
            "workspace_id": deadline.workspace_id
        })
    
    return {"items": deadlines_data}
