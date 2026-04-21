from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Herman Prompt Admin API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    database_url: str = "sqlite:///./data/herman_admin.db"
    bootstrap_schema: bool = True
    seed_demo_data: bool = True
    default_page_size: int = Field(default=25, ge=1, le=250)
    max_page_size: int = Field(default=100, ge=1, le=500)
    secret_vault_provider: str = "database_encrypted"
    secret_vault_master_key: str | None = None
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

    model_config = SettingsConfigDict(
        env_prefix="HERMAN_ADMIN_",
        env_file=".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
