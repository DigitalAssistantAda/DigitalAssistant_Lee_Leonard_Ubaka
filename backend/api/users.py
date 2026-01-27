from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from schemas.auth import SuccessResponse
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
