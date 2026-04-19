from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ResellerPartnerBase(BaseModel):
    reseller_key: str = Field(min_length=1, max_length=100)
    reseller_name: str = Field(min_length=1, max_length=200)
    is_active: bool = True


class ResellerPartnerCreate(ResellerPartnerBase):
    pass


class ResellerPartnerUpdate(BaseModel):
    reseller_name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None


class ResellerPartner(ResellerPartnerBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
