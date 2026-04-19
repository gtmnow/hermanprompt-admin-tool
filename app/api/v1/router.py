from fastapi import APIRouter

from app.api.v1.routes import admins, audit, groups, health, onboarding, reports, resellers, system, tenants, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(resellers.router, prefix="/resellers", tags=["resellers"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["tenants"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(admins.router, prefix="/admins", tags=["admins"])
api_router.include_router(onboarding.router, prefix="/onboarding", tags=["onboarding"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(system.router, prefix="/system", tags=["system"])
api_router.include_router(audit.router, prefix="/audit-log", tags=["audit"])
