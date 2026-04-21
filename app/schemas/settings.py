from datetime import datetime

from pydantic import BaseModel, Field


class DatabaseInstanceConfigCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    db_kind: str = "postgresql"
    host: str | None = None
    database_name: str | None = None
    connection_string: str | None = None
    connection_string_masked: str | None = None
    connection_secret_reference: str | None = None
    notes: str | None = None
    is_active: bool = False
    managed_via_db_only: bool = True


class DatabaseInstanceConfigUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    db_kind: str | None = None
    host: str | None = None
    database_name: str | None = None
    connection_string: str | None = None
    connection_string_masked: str | None = None
    connection_secret_reference: str | None = None
    notes: str | None = None
    is_active: bool | None = None
    managed_via_db_only: bool | None = None


class DatabaseInstanceConfigSummary(BaseModel):
    id: str
    label: str
    db_kind: str
    host: str | None = None
    database_name: str | None = None
    connection_string_masked: str | None = None
    connection_secret_reference: str | None = None
    secret_source: str = "none"
    vault_provider: str | None = None
    notes: str | None = None
    is_active: bool
    managed_via_db_only: bool
    created_at: datetime
    updated_at: datetime


class PromptUiInstanceConfigCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    is_active: bool = False


class PromptUiInstanceConfigUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    is_active: bool | None = None


class PromptUiInstanceConfigSummary(BaseModel):
    id: str
    label: str
    base_url: str
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PlatformManagedLlmConfigCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    provider_type: str = Field(min_length=1, max_length=100)
    model_name: str = Field(min_length=1, max_length=200)
    endpoint_url: str | None = None
    api_key: str | None = None
    secret_reference: str | None = None
    notes: str | None = None
    is_active: bool = True


class PlatformManagedLlmConfigUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    provider_type: str | None = Field(default=None, min_length=1, max_length=100)
    model_name: str | None = Field(default=None, min_length=1, max_length=200)
    endpoint_url: str | None = None
    api_key: str | None = None
    secret_reference: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class PlatformManagedLlmConfigSummary(BaseModel):
    id: str
    label: str
    provider_type: str
    model_name: str
    endpoint_url: str | None = None
    api_key_masked: str | None = None
    secret_reference: str | None = None
    secret_source: str = "none"
    vault_provider: str | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SecretVaultStatusSummary(BaseModel):
    provider: str
    display_name: str
    configured: bool
    writable: bool
    reference_prefix: str
    key_source: str
    azure_key_vault_url: str | None = None
    managed_secret_count: int
    warnings: list[str] = Field(default_factory=list)
