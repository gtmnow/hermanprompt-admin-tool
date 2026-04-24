from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AdminPermission, AdminScope, AdminUser
from app.schemas import AdminCreate, AdminUpdate, AdminUserSummary, ListEnvelope, ResourceEnvelope
from app.schemas.admins import AdminPermissionSummary, AdminProfileSummary, AdminScopeSummary
from app.security import Principal, require_permission
from app.services import (
    ensure_scope_access,
    get_admin_or_404,
    generate_internal_user_id_hash,
    refresh_onboarding_state,
    serialize_model,
    upsert_admin_profile,
    write_audit_log,
)

router = APIRouter()


def to_admin_summary(admin: AdminUser) -> AdminUserSummary:
    return AdminUserSummary(
        id=admin.id,
        user_id_hash=admin.user_id_hash,
        role=admin.role,
        is_active=admin.is_active,
        created_at=admin.created_at,
        updated_at=admin.updated_at,
        permissions=[AdminPermissionSummary(permission_key=item.permission_key) for item in admin.permissions],
        scopes=[
            AdminScopeSummary(
                id=item.id,
                scope_type=item.scope_type,
                reseller_partner_id=item.reseller_partner_id,
                tenant_id=item.tenant_id,
                group_id=item.group_id,
                created_at=item.created_at,
            )
            for item in admin.scopes
        ],
        profile=AdminProfileSummary.model_validate(admin.profile, from_attributes=True) if admin.profile else None,
    )


@router.get("", response_model=ListEnvelope[AdminUserSummary])
def list_admins(
    role: str | None = Query(default=None),
    principal: Principal = Depends(require_permission("admins.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[AdminUserSummary]:
    query = select(AdminUser).order_by(AdminUser.created_at.desc())
    if role:
        query = query.where(AdminUser.role == role)

    items = []
    for admin in db.scalars(query):
        if admin.scopes:
            for scope in admin.scopes:
                ensure_scope_access(
                    principal,
                    reseller_partner_id=scope.reseller_partner_id,
                    tenant_id=scope.tenant_id,
                    group_id=scope.group_id,
                )
                break
        items.append(to_admin_summary(admin))
    return ListEnvelope[AdminUserSummary](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"role": role})


@router.post("", response_model=ResourceEnvelope[AdminUserSummary], status_code=status.HTTP_201_CREATED)
def create_admin(
    payload: AdminCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("admins.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[AdminUserSummary]:
    resolved_user_id_hash = payload.user_id_hash or generate_internal_user_id_hash(payload.email)
    admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == resolved_user_id_hash))
    created_admin = admin is None

    if admin is None:
        admin = AdminUser(user_id_hash=resolved_user_id_hash, role=payload.role, is_active=True)
        db.add(admin)
        db.flush()
    else:
        admin.is_active = True
        if payload.role == "super_admin" and admin.role != "super_admin":
            admin.role = "super_admin"
        elif admin.role != payload.role and admin.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User is already assigned as {admin.role}. Update the existing admin assignment instead.",
            )

    upsert_admin_profile(db, admin, payload.model_dump(mode="json"))

    existing_permissions = {item.permission_key for item in admin.permissions}
    for permission in payload.permissions:
        if permission not in principal.permissions and principal.role != "super_admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delegate permissions you do not have")
        if permission not in existing_permissions:
            db.add(AdminPermission(admin_user_id=admin.id, permission_key=permission))

    existing_scopes = {
        (item.scope_type, item.reseller_partner_id, item.tenant_id, item.group_id)
        for item in admin.scopes
    }

    for scope in payload.scopes:
        ensure_scope_access(
            principal,
            reseller_partner_id=str(scope.reseller_partner_id) if scope.reseller_partner_id else None,
            tenant_id=str(scope.tenant_id) if scope.tenant_id else None,
            group_id=str(scope.group_id) if scope.group_id else None,
        )
        scope_key = (
            scope.scope_type,
            str(scope.reseller_partner_id) if scope.reseller_partner_id else None,
            str(scope.tenant_id) if scope.tenant_id else None,
            str(scope.group_id) if scope.group_id else None,
        )
        if scope_key in existing_scopes:
            continue
        db.add(AdminScope(admin_user_id=admin.id, **scope.model_dump(mode="json")))
        existing_scopes.add(scope_key)
        if scope.tenant_id:
            refresh_onboarding_state(db, str(scope.tenant_id))

    write_audit_log(
        db,
        principal,
        action_type="admin.create" if created_admin else "admin.update",
        target_type="admin_user",
        target_id=admin.id,
        after=serialize_model(admin),
        request_id=request_id,
    )
    db.commit()
    db.refresh(admin)
    return ResourceEnvelope[AdminUserSummary](resource=to_admin_summary(admin), updated_at=admin.updated_at)


@router.patch("/{admin_id}", response_model=ResourceEnvelope[AdminUserSummary])
def update_admin(
    admin_id: str,
    payload: AdminUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("admins.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[AdminUserSummary]:
    admin = get_admin_or_404(db, admin_id)
    before = serialize_model(admin)

    if payload.is_active is not None:
        admin.is_active = payload.is_active
    profile_updates = {
        key: value
        for key, value in payload.model_dump(exclude_none=True, mode="json").items()
        if key in {"display_name", "email"}
    }
    if profile_updates:
        upsert_admin_profile(db, admin, profile_updates)
    if payload.permissions is not None:
        db.execute(delete(AdminPermission).where(AdminPermission.admin_user_id == admin.id))
        for permission in payload.permissions:
            if permission not in principal.permissions and principal.role != "super_admin":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delegate permissions you do not have")
            db.add(AdminPermission(admin_user_id=admin.id, permission_key=permission))
    if payload.scopes is not None:
        db.execute(delete(AdminScope).where(AdminScope.admin_user_id == admin.id))
        for scope in payload.scopes:
            ensure_scope_access(
                principal,
                reseller_partner_id=str(scope.reseller_partner_id) if scope.reseller_partner_id else None,
                tenant_id=str(scope.tenant_id) if scope.tenant_id else None,
                group_id=str(scope.group_id) if scope.group_id else None,
            )
            db.add(AdminScope(admin_user_id=admin.id, **scope.model_dump(mode="json")))

    write_audit_log(
        db,
        principal,
        action_type="admin.update",
        target_type="admin_user",
        target_id=admin.id,
        before=before,
        after=serialize_model(admin),
        request_id=request_id,
    )
    db.commit()
    db.refresh(admin)
    return ResourceEnvelope[AdminUserSummary](resource=to_admin_summary(admin), updated_at=admin.updated_at)
