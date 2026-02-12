"""
Authorization utilities - Permission checks and access control
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from models.user import User
from models.workspace import WorkspaceMember, WorkspaceRole, MemberStatus
from models.document import Document
from typing import Optional


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
        PermissionDenied: If user doesn't have access or insufficient role
        NotFound: If workspace doesn't exist
    """
    # Verify workspace exists
    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id
    ).first()
    
    if not workspace:
        raise NotFound("Workspace not found")
    
    # Check workspace membership
    membership = db.query(WorkspaceMember).filter(
        (WorkspaceMember.workspace_id == workspace_id) &
        (WorkspaceMember.user_id == user.id)
    ).first()
    
    if not membership or membership.status != MemberStatus.ACTIVE:
        raise PermissionDenied("You don't have access to this workspace")
    
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
            raise PermissionDenied(
                f"This action requires {required_role.value} role"
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
        PermissionDenied: If user doesn't have access or isn't owner
        NotFound: If document doesn't exist
    """
    # Get document and verify it belongs to user's accessible workspace
    document = db.query(Document).filter(
        Document.id == document_id
    ).first()
    
    if not document:
        raise NotFound("Document not found")
    
    # Verify user has access to document's workspace
    check_workspace_access(user, document.workspace_id, db)
    
    # Check ownership if required
    if check_ownership and document.uploaded_by != user.id:
        raise PermissionDenied("You can only modify documents you uploaded")
    
    return document


# Import Workspace after defining check functions to avoid circular imports
from models.workspace import Workspace
