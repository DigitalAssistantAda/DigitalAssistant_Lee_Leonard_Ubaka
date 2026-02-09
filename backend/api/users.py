from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.user_preference import UserPreference
from schemas.auth import SuccessResponse
from schemas.user_preferences import UserPreferencesResponse, UpdateUserPreferencesRequest
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


@router.get("/preferences", response_model=UserPreferencesResponse)
async def get_preferences(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get UI preferences for the authenticated user"""

    preferences = db.query(UserPreference).filter(UserPreference.user_id == current_user.id).first()
    if not preferences:
        preferences = UserPreference(user_id=current_user.id, accent_color=None)
        db.add(preferences)
        db.commit()
        db.refresh(preferences)

    return UserPreferencesResponse.model_validate(preferences)


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

    return UserPreferencesResponse.model_validate(preferences)
