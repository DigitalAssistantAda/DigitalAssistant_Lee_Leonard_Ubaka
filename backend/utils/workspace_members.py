"""
Shared helpers for workspace membership.
Used by api/workspaces, api/containers, api/documents to avoid duplication.
"""
from sqlalchemy.orm import Session

from models.workspace import WorkspaceMember, MemberStatus


def active_workspace_member_ids(db: Session, workspace_id: int) -> list[int]:
    """Return user IDs of active members in the workspace."""
    rows = db.query(WorkspaceMember.user_id).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).all()
    return [int(row.user_id) for row in rows]
