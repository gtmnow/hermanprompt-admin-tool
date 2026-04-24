from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import AdminSession, AdminUser


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class LaunchTokenClaims:
    user_id_hash: str
    email: str
    display_name: str
    issued_at: datetime
    expires_at: datetime
    raw_claims: dict[str, Any]


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f"{value}{padding}")
    except Exception as exc:  # pragma: no cover - defensive decode path
        raise _unauthorized("Malformed admin launch token") from exc


def _coerce_timestamp(value: Any, field_name: str) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    raise _unauthorized(f"Invalid launch token claim: {field_name}")


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _coerce_bool(value: Any, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    raise _unauthorized(f"Invalid launch token claim: {field_name}")


def _coerce_str(value: Any, field_name: str) -> str:
    if isinstance(value, str) and value.strip():
        return value
    raise _unauthorized(f"Missing launch token claim: {field_name}")


def validate_admin_launch_token(token: str, settings: Settings | None = None) -> LaunchTokenClaims:
    cfg = settings or get_settings()
    parts = token.split(".")
    if len(parts) != 3:
        raise _unauthorized("Malformed admin launch token")

    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(_base64url_decode(header_b64))
        payload = json.loads(_base64url_decode(payload_b64))
    except json.JSONDecodeError as exc:
        raise _unauthorized("Malformed admin launch token") from exc

    if header.get("alg") != "HS256":
        raise _unauthorized("Unsupported admin launch token algorithm")

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected_signature = hmac.new(
        cfg.launch_secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    actual_signature = _base64url_decode(signature_b64)
    if not hmac.compare_digest(actual_signature, expected_signature):
        raise _unauthorized("Invalid admin launch token signature")

    expires_at = _coerce_timestamp(payload.get("exp"), "exp")
    issued_at = _coerce_timestamp(payload.get("iat"), "iat")
    now = utc_now()
    if expires_at <= now:
        raise _unauthorized("Expired admin launch token")
    if issued_at > now + timedelta(minutes=5):
        raise _unauthorized("Invalid admin launch token iat")

    issuer = _coerce_str(payload.get("iss"), "iss")
    if issuer != cfg.launch_issuer:
        raise _unauthorized("Invalid admin launch token issuer")

    audience = payload.get("aud")
    if isinstance(audience, str):
        audiences = {audience}
    elif isinstance(audience, list):
        audiences = {item for item in audience if isinstance(item, str)}
    else:
        raise _unauthorized("Invalid admin launch token audience")
    if cfg.launch_audience not in audiences:
        raise _unauthorized("Invalid admin launch token audience")

    token_use = _coerce_str(payload.get("token_use"), "token_use")
    if token_use != cfg.launch_token_use:
        raise _unauthorized("Invalid admin launch token type")

    if not _coerce_bool(payload.get("mfa_verified"), "mfa_verified"):
        raise _unauthorized("Admin launch token requires MFA assurance")

    return LaunchTokenClaims(
        user_id_hash=_coerce_str(payload.get("user_id_hash"), "user_id_hash"),
        email=_coerce_str(payload.get("email"), "email"),
        display_name=_coerce_str(payload.get("display_name"), "display_name"),
        issued_at=issued_at,
        expires_at=expires_at,
        raw_claims=payload,
    )


def resolve_active_admin_session(db: Session, session_id: str) -> AdminSession | None:
    session = db.scalar(select(AdminSession).where(AdminSession.id == session_id))
    if session is None:
        return None
    now = utc_now()
    expires_at = _ensure_utc(session.expires_at)
    revoked_at = _ensure_utc(session.revoked_at) if session.revoked_at is not None else None
    if revoked_at is not None or expires_at <= now:
        return None
    return session


def touch_admin_session(db: Session, session: AdminSession) -> None:
    now = utc_now()
    last_seen_at = _ensure_utc(session.last_seen_at)
    if now - last_seen_at >= timedelta(minutes=5):
        session.last_seen_at = now
        db.add(session)
        db.commit()


def create_admin_session(
    db: Session,
    admin_user: AdminUser,
    request: Request,
    *,
    settings: Settings | None = None,
) -> AdminSession:
    cfg = settings or get_settings()
    now = utc_now()
    session = AdminSession(
        id=secrets.token_urlsafe(32),
        admin_user_id=admin_user.id,
        user_id_hash=admin_user.user_id_hash,
        issued_at=now,
        expires_at=now + timedelta(hours=cfg.auth_session_ttl_hours),
        last_seen_at=now,
        mfa_verified_at=now,
        user_agent=(request.headers.get("user-agent") or "")[:1000] or None,
        source_ip=request.client.host if request.client else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def revoke_admin_session(db: Session, session: AdminSession) -> None:
    session.revoked_at = utc_now()
    db.add(session)
    db.commit()


def get_request_session_id(request: Request, settings: Settings | None = None) -> str | None:
    cfg = settings or get_settings()
    return request.cookies.get(cfg.auth_session_cookie_name)


def set_admin_session_cookie(response: Response, session: AdminSession, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    response.set_cookie(
        key=cfg.auth_session_cookie_name,
        value=session.id,
        httponly=True,
        secure=cfg.auth_session_secure,
        samesite=cfg.auth_session_same_site,
        max_age=cfg.auth_session_ttl_hours * 60 * 60,
        path="/",
    )


def clear_admin_session_cookie(response: Response, settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    response.delete_cookie(
        key=cfg.auth_session_cookie_name,
        httponly=True,
        secure=cfg.auth_session_secure,
        samesite=cfg.auth_session_same_site,
        path="/",
    )
