from datetime import datetime, timezone
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ErrorDetail(BaseModel):
    code: str
    message: str
    field_errors: dict[str, str] = Field(default_factory=dict)


class ResourceEnvelope(BaseModel, Generic[T]):
    resource: T
    updated_at: datetime = Field(default_factory=utc_now)


class ListEnvelope(BaseModel, Generic[T]):
    items: list[T]
    page: int = 1
    page_size: int = 25
    total_count: int
    filters: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
