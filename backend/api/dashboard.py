"""
Dashboard statistics endpoint - provides user stats and recent activity
"""
import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, MemberStatus
from models.document import Document
from models.task import Task, TaskType, TaskStatus
from models.task_assignee import TaskAssignee
from models.audit_log import AuditLog
from utils.auth import get_current_user
from typing import Dict, Any, List
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _parse_audit_metadata(raw_metadata: Any) -> Dict[str, Any]:
    if isinstance(raw_metadata, dict):
        return raw_metadata
    if isinstance(raw_metadata, str):
        try:
            parsed = json.loads(raw_metadata)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _resolve_task_history_activity(log: AuditLog, metadata: Dict[str, Any], fallback_name: str | None) -> tuple[str, str]:
    task_name = metadata.get("task_title") or fallback_name
    if not task_name:
        task_name = f"Task #{log.object_id}" if log.object_id else "task"
    changes = metadata.get("changes") or []
    status_change = next(
        (
            change for change in changes
            if isinstance(change, dict)
            and change.get("field") == "status"
            and str(change.get("new") or "").lower() in {"completed", "closed"}
        ),
        None,
    )

    if status_change:
        next_status = str(status_change.get("new") or "").lower()
        if next_status == "completed":
            return f"Completed {task_name}", "task.completed"
        return f"Closed {task_name}", "task.closed"

    return f"Updated {task_name}", "task.updated"


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
        "username": current_user.username or current_user.email.split('@')[0],
        "status_message": current_user.status_message
    }


@router.get("/activity")
async def get_recent_activity(
    limit: int = 10,
    filter_type: str = "all",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, List[Dict[str, Any]]]:
    """Get recent activity for the current user with username and item details
    
    filter_type options: all, documents, workspaces, searches, summaries
    """
    
    # Get recent audit logs - START THE QUERY HERE
    query = db.query(AuditLog).filter(
        AuditLog.actor_user_id == current_user.id
    )
    
    # Apply filter based on filter_type
        # Apply filter based on filter_type
    if filter_type == "documents":
        # Filter for document-related actions (uploaded, downloaded, deleted, etc.)
        query = query.filter(
            (AuditLog.action.like("document.%")) |
            (AuditLog.action.ilike("%uploaded%")) |
            (AuditLog.action.ilike("%downloaded%")) |
            (AuditLog.action.ilike("%deleted%")) |
            (AuditLog.object_type == "document")
        )
    elif filter_type == "workspaces":
        query = query.filter(
            (AuditLog.action.like("workspace.%")) |
            (AuditLog.action == "workspace.invite_sent") |
            (AuditLog.action == "workspace.member_invited")
        )
    elif filter_type == "searches":
        query = query.filter(
            (AuditLog.action == "document.viewed") | 
            (AuditLog.action.like("search.%"))
        )
    elif filter_type == "summaries":
        query = query.filter(AuditLog.action.like("summary.%"))
    else:  # "all" - exclude login/logout
        query = query.filter(
            ~AuditLog.action.in_(["user.login", "user.logout"])
        )
    
    logs = query.order_by(desc(AuditLog.created_at)).limit(limit).all()
    
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
        
        # Get username
        actor = db.query(User).filter(User.id == log.actor_user_id).first()
        username = actor.username if actor else "Unknown User"
        
        # Extract item name and location from metadata
        item_name = None
        location_name = None
        metadata = _parse_audit_metadata(log.metadata_json)
        
        if metadata:
            item_name = metadata.get("filename") or metadata.get("name") or metadata.get("task_title")
            location_name = metadata.get("workspace_name") or metadata.get("container_name")
        
        # Fallback: fetch from database if not in metadata
        if not item_name:
            if log.object_type == "document" and log.object_id:
                doc = db.query(Document).filter(Document.id == log.object_id).first()
                item_name = doc.filename if doc else "document"
            elif log.object_type == "task" and log.object_id:
                task = db.query(Task).filter(Task.id == log.object_id).first()
                item_name = task.title if task else "task"
            elif log.object_type == "container" and log.object_id:
                from models.container import Container
                container = db.query(Container).filter(Container.id == log.object_id).first()
                item_name = container.name if container else "container"
            elif log.object_type == "workspace" and log.object_id:
                workspace = db.query(Workspace).filter(Workspace.id == log.object_id).first()
                item_name = workspace.name if workspace else "workspace"
        
        # Get location name if not in metadata
        if not location_name and log.workspace_id:
            workspace = db.query(Workspace).filter(Workspace.id == log.workspace_id).first()
            location_name = workspace.name if workspace else None
        
        # Build action description based on action type
        resolved_action_type = log.action
        action_description = ""
        if log.action == "task.history":
            action_description, resolved_action_type = _resolve_task_history_activity(log, metadata, item_name)
        elif "uploaded" in log.action:
            action_description = f"uploaded {item_name}"
            if location_name:
                action_description += f" to {location_name}"
        elif "downloaded" in log.action:
            action_description = f"downloaded {item_name}"
        elif "deleted" in log.action:
            action_description = f"deleted {item_name}"
            if location_name:
                action_description += f" from {location_name}"
        elif "created" in log.action:
            action_description = f"created {log.object_type} {item_name}"
        elif "invite_sent" in log.action or "member_invited" in log.action:
            # Get who sent the invite
            invited_user_name = None
            if metadata:
                invited_user_email = metadata.get("invited_email")
                if invited_user_email:
                    invited_user = db.query(User).filter(User.email == invited_user_email).first()
                    invited_user_name = invited_user.username if invited_user else invited_user_email
            
            action_description = f"sent invite to join {item_name}"
            if invited_user_name:
                action_description = f"invited {invited_user_name} to {item_name}"
        else:
            action_description = log.action.replace(".", " ").title()
        
        # Map action to icon type
        action_map = {
            "document.uploaded": "upload",
            "document.downloaded": "upload",
            "document.deleted": "upload",
            "document.viewed": "search",
            "container.created": "success",
            "user.login": "success",
        }

        icon_type = action_map.get(log.action, "success")
        if resolved_action_type.startswith("task."):
            icon_type = "success"
        elif log.action.startswith("workspace.") or log.object_type in {"workspace", "workspace_member"}:
            icon_type = "workspace"
        elif log.action.startswith("search."):
            icon_type = "search"
        
        activities.append({
            "username": username,
            "action": action_description,
            "type": icon_type,
            "time": time_ago,
            "status": "success",
            "action_type": resolved_action_type,
            "created_at": log.created_at.isoformat()
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
    issues = db.query(Task).outerjoin(
        TaskAssignee, TaskAssignee.task_id == Task.id
    ).filter(
        Task.workspace_id.in_(user_workspace_ids),
        Task.type == TaskType.ISSUE,
        Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
        ((TaskAssignee.user_id == current_user.id) | (Task.assigned_to == current_user.id)),
    ).distinct().order_by(desc(Task.created_at)).limit(limit).all()
    
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
    """Get upcoming due dates from deadline or issue tasks assigned to the user."""
    
    # Get user's workspace IDs
    user_workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).subquery()
    
    # Get assigned tasks with due dates that aren't completed/closed, ordered by due_date.
    # Include both explicit deadlines and issues that have due dates.
    deadlines = db.query(Task).outerjoin(
        TaskAssignee, TaskAssignee.task_id == Task.id
    ).filter(
        Task.workspace_id.in_(user_workspace_ids),
        Task.type.in_([TaskType.DEADLINE, TaskType.ISSUE]),
        Task.due_date.isnot(None),
        Task.status.notin_([TaskStatus.COMPLETED, TaskStatus.CLOSED]),
        ((TaskAssignee.user_id == current_user.id) | (Task.assigned_to == current_user.id)),
    ).distinct().order_by(Task.due_date).limit(limit).all()
    
    now_utc = datetime.now(timezone.utc)
    today_utc = now_utc.date()
    deadlines_data = []
    for deadline in deadlines:
        # Calculate days until deadline
        if deadline.due_date:
            due_date_utc = deadline.due_date
            if due_date_utc.tzinfo is None:
                due_date_utc = due_date_utc.replace(tzinfo=timezone.utc)
            days_until = (due_date_utc.date() - today_utc).days
            is_overdue = days_until < 0
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
            is_overdue = False
        
        deadlines_data.append({
            "id": deadline.id,
            "title": deadline.title,
            "due_date": deadline.due_date.isoformat() if deadline.due_date else None,
            "due_in": due_in,
            "is_overdue": is_overdue,
            "status": deadline.status,
            "workspace_id": deadline.workspace_id
        })
    
    return {"items": deadlines_data}
