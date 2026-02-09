from sqlalchemy import Column, Integer, DateTime, ForeignKey, String
from sqlalchemy.sql import func
from database import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    accent_color = Column(String(7), nullable=True)  # Hex color like #RRGGBB
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
