import json

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ResellerPartner
from app.schemas import (
    ListEnvelope,
    ResellerLifecycleActionRequest,
    ResellerLifecycleActionResult,
    ResellerPartner as ResellerPartnerSchema,
    ResellerPartnerCreate,
    ResellerPartnerUpdate,
    ResellerTenantDefaultsSummary,
    ResellerTenantDefaultsUpdate,
    ResourceEnvelope,
    ServiceTierDefinitionSummary,
)
from app.security import Principal, require_permission
from app.services import (
    activate_reseller_state,
    delete_reseller_and_tenants,
    ensure_scope_access,
    generate_reseller_key,
    get_reseller_impact_counts,
    get_service_tier_or_404,
    get_or_create_reseller_defaults,
    get_reseller_or_404,
    inactivate_reseller_state,
    serialize_model,
    sync_reseller_default_service_tier_fields,
    sync_reseller_service_tier_fields,
    validate_reseller_capacity,
    write_audit_log,
)

router = APIRouter()


def to_reseller_schema(db: Session, reseller: ResellerPartner) -> ResellerPartnerSchema:
    impact_counts = get_reseller_impact_counts(db, reseller)
    return ResellerPartnerSchema.model_validate(
        {
            **json.loads(serialize_model(reseller)),
            **impact_counts,
            "service_tier": (
                ServiceTierDefinitionSummary.model_validate(reseller.service_tier, from_attributes=True)
                if reseller.service_tier is not None
                else None
            ),
        }
    )


def to_reseller_defaults_schema(defaults) -> ResellerTenantDefaultsSummary:
    return ResellerTenantDefaultsSummary.model_validate(
        {
            **json.loads(serialize_model(defaults)),
            "default_feature_flags_json": json.loads(defaults.default_feature_flags_json or "{}"),
            "default_service_tier": (
                ServiceTierDefinitionSummary.model_validate(defaults.default_service_tier, from_attributes=True)
                if defaults.default_service_tier is not None
                else None
            ),
        }
    )


@router.get("", response_model=ListEnvelope[ResellerPartnerSchema])
def list_resellers(
    is_active: bool | None = Query(default=None),
    principal: Principal = Depends(require_permission("resellers.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[ResellerPartnerSchema]:
    query = select(ResellerPartner).order_by(ResellerPartner.created_at.desc())
    if is_active is not None:
        query = query.where(ResellerPartner.is_active == is_active)

    items = []
    for reseller in db.scalars(query):
        ensure_scope_access(principal, reseller_partner_id=reseller.id)
        items.append(to_reseller_schema(db, reseller))
    return ListEnvelope[ResellerPartnerSchema](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"is_active": is_active})


@router.post("", response_model=ResourceEnvelope[ResellerPartnerSchema], status_code=status.HTTP_201_CREATED)
def create_reseller(
    payload: ResellerPartnerCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerPartnerSchema]:
    payload_data = payload.model_dump()
    payload_data["reseller_key"] = payload.reseller_key or generate_reseller_key(db, payload.reseller_name)
    reseller = ResellerPartner(**payload_data)
    if payload.service_tier_definition_id:
        tier = get_service_tier_or_404(
            db,
            str(payload.service_tier_definition_id),
            scope_type="reseller",
            require_active=True,
        )
        sync_reseller_service_tier_fields(reseller, tier)
    db.add(reseller)
    db.flush()
    validate_reseller_capacity(db, reseller)
    write_audit_log(
        db,
        principal,
        action_type="reseller.create",
        target_type="reseller",
        target_id=reseller.id,
        after=serialize_model(reseller),
        request_id=request_id,
    )
    db.commit()
    db.refresh(reseller)
    return ResourceEnvelope[ResellerPartnerSchema](resource=to_reseller_schema(db, reseller), updated_at=reseller.updated_at)


@router.patch("/{reseller_id}", response_model=ResourceEnvelope[ResellerPartnerSchema])
def update_reseller(
    reseller_id: str,
    payload: ResellerPartnerUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerPartnerSchema]:
    reseller = get_reseller_or_404(db, reseller_id)
    ensure_scope_access(principal, reseller_partner_id=reseller.id)
    before = serialize_model(reseller)
    updates = payload.model_dump(exclude_none=True)
    requested_tier = None
    if "service_tier_definition_id" in updates:
        requested_tier = get_service_tier_or_404(
            db,
            str(updates.pop("service_tier_definition_id")),
            scope_type="reseller",
            require_active=True,
        )
    for key, value in updates.items():
        setattr(reseller, key, value)
    if requested_tier is not None:
        sync_reseller_service_tier_fields(reseller, requested_tier)
    validate_reseller_capacity(db, reseller)
    write_audit_log(
        db,
        principal,
        action_type="reseller.update",
        target_type="reseller",
        target_id=reseller.id,
        before=before,
        after=serialize_model(reseller),
        request_id=request_id,
    )
    db.commit()
    db.refresh(reseller)
    return ResourceEnvelope[ResellerPartnerSchema](resource=to_reseller_schema(db, reseller), updated_at=reseller.updated_at)


@router.post("/{reseller_id}/actions", response_model=ResourceEnvelope[ResellerLifecycleActionResult])
def run_reseller_lifecycle_action(
    reseller_id: str,
    payload: ResellerLifecycleActionRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerLifecycleActionResult]:
    reseller = get_reseller_or_404(db, reseller_id)
    ensure_scope_access(principal, reseller_partner_id=reseller.id)
    before = serialize_model(reseller)

    if payload.action == "inactivate":
        counts = inactivate_reseller_state(db, reseller)
        write_audit_log(
            db,
            principal,
            action_type="reseller.lifecycle.inactivate",
            target_type="reseller",
            target_id=reseller.id,
            before=before,
            after=serialize_model(reseller),
            request_id=request_id,
        )
        db.commit()
        db.refresh(reseller)
        return ResourceEnvelope[ResellerLifecycleActionResult](
            resource=ResellerLifecycleActionResult(
                reseller_id=reseller.id,
                action=payload.action,
                resulting_status="inactive",
                impacted_organization_count=counts["organization_count"],
                impacted_user_count=counts["total_user_count"],
                impacted_partner_admin_count=counts["partner_admin_count"],
                message=(
                    f"Partner inactivated. Disabled {counts['partner_admin_count']} partner admin login(s), "
                    f"{counts['organization_count']} organization(s), and {counts['total_user_count']} user account(s)."
                ),
            ),
            updated_at=reseller.updated_at,
        )

    if payload.action == "activate":
        counts = activate_reseller_state(db, reseller)
        write_audit_log(
            db,
            principal,
            action_type="reseller.lifecycle.activate",
            target_type="reseller",
            target_id=reseller.id,
            before=before,
            after=serialize_model(reseller),
            request_id=request_id,
        )
        db.commit()
        db.refresh(reseller)
        return ResourceEnvelope[ResellerLifecycleActionResult](
            resource=ResellerLifecycleActionResult(
                reseller_id=reseller.id,
                action=payload.action,
                resulting_status="active",
                impacted_organization_count=counts["organization_count"],
                impacted_user_count=counts["total_user_count"],
                impacted_partner_admin_count=counts["partner_admin_count"],
                message=(
                    f"Partner reactivated. Re-enabled {counts['partner_admin_count']} partner admin login(s), "
                    f"{counts['organization_count']} organization(s), and {counts['total_user_count']} user account(s)."
                ),
            ),
            updated_at=reseller.updated_at,
        )

    counts = delete_reseller_and_tenants(db, reseller)
    write_audit_log(
        db,
        principal,
        action_type="reseller.lifecycle.delete",
        target_type="reseller",
        target_id=reseller_id,
        before=before,
        request_id=request_id,
    )
    db.commit()
    return ResourceEnvelope[ResellerLifecycleActionResult](
        resource=ResellerLifecycleActionResult(
            reseller_id=reseller_id,
            action=payload.action,
            resulting_status="deleted",
            impacted_organization_count=counts["organization_count"],
            impacted_user_count=counts["total_user_count"],
            impacted_partner_admin_count=counts["partner_admin_count"],
            message=(
                f"Deleted inactive partner along with {counts['organization_count']} organization(s) "
                f"and {counts['total_user_count']} user account(s)."
            ),
        ),
        updated_at=reseller.updated_at,
    )


@router.get("/{reseller_id}/tenant-defaults", response_model=ResourceEnvelope[ResellerTenantDefaultsSummary])
def get_reseller_tenant_defaults(
    reseller_id: str,
    principal: Principal = Depends(require_permission("resellers.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerTenantDefaultsSummary]:
    reseller = get_reseller_or_404(db, reseller_id)
    ensure_scope_access(principal, reseller_partner_id=reseller.id)
    defaults = get_or_create_reseller_defaults(db, reseller)
    db.commit()
    db.refresh(defaults)
    resource = to_reseller_defaults_schema(defaults)
    return ResourceEnvelope[ResellerTenantDefaultsSummary](resource=resource, updated_at=defaults.updated_at)


@router.put("/{reseller_id}/tenant-defaults", response_model=ResourceEnvelope[ResellerTenantDefaultsSummary])
def update_reseller_tenant_defaults(
    reseller_id: str,
    payload: ResellerTenantDefaultsUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerTenantDefaultsSummary]:
    reseller = get_reseller_or_404(db, reseller_id)
    ensure_scope_access(principal, reseller_partner_id=reseller.id)
    defaults = get_or_create_reseller_defaults(db, reseller)
    before = serialize_model(defaults)

    updates = payload.model_dump(mode="json")
    requested_tier = None
    if updates.get("default_service_tier_definition_id"):
        requested_tier = get_service_tier_or_404(
            db,
            str(updates.pop("default_service_tier_definition_id")),
            scope_type="organization",
            require_active=True,
        )
    elif "default_plan_tier" in updates and updates["default_plan_tier"]:
        updates.pop("default_plan_tier")
    feature_flags = updates.pop("default_feature_flags_json", {})
    for key, value in updates.items():
        setattr(defaults, key, value)
    if requested_tier is not None:
        sync_reseller_default_service_tier_fields(defaults, requested_tier)
    defaults.default_feature_flags_json = json.dumps(feature_flags, sort_keys=True)

    write_audit_log(
        db,
        principal,
        action_type="reseller.tenant_defaults.update",
        target_type="reseller_tenant_defaults",
        target_id=defaults.id,
        before=before,
        after=serialize_model(defaults),
        request_id=request_id,
    )
    db.commit()
    db.refresh(defaults)

    resource = to_reseller_defaults_schema(defaults)
    return ResourceEnvelope[ResellerTenantDefaultsSummary](resource=resource, updated_at=defaults.updated_at)
