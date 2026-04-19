from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


ScopeType = Literal["global", "reseller", "tenant", "group"]


class AdminScopeAssignment(BaseModel):
    scope_type: ScopeType
    reseller_partner_id: UUID | None = None
    tenant_id: UUID | None = None
    group_id: UUID | None = None


class AdminCreate(BaseModel):
    user_id_hash: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=50)
    permissions: list[str] = Field(default_factory=list)
    scopes: list[AdminScopeAssignment] = Field(default_factory=list)


class AdminUpdate(BaseModel):
    is_active: bool | None = None
    permissions: list[str] | None = None
    scopes: list[AdminScopeAssignment] | None = None


class AdminPermissionSummary(BaseModel):
    permission_key: str


class AdminScopeSummary(AdminScopeAssignment):
    id: UUID
    created_at: datetime


class AdminUserSummary(BaseModel):
    id: UUID
    user_id_hash: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    permissions: list[AdminPermissionSummary] = Field(default_factory=list)
    scopes: list[AdminScopeSummary] = Field(default_factory=list)
