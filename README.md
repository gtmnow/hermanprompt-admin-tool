# Herman Admin

Herman Admin is the administrative and analytics service for the Herman Prompt platform. This repository started from the specification documents in [`docs/`](./docs) and now includes an initial FastAPI scaffold that mirrors the v1 API shape described in those specs.

## What is in place

- FastAPI application entrypoint in `app/main.py`
- Versioned API routing under `/api/v1`
- SQLAlchemy-backed persistence with a local SQLite default and Postgres-compatible schema
- Route modules for:
  - health
  - resellers
  - tenants
  - groups
  - users
  - admins
  - onboarding
  - reports and export jobs
  - system overview
  - audit log
- Shared Pydantic schemas for envelopes, domain resources, runtime config, reporting, and admin scope data
- Automatic startup initialization that creates tables and seeds a local development super admin

## Current assumptions

- The admin tool is a standalone application with its own service boundary.
- It will eventually use shared Herman Prompt platform data, likely via Postgres.
- The first implementation pass should optimize for clear contracts and domain boundaries before persistence.
- Authentication currently uses a development header: `X-Admin-User`.
- The seeded local super admin is `local-dev-admin`.
- Raw secrets are intentionally not stored or returned; only masked key state is persisted in this pass.
- Reporting is still operationally useful but uses derived backend metrics rather than production analytics rollups.

## Suggested next slices

1. Replace the development header auth with JWT validation and middleware-backed principal resolution.
2. Encrypt customer-managed credentials at rest or move them to a secret manager reference flow.
3. Add CSV bulk import jobs and row-level validation endpoints for user onboarding.
4. Replace derived reporting metrics with shared analytics rollups from the Herman Prompt platform.
5. Add automated API tests for scope isolation, activation gates, and audit logging.

## Local run

Install dependencies:

```bash
python3 -m pip install -e .
```

Start the API:

```bash
uvicorn app.main:app --reload
```

Open the docs:

- `http://127.0.0.1:8000/docs`

For local development, send `X-Admin-User: local-dev-admin` with requests to hit protected endpoints.
