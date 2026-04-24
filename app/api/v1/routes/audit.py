from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AdminAuditLog
from app.schemas import AuditLogEntry, ListEnvelope
from app.security import Principal, require_permission
from app.services import can_view_audit_entry

router = APIRouter()


@router.get("", response_model=ListEnvelope[AuditLogEntry])
def list_audit_log(
    action_type: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    principal: Principal = Depends(require_permission("audit.read")),
    db: Session = Depends(get_db),
) -> ListEnvelope[AuditLogEntry]:
    query = select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc())
    if action_type:
        query = query.where(AdminAuditLog.action_type == action_type)
    if target_type:
        query = query.where(AdminAuditLog.target_type == target_type)
    items = [
        AuditLogEntry.model_validate(item, from_attributes=True)
        for item in db.scalars(query)
        if can_view_audit_entry(db, principal, item)
    ]
    return ListEnvelope[AuditLogEntry](items=items, page=1, page_size=len(items) or 1, total_count=len(items), filters={"action_type": action_type, "target_type": target_type})
