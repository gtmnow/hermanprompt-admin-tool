from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ResellerPartner
from app.schemas import ListEnvelope, ResellerPartner as ResellerPartnerSchema, ResellerPartnerCreate, ResellerPartnerUpdate, ResourceEnvelope
from app.security import Principal, require_permission
from app.services import ensure_scope_access, get_reseller_or_404, serialize_model, write_audit_log

router = APIRouter()


@router.get("", response_model=ListEnvelope[ResellerPartnerSchema])
def list_resellers(
    is_active: bool | None = Query(default=None),
    principal: Principal = Depends(require_permission("resellers.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[ResellerPartnerSchema]:
    query = select(ResellerPartner).order_by(ResellerPartner.created_at.desc())
    if is_active is not None:
        query = query.where(ResellerPartner.is_active == is_active)

    items = []
    for reseller in db.scalars(query):
        ensure_scope_access(principal, reseller_partner_id=reseller.id)
        items.append(ResellerPartnerSchema.model_validate(reseller, from_attributes=True))
    return ListEnvelope[ResellerPartnerSchema](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"is_active": is_active})


@router.post("", response_model=ResourceEnvelope[ResellerPartnerSchema], status_code=status.HTTP_201_CREATED)
def create_reseller(
    payload: ResellerPartnerCreate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.create")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerPartnerSchema]:
    reseller = ResellerPartner(**payload.model_dump())
    db.add(reseller)
    db.flush()
    write_audit_log(
        db,
        principal,
        action_type="reseller.create",
        target_type="reseller",
        target_id=reseller.id,
        after=serialize_model(reseller),
        request_id=request_id,
    )
    db.commit()
    db.refresh(reseller)
    return ResourceEnvelope[ResellerPartnerSchema](resource=ResellerPartnerSchema.model_validate(reseller, from_attributes=True), updated_at=reseller.updated_at)


@router.patch("/{reseller_id}", response_model=ResourceEnvelope[ResellerPartnerSchema])
def update_reseller(
    reseller_id: str,
    payload: ResellerPartnerUpdate,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("resellers.write")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ResellerPartnerSchema]:
    reseller = get_reseller_or_404(db, reseller_id)
    ensure_scope_access(principal, reseller_partner_id=reseller.id)
    before = serialize_model(reseller)
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(reseller, key, value)
    write_audit_log(
        db,
        principal,
        action_type="reseller.update",
        target_type="reseller",
        target_id=reseller.id,
        before=before,
        after=serialize_model(reseller),
        request_id=request_id,
    )
    db.commit()
    db.refresh(reseller)
    return ResourceEnvelope[ResellerPartnerSchema](resource=ResellerPartnerSchema.model_validate(reseller, from_attributes=True), updated_at=reseller.updated_at)
