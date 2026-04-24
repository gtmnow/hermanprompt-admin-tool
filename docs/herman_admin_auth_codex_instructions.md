# Codex Execution Instructions: `Herman-Admin`

## Purpose

This document gives Codex project-specific implementation instructions for the `Herman-Admin` repository as part of the Admin auth and launcher build.

This document must be used with:

- [admin_auth_launcher_build_plan.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md:1)
- [admin_auth_launcher_codex_build_instructions.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_codex_build_instructions.md:1)

If architecture or security intent is unclear, defer to `admin_auth_launcher_build_plan.md`.

## Repository

- project: `Herman-Admin`
- path: `/Users/michaelanderson/projects/Herman-Admin`

## Fixed Configuration Decisions

Codex must treat the following as decided for this phase:

- Herman Admin uses database-backed sessions
- Admin launch tokens are validated against an Admin-specific contract, separate from Prompt
- Admin launch validation must use these local defaults:
  - `HERMANADMIN_LAUNCH_SECRET=test-admin-launch-secret`
  - `HERMANADMIN_LAUNCH_ISSUER=herman_portal_local`
  - `HERMANADMIN_LAUNCH_AUDIENCE=herman_admin`
  - token-use `admin_launch`
- Herman Admin continues running locally in this phase

Local environment assumptions for this build:

- Herman Admin UI:
  - `http://localhost:5173`
- Herman Admin backend:
  - `http://localhost:8011`
- `herman_portal` UI:
  - `http://localhost:5174`
- `herman_portal` backend:
  - `http://localhost:8010`

Prompt target may remain hosted at:

- [https://herman-prompt-demo-production-5b99.up.railway.app/](https://herman-prompt-demo-production-5b99.up.railway.app/)

## Build Outcome For This Repo

Codex must update Herman Admin so that it:

- accepts Herman Admin launch tokens issued by `herman_portal`
- validates them correctly
- exchanges them for a real authenticated admin session
- resolves the authenticated principal from that session
- keeps authorization sourced from `AdminUser`, `AdminPermission`, and `AdminScope`

Codex must not:

- build a separate credential system for Herman Admin
- duplicate portal login flows inside Herman Admin
- move detailed authorization logic into `herman_portal`

## Scope Summary

Codex is responsible in this repo for:

1. Admin launch token validation
2. launch token exchange endpoint
3. authenticated admin session creation
4. session-backed principal resolution
5. continued use of existing admin authorization model
6. phasing out header-based auth as the production path

Codex is not responsible in this repo for:

- primary login UI
- password reset
- invitation acceptance
- email MFA challenge issuance

Those remain in `herman_portal`.

## Required Architecture Rules

1. Herman Admin must trust `herman_portal` for authenticated login handoff.
2. Herman Admin must not trust raw identity alone as sufficient for access.
3. Herman Admin must still require an active admin mapping.
4. Authorization must continue to be derived from:
   - `AdminUser`
   - `AdminPermission`
   - `AdminScope`
5. Prompt launch tokens must not work against Herman Admin.
6. Production access must not depend on `X-Admin-User`.

## Execution Sequence

Codex should build this repo in the following order:

1. Admin launch token validator
2. launch token exchange endpoint
3. admin session persistence
4. authenticated principal resolution from session
5. replacement of production header-based auth path
6. end-to-end validation with `herman_portal`

## Phase 1: Admin Launch Token Validation

### Goal

Add a secure validator for Herman Admin launch tokens issued by `herman_portal`.

### Codex Tasks

1. Add an auth service dedicated to Admin launch token validation.
2. Validate:
   - signature
   - expiration
   - audience
   - token purpose
   - MFA assurance claim
3. Reject:
   - malformed tokens
   - expired tokens
   - Prompt-scoped tokens
   - Admin tokens without MFA assurance

### Required Token Contract

Herman Admin must expect at minimum:

- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`
- `iat`
- `exp`

### Required Configuration

Codex should add explicit config for:

- Admin launch token secret or public-key material
- expected audience
- expected token-use value
- issuer if used

## Phase 2: Launch Token Exchange Endpoint

### Goal

Exchange a valid Admin launch token for a Herman Admin authenticated session.

### Codex Tasks

1. Add `POST /api/auth/launch/exchange`.
2. Validate the token.
3. Resolve the corresponding admin record.
4. Refuse access if the identity is authenticated but not an active admin.
5. Create the Herman Admin session.
6. Return authenticated principal summary or session success response.

### Required Behavior

The exchange endpoint must:

- require a valid Admin launch token
- require an active `AdminUser`
- fail if no matching active admin exists
- fail if the token is valid identity-wise but not Admin-scoped

## Phase 3: Herman Admin Session Model

### Goal

Persist authenticated Admin access as a real session rather than a header shortcut.

### Preferred Strategy

- server-backed session with HttpOnly cookie

### Codex Tasks

1. Add session creation on successful token exchange.
2. Add session lookup middleware or dependency path.
3. Add logout endpoint.
4. Add current-user endpoint.

### Suggested Endpoints

- `POST /api/auth/launch/exchange`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Recommended Table

- `admin_sessions`

Suggested fields:

- `id`
- `admin_user_id`
- `user_id_hash`
- `issued_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `mfa_verified_at`
- `user_agent`
- `source_ip`

### Required Session Behavior

- session is created only after successful token exchange
- protected APIs require valid active session
- logout revokes or invalidates session
- expired or revoked session fails authorization

## Phase 4: Replace Production Header-Based Auth

### Current File

- [app/security.py](/Users/michaelanderson/projects/Herman-Admin/app/security.py:1)

### Goal

Use session-backed principal resolution instead of `X-Admin-User` as the production access path.

### Codex Tasks

1. Refactor current principal resolution.
2. Resolve current session first.
3. Map session to `AdminUser`.
4. Ensure `AdminUser.is_active` is enforced.
5. Load explicit permissions and role defaults.
6. Load scopes.
7. Build `Principal` from the authenticated admin session.

### Important Rule

Do not remove local dev convenience entirely unless explicitly requested.

Instead:

- keep local bypass available only behind an explicit environment flag
- ensure hosted environments default to session-backed auth only

### Required Production Behavior

- no session means unauthorized
- invalid session means unauthorized
- active session means principal is rebuilt from live admin tables

## Phase 5: Preserve Herman Admin Authorization

### Goal

Continue using the current Herman Admin authorization model after authentication is modernized.

### Codex Tasks

1. Keep `AdminUser` as the identity-to-admin mapping.
2. Keep `AdminPermission` as explicit permission grants.
3. Keep `AdminScope` as the source of reseller, tenant, and group boundaries.
4. Ensure every protected route continues to use the existing permission and scope checks.

### Important Rule

Launch tokens prove authenticated Admin entry.

They do not replace:

- permission checks
- scope checks
- active admin checks

## Expected Files And Areas To Change

Codex should expect work in areas such as:

- backend auth/security layer
- admin principal resolution
- session model and database schema
- auth bootstrap routes
- frontend app bootstrap and authenticated session detection

Exact file names should be discovered from the existing repo structure.

## UI Expectations In Herman Admin

Codex should ensure the frontend can:

1. receive the post-launch authenticated state
2. initialize the app from the new authenticated session
3. handle expired or missing session by redirecting to the appropriate login entrypoint or unauthorized state

If an app shell auth bootstrap already exists conceptually, extend it rather than inventing a parallel auth flow.

## Testing Requirements For This Repo

Codex must verify:

1. valid Admin launch token is accepted
2. Prompt launch token is rejected
3. token without MFA assurance is rejected
4. inactive admin is rejected
5. valid exchange creates session
6. authenticated request to protected route succeeds
7. unauthenticated request to protected route fails
8. logout invalidates session
9. changed permissions are reflected without reminting token

## End-To-End Integration Requirements

Codex should validate the full sequence with `herman_portal`:

1. user logs in through portal
2. user sees Admin tile
3. user completes email MFA
4. portal redirects into Herman Admin with launch token
5. Herman Admin exchanges token for session
6. Herman Admin loads current principal
7. protected route succeeds

## Do Not Change In This Repo

Codex must not:

- add local login/password UI for Herman Admin
- add a separate Herman Admin password store
- replace `AdminUser` authorization with token-embedded permissions
- make Herman Admin independently own primary authentication

## Documentation Updates Required After Implementation

After work in this repo is complete, Codex should update:

- `current_build_status.md`
- auth architecture notes in Herman Admin docs
- environment and deployment setup for Admin launch token validation

If schema changes are introduced, Codex should also update:

- migration documentation
- local setup instructions
- hosted environment variable documentation

## Definition Of Done For `Herman-Admin`

This repo is complete for this feature when:

1. Herman Admin accepts only valid Admin launch tokens from portal
2. Herman Admin exchanges the token for a real authenticated session
3. protected APIs require that session
4. principal resolution comes from session plus live admin tables
5. `AdminUser`, `AdminPermission`, and `AdminScope` remain the authorization source of truth
6. header-based auth is no longer the production access path
