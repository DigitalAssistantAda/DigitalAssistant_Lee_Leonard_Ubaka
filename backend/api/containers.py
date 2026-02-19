from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from sqlalchemy import or_
from database import get_db
from models.container import Container
from models.user import User
from models.workspace import Workspace, WorkspaceMember, MemberStatus
from schemas.container import CreateContainerRequest, ContainerResponse, ContainerListResponse
from utils.auth import get_current_user, create_audit_log
from schemas.auth import SuccessResponse

router = APIRouter()


def check_workspace_access(workspace_id: int, user: User, db: Session) -> Workspace:
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id,
        WorkspaceMember.status == MemberStatus.ACTIVE
    ).first()

    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")

    return workspace


# Create a container (top-level) - workspace_id may be provided in body
@router.post("/containers", response_model=ContainerResponse, tags=["Containers"])
async def create_container(
    request: CreateContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # If workspace_id provided, ensure access
    if request.workspace_id:
        check_workspace_access(request.workspace_id, current_user, db)

    container = Container(
        workspace_id=request.workspace_id,
        name=request.name,
        color=request.color,
        created_by=current_user.id,
    )
    db.add(container)
    db.flush()
    db.commit()
    db.refresh(container)

    create_audit_log(db, current_user, "container.created", "container", container.id, workspace_id=container.workspace_id)

    return ContainerResponse.model_validate(container)


@router.get("/containers", response_model=ContainerListResponse, tags=["Containers"])
async def list_accessible_containers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member_workspace_ids = [
        row.workspace_id
        for row in db.query(WorkspaceMember.workspace_id).filter(
            WorkspaceMember.user_id == current_user.id,
            WorkspaceMember.status == MemberStatus.ACTIVE,
        ).all()
    ]

    if member_workspace_ids:
        containers = db.query(Container).filter(
            or_(
                Container.created_by == current_user.id,
                Container.workspace_id.in_(member_workspace_ids),
            )
        ).all()
    else:
        containers = db.query(Container).filter(
            Container.created_by == current_user.id
        ).all()

    return ContainerListResponse(items=[ContainerResponse.model_validate(c) for c in containers])


# Create a container inside a workspace (workspace-scoped path)
@router.post("/workspaces/{workspace_id}/containers", response_model=ContainerResponse, tags=["Containers"])
async def create_workspace_container(
    workspace_id: int,
    request: CreateContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Ensure the workspace path ID and body (if present) are consistent
    if request.workspace_id and request.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="workspace_id mismatch")

    # Check access
    check_workspace_access(workspace_id, current_user, db)

    container = Container(
        workspace_id=workspace_id,
        name=request.name,
        color=request.color,
        created_by=current_user.id,
    )
    db.add(container)
    db.flush()
    db.commit()
    db.refresh(container)

    create_audit_log(db, current_user, "container.created", "container", container.id, workspace_id=workspace_id)

    return ContainerResponse.model_validate(container)


# List containers for a workspace
@router.get("/workspaces/{workspace_id}/containers", response_model=ContainerListResponse, tags=["Containers"])
async def list_workspace_containers(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    check_workspace_access(workspace_id, current_user, db)
    containers = db.query(Container).filter(Container.workspace_id == workspace_id).all()
    return ContainerListResponse(items=[ContainerResponse.model_validate(c) for c in containers])


@router.delete("/containers/{container_id}", response_model=SuccessResponse, tags=["Containers"])
async def delete_container(
    container_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Container not found")

    # If container belongs to a workspace, ensure user is a member
    if container.workspace_id:
        check_workspace_access(container.workspace_id, current_user, db)
    else:
        # top-level container: only creator can delete
        if container.created_by != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    db.delete(container)
    db.commit()

    create_audit_log(db, current_user, "container.deleted", "container", container_id, workspace_id=container.workspace_id)

    return SuccessResponse()


@router.delete("/workspaces/{workspace_id}/containers/{container_id}", response_model=SuccessResponse, tags=["Containers"])
async def delete_workspace_container(
    workspace_id: int,
    container_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify workspace access
    check_workspace_access(workspace_id, current_user, db)

    container = db.query(Container).filter(Container.id == container_id, Container.workspace_id == workspace_id).first()
    if not container:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Container not found in workspace")

    db.delete(container)
    db.commit()

    create_audit_log(db, current_user, "container.deleted", "container", container_id, workspace_id=workspace_id)

    return SuccessResponse()
