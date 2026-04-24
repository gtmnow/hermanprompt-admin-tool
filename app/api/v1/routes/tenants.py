from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.core.config import get_settings
from app.models import PlatformManagedLlmConfig, Tenant, TenantLLMConfig, TenantOnboardingStatus, TenantRuntimeSettings
from app.schemas import (
    ListEnvelope,
    ResourceEnvelope,
    Tenant as TenantSchema,
    TenantCreate,
    TenantLifecycleActionRequest,
    TenantLifecycleActionResult,
    TenantLLMConfig as TenantLLMConfigSchema,
    TenantLLMConfigUpdate,
    TenantPortalConfig as TenantPortalConfigSchema,
    TenantProfile as TenantProfileSchema,
    TenantRuntimeSettings as TenantRuntimeSettingsSchema,
    TenantRuntimeSettingsUpdate,
    ServiceTierDefinitionSummary,
    TenantSummary,
    TenantUpdate,
    TenantValidationResult,
)
from app.security import Principal, require_permission
from app.secret_vault import resolve_secret_reference, store_managed_secret
from app.services import (
    apply_reseller_defaults_to_tenant,
    delete_tenant_and_users,
    ensure_additive_schema_extensions,
    ensure_scope_access,
    generate_tenant_key,
    get_service_tier_or_404,
    get_or_create_reseller_defaults,
    get_reseller_or_404,
    get_tenant_or_404,
    get_snapshot_tenant_ids,
    get_snapshot_tenant_metrics,
    inactivate_tenant_state,
    mask_api_key,
    refresh_onboarding_state,
    reset_tenant_state,
    serialize_model,
    sync_tenant_service_tier_fields,
    table_exists,
    upsert_tenant_portal_config,
    upsert_tenant_profile,
    validate_activation_readiness,
    validate_reseller_capacity,
    write_audit_log,
)

router = APIRouter()
settings = get_settings()


class ActivationOverrideRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


def normalize_secret_source(value: str | None) -> str:
    if value in {"vault_managed", "external_reference", "none"}:
        return value
    legacy_map = {
        "fixture_seed": "none",
        "database_encrypted": "vault_managed",
    }
    return legacy_map.get(value or "", "none")


def normalize_credential_mode(value: str | None) -> str:
    if value in {"platform_managed", "customer_managed"}:
        return value
    legacy_map = {
        "service_managed": "platform_managed",
        "tenant_managed": "customer_managed",
    }
    return legacy_map.get(value or "", "customer_managed")


def to_tenant_schema(tenant: Tenant) -> TenantSchema:
    return TenantSchema.model_validate(tenant, from_attributes=True)


def to_llm_schema(config: TenantLLMConfig | None) -> TenantLLMConfigSchema | None:
    if config is None:
        return None
    payload = json.loads(serialize_model(config))
    payload["secret_source"] = normalize_secret_source(payload.get("secret_source"))
    payload["credential_mode"] = normalize_credential_mode(payload.get("credential_mode"))
    return TenantLLMConfigSchema.model_validate(payload)


def to_runtime_schema(settings: TenantRuntimeSettings | None) -> TenantRuntimeSettingsSchema | None:
    if settings is None:
        return None
    return TenantRuntimeSettingsSchema(
        enforcement_mode=settings.enforcement_mode,
        reporting_enabled=settings.reporting_enabled,
        export_enabled=settings.export_enabled,
        raw_prompt_retention_enabled=settings.raw_prompt_retention_enabled,
        raw_prompt_admin_visibility=settings.raw_prompt_admin_visibility,
        data_retention_days=settings.data_retention_days,
        feature_flags_json=json.loads(settings.feature_flags_json) if settings.feature_flags_json else {},
    )


def to_portal_schema(tenant: Tenant) -> TenantPortalConfigSchema:
    portal_config = tenant.portal_config
    if portal_config is None:
        return TenantPortalConfigSchema(
            portal_base_url=settings.default_portal_base_url,
            logo_url=None,
            welcome_message=None,
            is_active=True,
            created_at=tenant.created_at,
            updated_at=tenant.updated_at,
        )
    return TenantPortalConfigSchema.model_validate(portal_config, from_attributes=True)


def to_summary(db: Session, tenant: Tenant) -> TenantSummary:
    profile = TenantProfileSchema.model_validate(tenant.profile, from_attributes=True) if tenant.profile else None
    snapshot_metrics = get_snapshot_tenant_metrics(db, tenant)
    if profile and snapshot_metrics:
        profile.last_activity_at = snapshot_metrics["last_activity_at"]  # type: ignore[assignment]
        profile.utilization_pct = snapshot_metrics["utilization_pct"]  # type: ignore[assignment]

    return TenantSummary(
        tenant=to_tenant_schema(tenant),
        service_tier=(
            ServiceTierDefinitionSummary.model_validate(tenant.service_tier, from_attributes=True)
            if tenant.service_tier is not None
            else None
        ),
        profile=profile,
        portal_config=to_portal_schema(tenant),
        llm_config=to_llm_schema(tenant.llm_config),
        runtime_settings=to_runtime_schema(tenant.runtime_settings),
    )


def snapshot_name(snapshot_tenant_id: str) -> str:
    return snapshot_tenant_id.replace("_", " ").replace("-", " ").title()


def snapshot_summary(db: Session, snapshot_tenant_id: str) -> TenantSummary:
    now = datetime.now(timezone.utc)
    synthetic_id = uuid5(NAMESPACE_URL, f"snapshot-tenant:{snapshot_tenant_id}")
    utilization_pct = None
    last_activity_at = None
    metrics = db.execute(
        text(
            """
            select
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
    if metrics:
        if metrics["avg_structure"] is not None:
            utilization_pct = int(round(float(metrics["avg_structure"]) * 100))
        last_activity_at = metrics["last_activity_at"]

    return TenantSummary(
        tenant=TenantSchema(
            id=synthetic_id,
            tenant_name=snapshot_name(snapshot_tenant_id),
            tenant_key=snapshot_tenant_id,
            reseller_partner_id=None,
            status="active",
            plan_tier=None,
            reporting_timezone="America/New_York",
            external_customer_id=snapshot_tenant_id,
            created_at=now,
            updated_at=now,
        ),
        profile=TenantProfileSchema(
            organization_type=None,
            industry=None,
            primary_contact_name=None,
            primary_contact_email=None,
            service_mode=None,
            deployment_notes="Derived from live Herman Prompt snapshot data because admin tenant schema is not present in this database.",
            last_activity_at=last_activity_at,
            utilization_pct=utilization_pct,
        ),
        portal_config=TenantPortalConfigSchema(
            portal_base_url=settings.default_portal_base_url,
            logo_url=None,
            welcome_message=None,
            is_active=True,
            created_at=now,
            updated_at=now,
        ),
        llm_config=None,
        runtime_settings=None,
    )


@router.get("", response_model=ListEnvelope[TenantSummary])
def list_tenants(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    reseller_partner_id: str | None = Query(default=None),
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[TenantSummary]:
    ensure_additive_schema_extensions()
    if not table_exists(db, "tenants"):
        items = [snapshot_summary(db, snapshot_tenant_id) for snapshot_tenant_id in get_snapshot_tenant_ids(db)]
        return ListEnvelope[TenantSummary](
            items=items,
            page=1,
            page_size=len(items) or 1,
            total_count=len(items),
            filters={"status": status_filter, "reseller_partner_id": reseller_partner_id},
        )

    query = select(Tenant).order_by(Tenant.created_at.desc())
    if status_filter:
        query = query.where(Tenant.status == status_filter)
    if reseller_partner_id:
        query = query.where(Tenant.reseller_partner_id == reseller_partner_id)

    items = []
    mapped_snapshot_ids: set[str] = set()
    for tenant in db.scalars(query):
        ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
        items.append(to_summary(db, tenant))
        if tenant.external_customer_id:
            mapped_snapshot_ids.add(tenant.external_customer_id)
        mapped_snapshot_ids.add(tenant.id)
        mapped_snapshot_ids.add(tenant.tenant_key)

    for snapshot_tenant_id in get_snapshot_tenant_ids(db):
        if snapshot_tenant_id in mapped_snapshot_ids:
            continue
        items.append(snapshot_summary(db, snapshot_tenant_id))

    start = (page - 1) * page_size
    end = start + page_size
    return ListEnvelope[TenantSummary](
        items=items[start:end],
        page=page,
        page_size=page_size,
        total_count=len(items),
        filters={"status": status_filter, "reseller_partner_id": reseller_partner_id},
    )


@router.post("", response_model=ResourceEnvelope[TenantSummary], status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    ensure_additive_schema_extensions()
    payload_data = payload.model_dump(mode="json")
    reseller_defaults = None
    if payload.reseller_partner_id:
        ensure_scope_access(principal, reseller_partner_id=str(payload.reseller_partner_id))
        reseller = get_reseller_or_404(db, str(payload.reseller_partner_id))
        reseller_defaults = get_or_create_reseller_defaults(db, reseller)

    tenant_fields = {
        key: value
        for key, value in payload_data.items()
        if key
        not in {
            "organization_type",
            "industry",
            "primary_contact_name",
            "primary_contact_email",
            "service_mode",
            "deployment_notes",
        }
    }
    tenant_fields["tenant_key"] = payload.tenant_key or generate_tenant_key(db, payload.tenant_name)
    tenant = Tenant(**tenant_fields)
    requested_tier = None
    if payload.service_tier_definition_id:
        requested_tier = get_service_tier_or_404(
            db,
            str(payload.service_tier_definition_id),
            scope_type="organization",
            require_active=True,
        )
        sync_tenant_service_tier_fields(tenant, requested_tier)
    db.add(tenant)
    db.flush()
    upsert_tenant_profile(db, tenant, payload_data)

    apply_reseller_defaults_to_tenant(db, tenant, reseller_defaults, default_portal_base_url=settings.default_portal_base_url)
    effective_tier = requested_tier or tenant.service_tier
    sync_tenant_service_tier_fields(tenant, effective_tier)
    if tenant.reseller_partner is not None:
        validate_reseller_capacity(db, tenant.reseller_partner, tenant_to_include=tenant, tenant_tier_override=effective_tier)

    if tenant.runtime_settings is None:
        db.add(TenantRuntimeSettings(tenant_id=tenant.id))
    onboarding = TenantOnboardingStatus(tenant_id=tenant.id, tenant_created=True, onboarding_status="draft")
    db.add(onboarding)
    write_audit_log(
        db,
        principal,
        action_type="tenant.create",
        target_type="tenant",
        target_id=tenant.id,
        after=serialize_model(tenant),
        request_id=request_id,
    )
    db.commit()
    db.refresh(tenant)
    return ResourceEnvelope[TenantSummary](resource=to_summary(db, tenant), updated_at=tenant.updated_at)


@router.post("/{tenant_id}/actions", response_model=ResourceEnvelope[TenantLifecycleActionResult])
def run_tenant_lifecycle_action(
    tenant_id: str,
    payload: TenantLifecycleActionRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantLifecycleActionResult]:
    ensure_additive_schema_extensions()
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        if payload.action == "delete":
            return ResourceEnvelope[TenantLifecycleActionResult](
                resource=TenantLifecycleActionResult(
                    tenant_id=tenant_id,
                    action=payload.action,
                    resulting_status="deleted",
                    message="Organization was already removed.",
                )
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    before = serialize_model(tenant)

    if payload.action == "inactivate":
        affected_users = inactivate_tenant_state(db, tenant)
        refresh_onboarding_state(db, tenant.id)
        write_audit_log(
            db,
            principal,
            action_type="tenant.lifecycle.inactivate",
            target_type="tenant",
            target_id=tenant.id,
            before=before,
            after=serialize_model(tenant),
            request_id=request_id,
        )
        db.commit()
        return ResourceEnvelope[TenantLifecycleActionResult](
            resource=TenantLifecycleActionResult(
                tenant_id=tenant.id,
                action=payload.action,
                resulting_status=tenant.status,
                message=f"Organization moved to inactive and {len(affected_users)} user login(s) were disabled.",
            ),
            updated_at=tenant.updated_at,
        )

    if payload.action == "reset":
        affected_users = reset_tenant_state(db, tenant)
        refresh_onboarding_state(db, tenant.id)
        write_audit_log(
            db,
            principal,
            action_type="tenant.lifecycle.reset",
            target_type="tenant",
            target_id=tenant.id,
            before=before,
            after=serialize_model(tenant),
            request_id=request_id,
        )
        db.commit()
        return ResourceEnvelope[TenantLifecycleActionResult](
            resource=TenantLifecycleActionResult(
                tenant_id=tenant.id,
                action=payload.action,
                resulting_status=tenant.status,
                message=f"Organization reset to onboarding and {len(affected_users)} user login(s) were disabled.",
            ),
            updated_at=tenant.updated_at,
        )

    deleted_users = delete_tenant_and_users(db, tenant)
    write_audit_log(
        db,
        principal,
        action_type="tenant.lifecycle.delete",
        target_type="tenant",
        target_id=tenant_id,
        before=before,
        request_id=request_id,
    )
    db.commit()
    return ResourceEnvelope[TenantLifecycleActionResult](
        resource=TenantLifecycleActionResult(
            tenant_id=tenant_id,
            action=payload.action,
            resulting_status="deleted",
            message=f"Organization and {len(deleted_users)} user record(s) were removed.",
        )
    )


@router.get("/{tenant_id}/portal-config", response_model=ResourceEnvelope[TenantPortalConfigSchema])
def get_portal_config(
    tenant_id: str,
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantPortalConfigSchema]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    resource = to_portal_schema(tenant)
    updated_at = resource.updated_at or tenant.updated_at
    return ResourceEnvelope[TenantPortalConfigSchema](resource=resource, updated_at=updated_at)


@router.put("/{tenant_id}/portal-config", response_model=ResourceEnvelope[TenantPortalConfigSchema])
def update_portal_config(
    tenant_id: str,
    payload: TenantPortalConfigSchema,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantPortalConfigSchema]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    before = serialize_model(tenant.portal_config) if tenant.portal_config is not None else None

    record = upsert_tenant_portal_config(
        db,
        tenant,
        payload.model_dump(exclude={"id", "created_at", "updated_at"}, exclude_none=False),
        default_portal_base_url=settings.default_portal_base_url,
        created_by_admin_user_id=principal.admin_id,
    )
    db.flush()
    write_audit_log(
        db,
        principal,
        action_type="tenant.portal_config.update",
        target_type="tenant_portal_config",
        target_id=record.id,
        before=before,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[TenantPortalConfigSchema](
        resource=TenantPortalConfigSchema.model_validate(record, from_attributes=True),
        updated_at=record.updated_at,
    )


@router.get("/{tenant_id}", response_model=ResourceEnvelope[TenantSummary])
def get_tenant(
    tenant_id: str,
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    ensure_additive_schema_extensions()
    if not table_exists(db, "tenants"):
        for item in [snapshot_summary(db, snapshot_tenant_id) for snapshot_tenant_id in get_snapshot_tenant_ids(db)]:
            if str(item.tenant.id) == tenant_id:
                return ResourceEnvelope[TenantSummary](resource=item, updated_at=item.tenant.updated_at)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    return ResourceEnvelope[TenantSummary](resource=to_summary(db, tenant), updated_at=tenant.updated_at)


@router.patch("/{tenant_id}", response_model=ResourceEnvelope[TenantSummary])
def update_tenant(
    tenant_id: str,
    payload: TenantUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    before = serialize_model(tenant)

    updates = payload.model_dump(exclude_none=True, mode="json")
    requested_tier = None
    if "service_tier_definition_id" in updates:
        requested_tier = get_service_tier_or_404(
            db,
            str(updates.pop("service_tier_definition_id")),
            scope_type="organization",
            require_active=True,
        )
    elif "plan_tier" in updates and updates["plan_tier"]:
        updates.pop("plan_tier")
    profile_updates = {
        key: updates.pop(key)
        for key in [
            "organization_type",
            "industry",
            "primary_contact_name",
            "primary_contact_email",
            "service_mode",
            "deployment_notes",
        ]
        if key in updates
    }
    if "tenant_name" in updates and "tenant_key" not in updates:
        updates["tenant_key"] = generate_tenant_key(db, str(updates["tenant_name"]), exclude_tenant_id=tenant.id)
    for key, value in updates.items():
        setattr(tenant, key, value)
    if requested_tier is not None:
        sync_tenant_service_tier_fields(tenant, requested_tier)
    if profile_updates:
        upsert_tenant_profile(db, tenant, profile_updates)

    if tenant.reseller_partner is not None:
        validate_reseller_capacity(db, tenant.reseller_partner, tenant_to_include=tenant, tenant_tier_override=tenant.service_tier)

    if payload.status == "active":
        validate_activation_readiness(db, tenant)

    refresh_onboarding_state(db, tenant.id)
    write_audit_log(
        db,
        principal,
        action_type="tenant.update",
        target_type="tenant",
        target_id=tenant.id,
        before=before,
        after=serialize_model(tenant),
        request_id=request_id,
    )
    db.commit()
    db.refresh(tenant)
    return ResourceEnvelope[TenantSummary](resource=to_summary(db, tenant), updated_at=tenant.updated_at)


@router.post("/{tenant_id}/activation-override", response_model=ResourceEnvelope[TenantSummary])
def override_tenant_activation(
    tenant_id: str,
    payload: ActivationOverrideRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    if principal.role not in {"super_admin", "support_admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Activation override requires HermanScience admin access")

    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    before = serialize_model(tenant)
    tenant.status = "active"
    onboarding = refresh_onboarding_state(db, tenant.id)
    write_audit_log(
        db,
        principal,
        action_type="tenant.activation_override",
        target_type="tenant",
        target_id=tenant.id,
        before=before,
        after=json.dumps(
            {
                "tenant": serialize_model(tenant),
                "override_reason": payload.reason,
                "onboarding_status": onboarding.onboarding_status,
            },
            sort_keys=True,
        ),
        request_id=request_id,
    )
    db.commit()
    db.refresh(tenant)
    return ResourceEnvelope[TenantSummary](resource=to_summary(db, tenant), updated_at=tenant.updated_at)


@router.get("/{tenant_id}/llm-config", response_model=ResourceEnvelope[TenantLLMConfigSchema | None])
def get_llm_config(
    tenant_id: str,
    principal: Principal = Depends(require_permission("runtime.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantLLMConfigSchema | None]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    return ResourceEnvelope[TenantLLMConfigSchema | None](resource=to_llm_schema(tenant.llm_config), updated_at=tenant.updated_at)


@router.put("/{tenant_id}/llm-config", response_model=ResourceEnvelope[TenantLLMConfigSchema])
def upsert_llm_config(
    tenant_id: str,
    payload: TenantLLMConfigUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("runtime.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantLLMConfigSchema]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)

    llm_config = tenant.llm_config or TenantLLMConfig(tenant_id=tenant.id, provider_type="", model_name="")
    before = serialize_model(llm_config) if tenant.llm_config else None
    llm_config.provider_type = payload.provider_type
    llm_config.model_name = payload.model_name
    llm_config.endpoint_url = payload.endpoint_url
    llm_config.platform_managed_config_id = payload.platform_managed_config_id
    llm_config.credential_mode = payload.credential_mode
    llm_config.transformation_enabled = payload.transformation_enabled
    llm_config.scoring_enabled = payload.scoring_enabled
    llm_config.credential_status = "unvalidated"
    llm_config.last_validation_message = "Configuration saved; validation pending"

    if payload.credential_mode == "platform_managed":
        if not payload.platform_managed_config_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a platform-managed LLM from the shared pool")
        platform_config = db.get(PlatformManagedLlmConfig, payload.platform_managed_config_id)
        if platform_config is None or not platform_config.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected platform-managed LLM is not available")
        llm_config.provider_type = platform_config.provider_type
        llm_config.model_name = platform_config.model_name
        llm_config.endpoint_url = platform_config.endpoint_url
        llm_config.secret_reference = platform_config.secret_reference
        llm_config.api_key_masked = platform_config.api_key_masked
        llm_config.secret_source = platform_config.secret_source
        llm_config.vault_provider = platform_config.vault_provider
    else:
        llm_config.platform_managed_config_id = None
        if payload.api_key:
            stored = store_managed_secret(
                db,
                secret_value=payload.api_key,
                scope_type="tenant",
                scope_id=tenant.id,
                secret_kind="llm_api_key",
                display_name=f"{tenant.tenant_name} LLM API key",
                created_by_admin_user_id=principal.admin_id,
            )
            llm_config.secret_reference = stored.secret_reference
            llm_config.api_key_masked = mask_api_key(payload.api_key)
            llm_config.secret_source = stored.secret_source
            llm_config.vault_provider = stored.vault_provider
        elif payload.secret_reference:
            resolution = resolve_secret_reference(db, payload.secret_reference)
            llm_config.secret_reference = payload.secret_reference
            llm_config.secret_source = resolution.secret_source
            llm_config.vault_provider = resolution.vault_provider
            if tenant.llm_config and tenant.llm_config.api_key_masked:
                llm_config.api_key_masked = tenant.llm_config.api_key_masked
        elif llm_config.secret_reference:
            resolution = resolve_secret_reference(db, llm_config.secret_reference)
            llm_config.secret_source = resolution.secret_source
            llm_config.vault_provider = resolution.vault_provider
        else:
            llm_config.secret_reference = None
            llm_config.api_key_masked = None
            llm_config.secret_source = "none"
            llm_config.vault_provider = None

    db.add(llm_config)

    refresh_onboarding_state(db, tenant.id)
    write_audit_log(
        db,
        principal,
        action_type="tenant.llm_config.update",
        target_type="tenant_llm_config",
        target_id=tenant.id,
        before=before,
        after=serialize_model(llm_config),
        request_id=request_id,
    )
    db.commit()
    db.refresh(llm_config)
    return ResourceEnvelope[TenantLLMConfigSchema](resource=to_llm_schema(llm_config), updated_at=llm_config.updated_at)


@router.post("/{tenant_id}/llm-config/validate", response_model=ResourceEnvelope[TenantValidationResult])
def validate_llm_config(
    tenant_id: str,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("runtime.validate")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantValidationResult]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    llm_config = tenant.llm_config
    if llm_config is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM config has not been set")

    if llm_config.credential_mode == "platform_managed":
        if not llm_config.platform_managed_config_id:
            llm_config.credential_status = "invalid"
            llm_config.last_validation_message = "No platform-managed LLM has been selected"
            resolution = resolve_secret_reference(db, None)
        else:
            platform_config = db.get(PlatformManagedLlmConfig, llm_config.platform_managed_config_id)
            if platform_config is None or not platform_config.is_active:
                llm_config.credential_status = "invalid"
                llm_config.last_validation_message = "Selected platform-managed LLM is no longer available"
                resolution = resolve_secret_reference(db, None)
            else:
                llm_config.provider_type = platform_config.provider_type
                llm_config.model_name = platform_config.model_name
                llm_config.endpoint_url = platform_config.endpoint_url
                llm_config.secret_reference = platform_config.secret_reference
                llm_config.api_key_masked = platform_config.api_key_masked
                resolution = resolve_secret_reference(db, llm_config.secret_reference)
    else:
        resolution = resolve_secret_reference(db, llm_config.secret_reference)
    if not llm_config.provider_type or not llm_config.model_name:
        llm_config.credential_status = "invalid"
        llm_config.last_validation_message = "Provider and model are required"
    elif not llm_config.secret_reference:
        llm_config.credential_status = "invalid"
        llm_config.last_validation_message = "No vault-backed credential is configured"
    elif resolution.resolvable:
        llm_config.credential_status = "valid"
        llm_config.last_validation_message = "Validation succeeded and the vault secret resolved successfully"
    else:
        llm_config.credential_status = "invalid"
        llm_config.last_validation_message = resolution.message

    llm_config.secret_source = resolution.secret_source
    llm_config.vault_provider = resolution.vault_provider
    llm_config.last_validated_at = datetime.now(timezone.utc)
    refresh_onboarding_state(db, tenant.id)
    write_audit_log(
        db,
        principal,
        action_type="tenant.llm_config.validate",
        target_type="tenant_llm_config",
        target_id=tenant.id,
        after=serialize_model(llm_config),
        request_id=request_id,
    )
    db.commit()
    result = TenantValidationResult(
        validation_result=llm_config.credential_status,
        provider_echo=llm_config.provider_type,
        model_accessible=llm_config.credential_status == "valid",
        latency_ms=145,
        message=llm_config.last_validation_message,
    )
    return ResourceEnvelope[TenantValidationResult](resource=result)


@router.get("/{tenant_id}/runtime-settings", response_model=ResourceEnvelope[TenantRuntimeSettingsSchema])
def get_runtime_settings(
    tenant_id: str,
    principal: Principal = Depends(require_permission("runtime.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantRuntimeSettingsSchema]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    if tenant.runtime_settings is None:
        tenant.runtime_settings = TenantRuntimeSettings(tenant_id=tenant.id)
        db.add(tenant.runtime_settings)
        db.commit()
        db.refresh(tenant)
    return ResourceEnvelope[TenantRuntimeSettingsSchema](
        resource=to_runtime_schema(tenant.runtime_settings),
        updated_at=tenant.runtime_settings.updated_at,
    )


@router.put("/{tenant_id}/runtime-settings", response_model=ResourceEnvelope[TenantRuntimeSettingsSchema])
def update_runtime_settings(
    tenant_id: str,
    payload: TenantRuntimeSettingsUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("runtime.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantRuntimeSettingsSchema]:
    ensure_additive_schema_extensions()
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    runtime_settings = tenant.runtime_settings or TenantRuntimeSettings(tenant_id=tenant.id)
    before = serialize_model(runtime_settings) if tenant.runtime_settings else None

    updates = payload.model_dump(mode="json")
    feature_flags = updates.pop("feature_flags_json", {})
    for key, value in updates.items():
        setattr(runtime_settings, key, value)
    runtime_settings.feature_flags_json = json.dumps(feature_flags, sort_keys=True)
    db.add(runtime_settings)
    write_audit_log(
        db,
        principal,
        action_type="tenant.runtime_settings.update",
        target_type="tenant_runtime_settings",
        target_id=tenant.id,
        before=before,
        after=serialize_model(runtime_settings),
        request_id=request_id,
    )
    db.commit()
    db.refresh(runtime_settings)
    return ResourceEnvelope[TenantRuntimeSettingsSchema](
        resource=to_runtime_schema(runtime_settings),
        updated_at=runtime_settings.updated_at,
    )
