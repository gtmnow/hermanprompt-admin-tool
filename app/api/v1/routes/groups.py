from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Group
from app.schemas import Group as GroupSchema, GroupCreate, GroupProfile as GroupProfileSchema, GroupUpdate, ListEnvelope, ResourceEnvelope
from app.security import Principal, require_permission
from app.services import ensure_scope_access, get_group_or_404, get_tenant_or_404, serialize_model, upsert_group_profile, write_audit_log

router = APIRouter()


def to_group_schema(group: Group) -> GroupSchema:
    payload = GroupSchema.model_validate(group, from_attributes=True)
    payload.profile = GroupProfileSchema.model_validate(group.profile, from_attributes=True) if group.profile else None
    return payload


@router.get("", response_model=ListEnvelope[GroupSchema])
def list_groups(
    tenant_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    principal: Principal = Depends(require_permission("groups.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[GroupSchema]:
    query = select(Group).order_by(Group.created_at.desc())
    if tenant_id:
        query = query.where(Group.tenant_id == tenant_id)

    items = []
    for group in db.scalars(query):
        ensure_scope_access(principal, tenant_id=group.tenant_id, group_id=group.id)
        items.append(to_group_schema(group))

    start = (page - 1) * page_size
    end = start + page_size
    return ListEnvelope[GroupSchema](
        items=items[start:end],
        page=page,
        page_size=page_size,
        total_count=len(items),
        filters={"tenant_id": tenant_id},
    )


@router.post("", response_model=ResourceEnvelope[GroupSchema], status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("groups.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[GroupSchema]:
    tenant = get_tenant_or_404(db, str(payload.tenant_id))
    ensure_scope_access(principal, reseller_partner_id=tenant.reseller_partner_id, tenant_id=tenant.id)
    payload_data = payload.model_dump(mode="json")
    group = Group(
        tenant_id=payload_data["tenant_id"],
        group_name=payload_data["group_name"],
        group_type=payload_data.get("group_type"),
        parent_group_id=payload_data.get("parent_group_id"),
        is_active=payload_data.get("is_active", True),
    )
    db.add(group)
    db.flush()
    upsert_group_profile(db, group, payload_data)
    write_audit_log(
        db,
        principal,
        action_type="group.create",
        target_type="group",
        target_id=group.id,
        after=serialize_model(group),
        request_id=request_id,
    )
    db.commit()
    db.refresh(group)
    return ResourceEnvelope[GroupSchema](resource=to_group_schema(group), updated_at=group.updated_at)


@router.patch("/{group_id}", response_model=ResourceEnvelope[GroupSchema])
def update_group(
    group_id: str,
    payload: GroupUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("groups.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[GroupSchema]:
    group = get_group_or_404(db, group_id)
    ensure_scope_access(principal, tenant_id=group.tenant_id, group_id=group.id)
    before = serialize_model(group)
    updates = payload.model_dump(exclude_none=True, mode="json")
    profile_updates = {key: updates.pop(key) for key in ["description", "business_unit", "owner_name"] if key in updates}
    for key, value in updates.items():
        setattr(group, key, value)
    if profile_updates:
        upsert_group_profile(db, group, profile_updates)
    write_audit_log(
        db,
        principal,
        action_type="group.update",
        target_type="group",
        target_id=group.id,
        before=before,
        after=serialize_model(group),
        request_id=request_id,
    )
    db.commit()
    db.refresh(group)
    return ResourceEnvelope[GroupSchema](resource=to_group_schema(group), updated_at=group.updated_at)
