# Codex Build Instructions: Admin Auth, Launcher, and MFA

## Purpose

This document converts the architecture in [admin_auth_launcher_build_plan.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md:1) into execution instructions for Codex.

This is the implementation-facing companion to the build plan. The build plan remains the source of truth for:

- target architecture
- security boundaries
- rollout goals
- acceptance criteria

This document tells Codex what to build, in what order, and in which repository.

## Source of Truth

Codex should treat these documents as authoritative references:

- [admin_auth_launcher_build_plan.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md:1)
- [portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1)

Use this execution rule:

- if implementation sequencing or file ownership is unclear, follow this document
- if architecture intent or security behavior is unclear, defer to `admin_auth_launcher_build_plan.md`

## Fixed Configuration Decisions

Codex must treat the following as decided for this implementation phase:

- Admin launch tokens use their own secret and issuer contract, separate from Prompt launch tokens
- Herman Admin uses database-backed sessions
- Herman Admin continues to run locally in this phase
- Herman Prompt launch target is:
  - [https://herman-prompt-demo-production-5b99.up.railway.app/](https://herman-prompt-demo-production-5b99.up.railway.app/)

Current local portal configuration observed in `/Users/michaelanderson/projects/herman_portal/backend/.env`:

- `HERMANPROMPT_LAUNCH_SECRET=test-launch-secret`
- `PORTAL_UI_URL=http://localhost:5174`

Codex should follow the same naming pattern for Admin launch configuration and use these local defaults:

- `HERMANADMIN_LAUNCH_SECRET=test-admin-launch-secret`
- `HERMANADMIN_LAUNCH_ISSUER=herman_portal_local`
- `HERMANADMIN_LAUNCH_AUDIENCE=herman_admin`
- local Herman Admin UI URL:
  - `http://localhost:5173`
- local Herman Admin backend URL:
  - `http://localhost:8011`

## Repositories In Scope

### Repository 1

- `Herman-Admin`
- path: `/Users/michaelanderson/projects/Herman-Admin`

### Repository 2

- `herman_portal`
- path: `/Users/michaelanderson/projects/herman_portal`

## Global Build Rules For Codex

1. Do not invent a second identity system for Herman Admin.
2. Do not implement separate passwords for Herman Prompt and Herman Admin.
3. Do not route users to apps based on password choice.
4. Keep `herman_portal` as the single login surface.
5. Keep Herman Admin authorization in Herman Admin.
6. Use `user_id_hash` as the shared identity bridge across systems.
7. Use app-specific launch tokens for Herman Admin.
8. Require email MFA for Herman Admin launch only.
9. Do not add MFA to Herman Prompt launch in this phase.
10. Preserve local developer bypasses only behind explicit dev-only settings.

## Recommended Execution Order

Codex should execute the work in this sequence:

1. `herman_portal`: add available-apps launcher
2. `herman_portal`: add admin entitlement resolution
3. `herman_portal`: add email MFA challenge flow for Admin launch
4. `herman_portal`: add Herman Admin launch token minting
5. `Herman-Admin`: add launch token validation and session bootstrap
6. `Herman-Admin`: replace header-based auth with session-backed auth
7. `Herman-Admin`: preserve and wire existing permission/scope enforcement into authenticated principal resolution
8. End-to-end validation across both repos

Do not start with MFA in Herman Admin. MFA belongs in `herman_portal` before Admin launch.

## Project A: `herman_portal`

Path:

- `/Users/michaelanderson/projects/herman_portal`

### Goal

Turn `herman_portal` into:

- the shared login entrypoint
- the post-login app launcher
- the email-MFA gate for Herman Admin
- the issuer of Herman Admin launch tokens

### Phase A1: Add Available Apps Landing Page

Codex should build:

- an authenticated launcher route such as `/apps` or `/home`
- a backend endpoint that returns the apps available to the current authenticated user

Minimum apps to support:

- `herman_prompt`
- `herman_admin`

### Required behavior

- show `Herman Prompt` for valid authenticated users
- show `Herman Admin` only when the authenticated user maps to an active admin entitlement

### Portal entitlement logic

Codex should implement a read-only entitlement resolver that:

1. identifies the authenticated portal user
2. resolves `user_id_hash`
3. checks whether an active `AdminUser` exists in the shared database
4. returns app visibility metadata

Portal must not compute detailed admin permission policies. It only decides:

- can the user see the Admin tile
- can the user request an Admin launch

### Suggested backend deliverables

- `GET /api/auth/apps`
- response shape:
  - app key
  - label
  - description
  - enabled boolean
  - launch action key

### Suggested frontend deliverables

- launcher page after successful login
- app tiles
- click action for Prompt launch
- click action for Admin launch

### Acceptance criteria

- Prompt-only user sees Prompt only
- Admin-capable user sees Admin tile
- user without admin entitlement cannot see Admin tile

## Phase A2: Add Email MFA For Admin Launch

### Goal

Require an email verification step before issuing an Admin launch token.

### Codex implementation instructions

Codex should add a portal-owned MFA challenge flow specifically for Admin launch.

Build these parts:

1. backend endpoint to request an email MFA challenge
2. backend endpoint to verify submitted MFA code
3. database persistence for MFA challenge records
4. email sending flow for one-time codes
5. frontend modal or route for entering the MFA code after the user selects Herman Admin

### Required challenge characteristics

- code delivered to authenticated user email
- code stored hashed, not plaintext
- expiration required
- one-time use only
- retry limits
- resend cooldown

### Recommended table

- `auth_mfa_challenges`

Suggested fields:

- `id`
- `user_id_hash`
- `challenge_type`
- `requested_app`
- `code_hash`
- `expires_at`
- `consumed_at`
- `attempt_count`
- `created_at`

### Suggested endpoints

- `POST /api/auth/mfa/admin/request`
- `POST /api/auth/mfa/admin/verify`

### Required behavior

- MFA must be required only for Admin launch
- Prompt launch must remain unchanged
- expired or invalid codes must fail clearly

## Phase A3: Add Herman Admin Launch Token Minting

### Goal

Issue a signed, short-lived launch token for Herman Admin after successful MFA.

### Codex implementation instructions

Codex should:

1. add a dedicated Admin launch token service
2. use separate token audience and token purpose from Prompt
3. include MFA assurance in the token
4. redirect to Herman Admin with the launch token

### Required token claims

- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`
- `iat`
- `exp`

### Optional claims

- `admin_role`
- `launch_request_id`
- `source = herman_portal`

### Required security behavior

- short TTL
- signed token
- Admin token must not be usable by Herman Prompt
- token must only be mintable after successful MFA

### Suggested endpoint

- `POST /api/auth/launch/admin`

This may either:

- directly mint the token after successful MFA verification

or:

- be folded into the MFA verification endpoint

Either is acceptable as long as the flow is explicit and testable.

### Prompt launch rule

Do not break the existing Prompt launch token flow. Extend, do not replace.

## Project B: `Herman-Admin`

Path:

- `/Users/michaelanderson/projects/Herman-Admin`

### Goal

Allow Herman Admin to accept Admin launch tokens from `herman_portal`, establish authenticated admin sessions, and derive runtime authorization from existing admin tables.

## Phase B1: Add Admin Launch Token Validation

### Codex implementation instructions

Codex should add a new auth module in Herman Admin that:

1. validates the incoming Admin launch token
2. verifies signature, expiration, token type, and audience
3. confirms MFA assurance claim is present
4. rejects malformed, expired, or Prompt-scoped tokens

### Suggested backend deliverables

- auth service for Admin launch token verification
- typed token claims model
- configuration for Admin launch secret and issuer settings

### Required configuration

Add explicit settings for:

- Admin launch token secret or public-key material
- expected audience
- expected token type
- token issuer if used

## Phase B2: Add Session Bootstrap And Session Validation

### Goal

Exchange a valid launch token for a Herman Admin session.

### Codex implementation instructions

Codex should add:

- `POST /api/auth/launch/exchange`
- `GET /api/auth/me`
- `POST /api/auth/logout`

The exchange endpoint should:

1. accept the Admin launch token
2. validate it
3. resolve the corresponding admin user
4. create an authenticated Herman Admin session
5. return session success and principal summary

### Session strategy

Preferred implementation:

- server-backed session with HttpOnly cookie

If a server-backed session is used, Codex should add an `admin_sessions` table.

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

### Required behavior

- no valid launch token means no session
- no session means no access to protected Admin APIs
- logout invalidates current session

## Phase B3: Replace Header-Based Principal Resolution

### Current file

- [app/security.py](/Users/michaelanderson/projects/Herman-Admin/app/security.py:1)

### Goal

Replace `X-Admin-User` as the production authentication mechanism.

### Codex implementation instructions

Codex should refactor principal resolution so that:

1. current session is resolved first
2. session maps to `AdminUser`
3. `AdminUser.is_active` is enforced
4. permissions are loaded from:
   - explicit `AdminPermission`
   - role defaults
5. scopes are loaded from `AdminScope`

### Important rule

Do not remove dev-mode local bypass entirely unless instructed.

Instead:

- preserve it only behind a dev-only environment flag
- disable it by default in hosted environments

### Required production behavior

- direct requests without session must fail with unauthorized
- session-authenticated request must build `Principal` from current admin data
- changing admin permissions should take effect without token reminting

## Phase B4: Preserve Existing Authorization Model

### Codex implementation instructions

Codex must not move authorization logic into portal.

Herman Admin remains authoritative for:

- permission checks
- role defaults
- scope access
- reseller, tenant, and group boundaries

This means launch tokens should prove identity and Admin-launch authorization, but not replace the internal permission model.

## Cross-Repo Contract Work

Codex should treat this as a shared contract between the repos.

### Shared identity bridge

- `user_id_hash`

### Launch-token contract

Portal issues token with:

- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`

Herman Admin must validate exactly those fields that are required for trust.

### Database expectation

Both repos rely on the same shared database identity inventory:

- `auth_users`

Portal owns primary user authentication.

Herman Admin owns admin authorization.

## Codex Task Breakdown

Codex should implement the work in this order.

### Workstream 1: Portal launcher

Repository:

- `/Users/michaelanderson/projects/herman_portal`

Tasks:

1. add available-apps API
2. add available-apps page
3. add Admin entitlement lookup
4. add Admin launcher tile

### Workstream 2: Portal MFA

Repository:

- `/Users/michaelanderson/projects/herman_portal`

Tasks:

1. add MFA table
2. add MFA request endpoint
3. add MFA verify endpoint
4. add email delivery integration
5. add frontend MFA UI

### Workstream 3: Portal Admin launch

Repository:

- `/Users/michaelanderson/projects/herman_portal`

Tasks:

1. add Admin launch token service
2. add Admin launch endpoint
3. add Admin redirect builder

### Workstream 4: Herman Admin auth bootstrap

Repository:

- `/Users/michaelanderson/projects/Herman-Admin`

Tasks:

1. add launch-token validation
2. add exchange endpoint
3. add session storage
4. add `/api/auth/me`
5. add logout

### Workstream 5: Herman Admin principal refactor

Repository:

- `/Users/michaelanderson/projects/Herman-Admin`

Tasks:

1. replace header-based auth in production path
2. resolve `Principal` from session
3. keep role + permission + scope enforcement as-is
4. preserve optional local dev bypass under explicit flag

## Codex Testing Instructions

### Portal tests

Codex should verify:

- valid login still works
- Prompt launch still works
- Admin tile appears only for valid admins
- MFA email challenge can be requested
- valid code enables Admin launch
- invalid code blocks Admin launch

### Herman Admin tests

Codex should verify:

- valid Admin launch token creates session
- invalid or Prompt-scoped token fails
- unauthenticated request to protected API fails
- authenticated request loads correct admin principal
- inactive admin cannot access Admin even with otherwise valid identity

### End-to-end tests

Codex should verify:

1. login via portal
2. show available apps
3. choose Herman Admin
4. receive MFA code
5. verify MFA code
6. redirect to Herman Admin
7. establish session
8. successfully access protected admin route

## Required Documentation Updates After Build

After implementing the feature, Codex should update:

- `current_build_status.md`
- any Herman Admin auth architecture notes
- portal auth/deployment docs if token or MFA behavior changes

If schema changes are added, Codex should also update:

- deployment documentation
- environment variable documentation
- local setup instructions

## What Codex Must Not Do

Codex must not:

- add separate admin passwords
- add password-based app routing
- clone `herman_portal` as the primary solution
- duplicate Herman Admin permission logic in portal
- make MFA mandatory for Herman Prompt in this phase

## Acceptance Definition

This build is complete when:

1. `herman_portal` is the shared login entrypoint
2. login lands users on an available-apps page
3. Herman Admin launch requires email MFA
4. Herman Admin validates launch token and creates real session
5. Herman Admin authorization continues to come from `AdminUser`, `AdminPermission`, and `AdminScope`
6. header-only auth is no longer the production access model

## Summary Instruction For Codex

Build the launcher and MFA in `herman_portal`.

Build real token exchange and session-backed auth in `Herman-Admin`.

Reference [admin_auth_launcher_build_plan.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md:1) whenever architectural intent or security behavior needs clarification.
