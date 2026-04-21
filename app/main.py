from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db import Base, engine, SessionLocal
from app import models  # noqa: F401
from app.services import ensure_additive_schema_extensions, seed_database

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    debug=settings.debug,
    description=(
        "Administrative and analytics API for the Herman Prompt platform, including "
        "tenant onboarding, reseller delegation, and reporting."
    ),
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.on_event("startup")
def startup() -> None:
    if settings.bootstrap_schema:
        Base.metadata.create_all(bind=engine)
    ensure_additive_schema_extensions()
    if settings.seed_demo_data:
        with SessionLocal() as db:
            seed_database(db)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "environment": settings.environment,
        "docs": "/docs",
        "api_prefix": settings.api_v1_prefix,
        "bootstrap_schema": str(settings.bootstrap_schema).lower(),
        "seed_demo_data": str(settings.seed_demo_data).lower(),
    }
