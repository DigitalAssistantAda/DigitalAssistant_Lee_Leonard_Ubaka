from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.audit_log import AuditLog
from models.workspace import WorkspaceMember, WorkspaceRole, MemberStatus
from schemas.audit_log import AuditLogResponse, AuditLogListResponse
from utils.auth import get_current_user

router = APIRouter(tags=["Audit Logs"])


@router.get("/audit-logs", response_model=AuditLogListResponse)
async def get_audit_logs(
    workspace_id: int = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves audit logs for the tenant or workspace"""
    
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
