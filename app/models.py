from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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

    tenants: Mapped[list["Tenant"]] = relationship(back_populates="reseller_partner")


class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    tenant_name: Mapped[str] = mapped_column(String(200))
    reseller_partner_id: Mapped[str | None] = mapped_column(ForeignKey("reseller_partners.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    plan_tier: Mapped[str | None] = mapped_column(String(100))
    reporting_timezone: Mapped[str] = mapped_column(String(80), default="America/New_York")
    external_customer_id: Mapped[str | None] = mapped_column(String(200))

    reseller_partner: Mapped["ResellerPartner | None"] = relationship(back_populates="tenants")
    groups: Mapped[list["Group"]] = relationship(back_populates="tenant")
    memberships: Mapped[list["UserTenantMembership"]] = relationship(back_populates="tenant")
    llm_config: Mapped["TenantLLMConfig | None"] = relationship(back_populates="tenant", uselist=False)
    runtime_settings: Mapped["TenantRuntimeSettings | None"] = relationship(back_populates="tenant", uselist=False)
    onboarding_status: Mapped["TenantOnboardingStatus | None"] = relationship(back_populates="tenant", uselist=False)


class Group(TimestampMixin, Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    group_name: Mapped[str] = mapped_column(String(200))
    group_type: Mapped[str | None] = mapped_column(String(100))
    parent_group_id: Mapped[str | None] = mapped_column(ForeignKey("groups.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="groups", foreign_keys=[tenant_id])


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


class TenantLLMConfig(TimestampMixin, Base):
    __tablename__ = "tenant_llm_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), unique=True, index=True)
    provider_type: Mapped[str] = mapped_column(String(100))
    model_name: Mapped[str] = mapped_column(String(200))
    endpoint_url: Mapped[str | None] = mapped_column(String(500))
    api_key_masked: Mapped[str | None] = mapped_column(String(32))
    secret_reference: Mapped[str | None] = mapped_column(String(255))
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
