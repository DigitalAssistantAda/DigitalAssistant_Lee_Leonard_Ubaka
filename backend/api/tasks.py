from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime

from database import get_db
from models.task import Task, TaskType, TaskStatus, TaskPriority
from models.task_assignee import TaskAssignee
from models.workspace import WorkspaceMember, MemberStatus
from schemas.task import TaskCreate, TaskUpdate, TaskResponse, TaskListResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/tasks", tags=["tasks"])


def require_workspace_member(workspace_id: int, user_id: int, db: Session) -> None:
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id,
        WorkspaceMember.status == MemberStatus.ACTIVE,
    ).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")


def normalize_assignees(assignees: list[int] | None, assigned_to: int | None) -> list[int]:
    if assignees:
        return list(dict.fromkeys([value for value in assignees if value is not None]))
    if assigned_to is not None:
        return [assigned_to]
    return []


def fetch_task_assignees(db: Session, task_ids: list[int]) -> dict[int, list[int]]:
    if not task_ids:
        return {}
    rows = db.query(TaskAssignee.task_id, TaskAssignee.user_id).filter(
        TaskAssignee.task_id.in_(task_ids)
    ).all()
    grouped: dict[int, list[int]] = {task_id: [] for task_id in task_ids}
    for task_id, user_id in rows:
        grouped.setdefault(task_id, []).append(user_id)
    return grouped


def build_task_response(task: Task, assignees: list[int]) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        workspace_id=task.workspace_id,
        title=task.title,
        description=task.description,
        type=task.type.value if hasattr(task.type, "value") else task.type,
        status=task.status.value if hasattr(task.status, "value") else task.status,
        priority=task.priority.value if hasattr(task.priority, "value") else task.priority,
        assigned_to=task.assigned_to,
        assignees=assignees,
        due_date=task.due_date,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.post("/{workspace_id}", response_model=TaskResponse)
def create_task(
    workspace_id: int,
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Create a new task (issue or deadline) in a workspace."""
    require_workspace_member(workspace_id, current_user.id, db)

    try:
        task_type = TaskType(task_data.type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task type")

    try:
        task_status = TaskStatus(task_data.status or TaskStatus.OPEN.value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task status")

    task_priority = None
    if task_data.priority:
        try:
            task_priority = TaskPriority(task_data.priority)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task priority")

    assignees = normalize_assignees(task_data.assignees, task_data.assigned_to)
    for assignee_id in assignees:
        require_workspace_member(workspace_id, assignee_id, db)
    
    task = Task(
        workspace_id=workspace_id,
        title=task_data.title,
        description=task_data.description,
        type=task_type,
        status=task_status,
        priority=task_priority,
        assigned_to=assignees[0] if assignees else task_data.assigned_to,
        due_date=task_data.due_date,
        created_by=current_user.id,
    )
    db.add(task)
    db.flush()

    for assignee_id in assignees:
        db.add(TaskAssignee(task_id=task.id, user_id=assignee_id))

    db.commit()
    db.refresh(task)
    return build_task_response(task, assignees)


@router.get("/{workspace_id}", response_model=TaskListResponse)
def list_tasks(
    workspace_id: int,
    task_type: str = Query(None, description="Filter by type: 'issue' or 'deadline'"),
    status: str = Query(None, description="Filter by status"),
    assigned_to: str = Query(None, description="Filter by assigned user ID or 'me'"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List tasks in a workspace with optional filtering."""
    require_workspace_member(workspace_id, current_user.id, db)
    
    query = db.query(Task).filter(Task.workspace_id == workspace_id)
    
    if task_type:
        try:
            query = query.filter(Task.type == TaskType(task_type))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task type")
    if status:
        try:
            query = query.filter(Task.status == TaskStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task status")
    if assigned_to:
        if assigned_to == "me":
            query = query.outerjoin(TaskAssignee, TaskAssignee.task_id == Task.id).filter(
                or_(TaskAssignee.user_id == current_user.id, Task.assigned_to == current_user.id)
            )
        else:
            try:
                assignee_id = int(assigned_to)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid assigned_to filter")
            query = query.outerjoin(TaskAssignee, TaskAssignee.task_id == Task.id).filter(
                or_(TaskAssignee.user_id == assignee_id, Task.assigned_to == assignee_id)
            )
        query = query.distinct()
    
    total = query.count()
    tasks = query.order_by(Task.created_at.desc()).offset(skip).limit(limit).all()

    assignees_map = fetch_task_assignees(db, [task.id for task in tasks])
    items = []
    for task in tasks:
        assignees = assignees_map.get(task.id) or ([task.assigned_to] if task.assigned_to else [])
        items.append(build_task_response(task, assignees))

    return TaskListResponse(items=items, total=total)


@router.get("/{workspace_id}/{task_id}", response_model=TaskResponse)
def get_task(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get a specific task."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    assignees_map = fetch_task_assignees(db, [task.id])
    assignees = assignees_map.get(task.id) or ([task.assigned_to] if task.assigned_to else [])
    return build_task_response(task, assignees)


@router.put("/{workspace_id}/{task_id}", response_model=TaskResponse)
def update_task(
    workspace_id: int,
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update a task."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # TODO: Verify user has permission to update (owner or admin)
    
    update_data = task_data.dict(exclude_unset=True)

    if "status" in update_data:
        try:
            update_data["status"] = TaskStatus(update_data["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task status")

    if "priority" in update_data and update_data["priority"] is not None:
        try:
            update_data["priority"] = TaskPriority(update_data["priority"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task priority")

    assignees = None
    if "assignees" in update_data:
        assignees = update_data.pop("assignees") or []
    elif "assigned_to" in update_data:
        assignees = [update_data["assigned_to"]] if update_data["assigned_to"] is not None else []

    if assignees is not None:
        normalized = normalize_assignees(assignees, None)
        for assignee_id in normalized:
            require_workspace_member(workspace_id, assignee_id, db)
        update_data["assigned_to"] = normalized[0] if normalized else None

    for field, value in update_data.items():
        setattr(task, field, value)

    if assignees is not None:
        db.query(TaskAssignee).filter(TaskAssignee.task_id == task.id).delete()
        for assignee_id in normalize_assignees(assignees, None):
            db.add(TaskAssignee(task_id=task.id, user_id=assignee_id))
    
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    assignees_map = fetch_task_assignees(db, [task.id])
    assignees = assignees_map.get(task.id) or ([task.assigned_to] if task.assigned_to else [])
    return build_task_response(task, assignees)


@router.delete("/{workspace_id}/{task_id}")
def delete_task(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Delete a task."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # TODO: Verify user has permission to delete
    
    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}
