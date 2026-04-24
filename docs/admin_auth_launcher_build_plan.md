# Herman Admin Auth, Launcher, and MFA Build Plan

## Purpose

This document defines the implementation plan for moving Herman Admin from its current header-based local access model to a production authentication and authorization model built around:

- `herman_portal` as the shared login experience
- a post-login "available apps" launcher
- a dedicated Herman Admin launch-token flow
- real token and session validation inside Herman Admin
- continued use of Herman Admin's own `AdminUser`, permission, and scope model for authorization
- MFA enforced for Herman Admin launch only, using email as the second factor

This plan is intended to be implementation-ready. It describes the architecture, phased build sequence, repo responsibilities, required contracts, and acceptance criteria.

## Build Goals

The target end state is:

1. A user signs in once through `herman_portal`.
2. After authentication, the portal shows which Herman apps the user can access.
3. If the user launches Herman Prompt, the portal issues the existing Prompt launch token flow.
4. If the user launches Herman Admin, the portal performs email MFA first, then issues a Herman Admin launch token.
5. Herman Admin validates the launch token, creates an authenticated admin session, and derives runtime permissions from its own `AdminUser`, `AdminPermission`, and `AdminScope` records.
6. Passwords remain shared identity credentials, not app-specific routing logic.

## Non-Goals

This build plan does not introduce:

- separate passwords for Herman Prompt and Herman Admin
- password-based routing to different apps
- a cloned admin-only copy of `herman_portal`
- full enterprise SSO as part of the first implementation phase

Enterprise SSO remains a future-compatible direction, but this plan establishes the internal architecture that can later sit behind an external IdP.

## Current State

### Herman Portal

Current `herman_portal` capabilities already include:

- email/password login
- invitation acceptance with initial password setup
- password reset and password change flows
- shared identity resolution through `auth_users`
- launch token minting for Herman Prompt

Relevant current references:

- `/Users/michaelanderson/projects/herman_portal/docs/BUILD_SPEC.md`
- `/Users/michaelanderson/projects/herman_portal/docs/DEPLOYMENT.md`

### Herman Admin

Current Herman Admin behavior:

- authorization model already exists through `AdminUser`, `AdminPermission`, and `AdminScope`
- effective permissions are assembled in [app/security.py](/Users/michaelanderson/projects/Herman-Admin/app/security.py:1)
- authentication is not production-ready yet
- current principal resolution still depends on `X-Admin-User`

This means Herman Admin already knows how to answer:

- what this admin can do
- which tenants, groups, or resellers they can operate on

It does not yet securely answer:

- who is logging in
- whether the caller has a valid authenticated admin session

## Architectural Decision

### Chosen Approach

The build will use:

- one shared identity and login experience in `herman_portal`
- one credential set per person
- one launcher surface that routes users to the apps they are entitled to use
- app-specific launch tokens
- app-local authorization inside Herman Admin

### Why This Approach

This avoids the weakest design option: using different passwords to decide which app a user can enter.

Using password-based routing would create:

- a confusing user experience
- duplicate password lifecycle complexity
- more reset and support burden
- an authentication model that mixes identity and app entitlement

The chosen approach keeps concerns separated:

- authentication: handled once in `herman_portal`
- app selection: handled by entitlements in the launcher
- authorization: handled inside Herman Admin from admin tables

## Target User Experience

### Standard User

1. User opens `herman_portal`.
2. User signs in with email and password.
3. User sees available apps.
4. User selects Herman Prompt.
5. Portal issues Prompt launch token and redirects to Herman Prompt.

### Admin User

1. User opens `herman_portal`.
2. User signs in with email and password.
3. User sees available apps.
4. User selects Herman Admin.
5. Portal sends an email MFA code.
6. User enters the MFA code.
7. Portal issues Herman Admin launch token.
8. Browser is redirected into Herman Admin.
9. Herman Admin validates the launch token and creates an admin session.
10. Herman Admin loads the admin principal from `AdminUser`, permissions, and scopes.

### Dual-Access User

If a user can access both Herman Prompt and Herman Admin:

- the same primary login is reused
- app choice is explicit in the launcher
- MFA is required only when launching Herman Admin
- Prompt launch remains one-click after login

## Core Build Principles

### 1. One Identity, Multiple App Entitlements

`auth_users` remains the shared identity inventory.

Credential ownership stays with portal auth tables and flows, not with Herman Admin.

### 2. Herman Admin Owns Authorization

Herman Admin continues to use:

- `AdminUser`
- `AdminPermission`
- `AdminScope`

This means app access to Herman Admin depends on the presence of a valid admin mapping, not just a successful login.

### 3. App-Specific Tokens

Prompt and Admin must use separate launch tokens or separate token audiences so:

- Prompt tokens cannot be replayed against Herman Admin
- Admin tokens can carry admin-specific claims
- MFA assurance can be enforced for Admin launch

### 4. MFA as Step-Up Security

MFA should not be required for the initial portal login in phase 1.

Instead:

- email/password authenticates the shared user identity
- launching Herman Admin triggers email MFA
- successful MFA upgrades assurance for that launch

This keeps Prompt access streamlined while protecting admin access more strongly.

## Repositories and Responsibility Split

### Repo: `herman_portal`

`/Users/michaelanderson/projects/herman_portal`

New responsibilities:

- authenticate users
- determine which Herman apps the user can launch
- render the available-apps landing page
- trigger and validate Admin MFA
- mint Herman Admin launch tokens
- redirect into Herman Admin

Existing responsibilities retained:

- login
- invitation acceptance
- password reset
- password change
- Prompt launch token minting

### Repo: `Herman-Admin`

`/Users/michaelanderson/projects/Herman-Admin`

New responsibilities:

- validate Herman Admin launch tokens
- create and maintain authenticated admin sessions
- derive admin principal from `AdminUser`, permissions, and scopes
- reject access when identity is authenticated but no valid admin mapping exists

Existing responsibilities retained:

- admin permissions and scope enforcement
- admin UI and admin workflow execution

## Phase Plan

## Phase 1: Shared Login and App Launcher

### Objective

Add an authenticated launcher in `herman_portal` that shows available Herman apps after login.

### Portal Build Tasks

1. Add a post-login route such as `/apps` or `/home`.
2. Resolve the authenticated user from the existing portal session.
3. Determine app entitlements for the user:
   - Herman Prompt access based on existing Prompt user identity
   - Herman Admin access based on whether an active `AdminUser` exists for the same `user_id_hash`
4. Render available app tiles with labels, descriptions, and launch actions.

### Entitlement Rules

Minimum phase-1 rules:

- show Herman Prompt if the user is a valid portal-authenticated user
- show Herman Admin only if:
  - an `AdminUser` row exists for that `user_id_hash`
  - `AdminUser.is_active = true`

Optional enhancement:

- surface a brief scope summary such as:
  - `Global admin`
  - `Reseller admin`
  - `Tenant admin for 4 organizations`

### Deliverables

- launcher page in portal
- backend endpoint returning available apps for current session
- app tile model with at least:
  - app key
  - display label
  - launch path or launch method
  - availability flag

### Acceptance Criteria

- a Prompt-only user sees only Prompt
- an Admin-only user sees only Admin
- a dual-access user sees both
- a user without Admin entitlements cannot see Admin in the launcher

## Phase 2: Herman Admin Launch Token Flow

### Objective

Allow `herman_portal` to issue a signed token specifically for Herman Admin launches.

### Portal Build Tasks

1. Add a launch service for Herman Admin parallel to the existing Prompt launch token service.
2. Add an Admin launch endpoint such as:
   - `POST /api/auth/launch/admin`
3. Require authenticated portal session before minting token.
4. Validate that the user has an active `AdminUser` mapping before minting token.
5. Include admin-specific claims in the token.

### Required Token Claims

The Admin launch token should include at minimum:

- `sub` or equivalent authenticated subject
- `user_id_hash`
- `email`
- `display_name`
- `token_use = admin_launch`
- `aud = herman_admin`
- issued-at timestamp
- expiration timestamp
- MFA assurance indicator

Recommended additional claims:

- `admin_role`
- `session_id` or launch request ID

Important:

- do not embed full permission and scope lists in the token as the source of truth
- permissions and scopes should be loaded fresh by Herman Admin from its own tables

### Token Security Requirements

- short TTL, for example 5 minutes
- distinct signing secret from Prompt launch tokens, or at minimum distinct audience and token type
- one-time use is preferred if implementation cost is acceptable

### Deliverables

- Herman Admin launch endpoint in portal backend
- Herman Admin redirect builder
- token claim contract documented and versioned

### Acceptance Criteria

- Admin launch token can only be minted by an authenticated user with active admin entitlement
- Prompt launch token cannot be used to enter Herman Admin
- expired or malformed Admin launch tokens are rejected

## Phase 3: Email MFA for Admin Launch

### Objective

Require email-based MFA only when launching Herman Admin.

### Portal Build Tasks

1. Add MFA challenge request endpoint for Admin launch.
2. Generate short-lived email one-time code.
3. Store hashed MFA code and challenge metadata.
4. Send code to the user’s authenticated email address.
5. Add MFA entry UI in the portal launcher flow.
6. Validate the submitted code before minting the Admin launch token.

### Proposed Data Model

Add a portal-owned table for step-up auth challenges, for example:

`auth_mfa_challenges`

Suggested fields:

- `id`
- `user_id_hash`
- `challenge_type` = `email_code`
- `code_hash`
- `expires_at`
- `consumed_at`
- `attempt_count`
- `created_at`
- `context` or `requested_app` = `herman_admin`

### MFA Rules

- only required for Admin launch
- code expires quickly, such as 10 minutes
- code must be one-time use
- enforce retry limits
- optional resend with cooldown

### UX Flow

1. User clicks `Launch Herman Admin`.
2. Portal verifies admin entitlement.
3. Portal sends code to authenticated email.
4. User enters code.
5. Portal validates code.
6. Portal mints Admin launch token.
7. User is redirected to Herman Admin.

### Acceptance Criteria

- Admin launch cannot proceed without successful MFA
- Prompt launch does not require MFA
- wrong, expired, or reused code is rejected

## Phase 4: Real Token and Session Validation in Herman Admin

### Objective

Replace the current header-based admin principal model with token-backed authentication and app session establishment.

### Herman Admin Build Tasks

1. Add Admin launch token validation service.
2. Validate:
   - signature
   - audience
   - token type
   - expiration
   - MFA assurance flag
3. Add Herman Admin login bootstrap route, for example:
   - `POST /api/auth/launch/exchange`
4. On valid token:
   - create Herman Admin session
   - persist session server-side or issue signed admin session cookie/token
5. Replace `X-Admin-User` principal bootstrap with authenticated session resolution.

### Session Model

Preferred:

- HttpOnly secure cookie-backed session

Alternative:

- signed access token plus refresh token

For admin tooling, cookie-backed session is simpler and safer for browser UX.

### Suggested Herman Admin Session Table

If database-backed sessions are used:

`admin_sessions`

Suggested fields:

- `id`
- `admin_user_id`
- `user_id_hash`
- `issued_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `mfa_verified_at`
- `source_ip`
- `user_agent`

### Principal Resolution Update

Current file:

- [app/security.py](/Users/michaelanderson/projects/Herman-Admin/app/security.py:1)

Target behavior:

- resolve current session instead of reading `X-Admin-User`
- load `AdminUser`
- verify `AdminUser.is_active`
- load explicit permissions plus role defaults
- load scopes
- construct `Principal`

### Acceptance Criteria

- Herman Admin cannot be entered without a valid Admin launch token
- Herman Admin session persists after successful launch
- direct browser access without session redirects or returns unauthorized
- `X-Admin-User` local bypass remains dev-only and disabled in hosted environments

## Phase 5: Preserve Herman Admin Authorization Model

### Objective

Use the existing admin tables as the source of truth for authorization, with no duplication in portal.

### Rules

- Portal authenticates identity and grants entry to Herman Admin only if admin entitlement exists.
- Herman Admin authorizes all actions internally.
- Portal must not become the source of truth for:
  - admin permissions
  - reseller scopes
  - tenant scopes
  - group scopes

### Build Tasks

1. Keep `AdminUser`, `AdminPermission`, and `AdminScope` unchanged as the authorization foundation.
2. Add a small portal-side entitlement read path only:
   - can this user launch Admin
3. Keep all scope expansion and permission enforcement in Herman Admin.

### Acceptance Criteria

- deactivating an admin user in Herman Admin removes Admin launcher access
- changing permissions in Herman Admin affects runtime access without needing portal-side permission sync

## Data Contract Between Portal and Herman Admin

### Required Shared Identity Key

The shared identity key must be:

- `user_id_hash`

This is the common bridge between:

- portal-authenticated identity
- `auth_users`
- Herman Admin `AdminUser`

### Required Launch Exchange Contract

Portal to Herman Admin:

- signed Admin launch token

Herman Admin to Portal:

- none required for initial implementation beyond redirect target

### Required Claims for Admin Launch Token

- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`
- `exp`
- `iat`

### Optional Claims

- `admin_role`
- `launch_request_id`
- `source = herman_portal`

## Required Database and Schema Work

### In `herman_portal`

Potential new or extended tables:

- `auth_mfa_challenges`
- optional launcher/session support extensions if not already present

Likely reused tables:

- `auth_users`
- `auth_user_credentials`
- `auth_sessions`

### In `Herman-Admin`

Potential new tables:

- `admin_sessions` if session persistence is stored in Herman Admin DB schema

Existing tables reused:

- `admin_users`
- `admin_permissions`
- `admin_scopes`

## API Work Summary

### Portal APIs to Add

- `GET /api/auth/apps`
  - returns available apps for authenticated user
- `POST /api/auth/mfa/admin/request`
  - starts email MFA for Admin launch
- `POST /api/auth/mfa/admin/verify`
  - verifies code and returns Admin launch token or launch redirect
- `POST /api/auth/launch/admin`
  - optional combined endpoint after MFA

### Herman Admin APIs to Add

- `POST /api/auth/launch/exchange`
  - validate Admin launch token and establish admin session
- `POST /api/auth/logout`
  - revoke or end admin session
- `GET /api/auth/me`
  - return authenticated admin principal summary

## Security Requirements

### Token Security

- signed tokens only
- short expiration
- admin-specific audience
- explicit token type
- MFA assurance claim required for Admin launch

### Session Security

- HttpOnly cookies preferred
- secure cookies in hosted environments
- same-site policy chosen to support the redirect flow safely
- CSRF protection for state-changing browser requests

### Email MFA Security

- hashed codes only
- code expiration
- resend cooldown
- attempt throttling
- audit trail of challenge request and verification outcome

### Audit Logging

Add audit events for:

- admin launcher entitlement check
- MFA challenge requested
- MFA challenge verified
- Admin launch token minted
- Admin launch token exchange succeeded
- Admin session created
- Admin session ended

## Rollout Sequence

### Milestone 1

Portal app launcher only, with no Admin launch yet.

Outcome:

- authenticated users can see available apps
- Admin tile may be shown as unavailable or coming soon

### Milestone 2

Admin launch token path without MFA in non-production environments.

Outcome:

- end-to-end Admin launch works for development and staging
- Herman Admin session model is functional

### Milestone 3

Email MFA enabled for Admin launch in staging.

Outcome:

- end-to-end secure Admin access path validated

### Milestone 4

Production rollout.

Outcome:

- hosted Herman Admin no longer depends on `X-Admin-User`
- portal becomes the shared login and launcher surface

## Open Decisions

These decisions should be confirmed before implementation begins:

1. Should Admin launch tokens use a completely separate signing secret from Prompt launch tokens?
   - Recommendation: yes.
2. Should Herman Admin use database-backed sessions or signed cookie-only sessions?
   - Recommendation: database-backed sessions for stronger revocation and auditability.
3. Should portal app entitlements be resolved by direct DB lookup or by calling a Herman Admin entitlement endpoint?
   - Recommendation: direct DB lookup at first, because Admin entitlement is currently table-driven and local to the shared database.
4. Should launcher visibility distinguish between read-only admins and write-capable admins?
   - Recommendation: not for phase 1. Any active admin entitlement can see the Admin tile.

## Recommended Build Order

1. Build the portal available-apps landing page.
2. Add admin entitlement resolution in portal.
3. Add Herman Admin launch token minting in portal.
4. Add Herman Admin launch token validation and session exchange.
5. Replace header-based admin auth in Herman Admin.
6. Add email MFA for Admin launch.
7. Add audit logging and revocation hardening.

## Acceptance Test Matrix

### Prompt-Only User

- can log in through portal
- sees Prompt only
- cannot launch Admin

### Admin-Only User

- can log in through portal
- sees Admin
- must complete email MFA before Admin launch
- can enter Herman Admin
- permissions are enforced from Herman Admin tables

### Dual-Access User

- can log in once
- sees both Prompt and Admin
- can launch Prompt without MFA
- must complete MFA before launching Admin

### Non-Admin Authenticated User

- may be authenticated in portal
- does not see Admin tile
- cannot exchange or use Admin launch token

### Inactive Admin

- portal does not expose Admin launcher access
- Herman Admin rejects session creation if stale token is presented after deactivation

## Implementation Notes

### Near-Term Recommendation

Do not clone `herman_portal`.

The stronger near-term implementation is:

- evolve `herman_portal` into the shared login and launcher
- add app-specific launch flows
- let Herman Admin stay focused on authorization and admin workflows

### Future Compatibility

This design is compatible with future enterprise SSO.

Later, `herman_portal` can become:

- a relying party for OIDC/SAML
- or a thinner launcher that trusts an upstream IdP

without changing Herman Admin's internal authorization model.

## Build Readiness Checklist

Before implementation starts, confirm:

- Herman Admin base URL for hosted launch target
- Admin launch token secret strategy
- session storage strategy in Herman Admin
- email provider and deliverability path for MFA codes
- final Admin app tile copy and launcher UX
- whether dev-only header auth remains available behind an explicit environment flag

## Cross-Repo Configuration Decisions

These decisions are fixed for the current implementation phase and both repositories must comply with them.

### 1. Admin Launch Secret And Issuer

The current local `herman_portal` implementation already uses a launch-secret pattern in:

- `/Users/michaelanderson/projects/herman_portal/backend/.env`

Current observed local Prompt launch values:

- `HERMANPROMPT_LAUNCH_SECRET=test-launch-secret`
- `LAUNCH_TOKEN_TTL_SECONDS=3600`

For the Admin launch flow, use the same configuration pattern with Admin-specific names.

Required local configuration decision:

- `HERMANADMIN_LAUNCH_SECRET=test-admin-launch-secret`
- `HERMANADMIN_LAUNCH_ISSUER=herman_portal_local`
- `HERMANADMIN_LAUNCH_AUDIENCE=herman_admin`
- `HERMANADMIN_LAUNCH_TOKEN_USE=admin_launch`

Implementation rule:

- `herman_portal` must mint Admin launch tokens using the Admin-specific secret and issuer
- Herman Admin must validate against the same issuer, audience, and token-use contract
- Admin launch tokens must be separate from Prompt launch tokens

### 2. Session Model

The chosen session model for Herman Admin is:

- database-backed admin sessions

Reason:

- stronger revocation control
- better auditability
- better visibility into which admins are currently logged in
- better fit for an administrative control surface

Implementation rule:

- Herman Admin must create and validate server-backed sessions after launch-token exchange
- Herman Admin should add an `admin_sessions` table rather than relying on signed cookie-only sessions

### 3. Environment URL Decisions

For the current build phase:

- Herman Admin will continue to run locally
- Herman Prompt target is hosted at:
  - [https://herman-prompt-demo-production-5b99.up.railway.app/](https://herman-prompt-demo-production-5b99.up.railway.app/)

Use the following environment assumptions for initial implementation:

- local portal UI:
  - `http://localhost:5174`
- local portal backend:
  - `http://localhost:8010`
- local Herman Admin UI:
  - `http://localhost:5173`
- local Herman Admin backend:
  - `http://localhost:8011`
- current Herman Prompt UI target:
  - `https://herman-prompt-demo-production-5b99.up.railway.app/`

Implementation rule:

- `herman_portal` must redirect Admin launches to the local Herman Admin UI during this phase
- Prompt launch behavior may continue to target the hosted Herman Prompt URL
- when local/staging/production URL matrices are expanded later, these values must be updated in both repos together

## Summary

The implementation should proceed with:

- `herman_portal` as the shared login entrypoint
- a launcher page after login
- email MFA only for Admin launch
- app-specific Herman Admin launch tokens
- real session-backed authentication inside Herman Admin
- Herman Admin's existing admin tables preserved as the sole authorization source

This is the cleanest path to production auth without introducing duplicate credential systems or app-specific passwords.
