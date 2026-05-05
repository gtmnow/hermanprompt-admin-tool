from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


PolicySource = Literal["Default", "Service Tier", "Organization Override"]


class RagQuotaPolicySummary(BaseModel):
    id: UUID
    policy_key: str
    scope_target: Literal["global_default", "service_tier", "tenant_override"]
    service_tier_definition_id: UUID | None = None
    tenant_id: UUID | None = None
    user_type: str | None = None
    org_max_file_bytes: int
    user_max_file_bytes: int
    org_max_document_count: int
    user_max_document_count: int
    org_max_total_bytes: int
    user_max_total_bytes: int
    org_max_extracted_text_bytes: int
    user_max_extracted_text_bytes: int
    org_max_chunks_per_document: int
    user_max_chunks_per_document: int
    org_max_retrieved_chunks: int
    user_max_retrieved_chunks: int
    max_retrieved_chunks_total: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RagQuotaPolicyUpdate(BaseModel):
    org_max_file_bytes: int
    user_max_file_bytes: int
    org_max_document_count: int
    user_max_document_count: int
    org_max_total_bytes: int
    user_max_total_bytes: int
    org_max_extracted_text_bytes: int
    user_max_extracted_text_bytes: int
    org_max_chunks_per_document: int
    user_max_chunks_per_document: int
    org_max_retrieved_chunks: int
    user_max_retrieved_chunks: int
    max_retrieved_chunks_total: int
    is_active: bool = True


class RagUsageSummary(BaseModel):
    document_count: int
    total_bytes: int
    ready_documents: int
    processing_documents: int
    failed_documents: int
    disabled_documents: int


class EffectiveRagLimits(BaseModel):
    policy_source: PolicySource
    policy_key: str
    max_file_bytes: int
    max_document_count: int
    max_total_bytes: int
    max_extracted_text_bytes: int
    max_chunks_per_document: int
    max_retrieved_chunks: int
    max_retrieved_chunks_total: int


class RagDocumentSummary(BaseModel):
    id: str
    filename: str
    media_type: str
    size_bytes: int
    status: str
    status_message: str | None = None
    uploaded_at: str
    processed_at: str | None = None


class RagCollectionSummary(BaseModel):
    id: str
    retrieval_enabled: bool
    is_active: bool
    max_results: int | None = None


class TenantKnowledgeSummary(BaseModel):
    collection: RagCollectionSummary
    limits: EffectiveRagLimits
    usage: RagUsageSummary
    documents: list[RagDocumentSummary]


class TenantKnowledgeCollectionUpdate(BaseModel):
    retrieval_enabled: bool | None = None
    is_active: bool | None = None
    max_results: int | None = None
