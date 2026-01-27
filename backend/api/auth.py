from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from models.tenant import Tenant
from schemas.auth import (
    RegisterRequest,
    RegisterResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    SuccessResponse,
    UserResponse,
    TenantResponse,
)
from utils.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    get_current_user,
    create_audit_log,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=RegisterResponse)
async def register(request: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user and optionally create a new tenant"""
    
    # Check if user already exists
    existing_user = db.query(User).filter(
        (User.email == request.email) | (User.username == request.username)
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email or username already exists"
        )
    
    # Create or use tenant
    if request.tenant_name:
        tenant = Tenant(name=request.tenant_name)
        db.add(tenant)
        db.flush()
    else:
        # Default tenant for testing purposes
        tenant = db.query(Tenant).first()
        if not tenant:
            tenant = Tenant(name="Default Tenant")
            db.add(tenant)
            db.flush()
    
    # Create user
    hashed_password = get_password_hash(request.password)
    user = User(
        email=request.email,
        username=request.username,
        hashed_password=hashed_password,
        tenant_id=tenant.id
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Create tokens
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})
    
    # Create audit log
    create_audit_log(db, user, "user.registered", "user", user.id)
    
    return RegisterResponse(
        user=UserResponse.model_validate(user),
        tenant=TenantResponse.model_validate(tenant),
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate a user and return access credentials"""
    
    # Find user by email or username
    user = db.query(User).filter(
        (User.email == request.email_or_username) | (User.username == request.email_or_username)
    ).first()
    
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/username or password"
        )
    
    if not user.is_active or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or deleted"
        )
    
    # Create tokens
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})
    
    # Create audit log
    create_audit_log(db, user, "user.logged_in", "user", user.id)
    
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
    """Returns the currently authenticated user and tenant context"""
    
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    return MeResponse(
        user=UserResponse.model_validate(current_user),
        tenant=TenantResponse.model_validate(tenant)
    )
