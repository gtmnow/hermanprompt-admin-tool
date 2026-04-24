from datetime import timezone
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from uuid import NAMESPACE_URL, uuid5

from app.db import get_db
from app.invitations import create_or_replace_invitation, send_invitation_email
from app.models import AdminScope, AdminUser, Group, UserGroupMembership, UserTenantMembership
from app.models import Tenant
from app.schemas import (
    ListEnvelope,
    ResourceEnvelope,
    UserLifecycleActionRequest,
    UserMembershipCreate,
    UserMembershipSummary,
    UserMembershipUpdate,
)
from app.schemas.users import UserGroupMembershipSummary, UserMembershipProfileSummary
from app.security import Principal, require_permission
from app.services import (
    auth_tenant_candidates,
    build_display_name,
    ensure_deactivated_users_tenant,
    ensure_scope_access,
    get_tenant_or_404,
    get_auth_users,
    normalize_email,
    parse_datetime,
    refresh_onboarding_state,
    serialize_model,
    generate_internal_user_id_hash,
    upsert_auth_user,
    upsert_user_membership_profile,
    validate_tenant_user_limit,
    write_audit_log,
)

router = APIRouter()


def map_snapshot_tenant_to_visible_tenant_id(db: Session, snapshot_tenant_id: str) -> str:
    tenants = list(db.scalars(select(Tenant)))
    for tenant in tenants:
        if tenant.external_customer_id == snapshot_tenant_id or tenant.id == snapshot_tenant_id or tenant.tenant_key == snapshot_tenant_id:
            return tenant.id
    return str(uuid5(NAMESPACE_URL, f"snapshot-tenant:{snapshot_tenant_id}"))


def auth_row_to_summary(db: Session, row: dict[str, object], tenant_id: str) -> UserMembershipSummary:
    display_name = (row.get("display_name") or "").strip()
    first_name = display_name.split(" ", 1)[0] if display_name else None
    last_name = display_name.split(" ", 1)[1] if display_name and " " in display_name else None
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
            UserTenantMembership.user_id_hash == str(row["user_id_hash"]),
            UserTenantMembership.tenant_id == tenant_id,
        )
    )
    group_memberships = (
        list(db.scalars(select(UserGroupMembership).where(UserGroupMembership.tenant_membership_id == membership.id)))
        if membership is not None
        else []
    )
    profile = membership.profile if membership else None

    return UserMembershipSummary(
        id=membership.id if membership is not None else uuid5(NAMESPACE_URL, f"auth-user:{row['tenant_id']}:{row['user_id_hash']}"),
        user_id_hash=str(row["user_id_hash"]),
        tenant_id=tenant_id,
        status=membership.status if membership is not None else ("active" if bool(row.get("is_active")) else "inactive"),
        is_primary=membership.is_primary if membership is not None else True,
        created_at=membership.created_at if membership is not None else row["created_at"],
        updated_at=membership.updated_at if membership is not None else row["updated_at"],
        group_memberships=[UserGroupMembershipSummary(group_id=item.group_id) for item in group_memberships],
        profile=UserMembershipProfileSummary(
            first_name=profile.first_name if profile and profile.first_name is not None else first_name,
            last_name=profile.last_name if profile and profile.last_name is not None else last_name,
            email=str(row["email"]) if row.get("email") else profile.email if profile else None,
            title=profile.title if profile and profile.title is not None else ("Admin" if bool(row.get("is_admin")) else "Member"),
            utilization_level=profile.utilization_level if profile and profile.utilization_level is not None else utilization_level,
            sessions_count=sessions_count,
            avg_improvement_pct=profile.avg_improvement_pct if profile and profile.avg_improvement_pct is not None else avg_improvement_pct,
            last_activity_at=profile.last_activity_at if profile and profile.last_activity_at is not None else row.get("last_activity_at") or row.get("last_login_at"),
        ),
    )


def to_user_summary(db: Session, membership: UserTenantMembership) -> UserMembershipSummary:
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
            UserMembershipProfileSummary.model_validate(membership.profile, from_attributes=True)
            if membership.profile
            else None
        ),
    )


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
    items: list[UserMembershipSummary] = []
    seen_memberships: set[tuple[str, str]] = set()

    for row in auth_rows:
        visible_tenant_id = map_snapshot_tenant_to_visible_tenant_id(db, str(row["tenant_id"]))
        if tenant_id and visible_tenant_id != tenant_id:
            continue
        ensure_scope_access(principal, tenant_id=visible_tenant_id, group_id=group_id)
        item = auth_row_to_summary(db, row, visible_tenant_id)
        if group_id and not any(str(group.group_id) == group_id for group in item.group_memberships):
            continue
        items.append(item)
        seen_memberships.add((item.user_id_hash, str(item.tenant_id)))

    query = select(UserTenantMembership).order_by(UserTenantMembership.created_at.desc())
    if tenant_id:
        query = query.where(UserTenantMembership.tenant_id == tenant_id)
    memberships = list(db.scalars(query))
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
        items.append(to_user_summary(db, membership))
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
    resolved_user_id_hash = payload.user_id_hash or generate_internal_user_id_hash(payload.email)
    existing_membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == resolved_user_id_hash,
            UserTenantMembership.tenant_id == str(payload.tenant_id),
        )
    )
    if existing_membership is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already assigned to this organization")
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
        is_primary=payload.is_primary,
    )
    db.add(membership)
    db.flush()
    upsert_user_membership_profile(db, membership, payload.model_dump(mode="json"))

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
        item = auth_row_to_summary(db, row, visible_tenant_id)
        items.append(item)
        seen_memberships.add((item.user_id_hash, str(item.tenant_id)))

    memberships = list(db.scalars(select(UserTenantMembership).where(UserTenantMembership.user_id_hash == user_id_hash)))
    for membership in memberships:
        ensure_scope_access(principal, tenant_id=membership.tenant_id)
        membership_key = (membership.user_id_hash, membership.tenant_id)
        if membership_key in seen_memberships:
            continue
        items.append(to_user_summary(db, membership))
    items.sort(key=sort_datetime_value, reverse=True)
    return ListEnvelope[UserMembershipSummary](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"user_id_hash": user_id_hash})


@router.patch("/{user_id_hash}", response_model=ListEnvelope[UserMembershipSummary])
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
            is_primary=payload.is_primary if payload.is_primary is not None else True,
        )
        db.add(membership)
        db.flush()
    elif payload.status is not None and membership.status == "deleted" and payload.status != "deleted":
        validate_tenant_user_limit(db, tenant)

    if payload.status is not None:
        membership.status = payload.status
    if payload.is_primary is not None:
        membership.is_primary = payload.is_primary
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
    items = [auth_row_to_summary(db, reloaded_auth_row, tenant.id)]
    return ListEnvelope[UserMembershipSummary](items=items, page=1, page_size=1, total_count=1, filters={"user_id_hash": user_id_hash, "tenant_id": tenant_id})


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
            is_admin=False,
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
