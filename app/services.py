from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import bindparam, delete, func, inspect, select, text
from sqlalchemy.orm import Session

from app.db import engine
from app.models import (
    AdminAuditLog,
    AdminPermission,
    AdminProfile,
    AdminSession,
    AdminScope,
    AdminUser,
    DatabaseInstanceConfig,
    Group,
    GroupProfile,
    PlatformManagedLlmConfig,
    PromptUiInstanceConfig,
    ReportExportJob,
    ResellerPartner,
    ResellerTenantDefaults,
    ServiceTierDefinition,
    Tenant,
    TenantLLMConfig,
    TenantOnboardingStatus,
    TenantPortalConfig,
    TenantProfile,
    TenantRuntimeSettings,
    UserInvitation,
    UserGroupMembership,
    UserMembershipProfile,
    UserTenantMembership,
)
from app.security import Principal

AUTH_USER_DISABLED_PASSWORD_HASH = "$2y$12$meGFiGyYM5aRO0bDJmpuN.gfvgLNTF/5lk/qgIiSI1/DHuy9XNoQS"

SERVICE_TIER_SEED_DATA = [
    {
        "scope_type": "organization",
        "tier_key": "demo_30_day",
        "tier_name": "30 Day Demo",
        "max_users": 3,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": None,
        "per_active_user_fee": None,
        "additional_usage_fee": "None-blocked",
        "cqi_assessment": 39,
        "sort_order": 10,
    },
    {
        "scope_type": "organization",
        "tier_key": "professional",
        "tier_name": "Professional",
        "max_users": 25,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": 10,
        "per_active_user_fee": 10,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 39,
        "sort_order": 20,
    },
    {
        "scope_type": "organization",
        "tier_key": "business",
        "tier_name": "Business",
        "max_users": 100,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": 25,
        "per_active_user_fee": 8.5,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 30,
        "sort_order": 30,
    },
    {
        "scope_type": "organization",
        "tier_key": "large_business",
        "tier_name": "Large Business",
        "max_users": 500,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": 100,
        "per_active_user_fee": 7.75,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 25,
        "sort_order": 40,
    },
    {
        "scope_type": "organization",
        "tier_key": "enterprise",
        "tier_name": "Enterprise",
        "max_users": 1000,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": 200,
        "per_active_user_fee": 7,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 20,
        "sort_order": 50,
    },
    {
        "scope_type": "reseller",
        "tier_key": "gold_partner",
        "tier_name": "Gold Partner",
        "max_users": 1000,
        "has_unlimited_users": False,
        "max_organizations": None,
        "monthly_admin_fee": 200,
        "per_active_user_fee": 7,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 20,
        "sort_order": 60,
    },
    {
        "scope_type": "reseller",
        "tier_key": "platinum_partner",
        "tier_name": "Platinum Partner",
        "max_users": None,
        "has_unlimited_users": True,
        "max_organizations": None,
        "monthly_admin_fee": 100,
        "per_active_user_fee": 6.5,
        "additional_usage_fee": "TBD ($xx per yy tokens)",
        "cqi_assessment": 20,
        "sort_order": 70,
    },
]


def parse_datetime(value: str | datetime | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def table_exists(db: Session, table_name: str) -> bool:
    try:
        db.execute(text(f"select 1 from {table_name} limit 1"))
        return True
    except Exception:
        return False


def normalize_tier_key(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized or None


def generate_tenant_key(db: Session, tenant_name: str, *, exclude_tenant_id: str | None = None) -> str:
    base_key = normalize_tier_key(tenant_name) or "organization"
    candidate = base_key
    suffix = 2
    while True:
        existing = db.scalar(select(Tenant).where(Tenant.tenant_key == candidate))
        if existing is None or existing.id == exclude_tenant_id:
            return candidate
        candidate = f"{base_key}-{suffix}"
        suffix += 1


def ensure_additive_schema_extensions() -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        dialect = connection.dialect.name
        existing_tables = set(inspector.get_table_names())

        if "admin_sessions" not in existing_tables:
            AdminSession.__table__.create(bind=connection)
        if "service_tier_definitions" not in existing_tables:
            ServiceTierDefinition.__table__.create(bind=connection)
        if "platform_managed_llm_configs" not in existing_tables:
            PlatformManagedLlmConfig.__table__.create(bind=connection)
        if "reseller_tenant_defaults" not in existing_tables:
            ResellerTenantDefaults.__table__.create(bind=connection)
        else:
            reseller_defaults_columns = {column["name"] for column in inspector.get_columns("reseller_tenant_defaults")}
            if "default_service_tier_definition_id" not in reseller_defaults_columns:
                connection.execute(
                    text("ALTER TABLE reseller_tenant_defaults ADD COLUMN default_service_tier_definition_id VARCHAR(36)")
                )

        if "reseller_partners" in existing_tables:
            reseller_columns = {column["name"] for column in inspector.get_columns("reseller_partners")}
            if "service_tier_definition_id" not in reseller_columns:
                connection.execute(text("ALTER TABLE reseller_partners ADD COLUMN service_tier_definition_id VARCHAR(36)"))

        if "tenants" in existing_tables:
            tenant_columns = {column["name"] for column in inspector.get_columns("tenants")}
            if "service_tier_definition_id" not in tenant_columns:
                connection.execute(text("ALTER TABLE tenants ADD COLUMN service_tier_definition_id VARCHAR(36)"))

        if "user_invitations" not in existing_tables:
            UserInvitation.__table__.create(bind=connection)
        else:
            invitation_columns = {column["name"] for column in inspector.get_columns("user_invitations")}
            invitation_unique_constraints = inspector.get_unique_constraints("user_invitations")
            has_legacy_membership_unique = any(
                constraint.get("column_names") == ["user_id_hash", "tenant_id"]
                for constraint in invitation_unique_constraints
            )
            if has_legacy_membership_unique:
                if dialect == "sqlite":
                    connection.execute(
                        text(
                            """
                            CREATE TABLE user_invitations__codex_migrated (
                              id VARCHAR(36) NOT NULL PRIMARY KEY,
                              user_id_hash VARCHAR(200) NOT NULL,
                              tenant_id VARCHAR(36) NOT NULL,
                              email VARCHAR(200) NOT NULL,
                              invite_token_hash VARCHAR(128) NOT NULL UNIQUE,
                              invite_url VARCHAR(1000),
                              status VARCHAR(30) NOT NULL,
                              provider VARCHAR(50),
                              provider_message_id VARCHAR(255),
                              created_by_admin_user_id VARCHAR(36),
                              expires_at DATETIME,
                              sent_at DATETIME,
                              accepted_at DATETIME,
                              revoked_at DATETIME,
                              last_error TEXT,
                              created_at DATETIME NOT NULL,
                              updated_at DATETIME NOT NULL,
                              FOREIGN KEY (tenant_id) REFERENCES tenants (id),
                              FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
                            )
                            """
                        )
                    )
                    copy_expires_expression = (
                        "COALESCE(expires_at, datetime(COALESCE(created_at, CURRENT_TIMESTAMP), '+7 days'))"
                        if "expires_at" in invitation_columns
                        else "datetime(COALESCE(created_at, CURRENT_TIMESTAMP), '+7 days')"
                    )
                    revoked_at_expression = "revoked_at" if "revoked_at" in invitation_columns else "NULL"
                    created_by_expression = (
                        "created_by_admin_user_id" if "created_by_admin_user_id" in invitation_columns else "NULL"
                    )
                    connection.execute(
                        text(
                            f"""
                            INSERT INTO user_invitations__codex_migrated (
                              id,
                              user_id_hash,
                              tenant_id,
                              email,
                              invite_token_hash,
                              invite_url,
                              status,
                              provider,
                              provider_message_id,
                              created_by_admin_user_id,
                              expires_at,
                              sent_at,
                              accepted_at,
                              revoked_at,
                              last_error,
                              created_at,
                              updated_at
                            )
                            SELECT
                              id,
                              user_id_hash,
                              tenant_id,
                              email,
                              invite_token_hash,
                              invite_url,
                              status,
                              provider,
                              provider_message_id,
                              {created_by_expression},
                              {copy_expires_expression},
                              sent_at,
                              accepted_at,
                              {revoked_at_expression},
                              last_error,
                              created_at,
                              updated_at
                            FROM user_invitations
                            ORDER BY created_at, id
                            """
                        )
                    )
                    connection.execute(text("DROP TABLE user_invitations"))
                    connection.execute(text("ALTER TABLE user_invitations__codex_migrated RENAME TO user_invitations"))
                    connection.execute(text("CREATE INDEX ix_user_invitations_user ON user_invitations(user_id_hash)"))
                    connection.execute(text("CREATE INDEX ix_user_invitations_tenant ON user_invitations(tenant_id)"))
                    connection.execute(text("CREATE INDEX ix_user_invitations_email ON user_invitations(email)"))
                    connection.execute(text("CREATE INDEX ix_user_invitations_status ON user_invitations(status)"))
                    connection.execute(text("CREATE INDEX ix_user_invitations_provider_message_id ON user_invitations(provider_message_id)"))
                else:
                    for constraint in invitation_unique_constraints:
                        if constraint.get("column_names") == ["user_id_hash", "tenant_id"] and constraint.get("name"):
                            connection.execute(
                                text(
                                    f'ALTER TABLE user_invitations DROP CONSTRAINT "{constraint["name"]}"'
                                )
                            )
                    inspector = inspect(connection)
                    invitation_columns = {column["name"] for column in inspector.get_columns("user_invitations")}
            if "created_by_admin_user_id" not in invitation_columns:
                connection.execute(text("ALTER TABLE user_invitations ADD COLUMN created_by_admin_user_id VARCHAR(36)"))
            if "expires_at" not in invitation_columns:
                if dialect == "postgresql":
                    connection.execute(text("ALTER TABLE user_invitations ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE"))
                    connection.execute(
                        text(
                            """
                            UPDATE user_invitations
                            SET expires_at = COALESCE(created_at, CURRENT_TIMESTAMP) + INTERVAL '7 days'
                            WHERE expires_at IS NULL
                            """
                        )
                    )
                else:
                    connection.execute(text("ALTER TABLE user_invitations ADD COLUMN expires_at DATETIME"))
                    connection.execute(
                        text(
                            """
                            UPDATE user_invitations
                            SET expires_at = datetime(COALESCE(created_at, CURRENT_TIMESTAMP), '+7 days')
                            WHERE expires_at IS NULL
                            """
                        )
                    )
            if "revoked_at" not in invitation_columns:
                if dialect == "postgresql":
                    connection.execute(text("ALTER TABLE user_invitations ADD COLUMN revoked_at TIMESTAMP WITH TIME ZONE"))
                else:
                    connection.execute(text("ALTER TABLE user_invitations ADD COLUMN revoked_at DATETIME"))

        if "tenant_portal_configs" not in existing_tables:
            TenantPortalConfig.__table__.create(bind=connection)

        if "tenant_llm_config" in existing_tables:
            existing_columns = {column["name"] for column in inspector.get_columns("tenant_llm_config")}
            if "platform_managed_config_id" not in existing_columns:
                connection.execute(text("ALTER TABLE tenant_llm_config ADD COLUMN platform_managed_config_id VARCHAR(36)"))

        existing_tiers = {
            (row["scope_type"], row["tier_key"]): row["id"]
            for row in connection.execute(
                text("SELECT id, scope_type, tier_key FROM service_tier_definitions")
            ).mappings()
        }
        for item in SERVICE_TIER_SEED_DATA:
            key = (item["scope_type"], item["tier_key"])
            if key in existing_tiers:
                continue
            payload = {**item, "id": str(uuid4())}
            connection.execute(
                text(
                    """
                    INSERT INTO service_tier_definitions (
                      id,
                      scope_type,
                      tier_key,
                      tier_name,
                      description,
                      max_users,
                      has_unlimited_users,
                      max_organizations,
                      monthly_admin_fee,
                      per_active_user_fee,
                      additional_usage_fee,
                      cqi_assessment,
                      billing_notes,
                      is_active,
                      sort_order,
                      created_at,
                      updated_at
                    ) VALUES (
                      :id,
                      :scope_type,
                      :tier_key,
                      :tier_name,
                      :description,
                      :max_users,
                      :has_unlimited_users,
                      :max_organizations,
                      :monthly_admin_fee,
                      :per_active_user_fee,
                      :additional_usage_fee,
                      :cqi_assessment,
                      :billing_notes,
                      :is_active,
                      :sort_order,
                      CURRENT_TIMESTAMP,
                      CURRENT_TIMESTAMP
                    )
                    """
                ),
                {
                    "id": payload["id"],
                    "scope_type": payload["scope_type"],
                    "tier_key": payload["tier_key"],
                    "tier_name": payload["tier_name"],
                    "description": payload.get("description"),
                    "max_users": payload["max_users"],
                    "has_unlimited_users": payload["has_unlimited_users"],
                    "max_organizations": payload["max_organizations"],
                    "monthly_admin_fee": payload["monthly_admin_fee"],
                    "per_active_user_fee": payload["per_active_user_fee"],
                    "additional_usage_fee": payload["additional_usage_fee"],
                    "cqi_assessment": payload["cqi_assessment"],
                    "billing_notes": payload.get("billing_notes"),
                    "is_active": True,
                    "sort_order": payload["sort_order"],
                },
            )

        if "tenants" in existing_tables:
            connection.execute(
                text(
                    """
                    UPDATE tenants
                    SET service_tier_definition_id = tier.id
                    FROM service_tier_definitions tier
                    WHERE tenants.service_tier_definition_id IS NULL
                      AND tier.scope_type = 'organization'
                      AND (
                        lower(tenants.plan_tier) = lower(tier.tier_name)
                        OR lower(tenants.plan_tier) = lower(tier.tier_key)
                      )
                    """
                )
            )

        if "reseller_tenant_defaults" in existing_tables:
            connection.execute(
                text(
                    """
                    UPDATE reseller_tenant_defaults
                    SET default_service_tier_definition_id = tier.id
                    FROM service_tier_definitions tier
                    WHERE reseller_tenant_defaults.default_service_tier_definition_id IS NULL
                      AND tier.scope_type = 'organization'
                      AND (
                        lower(reseller_tenant_defaults.default_plan_tier) = lower(tier.tier_name)
                        OR lower(reseller_tenant_defaults.default_plan_tier) = lower(tier.tier_key)
                      )
                    """
                )
            )


def is_postgres(db: Session) -> bool:
    bind = db.get_bind()
    return bool(bind and bind.dialect.name == "postgresql")


def coerce_utc_datetime(value: date | datetime, end_of_day: bool = False) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    time_value = datetime.max.time() if end_of_day else datetime.min.time()
    return datetime.combine(value, time_value, tzinfo=timezone.utc)


def determine_series_granularity(start_at: datetime, end_at: datetime) -> str:
    duration = end_at - start_at
    if duration <= timedelta(hours=36):
        return "hour"
    if duration <= timedelta(days=45):
        return "day"
    return "month"


def build_time_buckets(start_at: datetime, end_at: datetime, granularity: str) -> list[str]:
    if granularity == "hour":
        current = start_at.replace(minute=0, second=0, microsecond=0)
        final = end_at.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
        fmt = lambda value: value.strftime("%Y-%m-%dT%H:00:00Z")
    elif granularity == "month":
        current = start_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        final = end_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        step = None
        fmt = lambda value: value.strftime("%Y-%m-01")
    else:
        current = start_at.replace(hour=0, minute=0, second=0, microsecond=0)
        final = end_at.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)
        fmt = lambda value: value.strftime("%Y-%m-%d")

    buckets: list[str] = []
    while current <= final:
        buckets.append(fmt(current))
        if granularity == "month":
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)
        else:
            current += step  # type: ignore[operator]
    return buckets


def has_live_snapshot(db: Session) -> bool:
    try:
        count = db.execute(text("select count(*) from auth_users")).scalar()
    except Exception:
        return False
    return bool(count)


def get_snapshot_tenant_ids(db: Session) -> list[str]:
    if not has_live_snapshot(db):
        return []
    rows = db.execute(
        text(
            """
            select tenant_id
            from auth_users
            group by tenant_id
            order by count(*) desc, tenant_id
            """
        )
    ).scalars()
    return [row for row in rows if row]


def normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def build_display_name(
    first_name: str | None = None,
    last_name: str | None = None,
    fallback: str | None = None,
) -> str | None:
    combined = " ".join(part.strip() for part in [first_name or "", last_name or ""] if part and part.strip()).strip()
    if combined:
        return combined
    if fallback:
        fallback = fallback.strip()
        return fallback or None
    return None


def auth_tenant_candidates(tenant: Tenant) -> list[str]:
    candidates: list[str] = []
    for candidate in [tenant.external_customer_id, tenant.id, tenant.tenant_key]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def preferred_auth_tenant_id(tenant: Tenant) -> str:
    return tenant.external_customer_id or tenant.id or tenant.tenant_key


def resolve_snapshot_tenant_id(db: Session, tenant: Tenant | None = None) -> str | None:
    snapshot_tenant_ids = get_snapshot_tenant_ids(db)
    if not snapshot_tenant_ids:
        return None
    if tenant and tenant.external_customer_id and tenant.external_customer_id in snapshot_tenant_ids:
        return tenant.external_customer_id
    if tenant and tenant.id in snapshot_tenant_ids:
        return tenant.id
    if tenant and tenant.tenant_key in snapshot_tenant_ids:
        return tenant.tenant_key
    if tenant is None and len(snapshot_tenant_ids) == 1:
        return snapshot_tenant_ids[0]
    return None


def get_snapshot_tenant_metrics(db: Session, tenant: Tenant) -> dict[str, object] | None:
    snapshot_tenant_id = resolve_snapshot_tenant_id(db, tenant)
    if snapshot_tenant_id is None:
        return None

    row = db.execute(
        text(
            """
            select
              count(*) as user_count,
              sum(case when a.is_active then 1 else 0 end) as active_user_count,
              avg(fp.structure) as avg_structure,
              max(coalesce(c.last_seen, a.last_login_at, a.updated_at, a.created_at)) as last_activity_at
            from auth_users a
            left join final_profile fp on fp.user_id_hash = a.user_id_hash
            left join (
              select user_id_hash, max(updated_at) as last_seen
              from conversations
              group by user_id_hash
            ) c on c.user_id_hash = a.user_id_hash
            where a.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": snapshot_tenant_id},
    ).mappings().first()
    if row is None:
        return None
    utilization_pct = None
    if row["avg_structure"] is not None:
        utilization_pct = int(round(float(row["avg_structure"]) * 100))
    return {
        "user_count": int(row["user_count"] or 0),
        "active_user_count": int(row["active_user_count"] or 0),
        "utilization_pct": utilization_pct,
        "last_activity_at": parse_datetime(row["last_activity_at"]),
        "snapshot_tenant_id": snapshot_tenant_id,
    }


def get_snapshot_users(db: Session, tenant: Tenant | None = None) -> list[dict[str, object]]:
    snapshot_tenant_id = resolve_snapshot_tenant_id(db, tenant)
    if tenant is not None and snapshot_tenant_id is None:
        return []
    tenant_clause = "where a.tenant_id = :tenant_id" if snapshot_tenant_id else ""
    params = {"tenant_id": snapshot_tenant_id} if snapshot_tenant_id else {}

    rows = db.execute(
        text(
            f"""
            select
              a.user_id_hash,
              a.tenant_id,
              a.email,
              a.display_name,
              a.is_active,
              a.is_admin,
              a.created_at,
              a.updated_at,
              a.last_login_at,
              conv.sessions_count,
              conv.last_activity_at,
              fp.structure,
              fp.detail_level,
              fp.prompt_enforcement_level
            from auth_users a
            left join (
              select
                user_id_hash,
                count(*) as sessions_count,
                max(updated_at) as last_activity_at
              from conversations
              group by user_id_hash
            ) conv on conv.user_id_hash = a.user_id_hash
            left join final_profile fp on fp.user_id_hash = a.user_id_hash
            {tenant_clause}
            order by coalesce(conv.last_activity_at, a.last_login_at, a.updated_at, a.created_at) desc, a.id desc
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


def get_auth_users(db: Session, user_id_hash: str | None = None) -> list[dict[str, object]]:
    user_filter = "where a.user_id_hash = :user_id_hash" if user_id_hash is not None else ""
    params = {"user_id_hash": user_id_hash} if user_id_hash is not None else {}
    rows = db.execute(
        text(
            f"""
            select
              a.id,
              a.user_id_hash,
              a.tenant_id,
              a.email,
              a.display_name,
              a.is_active,
              a.is_admin,
              a.created_at,
              a.updated_at,
              a.last_login_at,
              a.password_changed_at,
              conv.sessions_count,
              conv.last_activity_at,
              fp.structure,
              fp.detail_level,
              fp.prompt_enforcement_level
            from auth_users a
            left join (
              select
                user_id_hash,
                count(*) as sessions_count,
                max(updated_at) as last_activity_at
              from conversations
              group by user_id_hash
            ) conv on conv.user_id_hash = a.user_id_hash
            left join final_profile fp on fp.user_id_hash = a.user_id_hash
            {user_filter}
            order by coalesce(conv.last_activity_at, a.last_login_at, a.updated_at, a.created_at) desc, a.id desc
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


def upsert_auth_user(
    db: Session,
    *,
    tenant: Tenant,
    user_id_hash: str,
    email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    display_name: str | None = None,
    status: str = "active",
    is_admin: bool | None = None,
) -> dict[str, object]:
    normalized_email = normalize_email(email)
    if normalized_email is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")

    auth_tenant_id = preferred_auth_tenant_id(tenant)
    resolved_display_name = build_display_name(first_name, last_name, display_name) or normalized_email
    desired_is_active = status == "active"

    existing_by_user = db.execute(
        text("select * from auth_users where user_id_hash = :user_id_hash order by id desc limit 1"),
        {"user_id_hash": user_id_hash},
    ).mappings().first()
    existing_by_email = db.execute(
        text("select * from auth_users where lower(email) = :email order by id desc limit 1"),
        {"email": normalized_email},
    ).mappings().first()

    if existing_by_user and existing_by_email and existing_by_user["id"] != existing_by_email["id"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already assigned to a different auth user",
        )

    existing = existing_by_user or existing_by_email
    resolved_is_admin = bool(existing["is_admin"]) if existing and is_admin is None else bool(is_admin)
    now = datetime.utcnow()

    if existing:
        db.execute(
            text(
                """
                update auth_users
                set
                  email = :email,
                  display_name = :display_name,
                  tenant_id = :tenant_id,
                  is_active = :is_active,
                  is_admin = :is_admin,
                  updated_at = :updated_at
                where id = :id
                """
            ),
            {
                "id": existing["id"],
                "email": normalized_email,
                "display_name": resolved_display_name,
                "tenant_id": auth_tenant_id,
                "is_active": desired_is_active,
                "is_admin": resolved_is_admin,
                "updated_at": now,
            },
        )
    else:
        db.execute(
            text(
                """
                insert into auth_users (
                  email,
                  password_hash,
                  user_id_hash,
                  display_name,
                  tenant_id,
                  is_active,
                  is_admin,
                  created_at,
                  updated_at,
                  last_login_at,
                  password_changed_at
                ) values (
                  :email,
                  :password_hash,
                  :user_id_hash,
                  :display_name,
                  :tenant_id,
                  :is_active,
                  :is_admin,
                  :created_at,
                  :updated_at,
                  null,
                  null
                )
                """
            ),
            {
                "email": normalized_email,
                "password_hash": AUTH_USER_DISABLED_PASSWORD_HASH,
                "user_id_hash": user_id_hash,
                "display_name": resolved_display_name,
                "tenant_id": auth_tenant_id,
                "is_active": desired_is_active,
                "is_admin": resolved_is_admin,
                "created_at": now,
                "updated_at": now,
            },
        )

    row = db.execute(
        text("select * from auth_users where user_id_hash = :user_id_hash order by id desc limit 1"),
        {"user_id_hash": user_id_hash},
    ).mappings().first()
    return dict(row) if row else {}


def generate_internal_user_id_hash(email: str | None = None) -> str:
    normalized_email = normalize_email(email) if email else None
    base_label = "user"
    if normalized_email:
        email_local = normalized_email.split("@", 1)[0]
        candidate = re.sub(r"[^a-z0-9]+", "-", email_local.lower()).strip("-")
        if candidate:
            base_label = candidate[:40]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"user-{timestamp}-{base_label}-{uuid4().hex[:8]}"


def ensure_deactivated_users_tenant(db: Session) -> Tenant:
    tenant = db.scalar(select(Tenant).where(Tenant.tenant_key == "Deactivated_Users"))
    if tenant is not None:
        return tenant

    tenant = Tenant(
        tenant_key="Deactivated_Users",
        tenant_name="Deactivated Users",
        status="inactive",
        plan_tier="internal",
        reporting_timezone="America/New_York",
        external_customer_id="Deactivated_Users",
    )
    db.add(tenant)
    db.flush()
    return tenant


def serialize_model(instance) -> str:
    payload = {}
    for column in instance.__table__.columns:
        value = getattr(instance, column.name)
        if isinstance(value, datetime):
            payload[column.name] = value.isoformat()
        else:
            payload[column.name] = value
    return json.dumps(payload, default=str, sort_keys=True)


def write_audit_log(
    db: Session,
    principal: Principal,
    action_type: str,
    target_type: str,
    target_id: str,
    before: str | None = None,
    after: str | None = None,
    request_id: str | None = None,
) -> None:
    db.add(
        AdminAuditLog(
            actor_admin_user_id=principal.admin_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            before_json=before,
            after_json=after,
            request_id=request_id,
        )
    )


def mask_api_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    max_mask_length = 32
    if len(api_key) <= 4:
        return "*" * len(api_key)

    visible_suffix = api_key[-4:]
    masked_prefix = "*" * min(max(len(api_key) - 4, 4), max_mask_length - len(visible_suffix))
    return f"{masked_prefix}{visible_suffix}"


def ensure_scope_access(
    principal: Principal,
    *,
    reseller_partner_id: str | None = None,
    tenant_id: str | None = None,
    group_id: str | None = None,
) -> None:
    if principal.role == "super_admin":
        return

    if not principal.scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No scopes assigned")

    for scope in principal.scopes:
        if scope.scope_type == "global":
            return
        if reseller_partner_id and scope.scope_type == "reseller" and scope.reseller_partner_id == reseller_partner_id:
            return
        if tenant_id and scope.scope_type == "tenant" and scope.tenant_id == tenant_id:
            return
        if group_id and scope.scope_type == "group" and scope.group_id == group_id:
            return
        if reseller_partner_id and tenant_id and scope.scope_type == "reseller" and scope.reseller_partner_id == reseller_partner_id:
            return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requested resource is outside your scope")


def has_minimal_activation_mode(service_mode: str | None) -> bool:
    return service_mode in {"managed_service", "guided_activation", "hybrid"}


def get_tenant_or_404(db: Session, tenant_id: str) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return tenant


def get_group_or_404(db: Session, group_id: str) -> Group:
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


def get_admin_or_404(db: Session, admin_id: str) -> AdminUser:
    admin = db.get(AdminUser, admin_id)
    if admin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")
    return admin


def get_reseller_or_404(db: Session, reseller_id: str) -> ResellerPartner:
    reseller = db.get(ResellerPartner, reseller_id)
    if reseller is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reseller not found")
    return reseller


def get_service_tier_or_404(
    db: Session,
    tier_id: str,
    *,
    scope_type: str | None = None,
    require_active: bool = False,
) -> ServiceTierDefinition:
    tier = db.get(ServiceTierDefinition, tier_id)
    if tier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service tier not found")
    if scope_type and tier.scope_type != scope_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Selected tier must be a {scope_type} tier")
    if require_active and not tier.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected tier is inactive")
    return tier


def resolve_tenant_service_tier(
    db: Session,
    *,
    service_tier_definition_id: str | None,
    plan_tier: str | None,
) -> ServiceTierDefinition | None:
    if service_tier_definition_id:
        return get_service_tier_or_404(
            db,
            service_tier_definition_id,
            scope_type="organization",
            require_active=True,
        )
    if not plan_tier:
        return None
    return db.scalar(
        select(ServiceTierDefinition).where(
            ServiceTierDefinition.scope_type == "organization",
            func.lower(ServiceTierDefinition.tier_name) == plan_tier.strip().lower(),
        )
    )


def count_billable_tenant_memberships(db: Session, tenant_id: str) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(UserTenantMembership).where(
                UserTenantMembership.tenant_id == tenant_id,
                UserTenantMembership.status != "deleted",
            )
        )
        or 0
    )


def tier_user_limit(tier: ServiceTierDefinition | None) -> int | None:
    if tier is None or tier.has_unlimited_users:
        return None
    return tier.max_users


def sync_tenant_service_tier_fields(tenant: Tenant, tier: ServiceTierDefinition | None) -> None:
    tenant.service_tier_definition_id = tier.id if tier else None
    tenant.plan_tier = tier.tier_name if tier else None


def sync_reseller_default_service_tier_fields(
    defaults: ResellerTenantDefaults,
    tier: ServiceTierDefinition | None,
) -> None:
    defaults.default_service_tier_definition_id = tier.id if tier else None
    defaults.default_plan_tier = tier.tier_name if tier else None


def sync_reseller_service_tier_fields(reseller: ResellerPartner, tier: ServiceTierDefinition | None) -> None:
    reseller.service_tier_definition_id = tier.id if tier else None


def validate_tenant_user_limit(
    db: Session,
    tenant: Tenant,
    *,
    additional_users: int = 1,
) -> None:
    limit = tier_user_limit(tenant.service_tier)
    if limit is None:
        return
    current_users = count_billable_tenant_memberships(db, tenant.id)
    if current_users + additional_users > limit:
        if current_users >= limit:
            detail = f"No more users allowed. {tenant.tenant_name} is already at {current_users} of {limit} allocated users."
        else:
            detail = (
                f"Adding {additional_users} user"
                f"{'' if additional_users == 1 else 's'} would exceed the service tier limit. "
                f"{tenant.tenant_name} is currently at {current_users} of {limit} allocated users."
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


def tenant_consumes_reseller_capacity(tenant: Tenant) -> bool:
    return tenant.status != "inactive"


def validate_reseller_capacity(
    db: Session,
    reseller: ResellerPartner,
    *,
    candidate_tier: ServiceTierDefinition | None = None,
    tenant_to_include: Tenant | None = None,
    tenant_tier_override: ServiceTierDefinition | None = None,
) -> None:
    tier = candidate_tier or reseller.service_tier
    if tier is None:
        return

    assigned_tenants = list(
        db.scalars(select(Tenant).where(Tenant.reseller_partner_id == reseller.id).order_by(Tenant.created_at.asc()))
    )
    projected_tenants: list[tuple[Tenant, ServiceTierDefinition | None]] = []
    seen_ids: set[str] = set()
    for item in assigned_tenants:
        if tenant_to_include is not None and item.id == tenant_to_include.id:
            continue
        seen_ids.add(item.id)
        projected_tenants.append((item, item.service_tier))
    if tenant_to_include is not None and tenant_to_include.id not in seen_ids:
        projected_tenants.append((tenant_to_include, tenant_tier_override or tenant_to_include.service_tier))

    consuming_tenants = [(tenant, assigned_tier) for tenant, assigned_tier in projected_tenants if tenant_consumes_reseller_capacity(tenant)]

    if tier.max_organizations is not None and len(consuming_tenants) > tier.max_organizations:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{reseller.reseller_name} exceeds its reseller tier limit of {tier.max_organizations} organizations",
        )

    reseller_user_limit = tier_user_limit(tier)
    if reseller_user_limit is None:
        return

    allocated_users = 0
    for tenant, assigned_tier in consuming_tenants:
        if assigned_tier is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{tenant.tenant_name} needs an organization service tier before it can be assigned to {reseller.reseller_name}",
            )
        tier_limit = tier_user_limit(assigned_tier)
        if tier_limit is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{tenant.tenant_name} uses an unlimited organization tier that cannot be placed under the limited reseller tier {tier.tier_name}",
            )
        allocated_users += tier_limit

    if allocated_users > reseller_user_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{reseller.reseller_name} exceeds its reseller tier allocation of {reseller_user_limit} users. "
                f"The current organization tier mix allocates {allocated_users} users."
            ),
        )


def refresh_onboarding_state(db: Session, tenant_id: str) -> TenantOnboardingStatus:
    onboarding = db.scalar(select(TenantOnboardingStatus).where(TenantOnboardingStatus.tenant_id == tenant_id))
    tenant = get_tenant_or_404(db, tenant_id)

    if onboarding is None:
        onboarding = TenantOnboardingStatus(tenant_id=tenant_id, tenant_created=True)
        db.add(onboarding)

    llm_config = db.scalar(select(TenantLLMConfig).where(TenantLLMConfig.tenant_id == tenant_id))
    group_count = db.scalar(select(func.count()).select_from(Group).where(Group.tenant_id == tenant_id)) or 0
    user_count = (
        db.scalar(select(func.count()).select_from(UserTenantMembership).where(UserTenantMembership.tenant_id == tenant_id))
        or 0
    )
    snapshot_metrics = get_snapshot_tenant_metrics(db, tenant)
    if snapshot_metrics and user_count == 0:
        user_count = int(snapshot_metrics["user_count"])
    admin_count = (
        db.scalar(select(func.count()).select_from(AdminScope).where(AdminScope.tenant_id == tenant_id)) or 0
    )

    onboarding.tenant_created = True
    onboarding.llm_configured = llm_config is not None
    onboarding.llm_validated = bool(llm_config and llm_config.credential_status == "valid")
    onboarding.groups_created = group_count > 0
    onboarding.users_uploaded = user_count > 0
    onboarding.admin_assigned = admin_count > 0

    readiness = [
        onboarding.llm_configured,
        onboarding.llm_validated,
        onboarding.admin_assigned,
        onboarding.users_uploaded,
    ]
    if all(readiness):
        onboarding.onboarding_status = "ready" if tenant.status != "active" else "live"
    elif any(readiness):
        onboarding.onboarding_status = "in_progress"
    else:
        onboarding.onboarding_status = "draft"

    return onboarding


def revoke_tenant_invitations(db: Session, tenant_id: str) -> None:
    db.execute(delete(UserInvitation).where(UserInvitation.tenant_id == tenant_id))


def disable_tenant_user_logins(db: Session, tenant: Tenant) -> list[str]:
    tenant_candidates = auth_tenant_candidates(tenant)
    user_ids = [
        row["user_id_hash"]
        for row in db.execute(
            text(
                """
                select distinct user_id_hash
                from user_tenant_membership
                where tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant.id},
        ).mappings()
    ]
    now = datetime.utcnow()
    if tenant_candidates:
        db.execute(
            text(
                """
                update auth_users
                set
                  is_active = false,
                  password_hash = :password_hash,
                  last_login_at = null,
                  password_changed_at = null,
                  updated_at = :updated_at
                where tenant_id in :tenant_candidates
                """
            ).bindparams(bindparam("tenant_candidates", expanding=True)),
            {
                "password_hash": AUTH_USER_DISABLED_PASSWORD_HASH,
                "updated_at": now,
                "tenant_candidates": tenant_candidates,
            },
        )
    db.execute(
        text(
            """
            update user_tenant_membership
            set
              status = 'inactive',
              updated_at = :updated_at
            where tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant.id, "updated_at": now},
    )
    revoke_tenant_invitations(db, tenant.id)
    return [str(user_id) for user_id in user_ids]


def reset_tenant_state(db: Session, tenant: Tenant) -> list[str]:
    user_ids = disable_tenant_user_logins(db, tenant)
    tenant.status = "onboarding"
    return user_ids


def inactivate_tenant_state(db: Session, tenant: Tenant) -> list[str]:
    user_ids = disable_tenant_user_logins(db, tenant)
    tenant.status = "inactive"
    return user_ids


def delete_tenant_and_users(db: Session, tenant: Tenant) -> list[str]:
    tenant_candidates = auth_tenant_candidates(tenant)
    group_ids = [
        row["id"]
        for row in db.execute(
            text("select id from groups where tenant_id = :tenant_id"),
            {"tenant_id": tenant.id},
        ).mappings()
    ]
    membership_user_ids = [
        row["user_id_hash"]
        for row in db.execute(
            text("select distinct user_id_hash from user_tenant_membership where tenant_id = :tenant_id"),
            {"tenant_id": tenant.id},
        ).mappings()
    ]
    auth_user_ids = []
    if tenant_candidates:
        auth_user_ids = [
            row["user_id_hash"]
            for row in db.execute(
                text("select distinct user_id_hash from auth_users where tenant_id in :tenant_candidates").bindparams(
                    bindparam("tenant_candidates", expanding=True)
                ),
                {"tenant_candidates": tenant_candidates},
            ).mappings()
        ]
    all_user_ids = sorted({str(user_id) for user_id in [*membership_user_ids, *auth_user_ids]})
    scoped_admin_ids = [
        row["admin_user_id"]
        for row in db.execute(
            text(
                """
                select distinct admin_user_id
                from admin_scopes
                where tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant.id},
        ).mappings()
    ] if table_exists(db, "admin_scopes") else []
    if group_ids and table_exists(db, "admin_scopes"):
        group_admin_ids = [
            row["admin_user_id"]
            for row in db.execute(
                text(
                    """
                    select distinct admin_user_id
                    from admin_scopes
                    where group_id in :group_ids
                    """
                ).bindparams(bindparam("group_ids", expanding=True)),
                {"group_ids": group_ids},
            ).mappings()
        ]
        scoped_admin_ids = sorted({*scoped_admin_ids, *group_admin_ids})

    revoke_tenant_invitations(db, tenant.id)

    if table_exists(db, "admin_scopes"):
        db.execute(delete(AdminScope).where(AdminScope.tenant_id == tenant.id))
        if group_ids:
            db.execute(
                delete(AdminScope).where(AdminScope.group_id.in_(group_ids))
            )

    if table_exists(db, "user_group_membership"):
        if group_ids:
            db.execute(delete(UserGroupMembership).where(UserGroupMembership.group_id.in_(group_ids)))
        membership_ids = [
            row["id"]
            for row in db.execute(
                text("select id from user_tenant_membership where tenant_id = :tenant_id"),
                {"tenant_id": tenant.id},
            ).mappings()
        ]
        if membership_ids:
            db.execute(
                delete(UserGroupMembership).where(UserGroupMembership.tenant_membership_id.in_(membership_ids))
            )

    membership_ids = [
        row["id"]
        for row in db.execute(
            text("select id from user_tenant_membership where tenant_id = :tenant_id"),
            {"tenant_id": tenant.id},
        ).mappings()
    ]
    if membership_ids:
        db.execute(delete(UserMembershipProfile).where(UserMembershipProfile.tenant_membership_id.in_(membership_ids)))
    db.execute(delete(UserTenantMembership).where(UserTenantMembership.tenant_id == tenant.id))

    if group_ids:
        db.execute(delete(GroupProfile).where(GroupProfile.group_id.in_(group_ids)))
    db.execute(delete(Group).where(Group.tenant_id == tenant.id))
    db.execute(
        delete(ReportExportJob).where(
            ReportExportJob.scope_type == "organization",
            ReportExportJob.scope_id == tenant.id,
        )
    )
    if group_ids:
        db.execute(
            delete(ReportExportJob).where(
                ReportExportJob.scope_type == "group",
                ReportExportJob.scope_id.in_(group_ids),
            )
        )

    if all_user_ids and table_exists(db, "final_profile"):
        db.execute(
            text("delete from final_profile where user_id_hash in :user_ids").bindparams(
                bindparam("user_ids", expanding=True)
            ),
            {"user_ids": all_user_ids},
        )
    if all_user_ids and table_exists(db, "conversations"):
        db.execute(
            text("delete from conversations where user_id_hash in :user_ids").bindparams(
                bindparam("user_ids", expanding=True)
            ),
            {"user_ids": all_user_ids},
        )
    if tenant_candidates and table_exists(db, "auth_users"):
        db.execute(
            text("delete from auth_users where tenant_id in :tenant_candidates").bindparams(
                bindparam("tenant_candidates", expanding=True)
            ),
            {"tenant_candidates": tenant_candidates},
        )

    candidate_admin_user_hashes = set(all_user_ids)
    for admin_id in scoped_admin_ids:
        admin = db.get(AdminUser, admin_id)
        if admin is None:
            continue
        candidate_admin_user_hashes.add(admin.user_id_hash)

    for user_id_hash in candidate_admin_user_hashes:
        admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == user_id_hash))
        if admin is None:
            continue
        remaining_scope_count = db.scalar(
            select(func.count()).select_from(AdminScope).where(AdminScope.admin_user_id == admin.id)
        ) or 0
        if remaining_scope_count == 0:
            db.execute(delete(AdminPermission).where(AdminPermission.admin_user_id == admin.id))
            if admin.profile is not None:
                db.delete(admin.profile)
            db.delete(admin)

    if tenant.llm_config is not None:
        db.delete(tenant.llm_config)
    if tenant.runtime_settings is not None:
        db.delete(tenant.runtime_settings)
    if tenant.onboarding_status is not None:
        db.delete(tenant.onboarding_status)
    if tenant.profile is not None:
        db.delete(tenant.profile)
    if tenant.portal_config is not None:
        db.delete(tenant.portal_config)

    db.delete(tenant)
    return all_user_ids


def validate_activation_readiness(db: Session, tenant: Tenant) -> None:
    onboarding = refresh_onboarding_state(db, tenant.id)
    llm_config = db.scalar(select(TenantLLMConfig).where(TenantLLMConfig.tenant_id == tenant.id))
    service_mode = tenant.profile.service_mode if tenant.profile else None
    if not onboarding.admin_assigned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant cannot be activated until an admin is assigned")
    if not onboarding.users_uploaded:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant must have at least one user")

    if has_minimal_activation_mode(service_mode):
        return

    if not onboarding.llm_configured or not onboarding.llm_validated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant cannot be activated until the LLM configuration is saved and validated",
        )
    if llm_config and not llm_config.transformation_enabled and not llm_config.scoring_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Runtime configuration would do nothing")


def can_view_audit_entry(db: Session, principal: Principal, entry: AdminAuditLog) -> bool:
    if principal.role == "super_admin":
        return True

    try:
        if entry.target_type in {"tenant", "tenant_profile", "tenant_runtime_settings", "tenant_llm_config", "tenant_portal_config"}:
            tenant = db.get(Tenant, entry.target_id)
            if tenant is None:
                return False
            ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
            return True

        if entry.target_type in {"group", "group_profile"}:
            group = db.get(Group, entry.target_id)
            if group is None:
                profile = db.get(GroupProfile, entry.target_id)
                if profile is None:
                    return False
                group = db.get(Group, profile.group_id)
            if group is None:
                return False
            tenant = db.get(Tenant, group.tenant_id)
            ensure_scope_access(
                principal,
                reseller_partner_id=tenant.reseller_partner_id if tenant else None,
                tenant_id=group.tenant_id,
                group_id=group.id,
            )
            return True

        if entry.target_type == "reseller_partner":
            ensure_scope_access(principal, reseller_partner_id=entry.target_id)
            return True

        if entry.target_type == "report_export_job":
            job = db.get(ReportExportJob, entry.target_id)
            if job is None:
                return False
            ensure_scope_access(
                principal,
                reseller_partner_id=job.scope_id if job.scope_type == "reseller" else None,
                tenant_id=job.scope_id if job.scope_type == "organization" else None,
                group_id=job.scope_id if job.scope_type == "group" else None,
            )
            return True

        if entry.target_type == "admin_user":
            admin = db.get(AdminUser, entry.target_id)
            if admin is None:
                return False
            scopes = list(db.scalars(select(AdminScope).where(AdminScope.admin_user_id == admin.id)))
            for scope in scopes:
                ensure_scope_access(
                    principal,
                    reseller_partner_id=scope.reseller_partner_id,
                    tenant_id=scope.tenant_id,
                    group_id=scope.group_id,
                )
                return True
            return False
    except HTTPException:
        return False

    return False


def build_report_payload(db: Session, scope_type: str, scope_id: str, start_date: date | datetime, end_date: date | datetime) -> dict:
    tenant = db.get(Tenant, scope_id) if scope_type == "organization" else None
    snapshot_tenant_id = resolve_snapshot_tenant_id(db, tenant) if scope_type == "organization" else None
    start_at = coerce_utc_datetime(start_date)
    end_at = coerce_utc_datetime(end_date, end_of_day=isinstance(end_date, date) and not isinstance(end_date, datetime))
    granularity = determine_series_granularity(start_at, end_at)
    if is_postgres(db):
        bucket_expr = {
            "hour": "to_char(date_trunc('hour', {column} at time zone 'UTC'), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"')",
            "day": "to_char(({column} at time zone 'UTC')::date, 'YYYY-MM-DD')",
            "month": "to_char(date_trunc('month', {column} at time zone 'UTC'), 'YYYY-MM-01')",
        }[granularity]
        timestamp_predicate = "{column} between :start and :end"
    else:
        bucket_expr = {
            "hour": "strftime('%Y-%m-%dT%H:00:00Z', datetime({column}))",
            "day": "strftime('%Y-%m-%d', datetime({column}))",
            "month": "strftime('%Y-%m-01', datetime({column}))",
        }[granularity]
        timestamp_predicate = "datetime({column}) between datetime(:start) and datetime(:end)"

    if has_live_snapshot(db):
        if scope_type == "organization" and snapshot_tenant_id:
            params = {"tenant_id": snapshot_tenant_id, "start": start_at.isoformat(), "end": end_at.isoformat()}
            active_users = int(
                db.execute(
                    text("select count(*) from auth_users where tenant_id = :tenant_id and is_active"),
                    {"tenant_id": snapshot_tenant_id},
                ).scalar()
                or 0
            )
            session_user_count = int(
                db.execute(
                    text(
                        """
                        select count(distinct a.user_id_hash)
                        from auth_users a
                        join conversations c on c.user_id_hash = a.user_id_hash
                        where a.tenant_id = :tenant_id
                          and a.is_active
                        """
                    ),
                    {"tenant_id": snapshot_tenant_id},
                ).scalar()
                or 0
            )
            active_groups = 0
            tenant_count = 1
            average_improvement = float(
                db.execute(
                    text(
                        """
                        select avg(final_score - initial_score)
                        from conversation_prompt_scores s
                        where s.user_id_hash in (
                          select user_id_hash from auth_users where tenant_id = :tenant_id
                        )
                          and {time_predicate}
                        """
                        .format(time_predicate=timestamp_predicate.format(column="s.conversation_started_at"))
                    ),
                    params,
                ).scalar()
                or 0
            )
            conversation_rows = db.execute(
                text(
                    """
                    select {bucket} as bucket, count(*) as value
                    from conversations c
                    where user_id_hash in (
                      select user_id_hash from auth_users where tenant_id = :tenant_id
                    )
                      and {time_predicate}
                    group by {bucket}
                    order by bucket
                    """.format(
                        bucket=bucket_expr.format(column="c.created_at"),
                        time_predicate=timestamp_predicate.format(column="c.created_at"),
                    )
                ),
                params,
            ).mappings().all()
            improvement_rows = db.execute(
                text(
                    """
                    select {bucket} as bucket, avg(final_score - initial_score) as value
                    from conversation_prompt_scores s
                    where s.user_id_hash in (
                      select user_id_hash from auth_users where tenant_id = :tenant_id
                    )
                      and {time_predicate}
                    group by {bucket}
                    order by bucket
                    """.format(
                        bucket=bucket_expr.format(column="s.conversation_started_at"),
                        time_predicate=timestamp_predicate.format(column="s.conversation_started_at"),
                    )
                ),
                params,
            ).mappings().all()
        elif scope_type == "global":
            active_users = int(db.execute(text("select count(*) from auth_users where is_active")).scalar() or 0)
            session_user_count = int(
                db.execute(
                    text(
                        """
                        select count(distinct a.user_id_hash)
                        from auth_users a
                        join conversations c on c.user_id_hash = a.user_id_hash
                        where a.is_active
                        """
                    )
                ).scalar()
                or 0
            )
            active_groups = 0
            tenant_count = len(get_snapshot_tenant_ids(db))
            average_improvement = float(
                db.execute(
                    text(
                        """
                        select avg(final_score - initial_score)
                        from conversation_prompt_scores s
                        where {time_predicate}
                        """
                        .format(time_predicate=timestamp_predicate.format(column="s.conversation_started_at"))
                    ),
                    {"start": start_at.isoformat(), "end": end_at.isoformat()},
                ).scalar()
                or 0
            )
            conversation_rows = db.execute(
                text(
                    """
                    select {bucket} as bucket, count(*) as value
                    from conversations c
                    where {time_predicate}
                    group by {bucket}
                    order by bucket
                    """.format(
                        bucket=bucket_expr.format(column="c.created_at"),
                        time_predicate=timestamp_predicate.format(column="c.created_at"),
                    )
                ),
                {"start": start_at.isoformat(), "end": end_at.isoformat()},
            ).mappings().all()
            improvement_rows = db.execute(
                text(
                    """
                    select {bucket} as bucket, avg(final_score - initial_score) as value
                    from conversation_prompt_scores s
                    where {time_predicate}
                    group by {bucket}
                    order by bucket
                    """.format(
                        bucket=bucket_expr.format(column="s.conversation_started_at"),
                        time_predicate=timestamp_predicate.format(column="s.conversation_started_at"),
                    )
                ),
                {"start": start_at.isoformat(), "end": end_at.isoformat()},
            ).mappings().all()
        else:
            conversation_rows = []
            improvement_rows = []
            average_improvement = 0.0
            active_users = 0
            session_user_count = 0
            active_groups = 0
            tenant_count = 0

        if scope_type in {"organization", "global"}:
            usage_by_bucket = {row["bucket"]: round(float(row["value"]), 2) for row in conversation_rows}
            improvement_by_bucket = {
                row["bucket"]: round(float(row["value"]), 2) for row in improvement_rows if row["value"] is not None
            }
            buckets = build_time_buckets(start_at, end_at, granularity)
            usage_series = [{"bucket": bucket, "value": usage_by_bucket.get(bucket, 0)} for bucket in buckets]
            improvement_series = [{"bucket": bucket, "value": improvement_by_bucket.get(bucket)} for bucket in buckets]
            return {
                "active_users": active_users,
                "session_user_count": session_user_count,
                "active_groups": active_groups,
                "tenant_count": tenant_count,
                "average_improvement": round(average_improvement, 2),
                "usage_series": usage_series,
                "improvement_series": improvement_series,
            }

    active_users_query = select(func.count()).select_from(UserTenantMembership)
    active_groups_query = select(func.count()).select_from(Group).where(Group.is_active.is_(True))
    tenant_count_query = select(func.count()).select_from(Tenant)

    if scope_type == "organization":
        active_users_query = active_users_query.where(UserTenantMembership.tenant_id == scope_id)
        active_groups_query = active_groups_query.where(Group.tenant_id == scope_id)
        tenant_count = 1
        session_user_count = (
            db.scalar(
                select(func.count())
                .select_from(UserTenantMembership)
                .join(UserMembershipProfile, UserMembershipProfile.tenant_membership_id == UserTenantMembership.id)
                .where(
                    UserTenantMembership.tenant_id == scope_id,
                    UserTenantMembership.status == "active",
                    UserMembershipProfile.sessions_count > 0,
                )
            )
            or 0
        )
    elif scope_type == "group":
        memberships = db.scalar(
            select(func.count()).select_from(UserGroupMembership).where(UserGroupMembership.group_id == scope_id)
        ) or 0
        active_users = memberships
        active_groups = 1
        tenant_count = 1
        session_user_count = memberships
    elif scope_type == "reseller":
        tenant_ids = list(
            db.scalars(select(Tenant.id).where(Tenant.reseller_partner_id == scope_id))
        )
        active_users_query = active_users_query.where(UserTenantMembership.tenant_id.in_(tenant_ids))
        active_groups_query = active_groups_query.where(Group.tenant_id.in_(tenant_ids))
        tenant_count = len(tenant_ids)
        session_user_count = (
            db.scalar(
                select(func.count())
                .select_from(UserTenantMembership)
                .join(UserMembershipProfile, UserMembershipProfile.tenant_membership_id == UserTenantMembership.id)
                .where(
                    UserTenantMembership.tenant_id.in_(tenant_ids),
                    UserTenantMembership.status == "active",
                    UserMembershipProfile.sessions_count > 0,
                )
            )
            or 0
        )
    else:
        tenant_count = db.scalar(tenant_count_query) or 0
        session_user_count = (
            db.scalar(
                select(func.count())
                .select_from(UserTenantMembership)
                .join(UserMembershipProfile, UserMembershipProfile.tenant_membership_id == UserTenantMembership.id)
                .where(
                    UserTenantMembership.status == "active",
                    UserMembershipProfile.sessions_count > 0,
                )
            )
            or 0
        )

    if scope_type != "group":
        active_users = db.scalar(active_users_query.where(UserTenantMembership.status == "active")) or 0
        active_groups = db.scalar(active_groups_query) or 0

    buckets = build_time_buckets(start_at, end_at, granularity)
    usage_series = []
    improvement_series = []
    for index, bucket in enumerate(buckets):
        usage_series.append(
            {
                "bucket": bucket,
                "value": round(50 + (index * 2.4) + (active_users * 0.3), 2),
            }
        )
        improvement_series.append(
            {
                "bucket": bucket,
                "value": round(8.5 + min(active_users, 20) * 0.7 + (index * 0.4), 2),
            }
        )

    return {
        "active_users": active_users,
        "session_user_count": session_user_count,
        "active_groups": active_groups,
        "tenant_count": tenant_count,
        "average_improvement": round(8.5 + min(active_users, 20) * 0.7, 2),
        "usage_series": usage_series,
        "improvement_series": improvement_series,
    }


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_simple_pdf(lines: list[str]) -> bytes:
    content_lines = ["BT", "/F1 12 Tf", "50 760 Td", "14 TL"]
    for index, line in enumerate(lines):
        if index == 0:
            content_lines.append(f"({_escape_pdf_text(line)}) Tj")
        else:
            content_lines.append("T*")
            content_lines.append(f"({_escape_pdf_text(line)}) Tj")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("utf-8")

    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        f"5 0 obj << /Length {len(content_stream)} >> stream\n".encode("utf-8")
        + content_stream
        + b"\nendstream endobj\n",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n".encode("utf-8"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    pdf.extend(
        f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode("utf-8")
    )
    return bytes(pdf)


def create_export_file(job: ReportExportJob, payload: dict) -> str:
    export_dir = Path("data/exports")
    export_dir.mkdir(parents=True, exist_ok=True)
    export_extension = "pdf" if job.format == "pdf" else "csv"
    file_path = export_dir / f"{job.id}.{export_extension}"
    rows = [
        "metric,value",
        f"report_type,{job.report_type}",
        f"scope_type,{job.scope_type}",
        f"scope_id,{job.scope_id}",
        f"active_users,{payload['active_users']}",
        f"active_groups,{payload['active_groups']}",
        f"tenant_count,{payload['tenant_count']}",
        f"average_improvement,{payload['average_improvement']}",
    ]
    if job.format == "pdf":
        pdf_lines = [
            f"Report Export: {job.report_type}",
            f"Scope: {job.scope_type} / {job.scope_id}",
            f"Active Users: {payload['active_users']}",
            f"Active Groups: {payload['active_groups']}",
            f"Tenant Count: {payload['tenant_count']}",
            f"Average Improvement: {payload['average_improvement']}",
        ]
        file_path.write_bytes(_build_simple_pdf(pdf_lines))
    else:
        file_path.write_text("\n".join(rows), encoding="utf-8")
    return str(file_path)


def upsert_tenant_profile(db: Session, tenant: Tenant, payload: dict[str, object]) -> TenantProfile:
    profile = tenant.profile or TenantProfile(tenant_id=tenant.id)
    for key in [
        "organization_type",
        "industry",
        "primary_contact_name",
        "primary_contact_email",
        "service_mode",
        "deployment_notes",
    ]:
        if key in payload:
            setattr(profile, key, payload[key])
    db.add(profile)
    tenant.profile = profile
    return profile


def upsert_tenant_portal_config(
    db: Session,
    tenant: Tenant,
    payload: dict[str, object],
    *,
    default_portal_base_url: str,
    created_by_admin_user_id: str | None = None,
) -> TenantPortalConfig:
    portal_config = tenant.portal_config or TenantPortalConfig(
        tenant_id=tenant.id,
        portal_base_url=default_portal_base_url,
    )
    if tenant.portal_config is None and created_by_admin_user_id:
        portal_config.created_by_admin_user_id = created_by_admin_user_id

    for key in ["portal_base_url", "logo_url", "welcome_message", "is_active"]:
        if key in payload:
            setattr(portal_config, key, payload[key])

    if not portal_config.portal_base_url:
        portal_config.portal_base_url = default_portal_base_url

    db.add(portal_config)
    tenant.portal_config = portal_config
    return portal_config


def upsert_group_profile(db: Session, group: Group, payload: dict[str, object]) -> GroupProfile:
    profile = group.profile or GroupProfile(group_id=group.id)
    for key in ["description", "business_unit", "owner_name"]:
        if key in payload:
            setattr(profile, key, payload[key])
    db.add(profile)
    group.profile = profile
    return profile


def upsert_user_membership_profile(
    db: Session,
    membership: UserTenantMembership,
    payload: dict[str, object],
) -> UserMembershipProfile:
    profile = membership.profile or UserMembershipProfile(tenant_membership_id=membership.id)
    for key in [
        "first_name",
        "last_name",
        "email",
        "title",
        "utilization_level",
        "sessions_count",
        "avg_improvement_pct",
    ]:
        if key in payload and payload[key] is not None:
            setattr(profile, key, payload[key])
    if "last_activity_at" in payload:
        profile.last_activity_at = payload["last_activity_at"]  # type: ignore[assignment]
    db.add(profile)
    membership.profile = profile
    return profile


def upsert_admin_profile(db: Session, admin: AdminUser, payload: dict[str, object]) -> AdminProfile:
    profile = admin.profile or AdminProfile(admin_user_id=admin.id)
    for key in ["display_name", "email"]:
        if key in payload:
            setattr(profile, key, payload[key])
    db.add(profile)
    admin.profile = profile
    return profile


def get_or_create_reseller_defaults(db: Session, reseller: ResellerPartner) -> ResellerTenantDefaults:
    defaults = reseller.tenant_defaults or db.scalar(
        select(ResellerTenantDefaults).where(ResellerTenantDefaults.reseller_partner_id == reseller.id)
    )
    if defaults is None:
        defaults = ResellerTenantDefaults(
            reseller_partner_id=reseller.id,
            default_reporting_timezone="America/New_York",
            default_enforcement_mode="coaching",
            default_feature_flags_json=json.dumps(
                {
                    "onboarding_assistant": True,
                    "portfolio_reporting": True,
                },
                sort_keys=True,
            ),
            default_credential_mode="customer_managed",
            default_transformation_enabled=True,
            default_scoring_enabled=True,
        )
        db.add(defaults)
        reseller.tenant_defaults = defaults
        db.flush()
    return defaults


def apply_reseller_defaults_to_tenant(
    db: Session,
    tenant: Tenant,
    defaults: ResellerTenantDefaults | None,
    *,
    default_portal_base_url: str,
) -> None:
    if defaults is None:
        return

    if tenant.service_tier_definition_id is None and defaults.default_service_tier is not None:
        sync_tenant_service_tier_fields(tenant, defaults.default_service_tier)
    elif tenant.plan_tier is None and defaults.default_plan_tier:
        tenant.plan_tier = defaults.default_plan_tier
    if not tenant.reporting_timezone and defaults.default_reporting_timezone:
        tenant.reporting_timezone = defaults.default_reporting_timezone

    profile = tenant.profile or TenantProfile(tenant_id=tenant.id)
    if profile.service_mode is None and defaults.default_service_mode:
        profile.service_mode = defaults.default_service_mode
    db.add(profile)
    tenant.profile = profile

    if (
        defaults.default_portal_base_url
        or defaults.default_portal_logo_url
        or defaults.default_portal_welcome_message
    ):
        portal_config = tenant.portal_config or TenantPortalConfig(
            tenant_id=tenant.id,
            portal_base_url=defaults.default_portal_base_url or default_portal_base_url,
            logo_url=defaults.default_portal_logo_url,
            welcome_message=defaults.default_portal_welcome_message,
            is_active=True,
        )
        if tenant.portal_config is None:
            db.add(portal_config)
            tenant.portal_config = portal_config

    runtime_settings = tenant.runtime_settings or TenantRuntimeSettings(tenant_id=tenant.id)
    if tenant.runtime_settings is None:
        runtime_settings.enforcement_mode = defaults.default_enforcement_mode or runtime_settings.enforcement_mode
        runtime_settings.reporting_enabled = defaults.default_reporting_enabled
        runtime_settings.export_enabled = defaults.default_export_enabled
        runtime_settings.raw_prompt_retention_enabled = defaults.default_raw_prompt_retention_enabled
        runtime_settings.raw_prompt_admin_visibility = defaults.default_raw_prompt_admin_visibility
        runtime_settings.data_retention_days = defaults.default_data_retention_days
        runtime_settings.feature_flags_json = defaults.default_feature_flags_json or "{}"
        db.add(runtime_settings)
        tenant.runtime_settings = runtime_settings

    should_seed_llm = (
        defaults.default_platform_managed_config_id
        or (defaults.default_provider_type and defaults.default_model_name)
    )
    if should_seed_llm and tenant.llm_config is None:
        llm_config = TenantLLMConfig(
            tenant_id=tenant.id,
            provider_type=defaults.default_provider_type or "",
            model_name=defaults.default_model_name or "",
            endpoint_url=defaults.default_endpoint_url,
            platform_managed_config_id=defaults.default_platform_managed_config_id,
            credential_mode=defaults.default_credential_mode,
            transformation_enabled=defaults.default_transformation_enabled,
            scoring_enabled=defaults.default_scoring_enabled,
            credential_status="unvalidated",
            last_validation_message="Seeded from reseller defaults; validation pending",
        )
        if defaults.default_platform_managed_config_id:
            platform_config = db.get(PlatformManagedLlmConfig, defaults.default_platform_managed_config_id)
            if platform_config is not None:
                llm_config.provider_type = platform_config.provider_type
                llm_config.model_name = platform_config.model_name
                llm_config.endpoint_url = platform_config.endpoint_url
                llm_config.secret_reference = platform_config.secret_reference
                llm_config.api_key_masked = platform_config.api_key_masked
                llm_config.secret_source = platform_config.secret_source
                llm_config.vault_provider = platform_config.vault_provider
        db.add(llm_config)
        tenant.llm_config = llm_config


def seed_database(db: Session) -> None:
    existing_admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == "local-dev-admin"))
    existing_tenant = db.scalar(select(Tenant).where(Tenant.tenant_key == "demo-tenant"))
    existing_db_instance = db.scalar(select(DatabaseInstanceConfig).where(DatabaseInstanceConfig.label == "Local Admin SQLite"))
    existing_prompt_ui_instance = db.scalar(select(PromptUiInstanceConfig).where(PromptUiInstanceConfig.label == "Herman Prompt Demo"))

    if existing_admin and existing_tenant and existing_db_instance and existing_prompt_ui_instance:
        if existing_tenant.profile is None:
            db.add(
                TenantProfile(
                    tenant_id=existing_tenant.id,
                    organization_type="Customer Organization",
                    industry="Life Sciences",
                    primary_contact_name="Jordan Lee",
                    primary_contact_email="jordan.lee@hermanscience.example",
                    service_mode="guided_activation",
                    deployment_notes="Local HermanScience tenant for admin testing.",
                    utilization_pct=87,
                )
            )
            db.commit()
        existing_tenant.tenant_name = "HermanScience"
        db.commit()
        return

    reseller = db.scalar(select(ResellerPartner).where(ResellerPartner.reseller_key == "demo-reseller"))
    if reseller is None:
        reseller = ResellerPartner(reseller_key="demo-reseller", reseller_name="Demo Reseller")
        db.add(reseller)
        db.flush()

    admin = existing_admin
    if admin is None:
        admin = AdminUser(user_id_hash="local-dev-admin", role="super_admin", is_active=True)
        db.add(admin)
        db.flush()

    if admin.profile is None:
        db.add(AdminProfile(admin_user_id=admin.id, display_name="Michael Anderson", email="michael@example.com"))

    if not admin.scopes:
        db.add(AdminScope(admin_user_id=admin.id, scope_type="global"))

    existing_permission = db.scalar(
        select(AdminPermission).where(
            AdminPermission.admin_user_id == admin.id,
            AdminPermission.permission_key == "system_health.read",
        )
    )
    if existing_permission is None:
        db.add(AdminPermission(admin_user_id=admin.id, permission_key="system_health.read"))

    tenant = existing_tenant
    if tenant is None:
        tenant = Tenant(
            tenant_key="demo-tenant",
            tenant_name="HermanScience",
            reseller_partner_id=reseller.id,
            status="onboarding",
            plan_tier="enterprise",
            reporting_timezone="America/New_York",
        )
        db.add(tenant)
        db.flush()

    if tenant.runtime_settings is None:
        db.add(TenantRuntimeSettings(tenant_id=tenant.id, enforcement_mode="coaching"))

    if tenant.onboarding_status is None:
        db.add(TenantOnboardingStatus(tenant_id=tenant.id, tenant_created=True, onboarding_status="draft"))

    if tenant.profile is None:
        db.add(
            TenantProfile(
                tenant_id=tenant.id,
                organization_type="Customer Organization",
                industry="Life Sciences",
                primary_contact_name="Jordan Lee",
                primary_contact_email="jordan.lee@hermanscience.example",
                service_mode="guided_activation",
                deployment_notes="Local HermanScience tenant for admin testing.",
                utilization_pct=87,
            )
        )

    if existing_db_instance is None:
        db.add(
            DatabaseInstanceConfig(
                label="Local Admin SQLite",
                db_kind="sqlite",
                host="localhost",
                database_name="herman_admin.db",
                connection_string_masked="sqlite:///./data/herman_admin.db",
                notes="Local development database for the admin tool.",
                is_active=True,
                managed_via_db_only=True,
            )
        )
    if existing_prompt_ui_instance is None:
        db.add(
            PromptUiInstanceConfig(
                label="Herman Prompt Demo",
                base_url="https://herman-prompt-demo-production-5b99.up.railway.app",
                notes="Current active Herman Prompt UI for development and validation.",
                is_active=True,
            )
        )
    db.commit()
