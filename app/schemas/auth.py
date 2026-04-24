from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.admins import AdminProfileSummary, AdminScopeSummary


class LaunchExchangeRequest(BaseModel):
    launch_token: str = Field(min_length=1)


class AuthenticatedAdminPrincipal(BaseModel):
    admin_id: str
    user_id_hash: str
    role: str
    permissions: list[str] = Field(default_factory=list)
    scopes: list[AdminScopeSummary] = Field(default_factory=list)
    profile: AdminProfileSummary | None = None


class AdminSessionSummary(BaseModel):
    session_id: str
    expires_at: datetime
    issued_at: datetime
    last_seen_at: datetime


class AuthSessionResponse(BaseModel):
    authenticated: bool = True
    principal: AuthenticatedAdminPrincipal
    session: AdminSessionSummary


class LogoutResponse(BaseModel):
    success: bool = True
