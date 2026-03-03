from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.user_preference import UserPreference
from schemas.auth import SuccessResponse, UserResponse
from schemas.user_preferences import (
    UserPreferencesResponse,
    UpdateUserPreferencesRequest,
    DismissNotificationsRequest,
)
from schemas.user import UpdateUserRequest
from utils.auth import get_current_user, create_audit_log

router = APIRouter(prefix="/users", tags=["Users"])


@router.delete("/me", response_model=SuccessResponse)
async def delete_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Soft deletes the authenticated user account"""
    
    current_user.is_deleted = True
    current_user.is_active = False
    db.commit()
    
    # Create audit log
    create_audit_log(db, current_user, "user.deleted", "user", current_user.id)
    
    return SuccessResponse()


@router.put("/me", response_model=UserResponse)
async def update_me(
    request: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update account profile fields for the authenticated user"""

    if "email" in request.model_fields_set and request.email != current_user.email:
        existing = db.query(User).filter(User.email == request.email, User.id != current_user.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is already in use"
            )
        current_user.email = request.email

    if "username" in request.model_fields_set and request.username != current_user.username:
        existing = db.query(User).filter(User.username == request.username, User.id != current_user.id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is already in use"
            )
        current_user.username = request.username

    if "status_message" in request.model_fields_set:
        current_user.status_message = request.status_message

    db.commit()
    db.refresh(current_user)

    create_audit_log(db, current_user, "user.profile_updated", "user", current_user.id)

    return UserResponse.model_validate(current_user)


@router.get("/preferences", response_model=UserPreferencesResponse)
async def get_preferences(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get UI preferences for the authenticated user"""

    preferences = db.query(UserPreference).filter(UserPreference.user_id == current_user.id).first()
    if not preferences:
        preferences = UserPreference(user_id=current_user.id, accent_color=None)
        db.add(preferences)
        db.commit()
        db.refresh(preferences)

    data = UserPreferencesResponse.model_validate(preferences).model_dump()
    if data.get("dismissed_notification_ids") is None:
        data["dismissed_notification_ids"] = {"deletion_request_ids": [], "mention_ids": []}
    return UserPreferencesResponse(**data)


@router.put("/preferences", response_model=UserPreferencesResponse)
async def update_preferences(
    request: UpdateUserPreferencesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update UI preferences for the authenticated user"""

    preferences = db.query(UserPreference).filter(UserPreference.user_id == current_user.id).first()
    if not preferences:
        preferences = UserPreference(user_id=current_user.id)
        db.add(preferences)

    preferences.accent_color = request.accent_color
    db.commit()
    db.refresh(preferences)

    create_audit_log(db, current_user, "user.preferences_updated", "user_preferences", current_user.id)

    data = UserPreferencesResponse.model_validate(preferences).model_dump()
    if data.get("dismissed_notification_ids") is None:
        data["dismissed_notification_ids"] = {"deletion_request_ids": [], "mention_ids": []}
    return UserPreferencesResponse(**data)


@router.post("/notifications-dismiss", response_model=UserPreferencesResponse)
async def dismiss_notifications(
    request: DismissNotificationsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark notification(s) as dismissed so they are hidden from the notifications list."""

    preferences = db.query(UserPreference).filter(UserPreference.user_id == current_user.id).first()
    if not preferences:
        preferences = UserPreference(user_id=current_user.id)
        db.add(preferences)
        db.flush()

    current = preferences.dismissed_notification_ids or {
        "deletion_request_ids": [],
        "mention_ids": [],
    }
    dr_ids = list(current.get("deletion_request_ids") or [])
    m_ids = list(current.get("mention_ids") or [])

    for rid in request.deletion_request_ids or []:
        if isinstance(rid, int) and rid not in dr_ids:
            dr_ids.append(rid)
    for mid in request.mention_ids or []:
        if isinstance(mid, str) and mid and mid not in m_ids:
            m_ids.append(mid)

    preferences.dismissed_notification_ids = {
        "deletion_request_ids": dr_ids,
        "mention_ids": m_ids,
    }
    db.commit()
    db.refresh(preferences)

    data = UserPreferencesResponse.model_validate(preferences).model_dump()
    if data.get("dismissed_notification_ids") is None:
        data["dismissed_notification_ids"] = {"deletion_request_ids": [], "mention_ids": []}
    return UserPreferencesResponse(**data)
