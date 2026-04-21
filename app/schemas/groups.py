from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class GroupBase(BaseModel):
    tenant_id: UUID
    group_name: str = Field(min_length=1, max_length=200)
    group_type: str | None = None
    parent_group_id: UUID | None = None
    is_active: bool = True
    description: str | None = None
    business_unit: str | None = None
    owner_name: str | None = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    group_name: str | None = Field(default=None, min_length=1, max_length=200)
    group_type: str | None = None
    parent_group_id: UUID | None = None
    is_active: bool | None = None
    description: str | None = None
    business_unit: str | None = None
    owner_name: str | None = None


class GroupProfile(BaseModel):
    description: str | None = None
    business_unit: str | None = None
    owner_name: str | None = None


class Group(GroupBase):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime
    updated_at: datetime
    profile: GroupProfile | None = None
