from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import PlatformManagedLlmConfig, TenantLLMConfig
from app.secret_vault import resolve_secret_reference


class RuntimeLlmConfigError(ValueError):
    pass


@dataclass(frozen=True)
class EffectiveRuntimeLlmConfig:
    tenant_id: str
    user_id_hash: str | None
    provider: str
    model: str
    endpoint_url: str | None
    api_key: str
    transformation_enabled: bool
    scoring_enabled: bool
    credential_status: str
    source_kind: str


def resolve_effective_runtime_llm_config(
    db: Session,
    *,
    tenant_id: str | None = None,
    user_id_hash: str | None = None,
) -> EffectiveRuntimeLlmConfig:
    resolved_tenant_id = (tenant_id or "").strip()
    normalized_user_id_hash = (user_id_hash or "").strip() or None
    if not resolved_tenant_id:
        if not normalized_user_id_hash:
            raise RuntimeLlmConfigError("Either tenant_id or user_id_hash is required")
        auth_row = db.execute(
            text(
                """
                select tenant_id
                from auth_users
                where user_id_hash = :user_id_hash
                order by id desc
                limit 1
                """
            ),
            {"user_id_hash": normalized_user_id_hash},
        ).mappings().first()
        auth_tenant_id = str((auth_row or {}).get("tenant_id") or "").strip()
        resolved_tenant_id = _resolve_runtime_tenant_id(db, auth_tenant_id)
        if not resolved_tenant_id:
            raise RuntimeLlmConfigError("No tenant assignment found for user")

    tenant_llm = db.scalar(select(TenantLLMConfig).where(TenantLLMConfig.tenant_id == resolved_tenant_id))
    if tenant_llm is None:
        raise RuntimeLlmConfigError("No tenant LLM configuration found")
    if tenant_llm.credential_status != "valid":
        raise RuntimeLlmConfigError("Tenant LLM configuration is not valid")

    provider = tenant_llm.provider_type
    model = tenant_llm.model_name
    endpoint_url = tenant_llm.endpoint_url
    secret_reference = tenant_llm.secret_reference
    source_kind = "customer_managed"

    if tenant_llm.credential_mode == "platform_managed":
        if not tenant_llm.platform_managed_config_id:
            raise RuntimeLlmConfigError("Tenant platform-managed LLM selection is missing")
        platform_llm = db.get(PlatformManagedLlmConfig, tenant_llm.platform_managed_config_id)
        if platform_llm is None or not platform_llm.is_active:
            raise RuntimeLlmConfigError("Tenant platform-managed LLM is unavailable")
        provider = platform_llm.provider_type
        model = platform_llm.model_name
        endpoint_url = platform_llm.endpoint_url
        secret_reference = platform_llm.secret_reference
        source_kind = "platform_managed"

    if not provider or not model:
        raise RuntimeLlmConfigError("Tenant LLM configuration is incomplete")

    secret_resolution = resolve_secret_reference(db, secret_reference)
    if not secret_resolution.resolvable or not secret_resolution.value:
        raise RuntimeLlmConfigError(secret_resolution.message)

    return EffectiveRuntimeLlmConfig(
        tenant_id=resolved_tenant_id,
        user_id_hash=normalized_user_id_hash,
        provider=provider,
        model=model,
        endpoint_url=endpoint_url,
        api_key=secret_resolution.value,
        transformation_enabled=bool(tenant_llm.transformation_enabled),
        scoring_enabled=bool(tenant_llm.scoring_enabled),
        credential_status=tenant_llm.credential_status,
        source_kind=source_kind,
    )


def _resolve_runtime_tenant_id(db: Session, tenant_identifier: str) -> str:
    normalized = tenant_identifier.strip()
    if not normalized:
        return ""
    tenant_row = db.execute(
        text(
            """
            select id
            from tenants
            where id = :tenant_identifier
               or tenant_key = :tenant_identifier
               or external_customer_id = :tenant_identifier
            order by case when id = :tenant_identifier then 0 else 1 end
            limit 1
            """
        ),
        {"tenant_identifier": normalized},
    ).mappings().first()
    if tenant_row is not None:
        resolved = str(tenant_row.get("id") or "").strip()
        if resolved:
            return resolved
    return normalized
