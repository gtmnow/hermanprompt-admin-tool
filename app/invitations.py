from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib import error, request
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Tenant, UserInvitation, UserTenantMembership

RESEND_USER_AGENT = "herman-admin/0.1"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_invite_token() -> str:
    return secrets.token_urlsafe(32)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def build_invite_url(raw_token: str, tenant: Tenant) -> str:
    settings = get_settings()
    portal_base = tenant.portal_config.portal_base_url if getattr(tenant, "portal_config", None) else settings.default_portal_base_url
    base_url = f"{portal_base.rstrip('/')}/invite"
    tenant_hint = quote(tenant.tenant_key or tenant.id)
    return f"{base_url}?token={quote(raw_token)}&tenant={tenant_hint}"


def expire_stale_invitations(db: Session, *, membership: UserTenantMembership) -> None:
    now = utc_now()
    stale_invitations = list(
        db.scalars(
            select(UserInvitation).where(
                UserInvitation.user_id_hash == membership.user_id_hash,
                UserInvitation.tenant_id == membership.tenant_id,
                UserInvitation.status.in_(("pending", "sent")),
                UserInvitation.accepted_at.is_(None),
                UserInvitation.revoked_at.is_(None),
                UserInvitation.expires_at < now,
            )
        )
    )
    for invitation in stale_invitations:
        invitation.status = "expired"


def revoke_active_invitations(
    db: Session,
    *,
    membership: UserTenantMembership,
    revoked_at: datetime | None = None,
) -> None:
    expire_stale_invitations(db, membership=membership)
    revoke_time = revoked_at or utc_now()
    active_invitations = list(
        db.scalars(
            select(UserInvitation).where(
                UserInvitation.user_id_hash == membership.user_id_hash,
                UserInvitation.tenant_id == membership.tenant_id,
                UserInvitation.status.in_(("pending", "sent")),
                UserInvitation.accepted_at.is_(None),
                UserInvitation.revoked_at.is_(None),
            )
        )
    )
    for invitation in active_invitations:
        invitation.status = "revoked"
        invitation.revoked_at = revoke_time


def create_or_replace_invitation(
    db: Session,
    *,
    membership: UserTenantMembership,
    tenant: Tenant,
    email: str,
    created_by_admin_user_id: str | None = None,
) -> tuple[UserInvitation, str]:
    settings = get_settings()
    revoke_active_invitations(db, membership=membership)

    raw_token = build_invite_token()
    invitation = UserInvitation(
        user_id_hash=membership.user_id_hash,
        tenant_id=membership.tenant_id,
        email=email.strip(),
        invite_token_hash=hash_invite_token(raw_token),
        invite_url=build_invite_url(raw_token, tenant),
        status="pending",
        provider="resend",
        created_by_admin_user_id=created_by_admin_user_id,
        expires_at=utc_now() + timedelta(days=settings.invite_expiry_days),
    )
    db.add(invitation)
    db.flush()
    return invitation, raw_token


def render_invitation_email(*, tenant_name: str, invite_url: str, recipient_name: str | None) -> tuple[str, str]:
    greeting_name = recipient_name.strip() if recipient_name else "there"
    subject = f"You're invited to {tenant_name} on Prompt Transformer"
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #1f2f46; line-height: 1.5;">
        <p>Hello {greeting_name},</p>
        <p>You have been invited to join {tenant_name} in the prompt transformation portal.</p>
        <p>
          <a
            href="{invite_url}"
            style="display:inline-block;padding:12px 18px;background:#0b84d8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;"
          >
            Accept invitation
          </a>
        </p>
        <p>If the button does not work, use this link:</p>
        <p><a href="{invite_url}">{invite_url}</a></p>
        <p>This invitation was sent by the organization administrator through the prompt transformer admin console.</p>
      </body>
    </html>
    """.strip()
    return subject, html


def send_invitation_email(*, invitation: UserInvitation, tenant: Tenant, recipient_name: str | None) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        invitation.status = "failed"
        invitation.last_error = "Resend API key is not configured"
        return

    subject, html = render_invitation_email(
        tenant_name=tenant.tenant_name,
        invite_url=invitation.invite_url or "",
        recipient_name=recipient_name,
    )
    payload = {
        "from": f"{settings.invite_from_name} <{settings.invite_from_email}>",
        "to": [invitation.email],
        "subject": subject,
        "html": html,
    }
    if settings.invite_reply_to:
        payload["reply_to"] = settings.invite_reply_to

    req = request.Request(
        f"{settings.resend_api_base_url.rstrip('/')}/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
            "User-Agent": RESEND_USER_AGENT,
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=15) as response:
            response_payload = json.loads(response.read().decode("utf-8") or "{}")
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed_error = json.loads(body)
            error_message = parsed_error.get("message") or parsed_error.get("name") or body
        except json.JSONDecodeError:
            error_message = body
        invitation.status = "failed"
        invitation.last_error = (error_message or f"HTTP {exc.code}")[:1000]
        return
    except error.URLError as exc:
        invitation.status = "failed"
        invitation.last_error = str(exc.reason)
        return

    invitation.status = "sent"
    invitation.sent_at = utc_now()
    invitation.provider_message_id = str(response_payload.get("id") or "")
    invitation.last_error = None


def invitation_delivery_error(invitation: UserInvitation) -> str | None:
    if invitation.status != "failed":
        return None
    return invitation.last_error or "Invitation email could not be sent"
