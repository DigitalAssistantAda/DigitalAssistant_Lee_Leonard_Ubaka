from sqlalchemy import Column, String, Integer, DateTime, Enum
from sqlalchemy.sql import func
from database import Base
import enum


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(Enum(TenantStatus), nullable=False, default=TenantStatus.ACTIVE)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
