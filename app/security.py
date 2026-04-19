from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

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


def get_current_principal(
    x_admin_user: str | None = Header(default="local-dev-admin", alias="X-Admin-User"),
    db: Session = Depends(get_db),
) -> Principal:
    if not x_admin_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing admin header")

    admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == x_admin_user))
    if admin is None or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown admin user")

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


def require_permission(permission: str):
    def dependency(principal: Principal = Depends(get_current_principal)) -> Principal:
        if not principal.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission}",
            )
        return principal

    return dependency
