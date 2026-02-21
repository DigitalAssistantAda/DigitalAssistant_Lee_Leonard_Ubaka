from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from schemas.auth import (
    RegisterRequest,
    RegisterResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    SuccessResponse,
    UserResponse,
)
from utils.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    get_current_user,
)
from utils.audit import create_audit_log, AuditActions
from utils.security import (
    check_rate_limit,
    check_lockout,
    record_failed_login,
    clear_failed_login,
)
from errors import AppError

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=RegisterResponse)
async def register(request: RegisterRequest, request_context: Request, db: Session = Depends(get_db)):
    """Register a new user"""
    client_ip = request_context.client.host if request_context.client else "unknown"
    check_rate_limit(f"register:{client_ip}", limit=5, window_seconds=300)
    
    # Check if user already exists
    existing_user = db.query(User).filter(
        (User.email == request.email) | (User.username == request.username)
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email or username already exists"
        )
    
    # Create user
    hashed_password = get_password_hash(request.password)
    user = User(
        email=request.email,
        username=request.username,
        hashed_password=hashed_password
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Create tokens
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})
    
    # Create audit log
    create_audit_log(
        db,
        user,
        action=AuditActions.USER_REGISTERED,
        object_type="user",
        object_id=user.id,
        metadata={"email": user.email, "username": user.username}
    )
    
    return RegisterResponse(
        user=UserResponse.model_validate(user),
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, request_context: Request, db: Session = Depends(get_db)):
    """Authenticate a user and return access credentials"""
    client_ip = request_context.client.host if request_context.client else "unknown"
    check_rate_limit(f"login:{client_ip}", limit=10, window_seconds=300)
    check_lockout(f"login:{request.email_or_username.lower()}:{client_ip}")
    
    # Find user by email or username
    user = db.query(User).filter(
        (User.email == request.email_or_username) | (User.username == request.email_or_username)
    ).first()
    
    if not user:
        record_failed_login(f"login:{request.email_or_username.lower()}:{client_ip}")
        raise AppError(
            code="USER_NOT_FOUND",
            message="User not found.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    
    if not verify_password(request.password, user.hashed_password):
        record_failed_login(f"login:{request.email_or_username.lower()}:{client_ip}")
        raise AppError(
            code="INVALID_PASSWORD",
            message="Password incorrect.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    
    clear_failed_login(f"login:{request.email_or_username.lower()}:{client_ip}")
    
    if not user.is_active or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or deleted"
        )
    
    # Create audit log
    create_audit_log(
        db,
        user,
        action=AuditActions.USER_LOGGED_IN,
        object_type="user",
        object_id=user.id,
        metadata={"email": user.email}
    )
    
    # Create tokens
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})
    
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user)
    )


@router.post("/logout", response_model=SuccessResponse)
async def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """End the current user session"""
    
    # Create audit log
    create_audit_log(db, current_user, "user.logged_out", "user", current_user.id)
    
    return SuccessResponse()


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns the currently authenticated user"""

    return MeResponse(
        user=UserResponse.model_validate(current_user)
    )
