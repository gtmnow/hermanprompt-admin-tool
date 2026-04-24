from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    clear_admin_session_cookie,
    create_admin_session,
    get_request_session_id,
    resolve_active_admin_session,
    revoke_admin_session,
    set_admin_session_cookie,
    validate_admin_launch_token,
)
from app.core.config import get_settings
from app.db import get_db
from app.models import AdminProfile, AdminUser
from app.schemas.auth import (
    AdminSessionSummary,
    AuthenticatedAdminPrincipal,
    AuthSessionResponse,
    LaunchExchangeRequest,
    LogoutResponse,
)
from app.security import Principal, build_principal_for_admin, get_current_principal

router = APIRouter()


def _build_auth_response(db: Session, principal: Principal, session_id: str) -> AuthSessionResponse:
    session = resolve_active_admin_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired admin session")
    profile = db.scalar(select(AdminProfile).where(AdminProfile.admin_user_id == principal.admin_id))
    return AuthSessionResponse(
        principal=AuthenticatedAdminPrincipal(
            admin_id=principal.admin_id,
            user_id_hash=principal.user_id_hash,
            role=principal.role,
            permissions=sorted(principal.permissions),
            scopes=[
                {
                    "id": scope.id,
                    "scope_type": scope.scope_type,
                    "reseller_partner_id": scope.reseller_partner_id,
                    "tenant_id": scope.tenant_id,
                    "group_id": scope.group_id,
                    "created_at": scope.created_at,
                }
                for scope in principal.scopes
            ],
            profile={
                "display_name": profile.display_name if profile else None,
                "email": profile.email if profile else None,
            }
            if profile
            else None,
        ),
        session=AdminSessionSummary(
            session_id=session.id,
            issued_at=session.issued_at,
            expires_at=session.expires_at,
            last_seen_at=session.last_seen_at,
        ),
    )


@router.post("/launch/exchange", response_model=AuthSessionResponse)
def exchange_admin_launch_token(
    payload: LaunchExchangeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    claims = validate_admin_launch_token(payload.launch_token)
    admin = db.scalar(select(AdminUser).where(AdminUser.user_id_hash == claims.user_id_hash))
    if admin is None or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authenticated user is not an active admin")

    session = create_admin_session(db, admin, request)
    set_admin_session_cookie(response, session)
    principal = build_principal_for_admin(db, admin)
    return _build_auth_response(db, principal, session.id)


@router.get("/me", response_model=AuthSessionResponse)
def get_current_admin_session(
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    session_id = get_request_session_id(request, get_settings())
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin session required")
    return _build_auth_response(db, principal, session_id)


@router.post("/logout", response_model=LogoutResponse)
def logout_admin_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> LogoutResponse:
    session_id = get_request_session_id(request, get_settings())
    if session_id:
        session = resolve_active_admin_session(db, session_id)
        if session is not None:
            revoke_admin_session(db, session)
    clear_admin_session_cookie(response)
    return LogoutResponse()
