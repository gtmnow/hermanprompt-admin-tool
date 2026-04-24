from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DatabaseInstanceConfig, PlatformManagedLlmConfig, PromptUiInstanceConfig, ResellerPartner, ResellerTenantDefaults, ServiceTierDefinition, Tenant
from app.schemas import (
    DatabaseInstanceConfigCreate,
    DatabaseInstanceConfigSummary,
    DatabaseInstanceConfigUpdate,
    ListEnvelope,
    PlatformManagedLlmConfigCreate,
    PlatformManagedLlmConfigSummary,
    PlatformManagedLlmConfigUpdate,
    PromptUiInstanceConfigCreate,
    PromptUiInstanceConfigSummary,
    PromptUiInstanceConfigUpdate,
    ResourceEnvelope,
    SecretVaultStatusSummary,
    ServiceTierDefinitionCreate,
    ServiceTierDefinitionSummary,
    ServiceTierDefinitionUpdate,
)
from app.security import Principal, require_permission, require_super_admin
from app.secret_vault import get_vault_status, mask_connection_string, resolve_secret_reference, store_managed_secret
from app.services import ensure_additive_schema_extensions, serialize_model, validate_reseller_capacity, write_audit_log

router = APIRouter()


def to_platform_llm_summary(record: PlatformManagedLlmConfig) -> PlatformManagedLlmConfigSummary:
    return PlatformManagedLlmConfigSummary.model_validate(record, from_attributes=True)


def to_service_tier_summary(record: ServiceTierDefinition) -> ServiceTierDefinitionSummary:
    return ServiceTierDefinitionSummary.model_validate(record, from_attributes=True)


@router.get("/service-tiers", response_model=ListEnvelope[ServiceTierDefinitionSummary])
def list_service_tiers(
    scope_type: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[ServiceTierDefinitionSummary]:
    ensure_additive_schema_extensions()
    query = select(ServiceTierDefinition).order_by(
        ServiceTierDefinition.scope_type.asc(),
        ServiceTierDefinition.sort_order.asc(),
        ServiceTierDefinition.tier_name.asc(),
    )
    if scope_type:
        query = query.where(ServiceTierDefinition.scope_type == scope_type)
    if include_inactive:
        if principal.role != "super_admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access is required")
    else:
        query = query.where(ServiceTierDefinition.is_active.is_(True))
    items = [to_service_tier_summary(item) for item in db.scalars(query)]
    return ListEnvelope[ServiceTierDefinitionSummary](
        items=items,
        page=1,
        page_size=len(items) or 1,
        total_count=len(items),
        filters={"scope_type": scope_type, "include_inactive": include_inactive},
    )


@router.post("/service-tiers", response_model=ResourceEnvelope[ServiceTierDefinitionSummary], status_code=status.HTTP_201_CREATED)
def create_service_tier(
    payload: ServiceTierDefinitionCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ServiceTierDefinitionSummary]:
    ensure_additive_schema_extensions()
    existing = db.scalar(
        select(ServiceTierDefinition).where(
            ServiceTierDefinition.scope_type == payload.scope_type,
            ServiceTierDefinition.tier_key == payload.tier_key,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A tier with this key already exists in that scope")
    record = ServiceTierDefinition(**payload.model_dump())
    db.add(record)
    db.flush()
    write_audit_log(
        db,
        principal,
        action_type="settings.service_tier.create",
        target_type="service_tier_definition",
        target_id=record.id,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[ServiceTierDefinitionSummary](resource=to_service_tier_summary(record), updated_at=record.updated_at)


@router.patch("/service-tiers/{tier_id}", response_model=ResourceEnvelope[ServiceTierDefinitionSummary])
def update_service_tier(
    tier_id: str,
    payload: ServiceTierDefinitionUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ServiceTierDefinitionSummary]:
    ensure_additive_schema_extensions()
    record = db.get(ServiceTierDefinition, tier_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service tier not found")
    before = serialize_model(record)
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(record, key, value)
    if record.scope_type == "organization":
        record.max_organizations = None
    if record.has_unlimited_users:
        record.max_users = None
    elif record.max_users is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide a max user count or mark the tier as unlimited")
    if record.scope_type == "reseller":
        for reseller in db.scalars(select(ResellerPartner).where(ResellerPartner.service_tier_definition_id == record.id)):
            validate_reseller_capacity(db, reseller, candidate_tier=record)
    write_audit_log(
        db,
        principal,
        action_type="settings.service_tier.update",
        target_type="service_tier_definition",
        target_id=record.id,
        before=before,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[ServiceTierDefinitionSummary](resource=to_service_tier_summary(record), updated_at=record.updated_at)


@router.delete("/service-tiers/{tier_id}", response_model=ResourceEnvelope[ServiceTierDefinitionSummary])
def delete_service_tier(
    tier_id: str,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ServiceTierDefinitionSummary]:
    ensure_additive_schema_extensions()
    record = db.get(ServiceTierDefinition, tier_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service tier not found")

    active_reseller = db.scalar(
        select(ResellerPartner).where(
            ResellerPartner.service_tier_definition_id == tier_id,
            ResellerPartner.is_active.is_(True),
        )
    )
    if active_reseller is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{record.tier_name} is still assigned to active reseller {active_reseller.reseller_name}",
        )

    active_tenant = db.scalar(
        select(Tenant).where(
            Tenant.service_tier_definition_id == tier_id,
            Tenant.status == "active",
        )
    )
    if active_tenant is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{record.tier_name} is still assigned to active organization {active_tenant.tenant_name}",
        )

    for reseller in db.scalars(select(ResellerPartner).where(ResellerPartner.service_tier_definition_id == tier_id)):
        reseller.service_tier_definition_id = None
    for defaults in db.scalars(select(ResellerTenantDefaults).where(ResellerTenantDefaults.default_service_tier_definition_id == tier_id)):
        defaults.default_service_tier_definition_id = None
        defaults.default_plan_tier = None
    for tenant in db.scalars(select(Tenant).where(Tenant.service_tier_definition_id == tier_id)):
        tenant.service_tier_definition_id = None
        tenant.plan_tier = None

    before = serialize_model(record)
    summary = to_service_tier_summary(record)
    db.delete(record)
    write_audit_log(
        db,
        principal,
        action_type="settings.service_tier.delete",
        target_type="service_tier_definition",
        target_id=tier_id,
        before=before,
        request_id=request_id,
    )
    db.commit()
    return ResourceEnvelope[ServiceTierDefinitionSummary](resource=summary, updated_at=summary.updated_at)


@router.get("/secret-vault", response_model=ResourceEnvelope[SecretVaultStatusSummary])
def get_secret_vault(
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[SecretVaultStatusSummary]:
    _ = principal
    ensure_additive_schema_extensions()
    status_summary = SecretVaultStatusSummary.model_validate(get_vault_status(db), from_attributes=True)
    return ResourceEnvelope[SecretVaultStatusSummary](resource=status_summary)


@router.get("/platform-managed-llms", response_model=ListEnvelope[PlatformManagedLlmConfigSummary])
def list_platform_managed_llms(
    include_inactive: bool = Query(default=False),
    principal: Principal = Depends(require_permission("runtime.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[PlatformManagedLlmConfigSummary]:
    ensure_additive_schema_extensions()
    query = select(PlatformManagedLlmConfig).order_by(
        PlatformManagedLlmConfig.is_active.desc(),
        PlatformManagedLlmConfig.created_at.desc(),
    )
    if include_inactive:
        if principal.role != "super_admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access is required")
    else:
        query = query.where(PlatformManagedLlmConfig.is_active.is_(True))

    items = [to_platform_llm_summary(item) for item in db.scalars(query)]
    return ListEnvelope[PlatformManagedLlmConfigSummary](
        items=items,
        page=1,
        page_size=len(items) or 1,
        total_count=len(items),
        filters={"include_inactive": include_inactive},
    )


@router.post("/platform-managed-llms", response_model=ResourceEnvelope[PlatformManagedLlmConfigSummary], status_code=status.HTTP_201_CREATED)
def create_platform_managed_llm(
    payload: PlatformManagedLlmConfigCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[PlatformManagedLlmConfigSummary]:
    ensure_additive_schema_extensions()
    payload_data = payload.model_dump(exclude_none=True)
    api_key = payload_data.pop("api_key", None)
    secret_reference = payload_data.pop("secret_reference", None)
    record = PlatformManagedLlmConfig(**payload_data)
    db.add(record)
    db.flush()

    if api_key:
        stored = store_managed_secret(
            db,
            secret_value=api_key,
            scope_type="platform_llm",
            scope_id=record.id,
            secret_kind="llm_api_key",
            display_name=f"{record.label} platform-managed LLM key",
            created_by_admin_user_id=principal.admin_id,
        )
        record.secret_reference = stored.secret_reference
        record.api_key_masked = stored.secret_masked
        record.secret_source = stored.secret_source
        record.vault_provider = stored.vault_provider
    elif secret_reference:
        record.secret_reference = secret_reference
        resolution = resolve_secret_reference(db, secret_reference)
        record.secret_source = resolution.secret_source
        record.vault_provider = resolution.vault_provider
    else:
        record.secret_source = "none"
        record.vault_provider = None

    write_audit_log(
        db,
        principal,
        action_type="settings.platform_managed_llm.create",
        target_type="platform_managed_llm_config",
        target_id=record.id,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[PlatformManagedLlmConfigSummary](resource=to_platform_llm_summary(record), updated_at=record.updated_at)


@router.patch("/platform-managed-llms/{config_id}", response_model=ResourceEnvelope[PlatformManagedLlmConfigSummary])
def update_platform_managed_llm(
    config_id: str,
    payload: PlatformManagedLlmConfigUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[PlatformManagedLlmConfigSummary]:
    ensure_additive_schema_extensions()
    record = db.get(PlatformManagedLlmConfig, config_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform managed LLM config not found")

    before = serialize_model(record)
    updates = payload.model_dump(exclude_none=True)
    api_key = updates.pop("api_key", None)
    secret_reference = updates.pop("secret_reference", None)
    for key, value in updates.items():
        setattr(record, key, value)

    if api_key:
        stored = store_managed_secret(
            db,
            secret_value=api_key,
            scope_type="platform_llm",
            scope_id=record.id,
            secret_kind="llm_api_key",
            display_name=f"{record.label} platform-managed LLM key",
            created_by_admin_user_id=principal.admin_id,
        )
        record.secret_reference = stored.secret_reference
        record.api_key_masked = stored.secret_masked
        record.secret_source = stored.secret_source
        record.vault_provider = stored.vault_provider
    elif secret_reference:
        record.secret_reference = secret_reference
        resolution = resolve_secret_reference(db, secret_reference)
        record.secret_source = resolution.secret_source
        record.vault_provider = resolution.vault_provider

    write_audit_log(
        db,
        principal,
        action_type="settings.platform_managed_llm.update",
        target_type="platform_managed_llm_config",
        target_id=record.id,
        before=before,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[PlatformManagedLlmConfigSummary](resource=to_platform_llm_summary(record), updated_at=record.updated_at)


@router.get("/database-instances", response_model=ListEnvelope[DatabaseInstanceConfigSummary])
def list_database_instances(
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[DatabaseInstanceConfigSummary]:
    _ = principal
    ensure_additive_schema_extensions()
    items = [
        DatabaseInstanceConfigSummary.model_validate(item, from_attributes=True)
        for item in db.scalars(select(DatabaseInstanceConfig).order_by(DatabaseInstanceConfig.created_at.desc()))
    ]
    return ListEnvelope[DatabaseInstanceConfigSummary](
        items=items,
        page=1,
        page_size=len(items) or 1,
        total_count=len(items),
        filters={},
    )


@router.post("/database-instances", response_model=ResourceEnvelope[DatabaseInstanceConfigSummary], status_code=status.HTTP_201_CREATED)
def create_database_instance(
    payload: DatabaseInstanceConfigCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[DatabaseInstanceConfigSummary]:
    ensure_additive_schema_extensions()
    if payload.is_active:
        for item in db.scalars(select(DatabaseInstanceConfig).where(DatabaseInstanceConfig.is_active.is_(True))):
            item.is_active = False

    payload_data = payload.model_dump(exclude_none=True)
    connection_string = payload_data.pop("connection_string", None)
    connection_secret_reference = payload_data.pop("connection_secret_reference", None)
    record = DatabaseInstanceConfig(**payload_data)
    db.add(record)
    db.flush()

    if connection_string:
        stored = store_managed_secret(
            db,
            secret_value=connection_string,
            scope_type="database_instance",
            scope_id=record.id,
            secret_kind="connection_string",
            display_name=f"{record.label} connection string",
            created_by_admin_user_id=principal.admin_id,
        )
        record.connection_secret_reference = stored.secret_reference
        record.connection_string_masked = mask_connection_string(connection_string)
        record.secret_source = stored.secret_source
        record.vault_provider = stored.vault_provider
    elif connection_secret_reference:
        record.connection_secret_reference = connection_secret_reference
        resolution = resolve_secret_reference(db, connection_secret_reference)
        record.secret_source = resolution.secret_source
        record.vault_provider = resolution.vault_provider
    else:
        record.secret_source = "none"
        record.vault_provider = None

    write_audit_log(
        db,
        principal,
        action_type="settings.database_instance.create",
        target_type="database_instance_config",
        target_id=record.id,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[DatabaseInstanceConfigSummary](
        resource=DatabaseInstanceConfigSummary.model_validate(record, from_attributes=True),
        updated_at=record.updated_at,
    )


@router.patch("/database-instances/{instance_id}", response_model=ResourceEnvelope[DatabaseInstanceConfigSummary])
def update_database_instance(
    instance_id: str,
    payload: DatabaseInstanceConfigUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[DatabaseInstanceConfigSummary]:
    ensure_additive_schema_extensions()
    record = db.get(DatabaseInstanceConfig, instance_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Database instance not found")

    before = serialize_model(record)
    updates = payload.model_dump(exclude_none=True)
    if updates.get("is_active") is True:
        for item in db.scalars(select(DatabaseInstanceConfig).where(DatabaseInstanceConfig.is_active.is_(True))):
            item.is_active = False

    connection_string = updates.pop("connection_string", None)
    connection_secret_reference = updates.pop("connection_secret_reference", None)
    for key, value in updates.items():
        setattr(record, key, value)

    if connection_string:
        stored = store_managed_secret(
            db,
            secret_value=connection_string,
            scope_type="database_instance",
            scope_id=record.id,
            secret_kind="connection_string",
            display_name=f"{record.label} connection string",
            created_by_admin_user_id=principal.admin_id,
        )
        record.connection_secret_reference = stored.secret_reference
        record.connection_string_masked = mask_connection_string(connection_string)
        record.secret_source = stored.secret_source
        record.vault_provider = stored.vault_provider
    elif connection_secret_reference:
        record.connection_secret_reference = connection_secret_reference
        resolution = resolve_secret_reference(db, connection_secret_reference)
        record.secret_source = resolution.secret_source
        record.vault_provider = resolution.vault_provider

    write_audit_log(
        db,
        principal,
        action_type="settings.database_instance.update",
        target_type="database_instance_config",
        target_id=record.id,
        before=before,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[DatabaseInstanceConfigSummary](
        resource=DatabaseInstanceConfigSummary.model_validate(record, from_attributes=True),
        updated_at=record.updated_at,
    )


@router.get("/prompt-ui-instances", response_model=ListEnvelope[PromptUiInstanceConfigSummary])
def list_prompt_ui_instances(
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[PromptUiInstanceConfigSummary]:
    _ = principal
    ensure_additive_schema_extensions()
    items = [
        PromptUiInstanceConfigSummary.model_validate(item, from_attributes=True)
        for item in db.scalars(select(PromptUiInstanceConfig).order_by(PromptUiInstanceConfig.created_at.desc()))
    ]
    return ListEnvelope[PromptUiInstanceConfigSummary](
        items=items,
        page=1,
        page_size=len(items) or 1,
        total_count=len(items),
        filters={},
    )


@router.post("/prompt-ui-instances", response_model=ResourceEnvelope[PromptUiInstanceConfigSummary], status_code=status.HTTP_201_CREATED)
def create_prompt_ui_instance(
    payload: PromptUiInstanceConfigCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[PromptUiInstanceConfigSummary]:
    ensure_additive_schema_extensions()
    if payload.is_active:
        for item in db.scalars(select(PromptUiInstanceConfig).where(PromptUiInstanceConfig.is_active.is_(True))):
            item.is_active = False

    record = PromptUiInstanceConfig(**payload.model_dump())
    db.add(record)
    db.flush()
    write_audit_log(
        db,
        principal,
        action_type="settings.prompt_ui_instance.create",
        target_type="prompt_ui_instance_config",
        target_id=record.id,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[PromptUiInstanceConfigSummary](
        resource=PromptUiInstanceConfigSummary.model_validate(record, from_attributes=True),
        updated_at=record.updated_at,
    )


@router.patch("/prompt-ui-instances/{instance_id}", response_model=ResourceEnvelope[PromptUiInstanceConfigSummary])
def update_prompt_ui_instance(
    instance_id: str,
    payload: PromptUiInstanceConfigUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[PromptUiInstanceConfigSummary]:
    ensure_additive_schema_extensions()
    record = db.get(PromptUiInstanceConfig, instance_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prompt UI instance not found")

    before = serialize_model(record)
    updates = payload.model_dump(exclude_none=True)
    if updates.get("is_active") is True:
        for item in db.scalars(select(PromptUiInstanceConfig).where(PromptUiInstanceConfig.is_active.is_(True))):
            item.is_active = False
    for key, value in updates.items():
        setattr(record, key, value)

    write_audit_log(
        db,
        principal,
        action_type="settings.prompt_ui_instance.update",
        target_type="prompt_ui_instance_config",
        target_id=record.id,
        before=before,
        after=serialize_model(record),
        request_id=request_id,
    )
    db.commit()
    db.refresh(record)
    return ResourceEnvelope[PromptUiInstanceConfigSummary](
        resource=PromptUiInstanceConfigSummary.model_validate(record, from_attributes=True),
        updated_at=record.updated_at,
    )
