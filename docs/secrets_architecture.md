# Secrets Architecture

This document describes how Herman Admin currently handles secrets, what the present prototype vault does, and how we intend to migrate to Azure Key Vault for production.

## Goals

- Avoid storing plaintext customer secrets in tenant-facing admin tables.
- Give the app a stable "vault-style" interface now so we can swap providers later without rewriting the UI contract.
- Keep sensitive runtime configuration auditable and scoped to admin-owned workflows.
- Support a clean migration from Railway prototyping to Azure production hosting.

## What Counts As a Secret

In this system, secrets currently include:

- tenant LLM API keys
- future provider tokens or service credentials needed for LLM access
- database connection strings configured through the admin settings UI
- any future admin-owned service credentials that should not live directly in normal config tables

Prompt UI URLs, tenant names, models, provider names, and masked display values are not treated as secrets.

## Current Architecture

### Current Provider

The active prototype provider is `database_encrypted`.

This means:

- Herman Admin accepts sensitive values through its own API.
- The backend encrypts those values before persisting them.
- Encrypted ciphertext is stored in a dedicated `vault_secrets` table.
- The main tenant/settings tables store only:
  - masked display values
  - secret references
  - source/provider metadata

This is a real encrypted-at-rest application vault, but it is not an external managed secrets service.

### Trust Boundary

The current trust model is:

- Postgres stores ciphertext in `vault_secrets`.
- Herman Admin holds the master key material needed to decrypt those records.
- Therefore, the database alone is not sufficient to recover secrets, but the app runtime remains part of the trust boundary.

This is stronger than storing raw values in Postgres, but weaker than delegating secret custody to a managed external vault such as Azure Key Vault.

## Data Model

### Vault Table

The prototype encrypted store uses the `vault_secrets` table.

Each record includes:

- `secret_ref`
- `provider_type`
- `scope_type`
- `scope_id`
- `secret_kind`
- `display_name`
- `secret_masked`
- `ciphertext`
- `metadata_json`
- `created_by_admin_user_id`
- `last_accessed_at`
- timestamps

### Tenant LLM Config Metadata

Tenant LLM config records do not store plaintext API keys. They store:

- `api_key_masked`
- `secret_reference`
- `secret_source`
- `vault_provider`
- provider/model/runtime metadata

### Database Target Metadata

Database instance settings do not store plaintext connection strings when the operator provides a real DSN through the admin UI. They store:

- `connection_string_masked`
- `connection_secret_reference`
- `secret_source`
- `vault_provider`
- non-secret target metadata such as host, database name, and notes

## Key Management

### Current Master Key Source

The prototype vault uses symmetric encryption via Fernet.

The application derives or loads its master key in this order:

1. `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY`
2. local file at `HERMAN_ADMIN_SECRET_VAULT_LOCAL_KEY_PATH`

If the env var is absent and the local file does not yet exist, the app generates a new random key and writes it to the configured local file path.

### Important Implications

- The same master key is used for encryption and decryption.
- The key is not stored in Postgres.
- If the app loses access to the master key, previously stored encrypted secrets become unreadable.
- If multiple app instances need to decrypt the same secrets, they must share the same master key.

### Development vs Hosted Environments

For local development:

- file-backed key generation is acceptable
- this allows repeatable decrypts on the same workstation

For Railway or any hosted environment:

- the master key should be explicitly provided via `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY`
- a local ephemeral file-backed key is not acceptable for shared or production-like deployments

## Current API Flows

### Tenant LLM Credentials

When an operator saves tenant LLM credentials:

1. The UI sends `PUT /api/v1/tenants/:tenantId/llm-config`
2. If an `api_key` is present:
   - the backend encrypts and stores it in `vault_secrets`
   - the backend generates a reference like `vault://database-encrypted/<uuid>`
   - the tenant LLM config stores only masked/reference/provider metadata
3. If only a `secret_reference` is present:
   - the backend records that external or existing reference instead of storing a new secret

When an operator validates tenant LLM config:

1. The UI sends `POST /api/v1/tenants/:tenantId/llm-config/validate`
2. The backend checks:
   - provider is present
   - model is present
   - secret reference exists
   - secret reference can be resolved by the current vault implementation
3. Validation succeeds only if the vault reference is resolvable

### Database Target Credentials

When an operator saves a database target:

1. The UI sends `POST /api/v1/settings/database-instances` or `PATCH /api/v1/settings/database-instances/:id`
2. If a real `connection_string` is present:
   - the backend writes that value into the vault
   - the backend stores only a masked DSN plus secret reference in `database_instance_configs`
3. If only `connection_secret_reference` is present:
   - the backend stores the reference and classifies the source/provider metadata

### Vault Status for the UI

The settings screen calls `GET /api/v1/settings/secret-vault` to display:

- active provider
- whether the provider is configured
- whether write support exists
- reference prefix
- key source
- Azure vault URL, if configured
- managed secret count
- warnings

## Secret Reference Formats

### Supported Today

- `vault://database-encrypted/<uuid>`

These references are fully resolvable by the current prototype backend.

### Recognized But Not Resolvable Yet

- Azure-style secret URLs such as `https://<vault>.vault.azure.net/secrets/<name>/<version>`

The current backend recognizes these as Azure Key Vault references, but it does not yet fetch secret values from Azure.

### Unsupported External Formats

Any other external reference format is treated as an unresolved external reference unless future provider support is added.

## Security Characteristics of the Current Prototype

### What It Improves

- plaintext secrets are not stored in tenant-facing config rows
- the app has a single vault abstraction for both LLM keys and database connection strings
- operators see masked values and references instead of raw secret contents
- validation now checks whether stored secret references are actually resolvable

### What It Does Not Yet Provide

- Azure-managed custody of secrets
- managed identity-based secret access
- external vault RBAC enforcement
- secret version lifecycle management
- rotation workflows
- key rollover support for the prototype encrypted store
- separation between app operator permissions and vault operator permissions

## Known Limitations

- `database_encrypted` still makes Herman Admin part of the secret trust boundary.
- The current implementation uses one app-level master key rather than per-tenant or per-secret keys.
- If the master key changes without migration support, old ciphertext becomes undecryptable.
- Azure references can be saved, but they cannot yet be resolved by the app.
- The prototype vault is suitable for development and staging, not the desired long-term production posture.

## Target Production Architecture

The target production provider is `azure_key_vault`.

In that model:

- Azure Key Vault stores the real secret values.
- Herman Admin stores only:
  - secret reference
  - masked display value
  - provider/source metadata
  - validation/audit state
- Herman Admin authenticates to Azure using managed identity when hosted on Azure.
- The app no longer needs a local master decryption key for ordinary secret access.

### Intended Trust Model in Azure

- Key Vault becomes the root of trust for application secrets.
- Postgres stores references and metadata only.
- App access to secrets is governed by Azure identity and Key Vault permissions.
- Azure audit trails become the authoritative record for secret reads/writes at the vault layer.

## Railway Prototype to Azure Migration Path

### Phase 1: Current State

- Railway-hosted or local app
- `database_encrypted` provider
- master key supplied by env var or local file
- secrets stored as ciphertext in Postgres

### Phase 2: Dual-Provider Support

- keep the existing vault contract stable in the UI and admin tables
- implement real `azure_key_vault` read/write support in the backend
- allow new secrets to be written to Azure while old `database_encrypted` references still resolve

### Phase 3: Migration

- enumerate stored `vault://database-encrypted/...` secrets
- decrypt using the current master key
- write each secret into Azure Key Vault
- update saved references in admin-facing records to Azure Key Vault references
- optionally retain legacy ciphertext temporarily for rollback

### Phase 4: Production Lockdown

- disable new `database_encrypted` writes in production
- require Azure Key Vault for new secret creation
- remove dependency on app-local master key for hosted production deployments

## Recommended Production Rules

- Do not rely on file-backed vault keys outside local development.
- On Railway, if we continue using the prototype vault temporarily, set a strong `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY` through Railway environment variables.
- On Azure, prefer managed identity over client-secret authentication.
- Treat `database_encrypted` as transitional infrastructure, not the end state.
- Keep secret references stable in the API so the frontend does not need to care which vault provider is active.

## Environment Variables

Current vault-related settings:

- `HERMAN_ADMIN_SECRET_VAULT_PROVIDER`
- `HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY`
- `HERMAN_ADMIN_SECRET_VAULT_LOCAL_KEY_PATH`
- `HERMAN_ADMIN_AZURE_KEY_VAULT_URL`

Expected future Azure-related settings may include additional Azure identity configuration for non-Azure-hosted environments, but the preferred Azure deployment model is managed identity with minimal secret-bearing env vars.

## Open Follow-Up Work

- implement Azure Key Vault provider read/write operations
- add secret rotation and revalidation workflows
- add migration tooling from `database_encrypted` references to Azure references
- document operational recovery for lost/rotated master keys in prototype environments
- add automated tests for vault writes, reads, validation failures, and provider switching
