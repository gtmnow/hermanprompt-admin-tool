from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Group, ResellerPartner, Tenant, TenantLLMConfig, TenantOnboardingStatus, UserTenantMembership
from app.schemas import ResourceEnvelope, SystemOverview
from app.security import Principal, require_permission
from app.services import get_snapshot_tenant_ids, has_live_snapshot, table_exists

router = APIRouter()


@router.get("/overview", response_model=ResourceEnvelope[SystemOverview])
def get_system_overview(
    principal: Principal = Depends(require_permission("system_health.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[SystemOverview]:
    _ = principal
    snapshot_tenant_ids = get_snapshot_tenant_ids(db) if has_live_snapshot(db) else []
    tenant_count = db.scalar(select(func.count()).select_from(Tenant)) if table_exists(db, "tenants") else 0
    active_tenant_count = (
        db.scalar(select(func.count()).select_from(Tenant).where(Tenant.status == "active"))
        if table_exists(db, "tenants")
        else 0
    )
    reseller_count = db.scalar(select(func.count()).select_from(ResellerPartner)) if table_exists(db, "reseller_partners") else 0
    active_group_count = db.scalar(select(func.count()).select_from(Group).where(Group.is_active.is_(True))) if table_exists(db, "groups") else 0
    invalid_credential_count = (
        db.scalar(select(func.count()).select_from(TenantLLMConfig).where(TenantLLMConfig.credential_status == "invalid"))
        if table_exists(db, "tenant_llm_config")
        else 0
    )
    stalled_onboarding_count = (
        db.scalar(select(func.count()).select_from(TenantOnboardingStatus).where(TenantOnboardingStatus.onboarding_status == "in_progress"))
        if table_exists(db, "tenant_onboarding_status")
        else 0
    )
    overview = SystemOverview(
        tenant_count=max(tenant_count or 0, len(snapshot_tenant_ids)),
        active_tenant_count=max(active_tenant_count or 0, len(snapshot_tenant_ids)),
        reseller_count=reseller_count or 0,
        active_user_count=(
            db.execute(select(func.count()).select_from(text("auth_users")).where(text("is_active"))).scalar()
            if has_live_snapshot(db)
            else db.scalar(select(func.count()).select_from(UserTenantMembership).where(UserTenantMembership.status == "active")) or 0
        ),
        active_group_count=active_group_count or 0,
        invalid_credential_count=invalid_credential_count or 0,
        stalled_onboarding_count=stalled_onboarding_count or 0,
    )
    return ResourceEnvelope[SystemOverview](resource=overview)
