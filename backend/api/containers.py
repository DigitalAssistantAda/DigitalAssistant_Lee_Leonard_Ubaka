from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
from models.container import Container
from models.document import Document, DocumentStatus
from models.user import User
from models.workspace import WorkspaceMember, MemberStatus, WorkspaceRole
from schemas.container import CreateContainerRequest, ContainerResponse, ContainerListResponse, MoveContainerRequest, UpdateContainerRequest
from utils.auth import get_current_user, create_audit_log
from utils.authorization import require_workspace_access
from schemas.auth import SuccessResponse
from errors import AppError
from utils.workspace_members import active_workspace_member_ids
from realtime import connection_manager

router = APIRouter()


def _container_to_response(
    db: Session,
    container: Container,
    user_map: dict[int, str] | None = None,
) -> ContainerResponse:
    """Build ContainerResponse with created_by_username populated."""
    username = None
    if user_map is not None:
        username = user_map.get(container.created_by)
    else:
        user = db.query(User).filter(User.id == container.created_by).first()
        username = user.username if user else None
    return ContainerResponse(
        id=container.id,
        name=container.name,
        is_workspace_default=container.is_workspace_default,
        color=container.color,
        workspace_id=container.workspace_id,
        parent_container_id=container.parent_container_id,
        created_by=container.created_by,
        created_by_username=username,
        created_at=container.created_at,
    )


async def _notify_containers_changed(db: Session, workspace_id: int | None, actor_user_id: int) -> None:
    if workspace_id is not None:
        user_ids = active_workspace_member_ids(db, workspace_id)
    else:
        user_ids = [actor_user_id]

    for user_id in user_ids:
        await connection_manager.send_to_user(
            user_id,
            {
                "type": "containers.changed",
                "payload": {"workspace_id": workspace_id},
            },
        )
        await connection_manager.send_to_user(
            user_id,
            {
                "type": "workspaces.changed",
                "payload": {"workspace_id": workspace_id},
            },
        )


def _validate_parent_container(
    db: Session,
    current_user: User,
    workspace_id: int | None,
    parent_container_id: int | None,
) -> Container | None:
    if parent_container_id is None:
        return None

    parent_container = db.query(Container).filter(Container.id == parent_container_id).first()
    if not parent_container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Parent container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if parent_container.workspace_id is not None:
        require_workspace_access(workspace_id=parent_container.workspace_id, user=current_user, db=db)
    elif parent_container.created_by != current_user.id:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Parent container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if parent_container.workspace_id != workspace_id:
        raise AppError(
            code="INVALID_PARENT_CONTAINER",
            message="Nested folders must stay within the same workspace scope.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    return parent_container


def _validate_hierarchy_move(
    db: Session,
    container: Container,
    parent_container_id: int | None,
) -> Container | None:
    if parent_container_id is None:
        return None
    if parent_container_id == container.id:
        raise AppError(
            code="INVALID_PARENT_CONTAINER",
            message="A folder cannot be nested under itself.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    parent_container = db.query(Container).filter(Container.id == parent_container_id).first()
    if not parent_container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Parent container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if parent_container.workspace_id != container.workspace_id:
        raise AppError(
            code="INVALID_PARENT_CONTAINER",
            message="Nested folders must stay within the same workspace scope.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    cursor = parent_container
    safety = 0
    while cursor and safety < 200:
        if cursor.id == container.id:
            raise AppError(
                code="INVALID_PARENT_CONTAINER",
                message="Nested folders cannot create circular hierarchies.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if cursor.parent_container_id is None:
            break
        cursor = db.query(Container).filter(Container.id == cursor.parent_container_id).first()
        safety += 1

    return parent_container


# Create a container (top-level) - workspace_id may be provided in body
@router.post("/containers", response_model=ContainerResponse, tags=["Containers"])
async def create_container(
    request: CreateContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # If workspace_id provided, ensure access
    if request.workspace_id:
        require_workspace_access(workspace_id=request.workspace_id, user=current_user, db=db)

    _validate_parent_container(
        db=db,
        current_user=current_user,
        workspace_id=request.workspace_id,
        parent_container_id=request.parent_container_id,
    )

    container = Container(
        workspace_id=request.workspace_id,
        parent_container_id=request.parent_container_id,
        name=request.name,
        is_workspace_default=False,
        color=request.color,
        created_by=current_user.id,
    )
    db.add(container)
    db.commit()
    db.refresh(container)

    create_audit_log(db, current_user, "container.created", "container", container.id, workspace_id=container.workspace_id)
    await _notify_containers_changed(db, container.workspace_id, current_user.id)

    return _container_to_response(db, container)


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

    user_ids = {c.created_by for c in containers}
    user_map = {}
    if user_ids:
        for row in db.query(User.id, User.username).filter(User.id.in_(user_ids)):
            user_map[row.id] = row.username
    return ContainerListResponse(items=[_container_to_response(db, c, user_map) for c in containers])


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
        raise AppError(
            code="WORKSPACE_ID_MISMATCH",
            message="Workspace selection is invalid for this request.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Check access
    require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)

    _validate_parent_container(
        db=db,
        current_user=current_user,
        workspace_id=workspace_id,
        parent_container_id=request.parent_container_id,
    )

    container = Container(
        workspace_id=workspace_id,
        parent_container_id=request.parent_container_id,
        name=request.name,
        is_workspace_default=False,
        color=request.color,
        created_by=current_user.id,
    )
    db.add(container)
    db.commit()
    db.refresh(container)

    create_audit_log(db, current_user, "container.created", "container", container.id, workspace_id=workspace_id)
    await _notify_containers_changed(db, workspace_id, current_user.id)

    return _container_to_response(db, container)


# List containers for a workspace
@router.get("/workspaces/{workspace_id}/containers", response_model=ContainerListResponse, tags=["Containers"])
async def list_workspace_containers(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)
    containers = db.query(Container).filter(Container.workspace_id == workspace_id).all()
    user_ids = {c.created_by for c in containers}
    user_map = {}
    if user_ids:
        for row in db.query(User.id, User.username).filter(User.id.in_(user_ids)):
            user_map[row.id] = row.username
    return ContainerListResponse(items=[_container_to_response(db, c, user_map) for c in containers])


@router.delete("/containers/{container_id}", response_model=SuccessResponse, tags=["Containers"])
async def delete_container(
    container_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    # If container belongs to a workspace, ensure user is a member
    if container.workspace_id:
        require_workspace_access(workspace_id=container.workspace_id, user=current_user, db=db)
        if container.is_workspace_default:
            raise AppError(
                code="DEFAULT_CONTAINER_LOCKED",
                message="The workspace default folder is linked to the workspace and cannot be deleted.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        # Only the creator (user Ada created it for), admins, or owners may delete workspace containers
        if container.created_by != current_user.id:
            require_workspace_access(
                workspace_id=container.workspace_id,
                user=current_user,
                db=db,
                required_roles=[WorkspaceRole.ADMIN, WorkspaceRole.OWNER],
                insufficient_permissions_detail="Only the container creator, workspace admins, or owners can delete containers",
            )
    else:
        # top-level container: only creator can delete
        if container.created_by != current_user.id:
            raise AppError(
                code="CONTAINER_NOT_ACCESSIBLE",
                message="Container not found or you do not have access.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    # Pre-check: container must be empty (no non-deleted documents)
    doc_count = db.query(Document).filter(
        Document.container_id == container_id,
        Document.status != DocumentStatus.DELETED,
    ).count()
    if doc_count > 0:
        raise AppError(
            code="CONTAINER_NOT_EMPTY",
            message=f"Container cannot be deleted because it contains {doc_count} document(s). Remove or move documents first.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    workspace_id = container.workspace_id
    db.query(Container).filter(Container.parent_container_id == container.id).update(
        {Container.parent_container_id: None},
        synchronize_session=False,
    )
    db.delete(container)
    db.commit()

    create_audit_log(db, current_user, "container.deleted", "container", container_id, workspace_id=workspace_id)
    await _notify_containers_changed(db, workspace_id, current_user.id)

    return SuccessResponse()


@router.delete("/workspaces/{workspace_id}/containers/{container_id}", response_model=SuccessResponse, tags=["Containers"])
async def delete_workspace_container(
    workspace_id: int,
    container_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify workspace access
    require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)

    container = db.query(Container).filter(Container.id == container_id, Container.workspace_id == workspace_id).first()
    if not container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if container.is_workspace_default:
        raise AppError(
            code="DEFAULT_CONTAINER_LOCKED",
            message="The workspace default folder is linked to the workspace and cannot be deleted.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Only the creator (user Ada created it for), admins, or owners may delete workspace containers
    if container.created_by != current_user.id:
        require_workspace_access(
            workspace_id=workspace_id,
            user=current_user,
            db=db,
            required_roles=[WorkspaceRole.ADMIN, WorkspaceRole.OWNER],
            insufficient_permissions_detail="Only the container creator, workspace admins, or owners can delete containers",
        )

    # Pre-check: container must be empty (no non-deleted documents)
    doc_count = db.query(Document).filter(
        Document.container_id == container_id,
        Document.status != DocumentStatus.DELETED,
    ).count()
    if doc_count > 0:
        raise AppError(
            code="CONTAINER_NOT_EMPTY",
            message=f"Container cannot be deleted because it contains {doc_count} document(s). Remove or move documents first.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    db.query(Container).filter(Container.parent_container_id == container.id).update(
        {Container.parent_container_id: None},
        synchronize_session=False,
    )
    db.delete(container)
    db.commit()

    create_audit_log(db, current_user, "container.deleted", "container", container_id, workspace_id=workspace_id)
    await _notify_containers_changed(db, workspace_id, current_user.id)

    return SuccessResponse()


@router.put("/containers/{container_id}/move", response_model=ContainerResponse, tags=["Containers"])
async def move_container(
    container_id: int,
    request: MoveContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if container.workspace_id is not None:
        require_workspace_access(workspace_id=container.workspace_id, user=current_user, db=db)
        if container.is_workspace_default and request.parent_container_id is not None:
            raise AppError(
                code="DEFAULT_CONTAINER_LOCKED",
                message="The workspace default folder must remain at the workspace root.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
    elif container.created_by != current_user.id:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    parent_container = _validate_hierarchy_move(db, container, request.parent_container_id)

    if parent_container is not None:
        if parent_container.workspace_id is not None:
            require_workspace_access(workspace_id=parent_container.workspace_id, user=current_user, db=db)
        elif parent_container.created_by != current_user.id:
            raise AppError(
                code="CONTAINER_NOT_ACCESSIBLE",
                message="Parent container not found or you do not have access.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

    old_parent = container.parent_container_id
    container.parent_container_id = request.parent_container_id
    db.commit()
    db.refresh(container)

    create_audit_log(
        db,
        current_user,
        "container.moved",
        "container",
        container.id,
        metadata={
            "old_parent_container_id": old_parent,
            "new_parent_container_id": request.parent_container_id,
        },
        workspace_id=container.workspace_id,
    )
    await _notify_containers_changed(db, container.workspace_id, current_user.id)

    return _container_to_response(db, container)


@router.put("/workspaces/{workspace_id}/containers/{container_id}/move", response_model=ContainerResponse, tags=["Containers"])
async def move_workspace_container(
    workspace_id: int,
    container_id: int,
    request: MoveContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_workspace_access(workspace_id=workspace_id, user=current_user, db=db)
    container = db.query(Container).filter(
        Container.id == container_id,
        Container.workspace_id == workspace_id,
    ).first()
    if not container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if container.is_workspace_default and request.parent_container_id is not None:
        raise AppError(
            code="DEFAULT_CONTAINER_LOCKED",
            message="The workspace default folder must remain at the workspace root.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    _validate_hierarchy_move(db, container, request.parent_container_id)

    old_parent = container.parent_container_id
    container.parent_container_id = request.parent_container_id
    db.commit()
    db.refresh(container)

    create_audit_log(
        db,
        current_user,
        "container.moved",
        "container",
        container.id,
        metadata={
            "old_parent_container_id": old_parent,
            "new_parent_container_id": request.parent_container_id,
        },
        workspace_id=workspace_id,
    )
    await _notify_containers_changed(db, workspace_id, current_user.id)

    return _container_to_response(db, container)


@router.put("/containers/{container_id}", response_model=ContainerResponse, tags=["Containers"])
async def update_container(
    container_id: int,
    request: UpdateContainerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if container.workspace_id is not None:
        require_workspace_access(workspace_id=container.workspace_id, user=current_user, db=db)
        if container.created_by != current_user.id:
            require_workspace_access(
                workspace_id=container.workspace_id,
                user=current_user,
                db=db,
                required_roles=[WorkspaceRole.ADMIN, WorkspaceRole.OWNER],
                insufficient_permissions_detail="Only the container creator, workspace admins, or owners can edit containers",
            )
    elif container.created_by != current_user.id:
        raise AppError(
            code="CONTAINER_NOT_ACCESSIBLE",
            message="Container not found or you do not have access.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    if request.name is not None:
        next_name = request.name.strip()
        if not next_name:
            raise AppError(
                code="INVALID_CONTAINER_NAME",
                message="Container name cannot be empty.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if container.is_workspace_default and next_name != container.name:
            raise AppError(
                code="DEFAULT_CONTAINER_LOCKED",
                message="The workspace default folder name is linked to workspace name and cannot be edited directly.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        container.name = next_name

    if request.color is not None:
        container.color = request.color

    db.commit()
    db.refresh(container)

    create_audit_log(
        db,
        current_user,
        "container.updated",
        "container",
        container.id,
        workspace_id=container.workspace_id,
    )
    await _notify_containers_changed(db, container.workspace_id, current_user.id)

    return _container_to_response(db, container)
