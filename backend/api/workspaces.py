from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models.user import User
from models.workspace import Workspace, WorkspaceMember, WorkspaceRole, MemberStatus
from models.container import Container
from models.document import Document
from schemas.workspace import (
    CreateWorkspaceRequest,
    WorkspaceResponse,
    UpdateWorkspaceRequest,
    WorkspaceListResponse,
    WorkspaceMemberResponse,
    WorkspaceMemberListResponse,
    WorkspaceInvitationResponse,
    WorkspaceInvitationListResponse,
    AddMemberRequest,
    UpdateMemberRequest,
)
from schemas.auth import SuccessResponse
from utils.auth import get_current_user, create_audit_log
from utils.authorization import require_workspace_access, check_workspace_access
from errors import AppError
from utils.audit import AuditActions

router = APIRouter(prefix="/workspaces", tags=["Workspaces"])


def build_member_response(member: WorkspaceMember, user: User) -> WorkspaceMemberResponse:
    return WorkspaceMemberResponse(
        id=member.id,
        user_id=member.user_id,
        username=user.username,
        email=user.email,
        role=member.role,
        joined_at=member.joined_at,
        status=member.status,
    )


def build_invitation_response(member: WorkspaceMember, workspace: Workspace) -> WorkspaceInvitationResponse:
    return WorkspaceInvitationResponse(
        invitation_id=member.id,
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        role=member.role,
        status=member.status,
        invited_at=member.joined_at,
    )


@router.post("", response_model=WorkspaceResponse)
async def create_workspace(
    request: CreateWorkspaceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates a new workspace"""
    
    workspace = Workspace(
        name=request.name,
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

    # Create default workspace-owned container for document organization
    default_container = Container(
        workspace_id=workspace.id,
        name=request.name,
        color=workspace.accent_color,
        created_by=current_user.id,
    )
    db.add(default_container)

    db.commit()
    db.refresh(workspace)
    
    create_audit_log(db, current_user, "workspace.created", "workspace", workspace.id, workspace_id=workspace.id)
    
    return WorkspaceResponse.model_validate(workspace)


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists workspaces the user is a member of"""
    
    member_workspaces = db.query(Workspace).join(WorkspaceMember).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).all()
    
    # Enrich with counts
    workspace_responses = []
    for workspace in member_workspaces:
        # Count active members
        member_count = db.query(func.count(WorkspaceMember.id)).filter(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == MemberStatus.ACTIVE
        ).scalar() or 0
        
        # Count documents in workspace
        document_count = db.query(func.count(Document.id)).filter(
            Document.workspace_id == workspace.id
        ).scalar() or 0
        
        workspace_dict = WorkspaceResponse.model_validate(workspace).model_dump()
        workspace_dict['member_count'] = member_count
        workspace_dict['document_count'] = document_count
        workspace_responses.append(WorkspaceResponse(**workspace_dict))
    
    return WorkspaceListResponse(items=workspace_responses)


@router.get("/invitations/pending", response_model=WorkspaceInvitationListResponse)
async def list_pending_workspace_invitations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List pending workspace invitations for the current user."""

    invitations = db.query(WorkspaceMember, Workspace).join(
        Workspace, WorkspaceMember.workspace_id == Workspace.id
    ).filter(
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.PENDING,
    ).all()

    return WorkspaceInvitationListResponse(
        items=[build_invitation_response(member, workspace) for member, workspace in invitations]
    )


@router.post("/invitations/{invitation_id}/accept", response_model=WorkspaceMemberResponse)
async def accept_workspace_invitation(
    invitation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Accept a pending workspace invitation for the current user."""

    invitation = db.query(WorkspaceMember).filter(
        WorkspaceMember.id == invitation_id,
        WorkspaceMember.user_id == current_user.id,
    ).first()

    if not invitation:
        raise AppError(
            code="INVITATION_NOT_FOUND",
            message="Invitation not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if invitation.status != MemberStatus.PENDING:
        raise AppError(
            code="INVITATION_NOT_PENDING",
            message="Invitation is no longer pending.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    invitation.status = MemberStatus.ACTIVE
    db.commit()
    db.refresh(invitation)

    create_audit_log(
        db,
        current_user,
        AuditActions.WORKSPACE_INVITE_ACCEPTED,
        "workspace_member",
        invitation.id,
        metadata={"workspace_id": invitation.workspace_id},
        workspace_id=invitation.workspace_id,
    )

    return build_member_response(invitation, current_user)


@router.post("/invitations/{invitation_id}/decline", response_model=SuccessResponse)
async def decline_workspace_invitation(
    invitation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Decline a pending workspace invitation for the current user."""

    invitation = db.query(WorkspaceMember).filter(
        WorkspaceMember.id == invitation_id,
        WorkspaceMember.user_id == current_user.id,
    ).first()

    if not invitation:
        raise AppError(
            code="INVITATION_NOT_FOUND",
            message="Invitation not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if invitation.status != MemberStatus.PENDING:
        raise AppError(
            code="INVITATION_NOT_PENDING",
            message="Invitation is no longer pending.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    invitation.status = MemberStatus.INACTIVE
    db.commit()

    create_audit_log(
        db,
        current_user,
        AuditActions.WORKSPACE_INVITE_DECLINED,
        "workspace_member",
        invitation.id,
        metadata={"workspace_id": invitation.workspace_id},
        workspace_id=invitation.workspace_id,
    )

    return SuccessResponse()


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves details for a specific workspace"""
    workspace = require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)
    default_container = db.query(Container).filter(
        Container.workspace_id == workspace_id
    ).order_by(Container.id.asc()).first()
    member_count = db.query(func.count(WorkspaceMember.id)).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).scalar() or 0
    document_count = db.query(func.count(Document.id)).filter(
        Document.workspace_id == workspace_id
    ).scalar() or 0
    data = WorkspaceResponse.model_validate(workspace).model_dump()
    data["default_container_id"] = default_container.id if default_container else None
    data["member_count"] = member_count
    data["document_count"] = document_count
    return WorkspaceResponse(**data)


@router.put("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: int,
    request: UpdateWorkspaceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates workspace metadata"""
    

    workspace = require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        required_roles=[WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
    )

    # Check if user is a member of the workspace
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    # Check if user has permission to update workspace (must be owner or admin)
    if member.role not in [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]:
        raise AppError(
            code="INSUFFICIENT_PERMISSIONS",
            message="You do not have permission to modify workspace settings.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    
    workspace.name = request.name
    if "accent_color" in request.model_fields_set:
        workspace.accent_color = request.accent_color
    if "autonomous_organization_enabled" in request.model_fields_set and request.autonomous_organization_enabled is not None:
        workspace.autonomous_organization_enabled = request.autonomous_organization_enabled
    db.commit()
    db.refresh(workspace)
    
    create_audit_log(db, current_user, "workspace.updated", "workspace", workspace.id, workspace_id=workspace.id)
    
    return WorkspaceResponse.model_validate(workspace)


@router.delete("/{workspace_id}", response_model=SuccessResponse)
async def delete_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes a workspace"""
    
    workspace = require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        required_roles=[WorkspaceRole.OWNER],
    )
    
    # Create audit log before deletion
    create_audit_log(db, current_user, "workspace.deleted", "workspace", workspace_id, workspace_id=workspace_id)
    
    # Delete workspace related data in correct order to respect foreign keys
    # 1. Delete conversations and their AI messages
    from models.conversation import Conversation, AIMessage
    conversation_ids = [row[0] for row in db.query(Conversation.id).filter(Conversation.workspace_id == workspace_id).all()]
    if conversation_ids:
        db.query(AIMessage).filter(AIMessage.conversation_id.in_(conversation_ids)).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 2. Delete summaries
    from models.summary import Summary
    db.query(Summary).filter(Summary.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 3. Delete tasks and their assignees
    from models.task import Task
    from models.task_assignee import TaskAssignee
    task_ids = [row[0] for row in db.query(Task.id).filter(Task.workspace_id == workspace_id).all()]
    if task_ids:
        db.query(TaskAssignee).filter(TaskAssignee.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(Task).filter(Task.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 4. Delete messages
    from models.message import Message
    db.query(Message).filter(Message.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 5. Delete documents and their related data
    from models.document import Document
    from models.document_chunk import DocumentChunk
    from models.chunk_embedding import ChunkEmbedding
    from models.document_deletion_request import DocumentDeletionRequest
    document_ids = [row[0] for row in db.query(Document.id).filter(Document.workspace_id == workspace_id).all()]
    if document_ids:
        # Delete chunk embeddings first
        chunk_ids = [row[0] for row in db.query(DocumentChunk.id).filter(DocumentChunk.document_id.in_(document_ids)).all()]
        if chunk_ids:
            db.query(ChunkEmbedding).filter(ChunkEmbedding.chunk_id.in_(chunk_ids)).delete(synchronize_session=False)
        # Delete chunks
        db.query(DocumentChunk).filter(DocumentChunk.document_id.in_(document_ids)).delete(synchronize_session=False)
        # Delete deletion requests
        db.query(DocumentDeletionRequest).filter(DocumentDeletionRequest.document_id.in_(document_ids)).delete(synchronize_session=False)
        # Delete documents
        db.query(Document).filter(Document.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 6. Delete containers
    db.query(Container).filter(Container.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 7. Delete workspace members
    db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 8. Delete audit logs (not sure if you guys want to keep these or not)
    from models.audit_log import AuditLog
    db.query(AuditLog).filter(AuditLog.workspace_id == workspace_id).delete(synchronize_session=False)
    
    # 9. And finally delete the workspace itself
    db.delete(workspace)
    db.commit()
    
    return SuccessResponse()


@router.get("/{workspace_id}/members", response_model=WorkspaceMemberListResponse)
async def list_workspace_members(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists members of a workspace"""
    
    require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)
    
    members = db.query(WorkspaceMember, User).join(
        User, WorkspaceMember.user_id == User.id
    ).filter(
        WorkspaceMember.workspace_id == workspace_id
    ).all()
    
    return WorkspaceMemberListResponse(
        items=[build_member_response(m, u) for m, u in members]
    )


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberResponse)
async def add_workspace_member(
    workspace_id: int,
    request: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Adds a user to a workspace"""
    
    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        required_roles=[WorkspaceRole.OWNER],
    )
    
    # Find user by ID, email, or username (case-insensitive for email/username)
    lookup_value = (request.email_or_user_id or "").strip()
    if lookup_value.isdigit():
        target_user = db.query(User).filter(User.id == int(lookup_value)).first()
    else:
        lowered_lookup = lookup_value.lower()
        target_user = db.query(User).filter(
            (func.lower(User.email) == lowered_lookup) | (func.lower(User.username) == lowered_lookup)
        ).first()
    
    if not target_user:
        raise AppError(
            code="MEMBER_NOT_FOUND",
            message="Unable to invite member. No user was found with that email, username, or ID.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    
    # Check if already a member
    existing = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == target_user.id
    ).first()
    
    if existing:
        if existing.status == MemberStatus.ACTIVE:
            raise AppError(
                code="MEMBER_EXISTS",
                message="User is already a member of this workspace.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if existing.status == MemberStatus.PENDING:
            raise AppError(
                code="INVITATION_ALREADY_PENDING",
                message="This user already has a pending invitation.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        existing.role = WorkspaceRole(request.role)
        existing.status = MemberStatus.PENDING
        member = existing
    else:
        member = WorkspaceMember(
            workspace_id=workspace_id,
            user_id=target_user.id,
            role=WorkspaceRole(request.role),
            status=MemberStatus.PENDING
        )
        db.add(member)

    db.commit()
    db.refresh(member)
    
    create_audit_log(
        db,
        current_user,
        AuditActions.WORKSPACE_INVITE_SENT,
        "workspace_member",
        member.id,
        metadata={
            "workspace_id": workspace_id,
            "invited_user_id": target_user.id,
            "invited_user_email": target_user.email,
            "invited_role": member.role.value if hasattr(member.role, "value") else str(member.role),
        },
        workspace_id=workspace_id,
    )
    
    return build_member_response(member, target_user)


@router.put("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberResponse)
async def update_workspace_member(
    workspace_id: int,
    user_id: int,
    request: UpdateMemberRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates a member's role or status"""
    

    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        required_roles=[WorkspaceRole.OWNER],
    )

    check_workspace_access(current_user, workspace_id, db)

    current_member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).first()

    if not current_member or current_member.role != WorkspaceRole.OWNER:
        raise AppError(
            code="INSUFFICIENT_PERMISSIONS",
            message="Only workspace owners can change member roles.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise AppError(
            code="MEMBER_NOT_FOUND",
            message="Member not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    if request.role:
        member.role = WorkspaceRole(request.role)
    if request.status:
        member.status = MemberStatus(request.status)
    
    db.commit()
    db.refresh(member)
    
    create_audit_log(db, current_user, "workspace.member_updated", "workspace_member", member.id, workspace_id=workspace_id)
    
    updated_user = db.query(User).filter(User.id == member.user_id).first()
    return build_member_response(member, updated_user)


@router.delete("/{workspace_id}/members/{user_id}", response_model=SuccessResponse)
async def remove_workspace_member(
    workspace_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Removes a user from a workspace"""
    

    require_workspace_access(
        workspace_id=workspace_id,
        user=current_user,
        db=db,
        required_roles=[WorkspaceRole.OWNER],
    )

    # Check if user is a member of the workspace
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    
    current_member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()
    
    if not current_member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    
    # Check if current user has permission to delete members (must be owner)
    if current_member.role != WorkspaceRole.OWNER:
        raise AppError(
            code="INSUFFICIENT_PERMISSIONS",
            message="Only workspace owners can remove members from this workspace.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    
    # Find the member to delete
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise AppError(
            code="MEMBER_NOT_FOUND",
            message="Member not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    db.delete(member)
    db.commit()
    
    create_audit_log(db, current_user, "workspace.member_removed", "workspace_member", user_id, workspace_id=workspace_id)
    
    return SuccessResponse()
