from pydantic import BaseModel


class EffectiveRuntimeLlmConfigSummary(BaseModel):
    tenant_id: str
    user_id_hash: str | None = None
    provider: str
    model: str
    endpoint_url: str | None = None
    transformation_enabled: bool
    scoring_enabled: bool
    credential_status: str
    source_kind: str
