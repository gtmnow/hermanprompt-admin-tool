# Herman Admin

Herman Admin is the administrative and analytics service for the Herman Prompt platform. This repository started from the specification documents in [`docs/`](./docs) and now includes an initial FastAPI scaffold that mirrors the v1 API shape described in those specs.

The current cross-repo auth and invitation requirements are documented in [docs/portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1).

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
- Environment-aware startup initialization with optional schema bootstrap and optional demo seeding

## Current assumptions

- The admin tool is a standalone application with its own service boundary.
- It will eventually use shared Herman Prompt platform data, likely via Postgres.
- The first implementation pass should optimize for clear contracts and domain boundaries before persistence.
- Authentication currently uses a development header: `X-Admin-User`.
- The seeded local super admin is `local-dev-admin`.
- Herman Portal will own end-user login, invitation acceptance, initial password setup, and session creation.
- Herman Admin will own org-level portal configuration, invitation generation, invitation delivery, resend/revoke flows, and admin audit state.
- `auth_users` is the intended source of truth for portal-authenticated users.
- Sensitive credentials are now routed through an app-facing vault layer.
- The current prototype vault provider is `database_encrypted`, which stores encrypted ciphertext in the `vault_secrets` table and keeps only masked values plus secret references in the admin-facing records.
- For local development, the vault uses `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY` when provided, or falls back to a local file-backed key at `HERMAN_ADMIN_SECRET_VAULT_LOCAL_KEY_PATH`.
- Azure Key Vault is the intended production-facing model, and the current config surface already includes `HERMAN_ADMIN_SECRET_VAULT_PROVIDER` and `HERMAN_ADMIN_AZURE_KEY_VAULT_URL` for that migration path.
- Reporting is still operationally useful but uses derived backend metrics rather than production analytics rollups.
- When pointing at a live shared database, set `HERMAN_ADMIN_BOOTSTRAP_SCHEMA=false` and `HERMAN_ADMIN_SEED_DEMO_DATA=false`.

## Suggested next slices

1. Implement the shared portal auth schema in [docs/portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1), including `tenant_portal_configs`, `auth_user_credentials`, and invitation TTL fields.
2. Build Herman Portal `/login` and `/invite` flows against the shared schema and the production portal base URL `https://hermanportal-production.up.railway.app/`.
3. Replace the development header auth with JWT or session-backed principal resolution for Herman Admin.
4. Swap the prototype `database_encrypted` provider for true Azure Key Vault read/write support via managed identity.
5. Replace derived reporting metrics with shared analytics rollups from the Herman Prompt platform.

## Secret Vault

The admin tool now treats secrets as vault-managed resources instead of plain runtime config fields.

Portal configuration values such as portal base URL, logo URL, and welcome message are not secrets and should be stored in normal tenant-owned configuration tables rather than in the vault.

- Tenant LLM credentials:
  - `PUT /api/v1/tenants/:tenantId/llm-config` stores pasted API keys in the vault.
  - The tenant record keeps only `api_key_masked`, `secret_reference`, `secret_source`, and `vault_provider`.
  - `POST /api/v1/tenants/:tenantId/llm-config/validate` checks that provider/model are present and that the configured vault reference can actually be resolved.
- Database target credentials:
  - `POST /api/v1/settings/database-instances` and `PATCH /api/v1/settings/database-instances/:id` can accept a real `connection_string`.
  - The backend writes that secret into the vault and stores only a masked display value plus vault reference in `database_instance_configs`.
- Vault operations:
  - `GET /api/v1/settings/secret-vault` exposes provider status for the UI.
  - The prototype encrypted store uses the `vault_secrets` table.

### Current Provider Modes

- `database_encrypted`
  - Working today.
  - Encrypts secrets before writing them to Postgres.
  - Best for prototype and Railway staging use.
- `azure_key_vault`
  - Planned target for Azure deployment.
  - The current code recognizes Azure-style secret references and exposes Azure vault configuration metadata, but full external vault read/write integration is still the next step.

## Local run

Install dependencies:

```bash
python3 -m pip install -e .
```

Start the API:

```bash
HERMAN_ADMIN_BOOTSTRAP_SCHEMA=true HERMAN_ADMIN_SEED_DEMO_DATA=true uvicorn app.main:app --reload --host 127.0.0.1 --port 8011
```

Open the docs:

- `http://127.0.0.1:8011/docs`

For local development, send `X-Admin-User: local-dev-admin` with requests to hit protected endpoints.

For a local app instance pointed at a live Herman Prompt database, use:

```bash
HERMAN_ADMIN_DATABASE_URL=postgresql+psycopg://... \
HERMAN_ADMIN_BOOTSTRAP_SCHEMA=false \
HERMAN_ADMIN_SEED_DEMO_DATA=false \
uvicorn app.main:app --reload --host 127.0.0.1 --port 8011
```

If you want a stable vault key instead of the local file-backed dev key, also set:

```bash
HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY=your-generated-master-key
```
