from __future__ import annotations

import json
import time
from urllib import error, request

from sqlalchemy.orm import Session

from app.schemas import PlatformManagedLlmConfigTestRequest, PlatformManagedLlmConfigTestResult
from app.secret_vault import resolve_secret_reference


def _join_api_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _truncate_error_body(raw: str, limit: int = 240) -> str:
    compact = " ".join(raw.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3]}..."


def test_platform_llm_connection(payload: PlatformManagedLlmConfigTestRequest) -> PlatformManagedLlmConfigTestResult:
    provider = payload.provider_type.strip().lower()
    endpoint_url = payload.endpoint_url.strip()
    model_name = payload.model_name.strip()
    api_key = payload.api_key.strip()
    if not endpoint_url:
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=payload.provider_type,
            model_accessible=False,
            error_code="ENDPOINT_URL_REQUIRED",
            message="Endpoint URL is required",
        )
    if not api_key:
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=payload.provider_type,
            model_accessible=False,
            error_code="API_KEY_REQUIRED",
            message="LLM key is required",
        )

    if provider in {"openai", "azure_openai", "xai", "custom"}:
        target_url = _join_api_url(endpoint_url, "/chat/completions")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        # Keep the compatibility probe minimal for OpenAI-style chat APIs.
        # Optional generation controls vary across model families and providers,
        # so only send the fields that are broadly required to verify runtime use.
        body = {
            "model": model_name,
            "messages": [{"role": "user", "content": "Reply with OK"}],
        }
    elif provider == "anthropic":
        target_url = _join_api_url(endpoint_url, "/messages")
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
        body = {
            "model": model_name,
            "max_tokens": 5,
            "messages": [{"role": "user", "content": "Reply with OK"}],
        }
    else:
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=payload.provider_type,
            model_accessible=False,
            error_code="UNSUPPORTED_PROVIDER",
            message=f"Provider '{payload.provider_type}' is not supported by the connection tester yet",
        )

    started_at = time.perf_counter()
    req = request.Request(
        target_url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=20) as response:
            response.read()
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return PlatformManagedLlmConfigTestResult(
            validation_result="valid",
            provider_echo=payload.provider_type,
            model_accessible=True,
            latency_ms=latency_ms,
            error_code=None,
            message="Connection test succeeded",
        )
    except error.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        response_body = exc.read().decode("utf-8", errors="ignore")
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=payload.provider_type,
            model_accessible=False,
            latency_ms=latency_ms,
            error_code=f"HTTP_{exc.code}",
            message=f"Provider returned HTTP {exc.code}: {_truncate_error_body(response_body or exc.reason)}",
        )
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=payload.provider_type,
            model_accessible=False,
            latency_ms=latency_ms,
            error_code=exc.__class__.__name__.upper(),
            message=f"Connection test failed: {exc}",
        )


def validate_platform_llm_runtime(
    db: Session,
    *,
    provider_type: str,
    model_name: str,
    endpoint_url: str | None,
    api_key: str | None = None,
    secret_reference: str | None = None,
) -> PlatformManagedLlmConfigTestResult:
    normalized_api_key = (api_key or "").strip()
    if normalized_api_key:
        return test_platform_llm_connection(
            PlatformManagedLlmConfigTestRequest(
                provider_type=provider_type,
                model_name=model_name,
                endpoint_url=endpoint_url or "",
                api_key=normalized_api_key,
            )
        )

    resolution = resolve_secret_reference(db, secret_reference)
    if not resolution.resolvable or not resolution.value:
        return PlatformManagedLlmConfigTestResult(
            validation_result="invalid",
            provider_echo=provider_type,
            model_accessible=False,
            error_code="SECRET_REFERENCE_UNRESOLVABLE",
            message=resolution.message,
        )

    return test_platform_llm_connection(
        PlatformManagedLlmConfigTestRequest(
            provider_type=provider_type,
            model_name=model_name,
            endpoint_url=endpoint_url or "",
            api_key=resolution.value,
        )
    )
