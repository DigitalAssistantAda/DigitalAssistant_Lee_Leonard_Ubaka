from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.audit_log import AuditLog
from models.workspace import WorkspaceMember, MemberStatus
from schemas.audit_log import AuditLogResponse, AuditLogListResponse
from utils.auth import get_current_user
from utils.audit import get_audit_logs

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    action: str = Query(None),
    object_type: str = Query(None),
    user_id: int = Query(None),
):
    """List audit logs for workspaces the user can access."""

    workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).all()
    workspace_ids = [row[0] for row in workspace_ids]

    if not workspace_ids:
        return AuditLogListResponse(
            logs=[],
            total=0,
            limit=limit,
            offset=offset
        )

    logs, total_count = get_audit_logs(
        db=db,
        workspace_ids=workspace_ids,
        limit=limit,
        offset=offset,
        action_filter=f"%{action}%" if action else None,
        object_type_filter=object_type,
        user_id_filter=user_id,
    )
    
    return AuditLogListResponse(
        logs=[AuditLogResponse.model_validate(log) for log in logs],
        total=total_count,
        limit=limit,
        offset=offset
    )


@router.get("/{log_id}", response_model=AuditLogResponse)
async def get_audit_log(
    log_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific audit log entry scoped to user's workspaces"""

    workspace_ids = db.query(WorkspaceMember.workspace_id).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).all()
    workspace_ids = [row[0] for row in workspace_ids]

    log = db.query(AuditLog).filter(
        AuditLog.id == log_id,
        AuditLog.workspace_id.in_(workspace_ids)
    ).first()
    
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit log not found"
        )
    
    return AuditLogResponse.model_validate(log)
