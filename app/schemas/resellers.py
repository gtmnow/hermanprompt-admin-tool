from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.service_tiers import ServiceTierDefinitionSummary


class ResellerPartnerBase(BaseModel):
    reseller_key: str = Field(min_length=1, max_length=100)
    reseller_name: str = Field(min_length=1, max_length=200)
    is_active: bool = True
    service_tier_definition_id: UUID | None = None


class ResellerPartnerCreate(ResellerPartnerBase):
    pass


class ResellerPartnerUpdate(BaseModel):
    reseller_name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None


class ResellerPartner(ResellerPartnerBase):
    id: UUID
    service_tier: ServiceTierDefinitionSummary | None = None
    created_at: datetime
    updated_at: datetime


class ResellerTenantDefaultsBase(BaseModel):
    default_plan_tier: str | None = None
    default_service_tier_definition_id: UUID | None = None
    default_reporting_timezone: str | None = "America/New_York"
    default_service_mode: str | None = None
    default_portal_base_url: str | None = None
    default_portal_logo_url: str | None = None
    default_portal_welcome_message: str | None = None
    default_enforcement_mode: str | None = "coaching"
    default_reporting_enabled: bool = True
    default_export_enabled: bool = True
    default_raw_prompt_retention_enabled: bool = False
    default_raw_prompt_admin_visibility: bool = False
    default_data_retention_days: int | None = Field(default=None, ge=1)
    default_feature_flags_json: dict[str, bool | str | int | float] = Field(default_factory=dict)
    default_credential_mode: str = "customer_managed"
    default_platform_managed_config_id: str | None = None
    default_provider_type: str | None = None
    default_model_name: str | None = None
    default_endpoint_url: str | None = None
    default_transformation_enabled: bool = True
    default_scoring_enabled: bool = True


class ResellerTenantDefaultsUpdate(ResellerTenantDefaultsBase):
    pass


class ResellerTenantDefaultsSummary(ResellerTenantDefaultsBase):
    id: UUID
    reseller_partner_id: UUID
    default_service_tier: ServiceTierDefinitionSummary | None = None
    created_at: datetime
    updated_at: datetime
