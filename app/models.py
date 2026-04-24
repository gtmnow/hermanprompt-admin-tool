from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class ResellerPartner(TimestampMixin, Base):
    __tablename__ = "reseller_partners"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    reseller_key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    reseller_name: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    service_tier_definition_id: Mapped[str | None] = mapped_column(ForeignKey("service_tier_definitions.id"), index=True)

    tenants: Mapped[list["Tenant"]] = relationship(back_populates="reseller_partner")
    tenant_defaults: Mapped["ResellerTenantDefaults | None"] = relationship(back_populates="reseller_partner", uselist=False)
    service_tier: Mapped["ServiceTierDefinition | None"] = relationship(foreign_keys=[service_tier_definition_id])


class ServiceTierDefinition(TimestampMixin, Base):
    __tablename__ = "service_tier_definitions"
    __table_args__ = (UniqueConstraint("scope_type", "tier_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    scope_type: Mapped[str] = mapped_column(String(30), index=True)
    tier_key: Mapped[str] = mapped_column(String(100), index=True)
    tier_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    max_users: Mapped[int | None] = mapped_column(Integer)
    has_unlimited_users: Mapped[bool] = mapped_column(Boolean, default=False)
    max_organizations: Mapped[int | None] = mapped_column(Integer)
    monthly_admin_fee: Mapped[float | None] = mapped_column(Float)
    per_active_user_fee: Mapped[float | None] = mapped_column(Float)
    additional_usage_fee: Mapped[str | None] = mapped_column(Text)
    cqi_assessment: Mapped[int | None] = mapped_column(Integer)
    billing_notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ResellerTenantDefaults(TimestampMixin, Base):
    __tablename__ = "reseller_tenant_defaults"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    reseller_partner_id: Mapped[str] = mapped_column(ForeignKey("reseller_partners.id"), unique=True, index=True)
    default_plan_tier: Mapped[str | None] = mapped_column(String(100))
    default_service_tier_definition_id: Mapped[str | None] = mapped_column(ForeignKey("service_tier_definitions.id"), index=True)
    default_reporting_timezone: Mapped[str | None] = mapped_column(String(80))
    default_service_mode: Mapped[str | None] = mapped_column(String(50))
    default_portal_base_url: Mapped[str | None] = mapped_column(String(500))
    default_portal_logo_url: Mapped[str | None] = mapped_column(String(500))
    default_portal_welcome_message: Mapped[str | None] = mapped_column(Text)
    default_enforcement_mode: Mapped[str | None] = mapped_column(String(30))
    default_reporting_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_export_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_raw_prompt_retention_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    default_raw_prompt_admin_visibility: Mapped[bool] = mapped_column(Boolean, default=False)
    default_data_retention_days: Mapped[int | None] = mapped_column(Integer)
    default_feature_flags_json: Mapped[str] = mapped_column(Text, default="{}")
    default_credential_mode: Mapped[str] = mapped_column(String(30), default="customer_managed")
    default_platform_managed_config_id: Mapped[str | None] = mapped_column(String(36), index=True)
    default_provider_type: Mapped[str | None] = mapped_column(String(100))
    default_model_name: Mapped[str | None] = mapped_column(String(200))
    default_endpoint_url: Mapped[str | None] = mapped_column(String(500))
    default_transformation_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_scoring_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    reseller_partner: Mapped["ResellerPartner"] = relationship(back_populates="tenant_defaults")
    default_service_tier: Mapped["ServiceTierDefinition | None"] = relationship(foreign_keys=[default_service_tier_definition_id])


class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    tenant_name: Mapped[str] = mapped_column(String(200))
    reseller_partner_id: Mapped[str | None] = mapped_column(ForeignKey("reseller_partners.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    plan_tier: Mapped[str | None] = mapped_column(String(100))
    service_tier_definition_id: Mapped[str | None] = mapped_column(ForeignKey("service_tier_definitions.id"), index=True)
    reporting_timezone: Mapped[str] = mapped_column(String(80), default="America/New_York")
    external_customer_id: Mapped[str | None] = mapped_column(String(200))

    reseller_partner: Mapped["ResellerPartner | None"] = relationship(back_populates="tenants")
    service_tier: Mapped["ServiceTierDefinition | None"] = relationship(foreign_keys=[service_tier_definition_id])
    groups: Mapped[list["Group"]] = relationship(back_populates="tenant")
    memberships: Mapped[list["UserTenantMembership"]] = relationship(back_populates="tenant")
    llm_config: Mapped["TenantLLMConfig | None"] = relationship(back_populates="tenant", uselist=False)
    runtime_settings: Mapped["TenantRuntimeSettings | None"] = relationship(back_populates="tenant", uselist=False)
    onboarding_status: Mapped["TenantOnboardingStatus | None"] = relationship(back_populates="tenant", uselist=False)
    profile: Mapped["TenantProfile | None"] = relationship(back_populates="tenant", uselist=False)
    portal_config: Mapped["TenantPortalConfig | None"] = relationship(back_populates="tenant", uselist=False)


class Group(TimestampMixin, Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    group_name: Mapped[str] = mapped_column(String(200))
    group_type: Mapped[str | None] = mapped_column(String(100))
    parent_group_id: Mapped[str | None] = mapped_column(ForeignKey("groups.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="groups", foreign_keys=[tenant_id])
    profile: Mapped["GroupProfile | None"] = relationship(back_populates="group", uselist=False)


class TenantProfile(TimestampMixin, Base):
    __tablename__ = "tenant_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    organization_type: Mapped[str | None] = mapped_column(String(100))
    industry: Mapped[str | None] = mapped_column(String(100))
    primary_contact_name: Mapped[str | None] = mapped_column(String(200))
    primary_contact_email: Mapped[str | None] = mapped_column(String(200))
    service_mode: Mapped[str | None] = mapped_column(String(50))
    deployment_notes: Mapped[str | None] = mapped_column(Text)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    utilization_pct: Mapped[int | None] = mapped_column(Integer)

    tenant: Mapped["Tenant"] = relationship(back_populates="profile")


class GroupProfile(TimestampMixin, Base):
    __tablename__ = "group_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id"), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    business_unit: Mapped[str | None] = mapped_column(String(100))
    owner_name: Mapped[str | None] = mapped_column(String(200))

    group: Mapped["Group"] = relationship(back_populates="profile")


class UserTenantMembership(TimestampMixin, Base):
    __tablename__ = "user_tenant_membership"
    __table_args__ = (UniqueConstraint("user_id_hash", "tenant_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id_hash: Mapped[str] = mapped_column(String(200), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="invited", index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="memberships")
    group_memberships: Mapped[list["UserGroupMembership"]] = relationship(back_populates="tenant_membership")
    profile: Mapped["UserMembershipProfile | None"] = relationship(back_populates="membership", uselist=False)


class UserGroupMembership(Base):
    __tablename__ = "user_group_membership"
    __table_args__ = (UniqueConstraint("user_id_hash", "group_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id_hash: Mapped[str] = mapped_column(String(200), index=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id"), index=True)
    tenant_membership_id: Mapped[str | None] = mapped_column(ForeignKey("user_tenant_membership.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    tenant_membership: Mapped["UserTenantMembership | None"] = relationship(back_populates="group_memberships")


class AdminUser(TimestampMixin, Base):
    __tablename__ = "admin_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id_hash: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(50), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    scopes: Mapped[list["AdminScope"]] = relationship(back_populates="admin_user", cascade="all, delete-orphan")
    permissions: Mapped[list["AdminPermission"]] = relationship(
        back_populates="admin_user",
        cascade="all, delete-orphan",
    )
    profile: Mapped["AdminProfile | None"] = relationship(back_populates="admin_user", uselist=False)
    sessions: Mapped[list["AdminSession"]] = relationship(back_populates="admin_user", cascade="all, delete-orphan")


class UserMembershipProfile(TimestampMixin, Base):
    __tablename__ = "user_membership_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_membership_id: Mapped[str] = mapped_column(ForeignKey("user_tenant_membership.id"), unique=True, index=True)
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(100))
    utilization_level: Mapped[str | None] = mapped_column(String(50))
    sessions_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_improvement_pct: Mapped[int | None] = mapped_column(Integer)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    membership: Mapped["UserTenantMembership"] = relationship(back_populates="profile")


class UserInvitation(TimestampMixin, Base):
    __tablename__ = "user_invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id_hash: Mapped[str] = mapped_column(String(200), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(200), index=True)
    invite_token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    invite_url: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    provider: Mapped[str | None] = mapped_column(String(50))
    provider_message_id: Mapped[str | None] = mapped_column(String(255), index=True)
    created_by_admin_user_id: Mapped[str | None] = mapped_column(ForeignKey("admin_users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class AdminProfile(TimestampMixin, Base):
    __tablename__ = "admin_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200))

    admin_user: Mapped["AdminUser"] = relationship(back_populates="profile")


class AdminScope(Base):
    __tablename__ = "admin_scopes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), index=True)
    scope_type: Mapped[str] = mapped_column(String(20), index=True)
    reseller_partner_id: Mapped[str | None] = mapped_column(ForeignKey("reseller_partners.id"), index=True)
    tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id"), index=True)
    group_id: Mapped[str | None] = mapped_column(ForeignKey("groups.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    admin_user: Mapped["AdminUser"] = relationship(back_populates="scopes")


class AdminPermission(Base):
    __tablename__ = "admin_permissions"
    __table_args__ = (UniqueConstraint("admin_user_id", "permission_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), index=True)
    permission_key: Mapped[str] = mapped_column(String(100), index=True)

    admin_user: Mapped["AdminUser"] = relationship(back_populates="permissions")


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), index=True)
    user_id_hash: Mapped[str] = mapped_column(String(200), index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    mfa_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(1000))
    source_ip: Mapped[str | None] = mapped_column(String(100))

    admin_user: Mapped["AdminUser"] = relationship(back_populates="sessions")


class TenantLLMConfig(TimestampMixin, Base):
    __tablename__ = "tenant_llm_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    provider_type: Mapped[str] = mapped_column(String(100))
    model_name: Mapped[str] = mapped_column(String(200))
    endpoint_url: Mapped[str | None] = mapped_column(String(500))
    api_key_masked: Mapped[str | None] = mapped_column(String(32))
    secret_reference: Mapped[str | None] = mapped_column(String(255))
    secret_source: Mapped[str] = mapped_column(String(30), default="none")
    vault_provider: Mapped[str | None] = mapped_column(String(50))
    platform_managed_config_id: Mapped[str | None] = mapped_column(String(36), index=True)
    credential_mode: Mapped[str] = mapped_column(String(30), default="customer_managed")
    credential_status: Mapped[str] = mapped_column(String(30), default="unvalidated", index=True)
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_validation_message: Mapped[str | None] = mapped_column(Text)
    transformation_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    scoring_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="llm_config")


class TenantRuntimeSettings(TimestampMixin, Base):
    __tablename__ = "tenant_runtime_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    enforcement_mode: Mapped[str] = mapped_column(String(30), default="advisory")
    reporting_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    export_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_prompt_retention_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_prompt_admin_visibility: Mapped[bool] = mapped_column(Boolean, default=False)
    data_retention_days: Mapped[int | None] = mapped_column(Integer)
    feature_flags_json: Mapped[str] = mapped_column(Text, default="{}")

    tenant: Mapped["Tenant"] = relationship(back_populates="runtime_settings")


class TenantOnboardingStatus(Base):
    __tablename__ = "tenant_onboarding_status"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    tenant_created: Mapped[bool] = mapped_column(Boolean, default=True)
    llm_configured: Mapped[bool] = mapped_column(Boolean, default=False)
    llm_validated: Mapped[bool] = mapped_column(Boolean, default=False)
    groups_created: Mapped[bool] = mapped_column(Boolean, default=False)
    users_uploaded: Mapped[bool] = mapped_column(Boolean, default=False)
    admin_assigned: Mapped[bool] = mapped_column(Boolean, default=False)
    first_login_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    first_transform_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    first_score_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarding_status: Mapped[str] = mapped_column(String(30), default="draft")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    tenant: Mapped["Tenant"] = relationship(back_populates="onboarding_status")


class ReportExportJob(Base):
    __tablename__ = "report_export_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    requested_by_admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), index=True)
    report_type: Mapped[str] = mapped_column(String(100))
    scope_type: Mapped[str] = mapped_column(String(30))
    scope_id: Mapped[str] = mapped_column(String(200))
    filters_json: Mapped[str] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    file_path: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    actor_admin_user_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id"), index=True)
    action_type: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(100), index=True)
    target_id: Mapped[str] = mapped_column(String(200), index=True)
    before_json: Mapped[str | None] = mapped_column(Text)
    after_json: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class DatabaseInstanceConfig(TimestampMixin, Base):
    __tablename__ = "database_instance_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    label: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    db_kind: Mapped[str] = mapped_column(String(50), default="postgresql")
    host: Mapped[str | None] = mapped_column(String(200))
    database_name: Mapped[str | None] = mapped_column(String(200))
    connection_string_masked: Mapped[str | None] = mapped_column(String(500))
    connection_secret_reference: Mapped[str | None] = mapped_column(String(255))
    secret_source: Mapped[str] = mapped_column(String(30), default="none")
    vault_provider: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    managed_via_db_only: Mapped[bool] = mapped_column(Boolean, default=True)


class PromptUiInstanceConfig(TimestampMixin, Base):
    __tablename__ = "prompt_ui_instance_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    label: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    base_url: Mapped[str] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class TenantPortalConfig(TimestampMixin, Base):
    __tablename__ = "tenant_portal_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    portal_base_url: Mapped[str] = mapped_column(String(500))
    logo_url: Mapped[str | None] = mapped_column(String(1000))
    welcome_message: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by_admin_user_id: Mapped[str | None] = mapped_column(ForeignKey("admin_users.id"), index=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="portal_config")


class PlatformManagedLlmConfig(TimestampMixin, Base):
    __tablename__ = "platform_managed_llm_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    label: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    provider_type: Mapped[str] = mapped_column(String(100))
    model_name: Mapped[str] = mapped_column(String(200))
    endpoint_url: Mapped[str | None] = mapped_column(String(500))
    api_key_masked: Mapped[str | None] = mapped_column(String(32))
    secret_reference: Mapped[str | None] = mapped_column(String(255))
    secret_source: Mapped[str] = mapped_column(String(30), default="none")
    vault_provider: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class VaultSecret(TimestampMixin, Base):
    __tablename__ = "vault_secrets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    secret_ref: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    provider_type: Mapped[str] = mapped_column(String(50), index=True)
    scope_type: Mapped[str] = mapped_column(String(50), index=True)
    scope_id: Mapped[str] = mapped_column(String(200), index=True)
    secret_kind: Mapped[str] = mapped_column(String(50), index=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    secret_masked: Mapped[str | None] = mapped_column(String(64))
    ciphertext: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_by_admin_user_id: Mapped[str | None] = mapped_column(ForeignKey("admin_users.id"), index=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
