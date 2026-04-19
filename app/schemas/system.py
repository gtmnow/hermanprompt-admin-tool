from pydantic import BaseModel


class SystemOverview(BaseModel):
    tenant_count: int
    active_tenant_count: int
    reseller_count: int
    active_user_count: int
    active_group_count: int
    invalid_credential_count: int
    stalled_onboarding_count: int
