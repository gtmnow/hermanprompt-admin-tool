from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings


class PromptTransformerClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {"X-Client-Id": self.settings.prompt_transformer_client_id}
        if self.settings.prompt_transformer_api_key:
            headers["Authorization"] = f"Bearer {self.settings.prompt_transformer_api_key}"
        with httpx.Client(timeout=30.0) as client:
            response = client.request(
                method,
                f"{self.settings.prompt_transformer_url}{path}",
                params=params,
                json=json,
                data=data,
                files=files,
                headers=headers,
            )
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail")
            except Exception:
                detail = response.text
            raise ValueError(str(detail or "Prompt Transformer request failed"))
        return response.json()
