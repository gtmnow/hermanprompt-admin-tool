# Herman Admin

Herman Admin is the administrative and analytics service for the Herman Prompt platform. The repository now includes a working FastAPI backend, React frontend, additive Postgres-compatible schema management, reseller-aware onboarding flows, scoped reporting and exports, operational views, DB-backed service tier management, and portal-issued Admin launch-token exchange with server-backed Admin sessions.

The current implementation snapshot is documented in [docs/current_build_status.md](/Users/michaelanderson/projects/Herman-Admin/docs/current_build_status.md:1). Cross-repo auth and invitation requirements remain documented in [docs/portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1). The Admin-side launch/session flow is documented in [docs/admin_auth_session_flow.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_session_flow.md:1).

## Current build scope

The current branch-level build supports the use-case foundation for `1.1` through `8.2` from [docs/hermanscience_full_use_cases.md](/Users/michaelanderson/projects/Herman-Admin/docs/hermanscience_full_use_cases.md:1), including:

- reseller creation, reseller-scoped defaults, tenant portfolio assignment, and portfolio health views
- tenant activation workflows, onboarding checkpoints, activation override support, and portal configuration
- tenant/runtime/LLM setup with vault-backed secrets and validation status
- user creation, invitation, bulk import, edit flows, lifecycle actions, and scoped membership management
- group creation, editing, membership management, and group-admin support
- admin creation and scoped delegation across reseller, tenant, and group boundaries
- report execution, export job generation, export history, and scoped analytics views
- operations views, audit visibility, and internal system overview features
- reseller transfer and scoped investigation foundations
- DB-backed service tier definitions for organizations and resellers, including editable limits and guarded deletion

## What is in place

- FastAPI application entrypoint in `app/main.py`
- React + TypeScript frontend served through Vite
- Versioned API routing under `/api/v1`
- SQLAlchemy-backed persistence with SQLite development support and Postgres-compatible additive schema evolution
- Route modules for:
  - auth bootstrap and session routes
  - health
  - resellers
  - tenants
  - groups
  - users
  - admins
  - onboarding
  - reports and export jobs
  - settings, platform-managed LLMs, and service tiers
  - system overview
  - audit log
- Shared Pydantic schemas for envelopes, domain resources, runtime config, reporting, admin scope data, and service tiers
- Environment-aware startup initialization with optional schema bootstrap and optional demo seeding

## Current assumptions

- The admin tool is a standalone application with its own service boundary.
- It reads and writes admin-owned metadata while also deriving live operational signals from shared Herman Prompt tables when available.
- Authentication now uses Admin launch-token exchange plus a server-backed Admin session cookie.
- The seeded local super admin is `local-dev-admin`.
- Herman Portal owns end-user login, invitation acceptance, initial password setup, and session creation.
- Herman Admin owns org-level portal configuration, invitation generation, invitation delivery, resend/revoke flows, runtime controls, tier assignment, and admin audit state.
- `auth_users` remains the intended source of truth for portal-authenticated users.
- Sensitive credentials are routed through an app-facing vault layer.
- The current prototype vault provider is `database_encrypted`, which stores encrypted ciphertext in the `vault_secrets` table and keeps only masked values plus secret references in admin-facing records.
- For local development, the vault uses `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY` when provided, or falls back to a local file-backed key at `HERMAN_ADMIN_SECRET_VAULT_LOCAL_KEY_PATH`.
- Azure Key Vault is still the intended production-facing model, and the current config surface already includes `HERMAN_ADMIN_SECRET_VAULT_PROVIDER` and `HERMAN_ADMIN_AZURE_KEY_VAULT_URL` for that migration path.
- Reporting is operationally useful but still uses derived backend metrics rather than finalized production analytics rollups.
- When pointing at a live shared database, set `HERMAN_ADMIN_BOOTSTRAP_SCHEMA=false` and `HERMAN_ADMIN_SEED_DEMO_DATA=false`.

## Primary screens and routes

- `/dashboard`
- `/activation`
- `/activation/new`
- `/activation/:tenantId`
- `/resellers`
- `/orgs`
- `/orgs/:tenantId/users`
- `/orgs/:tenantId/groups`
- `/orgs/:tenantId/admins`
- `/orgs/:tenantId/portal`
- `/orgs/:tenantId/llm-config`
- `/orgs/:tenantId/runtime`
- `/orgs/:tenantId/onboarding`
- `/users`
- `/groups`
- `/admins`
- `/reports`
- `/operations`
- `/exports`
- `/tiers`
- `/settings`

## Tiering model

The build now includes DB-backed service tier definitions managed by HermanScience Super Admin users:

- organization tiers define user-capacity limits for customer organizations
- reseller tiers define aggregate portfolio capacity and optional org-count limits for reseller partners
- reseller defaults can only assign organization tiers defined in the DB
- org and reseller config screens now use DB-backed tier pick lists only
- tier definitions can be created, edited, activated/deactivated, and deleted only when no active reseller or active organization still uses them

## Suggested next slices

1. Finish deployed portal redirect wiring so the production launcher targets the deployed Herman Admin UI/backend pair.
2. Build Herman Portal `/login` and `/invite` flows against the shared schema and production portal base URL `https://hermanportal-production.up.railway.app/`.
3. Swap the prototype `database_encrypted` provider for true Azure Key Vault read/write support via managed identity.
4. Replace derived reporting metrics with shared analytics rollups from the Herman Prompt platform.
5. Add formal permission-management UX on top of the current scoped admin foundation.

## Admin Auth

Herman Admin now expects a Herman Portal Admin launch handoff:

- `POST /api/auth/launch/exchange`
  - validates a portal-issued Admin launch token
  - requires:
    - issuer `herman_portal_local`
    - audience `herman_admin`
    - token-use `admin_launch`
    - `mfa_verified = true`
  - requires an active `admin_users` mapping for the token `user_id_hash`
  - creates a server-backed row in `admin_sessions`
  - sets an HttpOnly `herman_admin_session` cookie
- `GET /api/auth/me`
  - returns the current Admin session principal
- `POST /api/auth/logout`
  - revokes the current Admin session and clears the cookie

Protected `/api/v1/...` routes now resolve the caller from the current Admin session and then rebuild authorization from live `AdminUser`, `AdminPermission`, and `AdminScope` rows.

`X-Admin-User` remains available only as a dev fallback when:

- `HERMAN_ADMIN_ALLOW_DEV_HEADER_AUTH=true`
- `HERMAN_ADMIN_ENVIRONMENT=development`
- the caller explicitly sends `X-Admin-User`

The SPA no longer hardcodes that header for normal operation. For local-only fallback work, set `VITE_DEV_ADMIN_USER`.

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
npm install
```

Start the API and frontend against a local development database:

```bash
HERMAN_ADMIN_DATABASE_URL=sqlite:///./data/herman_admin.db \
HERMAN_ADMIN_BOOTSTRAP_SCHEMA=true \
HERMAN_ADMIN_SEED_DEMO_DATA=true \
uvicorn app.main:app --reload --host 127.0.0.1 --port 8011
npm run dev
```

For a local app instance pointed at a live Herman Prompt / Railway Postgres database, use:

```bash
HERMAN_ADMIN_DATABASE_URL=postgresql+psycopg://... \
HERMAN_ADMIN_BOOTSTRAP_SCHEMA=false \
HERMAN_ADMIN_SEED_DEMO_DATA=false \
uvicorn app.main:app --reload --host 127.0.0.1 --port 8011
```

Open:

- frontend: `http://127.0.0.1:5175`
- API docs: `http://127.0.0.1:8011/docs`

Portal-to-admin auth defaults for this phase:

```bash
HERMANADMIN_LAUNCH_SECRET=test-admin-launch-secret
HERMANADMIN_LAUNCH_ISSUER=herman_portal_local
HERMANADMIN_LAUNCH_AUDIENCE=herman_admin
```

Optional local-only header fallback:

```bash
HERMAN_ADMIN_ALLOW_DEV_HEADER_AUTH=true
HERMAN_ADMIN_ENVIRONMENT=development
VITE_DEV_ADMIN_USER=local-dev-admin
```

If you want a stable vault key instead of the local file-backed dev key, also set:

```bash
HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY=your-generated-master-key
```

## Verification commands

Useful build-time checks:

```bash
.venv/bin/python -m py_compile app/auth.py app/api/auth.py app/models.py app/security.py app/services.py app/api/v1/routes/*.py app/schemas/*.py
npm run build
```
