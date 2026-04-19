from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Group, UserGroupMembership, UserTenantMembership
from app.schemas import ListEnvelope, ResourceEnvelope, UserMembershipCreate, UserMembershipSummary, UserMembershipUpdate
from app.schemas.users import UserGroupMembershipSummary
from app.security import Principal, require_permission
from app.services import ensure_scope_access, get_tenant_or_404, refresh_onboarding_state, serialize_model, write_audit_log

router = APIRouter()


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
    )


@router.get("", response_model=ListEnvelope[UserMembershipSummary])
def list_users(
    tenant_id: str | None = Query(default=None),
    group_id: str | None = Query(default=None),
    principal: Principal = Depends(require_permission("users.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[UserMembershipSummary]:
    query = select(UserTenantMembership).order_by(UserTenantMembership.created_at.desc())
    if tenant_id:
        query = query.where(UserTenantMembership.tenant_id == tenant_id)
    memberships = list(db.scalars(query))
    items = []
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
        items.append(to_user_summary(db, membership))
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

    membership = UserTenantMembership(
        user_id_hash=payload.user_id_hash,
        tenant_id=str(payload.tenant_id),
        status=payload.status,
        is_primary=payload.is_primary,
    )
    db.add(membership)
    db.flush()

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

    refresh_onboarding_state(db, membership.tenant_id)
    write_audit_log(
        db,
        principal,
        action_type="user_membership.create",
        target_type="user_tenant_membership",
        target_id=membership.id,
        after=serialize_model(membership),
        request_id=request_id,
    )
    db.commit()
    db.refresh(membership)
    return ResourceEnvelope[UserMembershipSummary](resource=to_user_summary(db, membership), updated_at=membership.updated_at)


@router.get("/{user_id_hash}", response_model=ListEnvelope[UserMembershipSummary])
def get_user_memberships(
    user_id_hash: str,
    principal: Principal = Depends(require_permission("users.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[UserMembershipSummary]:
    memberships = list(db.scalars(select(UserTenantMembership).where(UserTenantMembership.user_id_hash == user_id_hash)))
    items = []
    for membership in memberships:
        ensure_scope_access(principal, tenant_id=membership.tenant_id)
        items.append(to_user_summary(db, membership))
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
    membership = db.scalar(
        select(UserTenantMembership).where(
            UserTenantMembership.user_id_hash == user_id_hash,
            UserTenantMembership.tenant_id == tenant_id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User membership not found")
    ensure_scope_access(principal, tenant_id=membership.tenant_id)
    before = serialize_model(membership)

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

    refresh_onboarding_state(db, membership.tenant_id)
    write_audit_log(
        db,
        principal,
        action_type="user_membership.update",
        target_type="user_tenant_membership",
        target_id=membership.id,
        before=before,
        after=serialize_model(membership),
        request_id=request_id,
    )
    db.commit()
    db.refresh(membership)
    items = [to_user_summary(db, membership)]
    return ListEnvelope[UserMembershipSummary](items=items, page=1, page_size=1, total_count=1, filters={"user_id_hash": user_id_hash, "tenant_id": tenant_id})
