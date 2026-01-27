from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, WorkspaceRole, MemberStatus
from schemas.workspace import (
    CreateWorkspaceRequest,
    WorkspaceResponse,
    UpdateWorkspaceRequest,
    WorkspaceListResponse,
    WorkspaceMemberResponse,
    WorkspaceMemberListResponse,
    AddMemberRequest,
    UpdateMemberRequest,
)
from schemas.auth import SuccessResponse
from utils.auth import get_current_user, create_audit_log

router = APIRouter(prefix="/workspaces", tags=["Workspaces"])


def check_workspace_access(workspace_id: int, user: User, db: Session, required_roles: Optional[list] = None) -> Workspace:
    """Check if user has access to workspace and optionally verify role"""
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    
    if workspace.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    if required_roles and member.role not in required_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    return workspace


@router.post("", response_model=WorkspaceResponse)
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates a new workspace within the tenant"""
    
    workspace = Workspace(
        name=request.name,
        tenant_id=current_user.tenant_id,
        created_by=current_user.id
    )
    db.add(workspace)
    db.flush()
    
    # Add creator as owner
    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role=WorkspaceRole.OWNER,
        status=MemberStatus.ACTIVE
    )
    db.add(member)
    db.commit()
    db.refresh(workspace)
    
    create_audit_log(db, current_user, "workspace.created", "workspace", workspace.id)
    
    return WorkspaceResponse.model_validate(workspace)


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists workspaces the user is a member of"""
    
    member_workspaces = db.query(Workspace).join(WorkspaceMember).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
        Workspace.tenant_id == current_user.tenant_id
    ).all()
    
    return WorkspaceListResponse(
        items=[WorkspaceResponse.model_validate(w) for w in member_workspaces]
    )


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves details for a specific workspace"""
    
    workspace = check_workspace_access(workspace_id, current_user, db)
    return WorkspaceResponse.model_validate(workspace)


@router.put("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: int,
    request: UpdateWorkspaceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates workspace metadata"""
    
    workspace = check_workspace_access(workspace_id, current_user, db, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
    
    workspace.name = request.name
    db.commit()
    db.refresh(workspace)
    
    create_audit_log(db, current_user, "workspace.updated", "workspace", workspace.id)
    
    return WorkspaceResponse.model_validate(workspace)


@router.delete("/{workspace_id}", response_model=SuccessResponse)
async def delete_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a workspace"""
    
    workspace = check_workspace_access(workspace_id, current_user, db, [WorkspaceRole.OWNER])
    
    # Delete all members first
    db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).delete()
    db.delete(workspace)
    db.commit()
    
    create_audit_log(db, current_user, "workspace.deleted", "workspace", workspace_id)
    
    return SuccessResponse()


@router.get("/{workspace_id}/members", response_model=WorkspaceMemberListResponse)
async def list_workspace_members(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists members of a workspace"""
    
    check_workspace_access(workspace_id, current_user, db)
    
    members = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id
    ).all()
    
    return WorkspaceMemberListResponse(
        items=[WorkspaceMemberResponse.model_validate(m) for m in members]
    )


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberResponse)
async def add_workspace_member(
    workspace_id: int,
    request: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Adds a user to a workspace"""
    
    check_workspace_access(workspace_id, current_user, db, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
    
    # Find user by email or ID
    if request.email_or_user_id.isdigit():
        target_user = db.query(User).filter(User.id == int(request.email_or_user_id)).first()
    else:
        target_user = db.query(User).filter(User.email == request.email_or_user_id).first()
    
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if target_user.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not in same tenant")
    
    # Check if already a member
    existing = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == target_user.id
    ).first()
    
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already a member")
    
    member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=target_user.id,
        role=WorkspaceRole(request.role),
        status=MemberStatus.ACTIVE
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    
    create_audit_log(db, current_user, "workspace.member_added", "workspace_member", member.id)
    
    return WorkspaceMemberResponse.model_validate(member)


@router.put("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberResponse)
async def update_workspace_member(
    workspace_id: int,
    user_id: int,
    request: UpdateMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates a member's role or status"""
    
    check_workspace_access(workspace_id, current_user, db, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    
    if request.role:
        member.role = WorkspaceRole(request.role)
    if request.status:
        member.status = MemberStatus(request.status)
    
    db.commit()
    db.refresh(member)
    
    create_audit_log(db, current_user, "workspace.member_updated", "workspace_member", member.id)
    
    return WorkspaceMemberResponse.model_validate(member)


@router.delete("/{workspace_id}/members/{user_id}", response_model=SuccessResponse)
async def remove_workspace_member(
    workspace_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Removes a user from a workspace"""
    
    check_workspace_access(workspace_id, current_user, db, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN])
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    
    db.delete(member)
    db.commit()
    
    create_audit_log(db, current_user, "workspace.member_removed", "workspace_member", user_id)
    
    return SuccessResponse()
