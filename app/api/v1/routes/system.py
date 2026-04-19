from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Group, ResellerPartner, Tenant, TenantLLMConfig, TenantOnboardingStatus, UserTenantMembership
from app.schemas import ResourceEnvelope, SystemOverview
from app.security import Principal, require_permission

router = APIRouter()


@router.get("/overview", response_model=ResourceEnvelope[SystemOverview])
def get_system_overview(
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[SystemOverview]:
    _ = principal
    overview = SystemOverview(
        tenant_count=db.scalar(select(func.count()).select_from(Tenant)) or 0,
        active_tenant_count=db.scalar(select(func.count()).select_from(Tenant).where(Tenant.status == "active")) or 0,
        reseller_count=db.scalar(select(func.count()).select_from(ResellerPartner)) or 0,
        active_user_count=db.scalar(select(func.count()).select_from(UserTenantMembership).where(UserTenantMembership.status == "active")) or 0,
        active_group_count=db.scalar(select(func.count()).select_from(Group).where(Group.is_active.is_(True))) or 0,
        invalid_credential_count=db.scalar(select(func.count()).select_from(TenantLLMConfig).where(TenantLLMConfig.credential_status == "invalid")) or 0,
        stalled_onboarding_count=db.scalar(select(func.count()).select_from(TenantOnboardingStatus).where(TenantOnboardingStatus.onboarding_status == "in_progress")) or 0,
    )
    return ResourceEnvelope[SystemOverview](resource=overview)
