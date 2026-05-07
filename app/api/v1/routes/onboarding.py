import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import TenantOnboardingStatus
from app.schemas import ListEnvelope, ResourceEnvelope, TenantOnboardingStatus as TenantOnboardingStatusSchema
from app.security import Principal, require_permission
from app.services import (
    ensure_scope_access,
    get_tenant_or_404,
    refresh_onboarding_state,
    table_exists,
    tenant_onboarding_status_orm_compatible,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/tenants", response_model=ListEnvelope[TenantOnboardingStatusSchema])
def list_onboarding_statuses(
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[TenantOnboardingStatusSchema]:
    started_at = perf_counter()
    if not table_exists(db, "tenant_onboarding_status"):
        return ListEnvelope[TenantOnboardingStatusSchema](items=[], page=1, page_size=1, total_count=0, filters={})

    items = []
    if tenant_onboarding_status_orm_compatible(db):
        tenant_ids = [onboarding.tenant_id for onboarding in db.scalars(select(TenantOnboardingStatus).order_by(TenantOnboardingStatus.updated_at.desc()))]
    else:
        tenant_ids = [
            row["tenant_id"]
            for row in db.execute(text("select tenant_id from tenant_onboarding_status order by updated_at desc")).mappings()
        ]

    for tenant_id in tenant_ids:
        tenant = get_tenant_or_404(db, tenant_id)
        try:
            ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_403_FORBIDDEN:
                continue
            raise
        items.append(TenantOnboardingStatusSchema.model_validate(refresh_onboarding_state(db, tenant.id), from_attributes=True))
    db.commit()
    logger.info(
        "onboarding.tenants.list completed",
        extra={
            "context": {
                "role": principal.role,
                "scope_count": len(principal.scopes),
                "tenant_ids_examined": len(tenant_ids),
                "returned_count": len(items),
                "duration_ms": round((perf_counter() - started_at) * 1000, 1),
            }
        },
    )
    return ListEnvelope[TenantOnboardingStatusSchema](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={})


@router.get("/tenants/{tenant_id}", response_model=ResourceEnvelope[TenantOnboardingStatusSchema])
def get_onboarding_status(
    tenant_id: str,
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantOnboardingStatusSchema]:
    if not table_exists(db, "tenant_onboarding_status"):
        raise HTTPException(status_code=404, detail="Onboarding state is not available in this database")

    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    onboarding = refresh_onboarding_state(db, tenant.id)
    db.commit()
    return ResourceEnvelope[TenantOnboardingStatusSchema](
        resource=TenantOnboardingStatusSchema.model_validate(onboarding, from_attributes=True),
        updated_at=onboarding.updated_at,
    )
