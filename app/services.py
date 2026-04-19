from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AdminAuditLog,
    AdminPermission,
    AdminScope,
    AdminUser,
    Group,
    ReportExportJob,
    ResellerPartner,
    Tenant,
    TenantLLMConfig,
    TenantOnboardingStatus,
    TenantRuntimeSettings,
    UserGroupMembership,
    UserTenantMembership,
)
from app.security import Principal


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
    if len(api_key) <= 4:
        return "*" * len(api_key)
    return f"{'*' * (len(api_key) - 4)}{api_key[-4:]}"


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


def validate_activation_readiness(db: Session, tenant: Tenant) -> None:
    onboarding = refresh_onboarding_state(db, tenant.id)
    llm_config = db.scalar(select(TenantLLMConfig).where(TenantLLMConfig.tenant_id == tenant.id))
    if not onboarding.llm_configured or not onboarding.llm_validated or not onboarding.admin_assigned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant cannot be activated until LLM config is validated and admins are assigned",
        )
    if not onboarding.users_uploaded:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant must have at least one user")
    if llm_config and not llm_config.transformation_enabled and not llm_config.scoring_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Runtime configuration would do nothing")


def build_report_payload(db: Session, scope_type: str, scope_id: str, start_date: date, end_date: date) -> dict:
    active_users_query = select(func.count()).select_from(UserTenantMembership)
    active_groups_query = select(func.count()).select_from(Group).where(Group.is_active.is_(True))
    tenant_count_query = select(func.count()).select_from(Tenant)

    if scope_type == "organization":
        active_users_query = active_users_query.where(UserTenantMembership.tenant_id == scope_id)
        active_groups_query = active_groups_query.where(Group.tenant_id == scope_id)
        tenant_count = 1
    elif scope_type == "group":
        memberships = db.scalar(
            select(func.count()).select_from(UserGroupMembership).where(UserGroupMembership.group_id == scope_id)
        ) or 0
        active_users = memberships
        active_groups = 1
        tenant_count = 1
    elif scope_type == "reseller":
        tenant_ids = list(
            db.scalars(select(Tenant.id).where(Tenant.reseller_partner_id == scope_id))
        )
        active_users_query = active_users_query.where(UserTenantMembership.tenant_id.in_(tenant_ids))
        active_groups_query = active_groups_query.where(Group.tenant_id.in_(tenant_ids))
        tenant_count = len(tenant_ids)
    else:
        tenant_count = db.scalar(tenant_count_query) or 0

    if scope_type != "group":
        active_users = db.scalar(active_users_query.where(UserTenantMembership.status == "active")) or 0
        active_groups = db.scalar(active_groups_query) or 0

    days = max((end_date - start_date).days, 1)
    series = []
    for offset in range(days + 1):
        bucket = start_date + timedelta(days=offset)
        series.append(
            {
                "bucket": bucket.isoformat(),
                "value": round(50 + (offset * 2.4) + (active_users * 0.3), 2),
            }
        )

    return {
        "active_users": active_users,
        "active_groups": active_groups,
        "tenant_count": tenant_count,
        "average_improvement": round(8.5 + min(active_users, 20) * 0.7, 2),
        "series": series,
    }


def create_export_file(job: ReportExportJob, payload: dict) -> str:
    export_dir = Path("data/exports")
    export_dir.mkdir(parents=True, exist_ok=True)
    file_path = export_dir / f"{job.id}.csv"
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
    file_path.write_text("\n".join(rows), encoding="utf-8")
    return str(file_path)


def seed_database(db: Session) -> None:
    existing_admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == "local-dev-admin"))
    if existing_admin:
        return

    reseller = ResellerPartner(reseller_key="demo-reseller", reseller_name="Demo Reseller")
    db.add(reseller)
    db.flush()

    admin = AdminUser(user_id_hash="local-dev-admin", role="super_admin", is_active=True)
    db.add(admin)
    db.flush()

    db.add(AdminScope(admin_user_id=admin.id, scope_type="global"))
    db.add(AdminPermission(admin_user_id=admin.id, permission_key="system_health.read"))

    tenant = Tenant(
        tenant_key="demo-tenant",
        tenant_name="Demo Tenant",
        reseller_partner_id=reseller.id,
        status="onboarding",
        plan_tier="enterprise",
        reporting_timezone="America/New_York",
    )
    db.add(tenant)
    db.flush()

    db.add(TenantRuntimeSettings(tenant_id=tenant.id, enforcement_mode="coaching"))
    db.add(TenantOnboardingStatus(tenant_id=tenant.id, tenant_created=True, onboarding_status="draft"))
    db.commit()
