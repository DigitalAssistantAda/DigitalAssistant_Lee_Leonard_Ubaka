"""
Authorization utilities - Permission checks and access control
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from models.user import User
from models.workspace import WorkspaceMember, WorkspaceRole, MemberStatus
from models.document import Document
from typing import Optional
from errors import AppError


class PermissionDenied(HTTPException):
    """Raised when user doesn't have permission"""
    def __init__(self, detail: str = "Permission denied"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail
        )


class NotFound(HTTPException):
    """Raised when resource not found"""
    def __init__(self, detail: str = "Not found"):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail
        )


def check_workspace_access(
    user: User,
    workspace_id: int,
    db: Session,
    required_role: Optional[WorkspaceRole] = None
) -> WorkspaceMember:
    """
    Verify user has access to workspace with optional role check.
    
    Args:
        user: Current authenticated user
        workspace_id: Workspace to check access for
        db: Database session
        required_role: Minimum role required (owner, admin, member)
        
    Returns:
        WorkspaceMember record if authorized
        
    Raises:
        AppError: If user doesn't have access, workspace doesn't exist, or role is insufficient
    """
    # Verify workspace exists
    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id
    ).first()
    
    if not workspace:
        raise AppError(
            code="WORKSPACE_NOT_ACCESSIBLE",
            message="Workspace not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    # Check workspace membership
    membership = db.query(WorkspaceMember).filter(
        (WorkspaceMember.workspace_id == workspace_id) &
        (WorkspaceMember.user_id == user.id)
    ).first()
    
    if not membership or membership.status != MemberStatus.ACTIVE:
        raise AppError(
            code="WORKSPACE_NOT_ACCESSIBLE",
            message="Workspace not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    # Check role requirement if specified
    if required_role:
        role_hierarchy = {
            WorkspaceRole.OWNER: 3,
            WorkspaceRole.ADMIN: 2,
            WorkspaceRole.MEMBER: 1
        }
        
        user_role_level = role_hierarchy.get(membership.role, 0)
        required_level = role_hierarchy.get(required_role, 0)
        
        if user_role_level < required_level:
            raise AppError(
                code="WORKSPACE_PERMISSION_DENIED",
                message="You do not have permission to perform this action in this workspace.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
    
    return membership


def check_document_access(
    user: User,
    document_id: int,
    db: Session,
    check_ownership: bool = False
) -> Document:
    """
    Verify user has access to document in their workspace.
    
    Args:
        user: Current authenticated user
        document_id: Document to check access for
        db: Database session
        check_ownership: If True, user must be the uploader
        
    Returns:
        Document record if authorized
        
    Raises:
        AppError: If user doesn't have access, document doesn't exist, or isn't owner
    """
    # Get document and verify it belongs to user's accessible workspace
    document = db.query(Document).filter(
        Document.id == document_id
    ).first()
    
    if not document:
        raise AppError(
            code="DOCUMENT_NOT_ACCESSIBLE",
            message="Document not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    # Verify user has access to document's workspace.
    # Documents stored in personal containers may not be workspace-scoped.
    if document.workspace_id is not None:
        try:
            check_workspace_access(user, document.workspace_id, db)
        except AppError:
            raise AppError(
                code="DOCUMENT_NOT_ACCESSIBLE",
                message="Document not found or you do not have access.",
                status_code=status.HTTP_404_NOT_FOUND,
            )
    elif document.uploaded_by != user.id:
        raise AppError(
            code="DOCUMENT_NOT_ACCESSIBLE",
            message="Document not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    
    # Check ownership if required
    if check_ownership and document.uploaded_by != user.id:
        raise AppError(
            code="DOCUMENT_PERMISSION_DENIED",
            message="You do not have permission to modify this document.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    
    return document


def require_workspace_access(
    user: User,
    workspace_id: int,
    db: Session,
    required_roles: Optional[list[WorkspaceRole]] = None,
    not_member_detail: str = "Not a member of this workspace",
    insufficient_permissions_detail: str = "Insufficient permissions",
    check_workspace_exists: bool = True,
) -> Optional["Workspace"]:
    workspace = None
    if check_workspace_exists:
        workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
        if not workspace:
            raise AppError(
                code="WORKSPACE_NOT_ACCESSIBLE",
                message="Workspace not found or you do not have access.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    membership = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).first()

    if not membership:
        raise AppError(
            code="WORKSPACE_NOT_ACCESSIBLE",
            message="Workspace not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if required_roles and membership.role not in required_roles:
        raise AppError(
            code="WORKSPACE_PERMISSION_DENIED",
            message="You do not have permission to perform this action in this workspace.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    return workspace


# Import Workspace after defining check functions to avoid circular imports
from models.workspace import Workspace
