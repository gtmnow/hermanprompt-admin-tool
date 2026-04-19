from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogEntry(BaseModel):
    id: UUID
    actor_admin_user_id: UUID
    action_type: str
    target_type: str
    target_id: str
    before_json: str | None = None
    after_json: str | None = None
    request_id: str | None = None
    created_at: datetime
