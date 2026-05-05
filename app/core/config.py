from functools import lru_cache
from urllib.parse import urlparse

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Herman Prompt Admin API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    database_url: str | None = None
    bootstrap_schema: bool = True
    seed_demo_data: bool = True
    default_page_size: int = Field(default=25, ge=1, le=250)
    max_page_size: int = Field(default=100, ge=1, le=500)
    secret_vault_provider: str = "database_encrypted"
    secret_vault_master_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "HERMAN_SHARED_SECRET_VAULT_MASTER_KEY",
            "HERMAN_RUNTIME_SECRET_VAULT_MASTER_KEY",
            "HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY",
        ),
    )
    secret_vault_local_key_path: str = "./data/.secret_vault.key"
    azure_key_vault_url: str | None = None
    resend_api_key: str | None = None
    resend_api_base_url: str = "https://api.resend.com"
    invite_from_email: str = "onboarding@resend.dev"
    invite_from_name: str = "Herman Prompt Admin"
    invite_reply_to: str | None = None
    invite_expiry_days: int = 7
    invite_base_url: str = "http://127.0.0.1:5175/invite"
    default_portal_base_url: str = "https://hermanportal-production.up.railway.app"
    auth_session_cookie_name: str = "herman_admin_session"
    auth_session_ttl_hours: int = Field(default=12, ge=1, le=168)
    auth_session_same_site: str = "lax"
    auth_session_secure: bool = False
    auth_launch_param_name: str = "launch_token"
    auth_login_url: str = "https://hermanportal-production.up.railway.app/login"
    allow_dev_header_auth: bool = False
    enforce_runtime_database_target: bool | None = None
    runtime_database_required_host: str | None = None
    runtime_database_required_name: str | None = None
    herman_db_canonical_mode: bool = Field(
        default=False,
        validation_alias=AliasChoices("HERMAN_DB_CANONICAL_MODE"),
    )
    herman_db_version_table: str = Field(
        default="alembic_version",
        validation_alias=AliasChoices("HERMAN_DB_VERSION_TABLE"),
    )
    herman_db_allowed_revisions_raw: str = Field(
        default="20260504_0006,20260504_0007,20260504_0008,20260504_0009,20260505_0010,20260505_0011,20260505_0012,20260505_0013,20260505_0014,20260505_0015",
        validation_alias=AliasChoices("HERMAN_DB_ALLOWED_REVISIONS"),
    )
    launch_secret: str = Field(
        default="test-admin-launch-secret",
        validation_alias=AliasChoices("HERMAN_ADMIN_LAUNCH_SECRET", "HERMANADMIN_LAUNCH_SECRET"),
    )
    launch_issuer: str = Field(
        default="herman_portal_local",
        validation_alias=AliasChoices("HERMAN_ADMIN_LAUNCH_ISSUER", "HERMANADMIN_LAUNCH_ISSUER"),
    )
    launch_audience: str = Field(
        default="herman_admin",
        validation_alias=AliasChoices("HERMAN_ADMIN_LAUNCH_AUDIENCE", "HERMANADMIN_LAUNCH_AUDIENCE"),
    )
    launch_token_use: str = "admin_launch"
    user_hash_key: str = "dev-user-hash-key"
    prompt_transformer_url: str = "http://127.0.0.1:8001"
    prompt_transformer_api_key: str | None = None
    prompt_transformer_client_id: str = "hermanadmin"

    model_config = SettingsConfigDict(
        env_prefix="HERMAN_ADMIN_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def herman_db_allowed_revisions(self) -> set[str]:
        return {
            revision.strip()
            for revision in self.herman_db_allowed_revisions_raw.split(",")
            if revision.strip()
        }

    @property
    def effective_herman_db_canonical_mode(self) -> bool:
        if self.herman_db_canonical_mode:
            return True
        if not self.database_url:
            return False
        parsed = urlparse(self.database_url)
        return self.environment != "development" and not parsed.scheme.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
