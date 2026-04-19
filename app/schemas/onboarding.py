from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


OnboardingStatus = Literal["draft", "in_progress", "ready", "live"]


class TenantOnboardingStatus(BaseModel):
    tenant_id: UUID
    tenant_created: bool = True
    llm_configured: bool = False
    llm_validated: bool = False
    groups_created: bool = False
    users_uploaded: bool = False
    admin_assigned: bool = False
    first_login_detected: bool = False
    first_transform_detected: bool = False
    first_score_detected: bool = False
    onboarding_status: OnboardingStatus = "draft"
    updated_at: datetime
