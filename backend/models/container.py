from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from database import Base


class Container(Base):
    __tablename__ = "containers"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=True, index=True)
    parent_container_id = Column(Integer, ForeignKey("containers.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    is_workspace_default = Column(Boolean, nullable=False, default=False, server_default="false")
    color = Column(String(7), nullable=True)  # Hex color like #RRGGBB
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
