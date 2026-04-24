from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


TierScope = Literal["organization", "reseller"]


class ServiceTierDefinitionBase(BaseModel):
    scope_type: TierScope
    tier_key: str = Field(min_length=1, max_length=100)
    tier_name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    max_users: int | None = Field(default=None, ge=1)
    has_unlimited_users: bool = False
    max_organizations: int | None = Field(default=None, ge=1)
    monthly_admin_fee: float | None = Field(default=None, ge=0)
    per_active_user_fee: float | None = Field(default=None, ge=0)
    additional_usage_fee: str | None = None
    cqi_assessment: int | None = Field(default=None, ge=0)
    billing_notes: str | None = None
    is_active: bool = True
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_limits(self):
        if self.scope_type == "organization":
            self.max_organizations = None
        if self.has_unlimited_users:
            self.max_users = None
        elif self.max_users is None:
            raise ValueError("Provide a max user count or mark the tier as unlimited")
        return self


class ServiceTierDefinitionCreate(ServiceTierDefinitionBase):
    pass


class ServiceTierDefinitionUpdate(BaseModel):
    tier_key: str | None = Field(default=None, min_length=1, max_length=100)
    tier_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    max_users: int | None = Field(default=None, ge=1)
    has_unlimited_users: bool | None = None
    max_organizations: int | None = Field(default=None, ge=1)
    monthly_admin_fee: float | None = Field(default=None, ge=0)
    per_active_user_fee: float | None = Field(default=None, ge=0)
    additional_usage_fee: str | None = None
    cqi_assessment: int | None = Field(default=None, ge=0)
    billing_notes: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ServiceTierDefinitionSummary(ServiceTierDefinitionBase):
    id: str
    created_at: datetime
    updated_at: datetime

