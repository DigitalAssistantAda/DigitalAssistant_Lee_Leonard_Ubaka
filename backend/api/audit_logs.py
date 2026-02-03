from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.audit_log import AuditLog
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
    """
    List audit logs for the current tenant (multi-tenant isolated).
    
    Shows all actions taken by any user in the organization.
    Filters automatically to current tenant.
    """
    
    logs, total_count = get_audit_logs(
        db=db,
        tenant_id=current_user.tenant_id,
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
    """Get a specific audit log entry (tenant-scoped)"""
    
    log = db.query(AuditLog).filter(
        (AuditLog.id == log_id) &
        (AuditLog.tenant_id == current_user.tenant_id)
    ).first()
    
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit log not found"
        )
    
    return AuditLogResponse.model_validate(log)
    # Check if user is admin or owner
    if workspace_id:
        member = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == current_user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE
        ).first()
        
        if not member or member.role not in [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only workspace owners and admins can view audit logs"
            )
    
    # Get tenant-level logs
    query = db.query(AuditLog).filter(AuditLog.tenant_id == current_user.tenant_id)
    
    # TODO: Add filtering by workspace, action, object_type, etc.
    # TODO: Add pagination
    
    logs = query.order_by(AuditLog.created_at.desc()).limit(100).all()
    
    return AuditLogListResponse(
        items=[AuditLogResponse.model_validate(log) for log in logs]
    )
