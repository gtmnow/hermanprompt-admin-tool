from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import TenantOnboardingStatus
from app.schemas import ListEnvelope, ResourceEnvelope, TenantOnboardingStatus as TenantOnboardingStatusSchema
from app.security import Principal, require_permission
from app.services import ensure_scope_access, get_tenant_or_404, refresh_onboarding_state

router = APIRouter()


@router.get("/tenants", response_model=ListEnvelope[TenantOnboardingStatusSchema])
def list_onboarding_statuses(
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[TenantOnboardingStatusSchema]:
    items = []
    for onboarding in db.scalars(select(TenantOnboardingStatus).order_by(TenantOnboardingStatus.updated_at.desc())):
        tenant = get_tenant_or_404(db, onboarding.tenant_id)
        ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
        items.append(TenantOnboardingStatusSchema.model_validate(refresh_onboarding_state(db, tenant.id), from_attributes=True))
    db.commit()
    return ListEnvelope[TenantOnboardingStatusSchema](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={})


@router.get("/tenants/{tenant_id}", response_model=ResourceEnvelope[TenantOnboardingStatusSchema])
def get_onboarding_status(
    tenant_id: str,
    principal: Principal = Depends(require_permission("tenants.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[TenantOnboardingStatusSchema]:
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    onboarding = refresh_onboarding_state(db, tenant.id)
    db.commit()
    return ResourceEnvelope[TenantOnboardingStatusSchema](
        resource=TenantOnboardingStatusSchema.model_validate(onboarding, from_attributes=True),
        updated_at=onboarding.updated_at,
    )
