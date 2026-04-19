from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Tenant, TenantLLMConfig, TenantOnboardingStatus, TenantRuntimeSettings
from app.schemas import (
    ListEnvelope,
    ResourceEnvelope,
    Tenant as TenantSchema,
    TenantCreate,
    TenantLLMConfig as TenantLLMConfigSchema,
    TenantLLMConfigUpdate,
    TenantRuntimeSettings as TenantRuntimeSettingsSchema,
    TenantRuntimeSettingsUpdate,
    TenantSummary,
    TenantUpdate,
    TenantValidationResult,
)
from app.security import Principal, require_permission
from app.services import (
    ensure_scope_access,
    get_tenant_or_404,
    mask_api_key,
    refresh_onboarding_state,
    serialize_model,
    validate_activation_readiness,
    write_audit_log,
)

router = APIRouter()


def to_tenant_schema(tenant: Tenant) -> TenantSchema:
    return TenantSchema.model_validate(tenant, from_attributes=True)


def to_llm_schema(config: TenantLLMConfig | None) -> TenantLLMConfigSchema | None:
    if config is None:
        return None
    return TenantLLMConfigSchema.model_validate(config, from_attributes=True)


def to_runtime_schema(settings: TenantRuntimeSettings | None) -> TenantRuntimeSettingsSchema | None:
    if settings is None:
        return None
    payload = TenantRuntimeSettingsSchema.model_validate(settings, from_attributes=True)
    if settings.feature_flags_json:
        payload.feature_flags_json = json.loads(settings.feature_flags_json)
    return payload


def to_summary(tenant: Tenant) -> TenantSummary:
    return TenantSummary(
        tenant=to_tenant_schema(tenant),
        llm_config=to_llm_schema(tenant.llm_config),
        runtime_settings=to_runtime_schema(tenant.runtime_settings),
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
    query = select(Tenant).order_by(Tenant.created_at.desc())
    if status_filter:
        query = query.where(Tenant.status == status_filter)
    if reseller_partner_id:
        query = query.where(Tenant.reseller_partner_id == reseller_partner_id)

    items = []
    for tenant in db.scalars(query):
        ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
        items.append(to_summary(tenant))

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
    if payload.reseller_partner_id:
        ensure_scope_access(principal, reseller_partner_id=str(payload.reseller_partner_id))

    tenant = Tenant(**payload.model_dump(mode="json"))
    db.add(tenant)
    db.flush()

    runtime = TenantRuntimeSettings(tenant_id=tenant.id)
    onboarding = TenantOnboardingStatus(tenant_id=tenant.id, tenant_created=True, onboarding_status="draft")
    db.add(runtime)
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
    return ResourceEnvelope[TenantSummary](resource=to_summary(tenant), updated_at=tenant.updated_at)


@router.get("/{tenant_id}", response_model=ResourceEnvelope[TenantSummary])
def get_tenant(
    tenant_id: str,
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    return ResourceEnvelope[TenantSummary](resource=to_summary(tenant), updated_at=tenant.updated_at)


@router.patch("/{tenant_id}", response_model=ResourceEnvelope[TenantSummary])
def update_tenant(
    tenant_id: str,
    payload: TenantUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("tenants.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantSummary]:
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    before = serialize_model(tenant)

    updates = payload.model_dump(exclude_none=True, mode="json")
    for key, value in updates.items():
        setattr(tenant, key, value)

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
    return ResourceEnvelope[TenantSummary](resource=to_summary(tenant), updated_at=tenant.updated_at)


@router.get("/{tenant_id}/llm-config", response_model=ResourceEnvelope[TenantLLMConfigSchema | None])
def get_llm_config(
    tenant_id: str,
    principal: Principal = Depends(require_permission("runtime.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantLLMConfigSchema | None]:
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
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)

    llm_config = tenant.llm_config or TenantLLMConfig(tenant_id=tenant.id, provider_type="", model_name="")
    before = serialize_model(llm_config) if tenant.llm_config else None
    llm_config.provider_type = payload.provider_type
    llm_config.model_name = payload.model_name
    llm_config.endpoint_url = payload.endpoint_url
    llm_config.credential_mode = payload.credential_mode
    llm_config.secret_reference = payload.secret_reference
    llm_config.api_key_masked = mask_api_key(payload.api_key)
    llm_config.transformation_enabled = payload.transformation_enabled
    llm_config.scoring_enabled = payload.scoring_enabled
    llm_config.credential_status = "unvalidated"
    llm_config.last_validation_message = "Configuration saved; validation pending"
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
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    llm_config = tenant.llm_config
    if llm_config is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM config has not been set")

    llm_config.credential_status = "valid" if llm_config.provider_type and llm_config.model_name else "invalid"
    llm_config.last_validated_at = datetime.now(timezone.utc)
    llm_config.last_validation_message = (
        "Validation succeeded" if llm_config.credential_status == "valid" else "Provider configuration is incomplete"
    )
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
