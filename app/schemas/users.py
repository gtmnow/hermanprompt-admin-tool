from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


UserStatus = Literal["invited", "active", "inactive", "suspended", "deleted"]
UserLifecycleAction = Literal["deactivate", "reinvite", "delete"]


class UserMembershipCreate(BaseModel):
    user_id_hash: str = Field(min_length=1, max_length=200)
    tenant_id: UUID
    group_ids: list[UUID] = Field(default_factory=list)
    status: UserStatus = "invited"
    is_primary: bool = True
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    title: str | None = None


class UserMembershipUpdate(BaseModel):
    group_ids: list[UUID] | None = None
    status: UserStatus | None = None
    is_primary: bool | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    title: str | None = None
    utilization_level: str | None = None
    sessions_count: int | None = None
    avg_improvement_pct: int | None = None


class UserLifecycleActionRequest(BaseModel):
    tenant_id: UUID
    action: UserLifecycleAction


class UserGroupMembershipSummary(BaseModel):
    group_id: UUID


class UserMembershipProfileSummary(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    title: str | None = None
    utilization_level: str | None = None
    sessions_count: int = 0
    avg_improvement_pct: int | None = None
    last_activity_at: datetime | None = None


class UserMembershipSummary(BaseModel):
    id: UUID
    user_id_hash: str
    tenant_id: UUID
    status: UserStatus
    is_primary: bool
    created_at: datetime
    updated_at: datetime
    group_memberships: list[UserGroupMembershipSummary] = Field(default_factory=list)
    profile: UserMembershipProfileSummary | None = None
