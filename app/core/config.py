from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Herman Prompt Admin API"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    database_url: str = "sqlite:///./data/herman_admin.db"
    default_page_size: int = Field(default=25, ge=1, le=250)
    max_page_size: int = Field(default=100, ge=1, le=500)

    model_config = SettingsConfigDict(
        env_prefix="HERMAN_ADMIN_",
        env_file=".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
