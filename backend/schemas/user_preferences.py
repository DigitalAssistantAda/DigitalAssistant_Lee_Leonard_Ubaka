from pydantic import BaseModel, field_validator
from typing import Optional, List
from schemas.color import validate_hex_color


class UserPreferencesResponse(BaseModel):
    user_id: int
    accent_color: Optional[str] = None
    dismissed_notification_ids: Optional[dict] = None

    class Config:
        from_attributes = True


class UpdateUserPreferencesRequest(BaseModel):
    accent_color: Optional[str] = None

    @field_validator("accent_color")
    @classmethod
    def validate_accent_color(cls, value: Optional[str]) -> Optional[str]:
        return validate_hex_color(value, "Accent color")


class DismissNotificationsRequest(BaseModel):
    deletion_request_ids: Optional[List[int]] = None
    mention_ids: Optional[List[str]] = None
    permanently_deleted_deletion_request_ids: Optional[List[int]] = None
    permanently_deleted_mention_ids: Optional[List[str]] = None
    task_notification_ids: Optional[List[str]] = None
    permanently_deleted_task_notification_ids: Optional[List[str]] = None
