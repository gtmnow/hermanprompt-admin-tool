from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


UserStatus = Literal["invited", "active", "inactive", "suspended", "deleted"]
UserLifecycleAction = Literal["deactivate", "reinvite", "delete"]


class UserMembershipCreate(BaseModel):
    user_id_hash: str | None = Field(default=None, min_length=1, max_length=200)
    tenant_id: UUID
    group_ids: list[UUID] = Field(default_factory=list)
    initial_user_type: int = Field(ge=1, le=9)
    status: UserStatus = "invited"
    send_invite: bool = True
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
    initial_user_type: int | None = None
    utilization_level: str | None = None
    sessions_count: int = 0
    avg_improvement_pct: int | None = None
    last_activity_at: datetime | None = None


class UserStatusSummary(BaseModel):
    badge: str
    detail: str | None = None


class UserInvitationSummary(BaseModel):
    state: str
    email: str | None = None
    sent_at: datetime | None = None
    accepted_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    last_error: str | None = None


class UserAdminRoleSummary(BaseModel):
    admin_id: UUID
    role: str
    is_active: bool
    permissions: list[str] = Field(default_factory=list)
    scope_types: list[str] = Field(default_factory=list)


class UserDetailFieldSummary(BaseModel):
    label: str
    value: str


class UserDetailSectionSummary(BaseModel):
    key: str
    title: str
    status: Literal["available", "unavailable"]
    fields: list[UserDetailFieldSummary] = Field(default_factory=list)
    message: str | None = None


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
    status_summary: UserStatusSummary | None = None
    invitation_summary: UserInvitationSummary | None = None
    admin_role: UserAdminRoleSummary | None = None
    detail_sections: list[UserDetailSectionSummary] = Field(default_factory=list)
