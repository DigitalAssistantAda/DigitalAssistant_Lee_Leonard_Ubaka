from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from models.task import Task, TaskType, TaskStatus, TaskPriority
from schemas.task import TaskCreate, TaskUpdate, TaskResponse, TaskListResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.post("/{workspace_id}", response_model=TaskResponse)
def create_task(
    workspace_id: int,
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new task (issue or deadline) in a workspace."""
    # TODO: Verify user is a member of the workspace
    
    task = Task(
        workspace_id=workspace_id,
        title=task_data.title,
        description=task_data.description,
        type=task_data.type,
        status=task_data.status or TaskStatus.OPEN.value,
        priority=task_data.priority,
        assigned_to=task_data.assigned_to,
        due_date=task_data.due_date,
        created_by=current_user["user_id"],
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("/{workspace_id}", response_model=TaskListResponse)
def list_tasks(
    workspace_id: int,
    task_type: str = Query(None, description="Filter by type: 'issue' or 'deadline'"),
    status: str = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List tasks in a workspace with optional filtering."""
    # TODO: Verify user is a member of the workspace
    
    query = db.query(Task).filter(Task.workspace_id == workspace_id)
    
    if task_type:
        query = query.filter(Task.type == task_type)
    if status:
        query = query.filter(Task.status == status)
    
    total = query.count()
    tasks = query.order_by(Task.created_at.desc()).offset(skip).limit(limit).all()
    
    return TaskListResponse(items=tasks, total=total)


@router.get("/{workspace_id}/{task_id}", response_model=TaskResponse)
def get_task(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get a specific task."""
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{workspace_id}/{task_id}", response_model=TaskResponse)
def update_task(
    workspace_id: int,
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a task."""
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # TODO: Verify user has permission to update (owner or admin)
    
    update_data = task_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)
    
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{workspace_id}/{task_id}")
def delete_task(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a task."""
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # TODO: Verify user has permission to delete
    
    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}
