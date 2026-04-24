from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import get_request_session_id, resolve_active_admin_session, touch_admin_session
from app.core.config import get_settings
from app.db import get_db
from app.models import AdminPermission, AdminScope, AdminUser


ROLE_DEFAULT_PERMISSIONS: dict[str, set[str]] = {
    "super_admin": {
        "tenants.read",
        "tenants.create",
        "tenants.write",
        "resellers.read",
        "resellers.create",
        "resellers.write",
        "groups.read",
        "groups.create",
        "groups.write",
        "users.read",
        "users.create",
        "users.write",
        "admins.read",
        "admins.create",
        "admins.write",
        "runtime.read",
        "runtime.write",
        "runtime.validate",
        "analytics.read",
        "analytics.export",
        "system_health.read",
        "audit.read",
    },
    "support_admin": {"tenants.read", "groups.read", "users.read", "runtime.read", "analytics.read", "audit.read"},
    "reseller_super_user": {
        "resellers.read",
        "tenants.read",
        "tenants.create",
        "tenants.write",
        "groups.read",
        "groups.create",
        "groups.write",
        "users.read",
        "users.create",
        "users.write",
        "admins.read",
        "admins.create",
        "admins.write",
        "runtime.read",
        "runtime.write",
        "runtime.validate",
        "analytics.read",
        "analytics.export",
    },
    "tenant_admin": {
        "tenants.read",
        "tenants.write",
        "groups.read",
        "groups.create",
        "groups.write",
        "users.read",
        "users.create",
        "users.write",
        "admins.read",
        "admins.create",
        "runtime.read",
        "runtime.write",
        "analytics.read",
        "analytics.export",
    },
    "group_admin": {"groups.read", "groups.write", "users.read", "users.write", "analytics.read"},
    "analyst": {"analytics.read"},
}


@dataclass
class Principal:
    admin_id: str
    user_id_hash: str
    role: str
    permissions: set[str]
    scopes: list[AdminScope]

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions


def build_principal_for_admin(db: Session, admin: AdminUser) -> Principal:
    try:
        if not admin.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive admin user")
    except AttributeError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown admin user") from exc

    explicit_permissions = {
        item.permission_key for item in db.scalars(select(AdminPermission).where(AdminPermission.admin_user_id == admin.id))
    }
    permissions = explicit_permissions | ROLE_DEFAULT_PERMISSIONS.get(admin.role, set())
    scopes = list(db.scalars(select(AdminScope).where(AdminScope.admin_user_id == admin.id)))
    return Principal(
        admin_id=admin.id,
        user_id_hash=admin.user_id_hash,
        role=admin.role,
        permissions=permissions,
        scopes=scopes,
    )


def _resolve_dev_header_principal(db: Session, x_admin_user: str) -> Principal:
    try:
        admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == x_admin_user))
    except Exception:
        admin = None

    if admin is None:
        try:
            db.execute(text("select 1 from admin_users limit 1"))
        except Exception:
            if x_admin_user == "local-dev-admin":
                return Principal(
                    admin_id="local-dev-admin",
                    user_id_hash="local-dev-admin",
                    role="super_admin",
                    permissions=ROLE_DEFAULT_PERMISSIONS["super_admin"],
                    scopes=[AdminScope(admin_user_id="local-dev-admin", scope_type="global")],
                )

    if admin is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown admin user")
    return build_principal_for_admin(db, admin)


def get_current_principal(
    request: Request,
    x_admin_user: str | None = Header(default=None, alias="X-Admin-User"),
    db: Session = Depends(get_db),
) -> Principal:
    settings = get_settings()
    session_id = get_request_session_id(request, settings)
    if session_id:
        session = resolve_active_admin_session(db, session_id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired admin session")
        admin = db.get(AdminUser, session.admin_user_id)
        if admin is None or not admin.is_active or admin.user_id_hash != session.user_id_hash:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive admin session")
        touch_admin_session(db, session)
        return build_principal_for_admin(db, admin)

    if settings.allow_dev_header_auth and settings.environment == "development" and x_admin_user:
        return _resolve_dev_header_principal(db, x_admin_user)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin session required")


def require_permission(permission: str):
    def dependency(principal: Principal = Depends(get_current_principal)) -> Principal:
        if not principal.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission}",
            )
        return principal

    return dependency


def require_super_admin(principal: Principal = Depends(get_current_principal)) -> Principal:
    if principal.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access is required")
    return principal
