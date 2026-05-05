from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from uuid import NAMESPACE_URL, uuid5

from app.db import get_db
from app.invitations import create_or_replace_invitation, invitation_delivery_error, send_invitation_email
from app.models import AdminPermission, AdminScope, AdminUser, Group, UserGroupMembership, UserInvitation, UserTenantMembership
from app.models import Tenant
from app.schemas import (
    ListEnvelope,
    ResourceEnvelope,
    UserAdminRoleSummary,
    UserDetailSectionSummary,
    UserInvitationSummary,
    UserLifecycleActionRequest,
    UserMembershipCreate,
    UserMembershipSummary,
    UserStatusSummary,
    UserMembershipUpdate,
)
from app.schemas.users import UserGroupMembershipSummary, UserMembershipProfileSummary
from app.security import Principal, require_permission
from app.services import (
    auth_tenant_candidates,
    build_display_name,
    ensure_deactivated_users_tenant,
    ensure_scope_access,
    get_canonical_user_id_hash,
    get_tenant_or_404,
    get_auth_users,
    normalize_email,
    parse_datetime,
    refresh_onboarding_state,
    seed_foundational_profile,
    serialize_model,
    sync_auth_user_primary_tenant,
    get_user_detail_sections,
    table_exists,
    upsert_auth_user,
    upsert_user_membership_profile,
    validate_tenant_user_limit,
    write_audit_log,
)

router = APIRouter()


def string_value(value: object | None) -> str | None:
    if value is None:
        return None
    try:
        text_value = str(value).strip()
    except Exception:
        return None
    return text_value or None


def safe_datetime(value: object | None):
    return parse_datetime(value) if isinstance(value, (str, datetime)) else None


def ensure_single_tenant_membership(
    db: Session,
    *,
    user_id_hash: str,
    target_tenant: Tenant,
) -> None:
    conflicting_membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == user_id_hash,
            UserTenantMembership.tenant_id != target_tenant.id,
            UserTenantMembership.status != "deleted",
        )
    )
    if conflicting_membership is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already belongs to another organization",
        )

    allowed_tenant_ids = set(auth_tenant_candidates(target_tenant))
    deactivated_tenant = db.scalar(select(Tenant).where(Tenant.tenant_key == "Deactivated_Users"))
    if deactivated_tenant is not None:
        allowed_tenant_ids.update(auth_tenant_candidates(deactivated_tenant))

    for auth_row in get_auth_users(db, user_id_hash):
        auth_tenant_id = string_value(auth_row.get("tenant_id"))
        if auth_tenant_id and auth_tenant_id not in allowed_tenant_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User already belongs to another organization",
            )


def auth_row_has_credentials(auth_row: dict[str, object] | None) -> bool:
    if auth_row is None:
        return False
    return bool(auth_row.get("password_changed_at") or auth_row.get("last_login_at"))


def effective_membership_status(
    membership_status: str,
    auth_row: dict[str, object] | None,
) -> str:
    if membership_status == "invited" and auth_row_has_credentials(auth_row):
        return "active" if bool(auth_row and auth_row.get("is_active")) else "inactive"
    return membership_status


def resolved_avg_improvement_pct(
    *,
    sessions_count: int,
    profile_avg_improvement_pct: int | None,
    derived_avg_improvement_pct: int | None,
) -> int | None:
    if sessions_count <= 0:
        return None
    if profile_avg_improvement_pct is not None:
        return profile_avg_improvement_pct
    return derived_avg_improvement_pct


def latest_invitation_for_user(db: Session, user_id_hash: str, tenant_id: str) -> UserInvitation | None:
    if not table_exists(db, "user_invitations"):
        return None
    invitations = list(
        db.scalars(
            select(UserInvitation)
            .where(
                UserInvitation.user_id_hash == user_id_hash,
                UserInvitation.tenant_id == tenant_id,
            )
            .order_by(UserInvitation.created_at.desc())
        )
    )
    return invitations[0] if invitations else None


def invitation_state(invitation: UserInvitation) -> str:
    now = datetime.now(timezone.utc)
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if invitation.expires_at is not None:
        invitation_expiry = invitation.expires_at.astimezone(timezone.utc) if invitation.expires_at.tzinfo else invitation.expires_at.replace(tzinfo=timezone.utc)
        if invitation_expiry < now:
            return "expired"
    if invitation.status == "sent" or invitation.sent_at is not None:
        return "sent"
    if invitation.status == "failed":
        return "failed"
    return invitation.status or "pending"


def build_invitation_summary(invitation: UserInvitation | None) -> UserInvitationSummary | None:
    if invitation is None:
        return None
    return UserInvitationSummary(
        state=invitation_state(invitation),
        email=invitation.email,
        sent_at=invitation.sent_at,
        accepted_at=invitation.accepted_at,
        expires_at=invitation.expires_at,
        revoked_at=invitation.revoked_at,
        last_error=invitation.last_error,
    )


def build_status_summary(
    membership_status: str,
    auth_row: dict[str, object] | None,
    invitation: UserInvitation | None,
) -> UserStatusSummary:
    detail: str | None = None
    badge = effective_membership_status(membership_status, auth_row)

    if membership_status in {"active", "inactive"} and auth_row is not None:
        badge = "active" if bool(auth_row.get("is_active")) else "inactive"
        if badge != membership_status:
            detail = "Membership and login state do not currently match."
    elif membership_status == "invited" and auth_row_has_credentials(auth_row):
        detail = "This user has credentials, so Herman Admin is treating the membership as active or inactive."

    if invitation is not None:
        current_invitation_state = invitation_state(invitation)
        invitation_details = {
            "accepted": "Invitation accepted.",
            "revoked": "Invitation revoked.",
            "expired": "Invitation expired.",
            "sent": "Invitation sent.",
            "pending": "Invitation pending.",
            "failed": "Invitation delivery failed.",
        }
        if membership_status == "invited" or current_invitation_state in invitation_details:
            detail = invitation_details.get(current_invitation_state, detail)

    if membership_status == "deleted":
        detail = "This user has been moved into the deactivated-users flow."

    return UserStatusSummary(badge=badge, detail=detail)


def build_admin_role_summary(db: Session, user_id_hash: str) -> UserAdminRoleSummary | None:
    if not table_exists(db, "admin_users"):
        return None
    admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == user_id_hash))
    if admin is None:
        return None
    permissions = [
        item.permission_key
        for item in db.scalars(select(AdminPermission).where(AdminPermission.admin_user_id == admin.id))
    ]
    scopes = list(db.scalars(select(AdminScope).where(AdminScope.admin_user_id == admin.id)))
    return UserAdminRoleSummary(
        admin_id=admin.id,
        role=admin.role,
        is_active=admin.is_active,
        permissions=permissions,
        scope_types=sorted({scope.scope_type for scope in scopes}),
    )


def build_admin_role_lookup(db: Session, user_id_hashes: list[str]) -> dict[str, UserAdminRoleSummary]:
    if not user_id_hashes or not table_exists(db, "admin_users"):
        return {}

    unique_hashes = sorted({user_id_hash for user_id_hash in user_id_hashes if user_id_hash})
    if not unique_hashes:
        return {}

    admins = list(
        db.scalars(
            select(AdminUser).where(AdminUser.user_id_hash.in_(unique_hashes))
        )
    )
    if not admins:
        return {}

    admin_ids = [admin.id for admin in admins]
    permissions_by_admin_id: dict[str, list[str]] = {admin_id: [] for admin_id in admin_ids}
    for permission in db.scalars(select(AdminPermission).where(AdminPermission.admin_user_id.in_(admin_ids))):
        permissions_by_admin_id.setdefault(permission.admin_user_id, []).append(permission.permission_key)

    scope_types_by_admin_id: dict[str, set[str]] = {admin_id: set() for admin_id in admin_ids}
    for scope in db.scalars(select(AdminScope).where(AdminScope.admin_user_id.in_(admin_ids))):
        scope_types_by_admin_id.setdefault(scope.admin_user_id, set()).add(scope.scope_type)

    return {
        admin.user_id_hash: UserAdminRoleSummary(
            admin_id=admin.id,
            role=admin.role,
            is_active=admin.is_active,
            permissions=permissions_by_admin_id.get(admin.id, []),
            scope_types=sorted(scope_types_by_admin_id.get(admin.id, set())),
        )
        for admin in admins
    }


def build_detail_sections(db: Session, user_id_hash: str) -> list[UserDetailSectionSummary]:
    try:
        return [
            UserDetailSectionSummary.model_validate(section)
            for section in get_user_detail_sections(db, user_id_hash)
        ]
    except Exception:
        return [
            UserDetailSectionSummary(
                key="detail_sections_unavailable",
                title="Read-Only Detail Sections",
                status="unavailable",
                fields=[],
                message="User detail sections could not be loaded safely for this record.",
            )
        ]


def map_snapshot_tenant_to_visible_tenant_id(db: Session, snapshot_tenant_id: str) -> str:
    tenants = list(db.scalars(select(Tenant)))
    for tenant in tenants:
        if tenant.external_customer_id == snapshot_tenant_id or tenant.id == snapshot_tenant_id or tenant.tenant_key == snapshot_tenant_id:
            return tenant.id
    return str(uuid5(NAMESPACE_URL, f"snapshot-tenant:{snapshot_tenant_id}"))


def auth_row_to_summary(
    db: Session,
    row: dict[str, object],
    tenant_id: str,
    *,
    include_detail_sections: bool = True,
) -> UserMembershipSummary:
    display_name = string_value(row.get("display_name")) or ""
    first_name = display_name.split(" ", 1)[0] if display_name else None
    last_name = display_name.split(" ", 1)[1] if display_name and " " in display_name else None
    row_user_id_hash = string_value(row.get("user_id_hash")) or "unknown-user"
    row_tenant_id = string_value(row.get("tenant_id")) or tenant_id
    detail_level = float(row["detail_level"]) if row.get("detail_level") is not None else None
    utilization_level = None
    if detail_level is not None:
        if detail_level >= 0.7:
            utilization_level = "high"
        elif detail_level >= 0.4:
            utilization_level = "medium"
        else:
            utilization_level = "low"

    sessions_count = int(row.get("sessions_count") or 0)
    avg_improvement_pct = int(round(float(row["structure"]) * 100)) if row.get("structure") is not None else None
    membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == row_user_id_hash,
            UserTenantMembership.tenant_id == tenant_id,
        )
    )
    group_memberships = (
        list(db.scalars(select(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id)))
        if membership is not None
        else []
    )
    admin_role = build_admin_role_summary(db, row_user_id_hash)
    profile = membership.profile if membership else None
    invitation = latest_invitation_for_user(db, row_user_id_hash, tenant_id)
    membership_status = membership.status if membership is not None else ("active" if bool(row.get("is_active")) else "inactive")
    current_status = effective_membership_status(membership_status, row)
    created_at = membership.created_at if membership is not None else safe_datetime(row.get("created_at")) or datetime.now(timezone.utc)
    updated_at = membership.updated_at if membership is not None else safe_datetime(row.get("updated_at")) or created_at

    return UserMembershipSummary(
        id=membership.id if membership is not None else uuid5(NAMESPACE_URL, f"auth-user:{row_tenant_id}:{row_user_id_hash}"),
        user_id_hash=row_user_id_hash,
        tenant_id=tenant_id,
        status=current_status,
        is_primary=membership.is_primary if membership is not None else True,
        created_at=created_at,
        updated_at=updated_at,
        group_memberships=[UserGroupMembershipSummary(group_id=item.group_id) for item in group_memberships],
        profile=UserMembershipProfileSummary(
            first_name=profile.first_name if profile and profile.first_name is not None else first_name,
            last_name=profile.last_name if profile and profile.last_name is not None else last_name,
            email=string_value(row.get("email")) if row.get("email") else profile.email if profile else None,
            title=profile.title if profile and profile.title is not None else ("Admin" if admin_role is not None else "Member"),
            initial_user_type=profile.initial_user_type if profile and profile.initial_user_type is not None else None,
            utilization_level=profile.utilization_level if profile and profile.utilization_level is not None else utilization_level,
            sessions_count=sessions_count,
            avg_improvement_pct=resolved_avg_improvement_pct(
                sessions_count=sessions_count,
                profile_avg_improvement_pct=profile.avg_improvement_pct if profile else None,
                derived_avg_improvement_pct=avg_improvement_pct,
            ),
            last_activity_at=profile.last_activity_at if profile and profile.last_activity_at is not None else safe_datetime(row.get("last_activity_at")) or safe_datetime(row.get("last_login_at")),
        ),
        status_summary=build_status_summary(membership_status, row, invitation),
        invitation_summary=build_invitation_summary(invitation),
        admin_role=admin_role,
        detail_sections=build_detail_sections(db, row_user_id_hash) if include_detail_sections else [],
    )


def to_user_summary(
    db: Session,
    membership: UserTenantMembership,
    *,
    include_detail_sections: bool = True,
) -> UserMembershipSummary:
    group_memberships = list(
        db.scalars(select(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id))
    )
    invitation = latest_invitation_for_user(db, membership.user_id_hash, membership.tenant_id)
    return UserMembershipSummary(
        id=membership.id,
        user_id_hash=membership.user_id_hash,
        tenant_id=membership.tenant_id,
        status=membership.status,
        is_primary=membership.is_primary,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
        group_memberships=[
            UserGroupMembershipSummary(group_id=item.group_id) for item in group_memberships
        ],
        profile=(
            UserMembershipProfileSummary.model_validate(membership.profile, from_attributes=True)
            if membership.profile
            else None
        ),
        status_summary=build_status_summary(membership.status, None, invitation),
        invitation_summary=build_invitation_summary(invitation),
        admin_role=build_admin_role_summary(db, membership.user_id_hash),
        detail_sections=build_detail_sections(db, membership.user_id_hash) if include_detail_sections else [],
    )


def safe_auth_row_to_summary(
    db: Session,
    row: dict[str, object],
    tenant_id: str,
    *,
    include_detail_sections: bool = True,
) -> UserMembershipSummary:
    try:
        return auth_row_to_summary(db, row, tenant_id, include_detail_sections=include_detail_sections)
    except Exception:
        fallback_user_id_hash = string_value(row.get("user_id_hash")) or "unknown-user"
        fallback_created_at = safe_datetime(row.get("created_at")) or datetime.now(timezone.utc)
        fallback_updated_at = safe_datetime(row.get("updated_at")) or fallback_created_at
        fallback_status = "active" if bool(row.get("is_active")) else "inactive"
        fallback_email = string_value(row.get("email"))
        fallback_display_name = string_value(row.get("display_name")) or ""
        first_name = fallback_display_name.split(" ", 1)[0] if fallback_display_name else None
        last_name = fallback_display_name.split(" ", 1)[1] if fallback_display_name and " " in fallback_display_name else None

        return UserMembershipSummary(
            id=uuid5(NAMESPACE_URL, f"auth-user-fallback:{tenant_id}:{fallback_user_id_hash}"),
            user_id_hash=fallback_user_id_hash,
            tenant_id=tenant_id,
            status=fallback_status,
            is_primary=True,
            created_at=fallback_created_at,
            updated_at=fallback_updated_at,
            group_memberships=[],
            profile=UserMembershipProfileSummary(
                first_name=first_name,
                last_name=last_name,
                email=fallback_email,
                title="Member",
                initial_user_type=None,
                utilization_level=None,
                sessions_count=0,
                avg_improvement_pct=None,
                last_activity_at=safe_datetime(row.get("last_activity_at")) or safe_datetime(row.get("last_login_at")),
            ),
            status_summary=UserStatusSummary(
                badge=fallback_status,
                detail="This user record has incomplete data, so Herman Admin is showing a safe fallback view.",
            ),
            invitation_summary=None,
            admin_role=None,
            detail_sections=[
                UserDetailSectionSummary(
                    key="fallback_detail_unavailable",
                    title="Read-Only Detail Sections",
                    status="unavailable",
                    fields=[],
                    message="Detailed profile sections could not be assembled safely for this record.",
                )
            ],
        )


def safe_membership_to_summary(
    db: Session,
    membership: UserTenantMembership,
    *,
    include_detail_sections: bool = True,
) -> UserMembershipSummary:
    try:
        return to_user_summary(db, membership, include_detail_sections=include_detail_sections)
    except Exception:
        fallback_created_at = membership.created_at or datetime.now(timezone.utc)
        fallback_updated_at = membership.updated_at or fallback_created_at
        fallback_email = membership.profile.email if membership.profile and membership.profile.email else None
        fallback_first_name = membership.profile.first_name if membership.profile else None
        fallback_last_name = membership.profile.last_name if membership.profile else None

        return UserMembershipSummary(
            id=membership.id,
            user_id_hash=membership.user_id_hash,
            tenant_id=membership.tenant_id,
            status=membership.status,
            is_primary=membership.is_primary,
            created_at=fallback_created_at,
            updated_at=fallback_updated_at,
            group_memberships=[],
            profile=UserMembershipProfileSummary(
                first_name=fallback_first_name,
                last_name=fallback_last_name,
                email=fallback_email,
            title=membership.profile.title if membership.profile and membership.profile.title else "Member",
            initial_user_type=membership.profile.initial_user_type if membership.profile else None,
            utilization_level=membership.profile.utilization_level if membership.profile else None,
            sessions_count=membership.profile.sessions_count if membership.profile else 0,
            avg_improvement_pct=resolved_avg_improvement_pct(
                sessions_count=membership.profile.sessions_count if membership.profile else 0,
                profile_avg_improvement_pct=membership.profile.avg_improvement_pct if membership.profile else None,
                derived_avg_improvement_pct=None,
            ),
            last_activity_at=membership.profile.last_activity_at if membership.profile else None,
        ),
            status_summary=UserStatusSummary(
                badge=membership.status,
                detail="This user membership has incomplete related data, so Herman Admin is showing a safe fallback view.",
            ),
            invitation_summary=None,
            admin_role=None,
            detail_sections=[
                UserDetailSectionSummary(
                    key="membership_fallback_detail_unavailable",
                    title="Read-Only Detail Sections",
                    status="unavailable",
                    fields=[],
                    message="Detailed profile sections could not be assembled safely for this membership.",
                )
            ],
        )


def auth_row_to_list_summary(
    db: Session,
    row: dict[str, object],
    tenant_id: str,
    *,
    admin_role: UserAdminRoleSummary | None,
) -> UserMembershipSummary:
    display_name = string_value(row.get("display_name")) or ""
    first_name = display_name.split(" ", 1)[0] if display_name else None
    last_name = display_name.split(" ", 1)[1] if display_name and " " in display_name else None
    row_user_id_hash = string_value(row.get("user_id_hash")) or "unknown-user"
    row_tenant_id = string_value(row.get("tenant_id")) or tenant_id
    detail_level = float(row["detail_level"]) if row.get("detail_level") is not None else None
    utilization_level = None
    if detail_level is not None:
        if detail_level >= 0.7:
            utilization_level = "high"
        elif detail_level >= 0.4:
            utilization_level = "medium"
        else:
            utilization_level = "low"

    sessions_count = int(row.get("sessions_count") or 0)
    avg_improvement_pct = int(round(float(row["structure"]) * 100)) if row.get("structure") is not None else None
    membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == row_user_id_hash,
            UserTenantMembership.tenant_id == tenant_id,
        )
    )
    group_memberships = (
        list(db.scalars(select(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id)))
        if membership is not None
        else []
    )
    profile = membership.profile if membership else None
    membership_status = membership.status if membership is not None else ("active" if bool(row.get("is_active")) else "inactive")
    current_status = effective_membership_status(membership_status, row)
    created_at = membership.created_at if membership is not None else safe_datetime(row.get("created_at")) or datetime.now(timezone.utc)
    updated_at = membership.updated_at if membership is not None else safe_datetime(row.get("updated_at")) or created_at

    return UserMembershipSummary(
        id=membership.id if membership is not None else uuid5(NAMESPACE_URL, f"auth-user:{row_tenant_id}:{row_user_id_hash}"),
        user_id_hash=row_user_id_hash,
        tenant_id=tenant_id,
        status=current_status,
        is_primary=membership.is_primary if membership is not None else True,
        created_at=created_at,
        updated_at=updated_at,
        group_memberships=[UserGroupMembershipSummary(group_id=item.group_id) for item in group_memberships],
        profile=UserMembershipProfileSummary(
            first_name=profile.first_name if profile and profile.first_name is not None else first_name,
            last_name=profile.last_name if profile and profile.last_name is not None else last_name,
            email=string_value(row.get("email")) if row.get("email") else profile.email if profile else None,
            title=profile.title if profile and profile.title is not None else ("Admin" if admin_role is not None else "Member"),
            initial_user_type=profile.initial_user_type if profile and profile.initial_user_type is not None else None,
            utilization_level=profile.utilization_level if profile and profile.utilization_level is not None else utilization_level,
            sessions_count=sessions_count,
            avg_improvement_pct=resolved_avg_improvement_pct(
                sessions_count=sessions_count,
                profile_avg_improvement_pct=profile.avg_improvement_pct if profile else None,
                derived_avg_improvement_pct=avg_improvement_pct,
            ),
            last_activity_at=profile.last_activity_at if profile and profile.last_activity_at is not None else safe_datetime(row.get("last_activity_at")) or safe_datetime(row.get("last_login_at")),
        ),
        status_summary=build_status_summary(membership_status, row, None),
        invitation_summary=None,
        admin_role=admin_role,
        detail_sections=[],
    )


def membership_to_list_summary(
    db: Session,
    membership: UserTenantMembership,
    *,
    admin_role: UserAdminRoleSummary | None,
) -> UserMembershipSummary:
    group_memberships = list(
        db.scalars(select(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id))
    )
    return UserMembershipSummary(
        id=membership.id,
        user_id_hash=membership.user_id_hash,
        tenant_id=membership.tenant_id,
        status=membership.status,
        is_primary=membership.is_primary,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
        group_memberships=[
            UserGroupMembershipSummary(group_id=item.group_id) for item in group_memberships
        ],
        profile=(
            UserMembershipProfileSummary(
                first_name=membership.profile.first_name,
                last_name=membership.profile.last_name,
                email=membership.profile.email,
                title=membership.profile.title,
                initial_user_type=membership.profile.initial_user_type,
                utilization_level=membership.profile.utilization_level,
                sessions_count=membership.profile.sessions_count,
                avg_improvement_pct=resolved_avg_improvement_pct(
                    sessions_count=membership.profile.sessions_count,
                    profile_avg_improvement_pct=membership.profile.avg_improvement_pct,
                    derived_avg_improvement_pct=None,
                ),
                last_activity_at=membership.profile.last_activity_at,
            )
            if membership.profile
            else None
        ),
        status_summary=build_status_summary(membership.status, None, None),
        invitation_summary=None,
        admin_role=admin_role,
        detail_sections=[],
    )


def safe_auth_row_to_list_summary(
    db: Session,
    row: dict[str, object],
    tenant_id: str,
    *,
    admin_role: UserAdminRoleSummary | None,
) -> UserMembershipSummary:
    try:
        return auth_row_to_list_summary(db, row, tenant_id, admin_role=admin_role)
    except Exception:
        fallback = safe_auth_row_to_summary(db, row, tenant_id, include_detail_sections=False)
        return fallback.model_copy(update={"admin_role": admin_role})


def safe_membership_to_list_summary(
    db: Session,
    membership: UserTenantMembership,
    *,
    admin_role: UserAdminRoleSummary | None,
) -> UserMembershipSummary:
    try:
        return membership_to_list_summary(db, membership, admin_role=admin_role)
    except Exception:
        fallback = safe_membership_to_summary(db, membership, include_detail_sections=False)
        return fallback.model_copy(update={"admin_role": admin_role})


def sort_datetime_value(item: UserMembershipSummary):
    value = item.profile.last_activity_at if item.profile and item.profile.last_activity_at is not None else item.updated_at
    if getattr(value, "tzinfo", None) is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.timestamp()


@router.get("", response_model=ListEnvelope[UserMembershipSummary])
def list_users(
    tenant_id: str | None = Query(default=None),
    group_id: str | None = Query(default=None),
    principal: Principal = Depends(require_permission("users.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[UserMembershipSummary]:
    if tenant_id:
        tenant = get_tenant_or_404(db, tenant_id)
        ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id, group_id=group_id)

    auth_rows = get_auth_users(db)
    memberships = list(db.scalars(select(UserTenantMembership).order_by(UserTenantMembership.created_at.desc())))
    admin_role_lookup = build_admin_role_lookup(
        db,
        [string_value(row.get("user_id_hash")) or "" for row in auth_rows] + [membership.user_id_hash for membership in memberships],
    )
    items: list[UserMembershipSummary] = []
    seen_memberships: set[tuple[str, str]] = set()

    for row in auth_rows:
        visible_tenant_id = map_snapshot_tenant_to_visible_tenant_id(db, str(row["tenant_id"]))
        if tenant_id and visible_tenant_id != tenant_id:
            continue
        ensure_scope_access(principal, tenant_id=visible_tenant_id, group_id=group_id)
        item = safe_auth_row_to_list_summary(
            db,
            row,
            visible_tenant_id,
            admin_role=admin_role_lookup.get(string_value(row.get("user_id_hash")) or ""),
        )
        if group_id and not any(str(group.group_id) == group_id for group in item.group_memberships):
            continue
        items.append(item)
        seen_memberships.add((item.user_id_hash, str(item.tenant_id)))

    if tenant_id:
        memberships = [membership for membership in memberships if membership.tenant_id == tenant_id]
    for membership in memberships:
        ensure_scope_access(principal, tenant_id=membership.tenant_id, group_id=group_id)
        if group_id:
            group_membership = db.scalar(
                select(UserGroupMembership).where(
                    UserGroupMembership.tenant_membership_id == membership.id,
                    UserGroupMembership.group_id == group_id,
                )
            )
            if group_membership is None:
                continue
        membership_key = (membership.user_id_hash, membership.tenant_id)
        if membership_key in seen_memberships:
            continue
        items.append(
            safe_membership_to_list_summary(
                db,
                membership,
                admin_role=admin_role_lookup.get(membership.user_id_hash),
            )
        )
        seen_memberships.add(membership_key)

    items.sort(key=sort_datetime_value, reverse=True)
    return ListEnvelope[UserMembershipSummary](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"tenant_id": tenant_id, "group_id": group_id})


@router.post("", response_model=ResourceEnvelope[UserMembershipSummary], status_code=status.HTTP_201_CREATED)
def create_user_membership(
    payload: UserMembershipCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("users.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[UserMembershipSummary]:
    tenant = get_tenant_or_404(db, str(payload.tenant_id))
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    resolved_user_id_hash = get_canonical_user_id_hash(
        db,
        email=payload.email,
        explicit_user_id_hash=payload.user_id_hash,
    )
    existing_membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == resolved_user_id_hash,
            UserTenantMembership.tenant_id == str(payload.tenant_id),
        )
    )
    if existing_membership is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already assigned to this organization")
    ensure_single_tenant_membership(db, user_id_hash=resolved_user_id_hash, target_tenant=tenant)
    validate_tenant_user_limit(db, tenant)

    auth_row = upsert_auth_user(
        db,
        tenant=tenant,
        user_id_hash=resolved_user_id_hash,
        email=payload.email or "",
        first_name=payload.first_name,
        last_name=payload.last_name,
        status=payload.status,
    )

    membership = UserTenantMembership(
        user_id_hash=resolved_user_id_hash,
        tenant_id=str(payload.tenant_id),
        status=payload.status,
        is_primary=True,
    )
    db.add(membership)
    db.flush()
    upsert_user_membership_profile(db, membership, payload.model_dump(mode="json"))
    seed_foundational_profile(
        db,
        user_id_hash=resolved_user_id_hash,
        initial_user_type=payload.initial_user_type,
    )

    for group_id in payload.group_ids:
        group = db.get(Group, str(group_id))
        if group is None or group.tenant_id != membership.tenant_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group must belong to the same tenant")
        db.add(
            UserGroupMembership(
                user_id_hash=membership.user_id_hash,
                group_id=str(group_id),
                tenant_membership_id=membership.id,
            )
        )

    if membership.status == "invited" and payload.send_invite:
        email = (payload.email or "").strip()
        if email:
            recipient_name = " ".join(part for part in [payload.first_name, payload.last_name] if part).strip() or None
            invitation, _ = create_or_replace_invitation(
                db,
                membership=membership,
                tenant=tenant,
                email=email,
                created_by_admin_user_id=principal.admin_id,
            )
            send_invitation_email(invitation=invitation, tenant=tenant, recipient_name=recipient_name)
            delivery_error = invitation_delivery_error(invitation)
            if delivery_error:
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Invitation email could not be sent: {delivery_error}",
                )

    refresh_onboarding_state(db, membership.tenant_id)
    write_audit_log(
        db,
        principal,
        action_type="user_membership.create",
        target_type="auth_user",
        target_id=resolved_user_id_hash,
        after=json.dumps(
            {
                "auth_tenant_id": auth_row.get("tenant_id"),
                "email": auth_row.get("email"),
                "membership_id": membership.id,
                "initial_user_type": payload.initial_user_type,
                "status": membership.status,
            },
            sort_keys=True,
        ),
        request_id=request_id,
    )
    db.commit()
    auth_row = next((row for row in get_auth_users(db, resolved_user_id_hash) if str(row["tenant_id"]) in auth_tenant_candidates(tenant)), None)
    if auth_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Auth user could not be reloaded")
    return ResourceEnvelope[UserMembershipSummary](resource=auth_row_to_summary(db, auth_row, tenant.id), updated_at=membership.updated_at)


@router.get("/{user_id_hash}", response_model=ListEnvelope[UserMembershipSummary])
def get_user_memberships(
    user_id_hash: str,
    principal: Principal = Depends(require_permission("users.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[UserMembershipSummary]:
    auth_rows = get_auth_users(db, user_id_hash)
    items: list[UserMembershipSummary] = []
    seen_memberships: set[tuple[str, str]] = set()
    for row in auth_rows:
        visible_tenant_id = map_snapshot_tenant_to_visible_tenant_id(db, str(row["tenant_id"]))
        ensure_scope_access(principal, tenant_id=visible_tenant_id)
        item = safe_auth_row_to_summary(db, row, visible_tenant_id)
        items.append(item)
        seen_memberships.add((item.user_id_hash, str(item.tenant_id)))

    memberships = list(db.scalars(select(UserTenantMembership).where(UserTenantMembership.user_id_hash == user_id_hash)))
    for membership in memberships:
        ensure_scope_access(principal, tenant_id=membership.tenant_id)
        membership_key = (membership.user_id_hash, membership.tenant_id)
        if membership_key in seen_memberships:
            continue
        items.append(safe_membership_to_summary(db, membership))
    items.sort(key=sort_datetime_value, reverse=True)
    return ListEnvelope[UserMembershipSummary](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"user_id_hash": user_id_hash})


@router.patch("/{user_id_hash}", response_model=ResourceEnvelope[UserMembershipSummary])
def update_user_membership(
    user_id_hash: str,
    payload: UserMembershipUpdate,
    tenant_id: str = Query(...),
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("users.write")),
    db: Session = Depends(get_db),
) -> ListEnvelope[UserMembershipSummary]:
    tenant = get_tenant_or_404(db, tenant_id)
    ensure_scope_access(principal, tenant_id=tenant.id)
    before_rows = [row for row in get_auth_users(db, user_id_hash) if str(row["tenant_id"]) in auth_tenant_candidates(tenant)]
    membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == user_id_hash,
            UserTenantMembership.tenant_id == tenant_id,
        )
    )
    before = serialize_model(membership) if membership is not None else None

    auth_row = before_rows[0] if before_rows else None
    current_email = normalize_email(payload.email) if payload.email is not None else (normalize_email(str(auth_row["email"])) if auth_row else None)
    if current_email is None:
        current_email = normalize_email(membership.profile.email if membership and membership.profile else None)
    if current_email is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")

    current_display_name = str(auth_row["display_name"]) if auth_row and auth_row.get("display_name") else None
    if current_display_name is None and membership and membership.profile:
        current_display_name = build_display_name(membership.profile.first_name, membership.profile.last_name)
    current_first_name = payload.first_name
    current_last_name = payload.last_name
    if membership and membership.profile:
        if current_first_name is None:
            current_first_name = membership.profile.first_name
        if current_last_name is None:
            current_last_name = membership.profile.last_name
    if auth_row and current_first_name is None and current_last_name is None and current_display_name:
        parts = current_display_name.split(" ", 1)
        current_first_name = parts[0]
        current_last_name = parts[1] if len(parts) > 1 else None

    if membership is None:
        ensure_single_tenant_membership(db, user_id_hash=user_id_hash, target_tenant=tenant)

    auth_row = upsert_auth_user(
        db,
        tenant=tenant,
        user_id_hash=user_id_hash,
        email=current_email,
        first_name=current_first_name,
        last_name=current_last_name,
        display_name=current_display_name,
        status=payload.status or (membership.status if membership is not None else ("active" if auth_row and bool(auth_row.get("is_active")) else "inactive")),
    )

    if membership is None:
        validate_tenant_user_limit(db, tenant)
        membership = UserTenantMembership(
            user_id_hash=user_id_hash,
            tenant_id=tenant_id,
            status=payload.status or ("active" if bool(auth_row.get("is_active")) else "inactive"),
            is_primary=True,
        )
        db.add(membership)
        db.flush()
    elif payload.status is not None and membership.status == "deleted" and payload.status != "deleted":
        validate_tenant_user_limit(db, tenant)

    if payload.status is not None:
        membership.status = payload.status
    membership.is_primary = True
    sync_auth_user_primary_tenant(db, user_id_hash=user_id_hash, fallback_tenant_id=tenant.id)
    if payload.group_ids is not None:
        db.execute(delete(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id))
        for group_id in payload.group_ids:
            group = db.get(Group, str(group_id))
            if group is None or group.tenant_id != membership.tenant_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group must belong to the same tenant")
            db.add(
                UserGroupMembership(
                    user_id_hash=membership.user_id_hash,
                    group_id=str(group_id),
                    tenant_membership_id=membership.id,
                )
            )
    profile_updates = {
        key: value
        for key, value in payload.model_dump(exclude_none=True, mode="json").items()
        if key
        in {
            "first_name",
            "last_name",
            "email",
            "title",
            "utilization_level",
            "sessions_count",
            "avg_improvement_pct",
        }
    }
    if profile_updates:
        upsert_user_membership_profile(db, membership, profile_updates)

    refresh_onboarding_state(db, membership.tenant_id)
    write_audit_log(
        db,
        principal,
        action_type="user_membership.update",
        target_type="auth_user",
        target_id=user_id_hash,
        before=before,
        after=json.dumps(
            {
                "auth_tenant_id": auth_row.get("tenant_id"),
                "email": auth_row.get("email"),
                "membership_id": membership.id,
                "status": membership.status,
            },
            sort_keys=True,
        ),
        request_id=request_id,
    )
    db.commit()
    reloaded_auth_row = next((row for row in get_auth_users(db, user_id_hash) if str(row["tenant_id"]) in auth_tenant_candidates(tenant)), None)
    if reloaded_auth_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Auth user could not be reloaded")
    resource = auth_row_to_summary(db, reloaded_auth_row, tenant.id)
    return ResourceEnvelope[UserMembershipSummary](resource=resource, updated_at=resource.updated_at)


@router.post("/{user_id_hash}/actions", response_model=ResourceEnvelope[UserMembershipSummary])
def run_user_lifecycle_action(
    user_id_hash: str,
    payload: UserLifecycleActionRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("users.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[UserMembershipSummary]:
    tenant = get_tenant_or_404(db, str(payload.tenant_id))
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)

    membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == user_id_hash,
            UserTenantMembership.tenant_id == tenant.id,
        )
    )
    auth_row = next((row for row in get_auth_users(db, user_id_hash) if str(row["tenant_id"]) in auth_tenant_candidates(tenant)), None)
    if membership is None and auth_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    current_email = normalize_email(str(auth_row["email"])) if auth_row and auth_row.get("email") else None
    if current_email is None and membership and membership.profile:
        current_email = normalize_email(membership.profile.email)
    current_first_name = membership.profile.first_name if membership and membership.profile else None
    current_last_name = membership.profile.last_name if membership and membership.profile else None
    current_display_name = (
        str(auth_row["display_name"])
        if auth_row and auth_row.get("display_name")
        else build_display_name(current_first_name, current_last_name)
    )
    if current_email is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User email is required for this action")

    target_tenant = tenant
    target_status = membership.status if membership is not None else ("active" if auth_row and bool(auth_row.get("is_active")) else "inactive")

    if payload.action == "deactivate":
        target_status = "inactive"
        auth_row = upsert_auth_user(
            db,
            tenant=tenant,
            user_id_hash=user_id_hash,
            email=current_email,
            first_name=current_first_name,
            last_name=current_last_name,
            display_name=current_display_name,
            status="inactive",
        )
        if membership is not None:
            membership.status = "inactive"
    elif payload.action == "reinvite":
        if membership is None or membership.status == "deleted":
            ensure_single_tenant_membership(db, user_id_hash=user_id_hash, target_tenant=tenant)
            validate_tenant_user_limit(db, tenant)
        target_status = "invited"
        auth_row = upsert_auth_user(
            db,
            tenant=tenant,
            user_id_hash=user_id_hash,
            email=current_email,
            first_name=current_first_name,
            last_name=current_last_name,
            display_name=current_display_name,
            status="inactive",
        )
        if membership is None:
            membership = UserTenantMembership(
                user_id_hash=user_id_hash,
                tenant_id=tenant.id,
                status="invited",
                is_primary=True,
            )
            db.add(membership)
            db.flush()
        else:
            membership.status = "invited"
        invitation, _ = create_or_replace_invitation(
            db,
            membership=membership,
            tenant=tenant,
            email=current_email,
            created_by_admin_user_id=principal.admin_id,
        )
        send_invitation_email(invitation=invitation, tenant=tenant, recipient_name=current_display_name)
        delivery_error = invitation_delivery_error(invitation)
        if delivery_error:
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Invitation email could not be sent: {delivery_error}",
            )
    else:
        deactivated_tenant = ensure_deactivated_users_tenant(db)
        target_tenant = deactivated_tenant
        target_status = "deleted"
        auth_row = upsert_auth_user(
            db,
            tenant=deactivated_tenant,
            user_id_hash=user_id_hash,
            email=current_email,
            first_name=current_first_name,
            last_name=current_last_name,
            display_name=current_display_name,
            status="inactive",
        )
        if membership is None:
            membership = UserTenantMembership(
                user_id_hash=user_id_hash,
                tenant_id=deactivated_tenant.id,
                status="deleted",
                is_primary=True,
            )
            db.add(membership)
            db.flush()
        else:
            db.execute(delete(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id))
            membership.tenant_id = deactivated_tenant.id
            membership.status = "deleted"
        admin_user = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == user_id_hash))
        if admin_user is not None:
            admin_user.is_active = False
            db.execute(delete(AdminScope).where(AdminScope.admin_user_id == admin_user.id))

    if membership is not None and membership.profile is not None and target_tenant.id != tenant.id:
        membership.profile.email = current_email
    refresh_onboarding_state(db, tenant.id)
    if target_tenant.id != tenant.id:
        refresh_onboarding_state(db, target_tenant.id)
    write_audit_log(
        db,
        principal,
        action_type=f"user.lifecycle.{payload.action}",
        target_type="auth_user",
        target_id=user_id_hash,
        after=json.dumps(
            {
                "tenant_id": target_tenant.id,
                "auth_tenant_id": auth_row.get("tenant_id"),
                "status": target_status,
            },
            sort_keys=True,
        ),
        request_id=request_id,
    )
    db.commit()

    reloaded_auth_row = next((row for row in get_auth_users(db, user_id_hash) if str(row["tenant_id"]) in auth_tenant_candidates(target_tenant)), None)
    if reloaded_auth_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Auth user could not be reloaded")

    updated_at = membership.updated_at if membership is not None else parse_datetime(reloaded_auth_row.get("updated_at"))  # type: ignore[arg-type]
    return ResourceEnvelope[UserMembershipSummary](
        resource=auth_row_to_summary(db, reloaded_auth_row, target_tenant.id),
        updated_at=updated_at,
    )
