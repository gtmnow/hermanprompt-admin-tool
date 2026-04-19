from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


UserStatus = Literal["invited", "active", "inactive", "suspended", "deleted"]


class UserMembershipCreate(BaseModel):
    user_id_hash: str = Field(min_length=1, max_length=200)
    tenant_id: UUID
    group_ids: list[UUID] = Field(default_factory=list)
    status: UserStatus = "invited"
    is_primary: bool = True


class UserMembershipUpdate(BaseModel):
    group_ids: list[UUID] | None = None
    status: UserStatus | None = None
    is_primary: bool | None = None


class UserGroupMembershipSummary(BaseModel):
    group_id: UUID


class UserMembershipSummary(BaseModel):
    id: UUID
    user_id_hash: str
    tenant_id: UUID
    status: UserStatus
    is_primary: bool
    created_at: datetime
    updated_at: datetime
    group_memberships: list[UserGroupMembershipSummary] = Field(default_factory=list)
