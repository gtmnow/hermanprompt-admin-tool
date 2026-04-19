from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


TenantStatus = Literal["draft", "onboarding", "active", "suspended", "inactive"]
CredentialMode = Literal["platform_managed", "customer_managed"]
CredentialStatus = Literal["unvalidated", "valid", "invalid", "suspended"]
EnforcementMode = Literal["advisory", "coaching", "enforced"]


class TenantBase(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=200)
    tenant_key: str = Field(min_length=1, max_length=100)
    reseller_partner_id: UUID | None = None
    status: TenantStatus = "draft"
    plan_tier: str | None = None
    reporting_timezone: str = "America/New_York"
    external_customer_id: str | None = None


class TenantCreate(TenantBase):
    pass


class TenantUpdate(BaseModel):
    tenant_name: str | None = Field(default=None, min_length=1, max_length=200)
    tenant_key: str | None = Field(default=None, min_length=1, max_length=100)
    reseller_partner_id: UUID | None = None
    status: TenantStatus | None = None
    plan_tier: str | None = None
    reporting_timezone: str | None = None
    external_customer_id: str | None = None


class Tenant(TenantBase):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime
    updated_at: datetime


class TenantLLMConfig(BaseModel):
    provider_type: str = Field(min_length=1, max_length=100)
    model_name: str = Field(min_length=1, max_length=200)
    endpoint_url: str | None = None
    api_key_masked: str | None = None
    secret_reference: str | None = None
    credential_mode: CredentialMode = "customer_managed"
    credential_status: CredentialStatus = "unvalidated"
    transformation_enabled: bool = True
    scoring_enabled: bool = True
    last_validated_at: datetime | None = None
    last_validation_message: str | None = None


class TenantLLMConfigUpdate(BaseModel):
    provider_type: str = Field(min_length=1, max_length=100)
    model_name: str = Field(min_length=1, max_length=200)
    endpoint_url: str | None = None
    api_key: str | None = None
    secret_reference: str | None = None
    credential_mode: CredentialMode = "customer_managed"
    transformation_enabled: bool = True
    scoring_enabled: bool = True


class TenantRuntimeSettings(BaseModel):
    enforcement_mode: EnforcementMode = "advisory"
    reporting_enabled: bool = True
    export_enabled: bool = True
    raw_prompt_retention_enabled: bool = False
    raw_prompt_admin_visibility: bool = False
    data_retention_days: int | None = Field(default=None, ge=1)
    feature_flags_json: dict[str, bool | str | int | float] = Field(default_factory=dict)


class TenantRuntimeSettingsUpdate(TenantRuntimeSettings):
    pass


class TenantSummary(BaseModel):
    tenant: Tenant
    llm_config: TenantLLMConfig | None = None
    runtime_settings: TenantRuntimeSettings | None = None


class TenantValidationResult(BaseModel):
    validation_result: CredentialStatus
    provider_echo: str
    model_accessible: bool
    latency_ms: int | None = None
    message: str | None = None
