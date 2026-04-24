from pathlib import Path

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db import Base, engine, SessionLocal
from app import models  # noqa: F401
from app.services import ensure_additive_schema_extensions, seed_database

settings = get_settings()
project_root = Path(__file__).resolve().parent.parent
frontend_dist_dir = project_root / "frontend_dist"
if not frontend_dist_dir.exists():
    frontend_dist_dir = project_root / "dist"
frontend_index_path = frontend_dist_dir / "index.html"

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
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

if (frontend_dist_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist_dir / "assets"), name="assets")


@app.on_event("startup")
def startup() -> None:
    if settings.bootstrap_schema:
        Base.metadata.create_all(bind=engine)
    ensure_additive_schema_extensions()
    if settings.seed_demo_data:
        with SessionLocal() as db:
            seed_database(db)


@app.get("/", include_in_schema=False)
def root():
    if frontend_index_path.exists():
        return FileResponse(frontend_index_path)

    return {
        "service": settings.app_name,
        "environment": settings.environment,
        "docs": "/docs",
        "api_prefix": settings.api_v1_prefix,
        "bootstrap_schema": str(settings.bootstrap_schema).lower(),
        "seed_demo_data": str(settings.seed_demo_data).lower(),
    }


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    if not frontend_index_path.exists():
        return {
            "service": settings.app_name,
            "environment": settings.environment,
            "docs": "/docs",
            "api_prefix": settings.api_v1_prefix,
            "bootstrap_schema": str(settings.bootstrap_schema).lower(),
            "seed_demo_data": str(settings.seed_demo_data).lower(),
        }

    if full_path.startswith(("api/", "docs", "openapi.json", "redoc", "assets/")):
        raise HTTPException(status_code=404, detail="Not Found")

    requested_path = frontend_dist_dir / full_path
    if requested_path.is_file():
        return FileResponse(requested_path)

    return FileResponse(frontend_index_path)
