import json
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime, timezone

from database import get_db
from models.task import Task, TaskType, TaskStatus, TaskPriority
from models.task_assignee import TaskAssignee
from models.task_reminder import TaskReminder
from models.user import User
from models.workspace import WorkspaceMember, MemberStatus
from models.audit_log import AuditLog
from schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskListResponse,
    TaskHistoryItem,
    TaskHistoryListResponse,
)
from schemas.task_reminder import TaskRemindersListResponse
from utils.auth import get_current_user
from utils.audit import create_audit_log, AuditActions
from utils.task_reminder_generation import generate_and_persist_task_reminders
from realtime import connection_manager

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


def _assignee_set_for_task(db: Session, task: Task) -> set[int]:
    m = fetch_task_assignees(db, [task.id])
    ids = list(m.get(task.id) or [])
    s = set(ids)
    if task.assigned_to is not None:
        s.add(task.assigned_to)
    return s


def _status_str(st) -> str:
    return st.value if hasattr(st, "value") else str(st)


def _priority_str(pr) -> str | None:
    if pr is None:
        return None
    return pr.value if hasattr(pr, "value") else str(pr)


def _text_preview(value: str | None, max_len: int = 200) -> str:
    if not value:
        return ""
    t = value.strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _parse_audit_metadata(meta) -> dict:
    if meta is None:
        return {}
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        try:
            return json.loads(meta)
        except json.JSONDecodeError:
            return {}
    return {}


def _collect_task_history_changes(
    *,
    old_title: str,
    old_description: str | None,
    old_status: str,
    old_priority: str | None,
    old_due,
    old_assignees: set[int],
    task: Task,
    new_assignees: set[int],
) -> list[dict]:
    changes: list[dict] = []
    if task.title != old_title:
        changes.append({"field": "title", "old": old_title, "new": task.title})

    old_desc = old_description or ""
    new_desc = task.description or ""
    if new_desc != old_desc:
        changes.append(
            {
                "field": "description",
                "old_preview": _text_preview(old_desc),
                "new_preview": _text_preview(new_desc),
            }
        )

    if _status_str(task.status) != old_status:
        changes.append({"field": "status", "old": old_status, "new": _status_str(task.status)})

    if _priority_str(task.priority) != old_priority:
        changes.append(
            {
                "field": "priority",
                "old": old_priority,
                "new": _priority_str(task.priority),
            }
        )

    if task.due_date != old_due:
        changes.append(
            {
                "field": "due_date",
                "old": old_due.isoformat() if old_due else None,
                "new": task.due_date.isoformat() if task.due_date else None,
            }
        )

    if sorted(old_assignees) != sorted(new_assignees):
        changes.append(
            {
                "field": "assignees",
                "old": sorted(old_assignees),
                "new": sorted(new_assignees),
            }
        )

    return changes


def _append_task_history_entry(
    db: Session,
    actor: User,
    workspace_id: int,
    task_id: int,
    changes: list[dict],
) -> None:
    """Single activity-history row for the issue detail timeline (action task.history)."""
    if not changes:
        return
    create_audit_log(
        db,
        actor,
        action=AuditActions.TASK_HISTORY,
        object_type="task",
        object_id=task_id,
        metadata={
            "task_id": task_id,
            "workspace_id": workspace_id,
            "changes": changes,
        },
        workspace_id=workspace_id,
    )


async def _ping_notification_users(user_ids: set[int]) -> None:
    msg = {"type": "notifications.changed", "payload": {}}
    for uid in user_ids:
        await connection_manager.send_to_user(uid, msg)


async def _notify_task_deleted(
    db: Session,
    actor: User,
    workspace_id: int,
    task_id: int,
    task_title: str,
    recipient_ids: set[int],
) -> None:
    targets: set[int] = set()
    for uid in recipient_ids:
        if uid == actor.id:
            continue
        create_audit_log(
            db,
            actor,
            action=AuditActions.TASK_DELETED,
            object_type="task",
            object_id=task_id,
            metadata={
                "notified_user_id": uid,
                "task_id": task_id,
                "workspace_id": workspace_id,
                "task_title": task_title,
            },
            workspace_id=workspace_id,
        )
        targets.add(uid)
    await _ping_notification_users(targets)


async def _notify_new_task_assignees(
    db: Session,
    actor: User,
    workspace_id: int,
    task: Task,
    assignee_ids: list[int],
) -> None:
    targets: set[int] = set()
    for uid in assignee_ids:
        if uid == actor.id:
            continue
        create_audit_log(
            db,
            actor,
            action=AuditActions.TASK_ASSIGNED,
            object_type="task",
            object_id=task.id,
            metadata={
                "notified_user_id": uid,
                "task_id": task.id,
                "workspace_id": workspace_id,
                "task_title": task.title,
            },
            workspace_id=workspace_id,
        )
        targets.add(uid)
    await _ping_notification_users(targets)


async def _notify_task_updates(
    db: Session,
    actor: User,
    workspace_id: int,
    task: Task,
    old_assignees: set[int],
    new_assignees: set[int],
    old_title: str,
    old_description: str | None,
    old_status: str,
    old_priority: str | None,
    old_due,
) -> None:
    newly_added = new_assignees - old_assignees
    removed = old_assignees - new_assignees
    field_changed = (
        task.title != old_title
        or (task.description or "") != (old_description or "")
        or _status_str(task.status) != old_status
        or _priority_str(task.priority) != old_priority
        or task.due_date != old_due
    )

    ping: set[int] = set()

    for uid in newly_added:
        if uid == actor.id:
            continue
        create_audit_log(
            db,
            actor,
            action=AuditActions.TASK_ASSIGNED,
            object_type="task",
            object_id=task.id,
            metadata={
                "notified_user_id": uid,
                "task_id": task.id,
                "workspace_id": workspace_id,
                "task_title": task.title,
            },
            workspace_id=workspace_id,
        )
        ping.add(uid)

    if field_changed or removed:
        for uid in new_assignees:
            if uid == actor.id or uid in newly_added:
                continue
            create_audit_log(
                db,
                actor,
                action=AuditActions.TASK_UPDATED,
                object_type="task",
                object_id=task.id,
                metadata={
                    "notified_user_id": uid,
                    "task_id": task.id,
                    "workspace_id": workspace_id,
                    "task_title": task.title,
                },
                workspace_id=workspace_id,
            )
            ping.add(uid)

    await _ping_notification_users(ping)


def _active_reminder_lines_for_notify(
    db: Session,
    task_id: int,
    *,
    max_items: int = 8,
    content_max: int = 200,
) -> list[dict]:
    """Compact reminder rows for notification metadata (truncated content)."""
    rows = (
        db.query(TaskReminder)
        .filter(
            TaskReminder.task_id == task_id,
            TaskReminder.dismissed == False,
            TaskReminder.acknowledged_at.is_(None),
        )
        .order_by(TaskReminder.id.asc())
        .limit(max_items)
        .all()
    )
    out: list[dict] = []
    for r in rows:
        raw = (r.content or "").strip()
        if len(raw) > content_max:
            text = raw[: content_max - 1].rstrip() + "…"
        else:
            text = raw
        out.append(
            {
                "id": r.id,
                "hint_type": r.hint_type or "follow_up",
                "content": text,
            }
        )
    return out


async def _notify_task_reminders_generated(
    db: Session,
    actor: User,
    workspace_id: int,
    task: Task,
    reminder_count: int,
    reminder_lines: list[dict],
) -> None:
    """Notify assignees and creator when issue reminders are regenerated (excluding the actor)."""
    targets: set[int] = set()
    recipients = set(_assignee_set_for_task(db, task))
    if task.created_by is not None:
        recipients.add(task.created_by)
    recipients.discard(actor.id)
    for uid in recipients:
        create_audit_log(
            db,
            actor,
            action=AuditActions.TASK_REMINDERS_GENERATED,
            object_type="task",
            object_id=task.id,
            metadata={
                "notified_user_id": uid,
                "task_id": task.id,
                "workspace_id": workspace_id,
                "task_title": task.title,
                "reminder_count": reminder_count,
                "reminder_lines": reminder_lines,
            },
            workspace_id=workspace_id,
        )
        targets.add(uid)
    await _ping_notification_users(targets)


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
async def create_task(
    workspace_id: int,
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    await _notify_new_task_assignees(db, current_user, workspace_id, task, assignees)
    return build_task_response(task, assignees)


@router.get("/{workspace_id}", response_model=TaskListResponse)
def list_tasks(
    workspace_id: int,
    task_type: str = Query(None, description="Filter by type: 'issue' or 'deadline'"),
    status: str = Query(None, description="Filter by status"),
    assigned_to: str = Query(None, description="Filter by assigned user ID or 'me'"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
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
            requested_status = TaskStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid task status")

        if requested_status == TaskStatus.OVERDUE:
            now_utc = datetime.now(timezone.utc)
            query = query.filter(
                Task.due_date.isnot(None),
                Task.due_date < now_utc,
                Task.status.notin_([TaskStatus.COMPLETED, TaskStatus.CLOSED]),
            )
        else:
            query = query.filter(Task.status == requested_status)
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
    tasks = (
        query.order_by(Task.updated_at.desc(), Task.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

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


@router.get("/{workspace_id}/{task_id}/history", response_model=TaskHistoryListResponse)
def get_task_history(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Field-level change history for an issue (status, assignees, description, etc.)."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.workspace_id == workspace_id,
            AuditLog.object_type == "task",
            AuditLog.object_id == task_id,
            AuditLog.action == AuditActions.TASK_HISTORY,
        )
        .order_by(AuditLog.created_at.desc())
        .limit(200)
        .all()
    )

    items: list[TaskHistoryItem] = []
    for log in logs:
        meta = _parse_audit_metadata(log.metadata_json)
        changes = meta.get("changes") if isinstance(meta.get("changes"), list) else []
        items.append(
            TaskHistoryItem(
                id=log.id,
                actor_user_id=log.actor_user_id,
                created_at=log.created_at,
                changes=changes,
            )
        )

    return TaskHistoryListResponse(items=items)


@router.get(
    "/{workspace_id}/{task_id}/reminders",
    response_model=TaskRemindersListResponse,
)
def list_task_reminders(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Active reminders for an issue/task (workspace members only)."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    rows = (
        db.query(TaskReminder)
        .filter(
            TaskReminder.task_id == task_id,
            TaskReminder.dismissed == False,
            TaskReminder.acknowledged_at.is_(None),
        )
        .order_by(TaskReminder.created_at.desc())
        .all()
    )
    return TaskRemindersListResponse(
        reminders=rows,
        reminder_generation_error=task.reminders_generation_error,
    )


@router.post("/{workspace_id}/{task_id}/reminders/generate")
async def generate_task_reminders(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rebuild reminders from issue text + related workspace document excerpts."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        generate_and_persist_task_reminders(db, task, current_user.id)
        reminder_count = (
            db.query(TaskReminder)
            .filter(
                TaskReminder.task_id == task.id,
                TaskReminder.dismissed == False,
                TaskReminder.acknowledged_at.is_(None),
            )
            .count()
        )
        reminder_lines = _active_reminder_lines_for_notify(db, task.id)
        await _notify_task_reminders_generated(
            db, current_user, workspace_id, task, reminder_count, reminder_lines
        )
        _append_task_history_entry(
            db,
            current_user,
            workspace_id,
            task.id,
            [{"field": "reminders_regenerated", "reminder_count": reminder_count}],
        )
    except Exception:
        db.rollback()
        task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
        err_msg = "Reminders could not be generated. The issue is unchanged; try again later."
        if task:
            task.reminders_generation_error = err_msg
            db.commit()
        return {
            "message": "Reminder generation failed",
            "reminder_generation_error": err_msg,
        }

    return {"message": "Reminders updated", "reminder_generation_error": None}


@router.post("/{workspace_id}/{task_id}/reminders/{reminder_id}/acknowledge")
def acknowledge_task_reminder(
    workspace_id: int,
    task_id: int,
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    reminder = (
        db.query(TaskReminder)
        .filter(TaskReminder.id == reminder_id, TaskReminder.task_id == task_id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")

    reminder.acknowledged_by = current_user.id
    reminder.acknowledged_at = datetime.now(timezone.utc)
    create_audit_log(
        db,
        current_user,
        action=AuditActions.TASK_REMINDER_ACKNOWLEDGED,
        object_type="task_reminder",
        object_id=reminder.id,
        metadata={"task_id": task_id, "hint_type": reminder.hint_type},
        workspace_id=workspace_id,
    )
    _append_task_history_entry(
        db,
        current_user,
        workspace_id,
        task_id,
        [
            {
                "field": "reminder_acknowledged",
                "hint_type": reminder.hint_type,
                "preview": _text_preview(reminder.content),
            }
        ],
    )
    db.commit()
    return {"message": "Reminder acknowledged"}


@router.post("/{workspace_id}/{task_id}/reminders/{reminder_id}/dismiss")
def dismiss_task_reminder(
    workspace_id: int,
    task_id: int,
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    reminder = (
        db.query(TaskReminder)
        .filter(TaskReminder.id == reminder_id, TaskReminder.task_id == task_id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")

    reminder.dismissed = True
    reminder.dismissed_at = datetime.now(timezone.utc)
    create_audit_log(
        db,
        current_user,
        action=AuditActions.TASK_REMINDER_DISMISSED,
        object_type="task_reminder",
        object_id=reminder.id,
        metadata={"task_id": task_id, "hint_type": reminder.hint_type},
        workspace_id=workspace_id,
    )
    _append_task_history_entry(
        db,
        current_user,
        workspace_id,
        task_id,
        [
            {
                "field": "reminder_dismissed",
                "hint_type": reminder.hint_type,
                "preview": _text_preview(reminder.content),
            }
        ],
    )
    db.commit()
    return {"message": "Reminder dismissed"}


@router.put("/{workspace_id}/{task_id}", response_model=TaskResponse)
async def update_task(
    workspace_id: int,
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a task."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    old_assignees = _assignee_set_for_task(db, task)
    old_title = task.title
    old_description = task.description
    old_status = _status_str(task.status)
    old_priority = _priority_str(task.priority)
    old_due = task.due_date

    update_data = task_data.model_dump(exclude_unset=True)

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

    if assignees is not None:
        new_assignee_set = set(normalize_assignees(assignees, None))
    else:
        new_assignee_set = set(old_assignees)

    history_changes = _collect_task_history_changes(
        old_title=old_title,
        old_description=old_description,
        old_status=old_status,
        old_priority=old_priority,
        old_due=old_due,
        old_assignees=old_assignees,
        task=task,
        new_assignees=new_assignee_set,
    )

    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    assignees_map = fetch_task_assignees(db, [task.id])
    assignees = assignees_map.get(task.id) or ([task.assigned_to] if task.assigned_to else [])
    new_assignees = _assignee_set_for_task(db, task)

    notify = (
        new_assignees != old_assignees
        or task.title != old_title
        or (task.description or "") != (old_description or "")
        or _status_str(task.status) != old_status
        or _priority_str(task.priority) != old_priority
        or task.due_date != old_due
    )
    if notify:
        await _notify_task_updates(
            db,
            current_user,
            workspace_id,
            task,
            old_assignees,
            new_assignees,
            old_title,
            old_description,
            old_status,
            old_priority,
            old_due,
        )

    if history_changes:
        create_audit_log(
            db,
            current_user,
            action=AuditActions.TASK_HISTORY,
            object_type="task",
            object_id=task.id,
            metadata={
                "task_id": task.id,
                "workspace_id": workspace_id,
                "changes": history_changes,
            },
            workspace_id=workspace_id,
        )

    return build_task_response(task, assignees)


@router.delete("/{workspace_id}/{task_id}")
async def delete_task(
    workspace_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a task."""
    require_workspace_member(workspace_id, current_user.id, db)
    task = db.query(Task).filter(Task.workspace_id == workspace_id, Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    assignee_ids = _assignee_set_for_task(db, task)
    notify_ids = set(assignee_ids)
    if task.created_by is not None:
        notify_ids.add(task.created_by)
    title_snapshot = task.title
    id_snapshot = task.id

    db.delete(task)
    db.commit()

    await _notify_task_deleted(
        db,
        current_user,
        workspace_id,
        id_snapshot,
        title_snapshot,
        notify_ids,
    )
    return {"message": "Task deleted"}
