# Codex Execution Instructions: `herman_portal`

## Purpose

This document gives Codex project-specific implementation instructions for the `herman_portal` repository as part of the Admin auth and launcher build.

This document does not replace the architecture plan. Codex must use these documents together:

- [admin_auth_launcher_build_plan.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md:1)
- [admin_auth_launcher_codex_build_instructions.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_codex_build_instructions.md:1)
- [portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1)

If there is a conflict:

- architecture and security intent come from `admin_auth_launcher_build_plan.md`
- repo execution sequencing comes from this document

## Repository

- project: `herman_portal`
- path: `/Users/michaelanderson/projects/herman_portal`

## Fixed Configuration Decisions

Codex must treat the following as decided for this phase:

- Herman Admin launch tokens must use a separate Admin-specific secret
- Herman Admin launch tokens must use:
  - issuer `herman_portal_local`
  - audience `herman_admin`
  - token-use `admin_launch`
- Herman Admin target remains local during this phase
- Herman Prompt target may remain hosted at:
  - [https://herman-prompt-demo-production-5b99.up.railway.app/](https://herman-prompt-demo-production-5b99.up.railway.app/)

Observed current local portal config:

- `PORTAL_UI_URL=http://localhost:5174`
- `HERMANPROMPT_LAUNCH_SECRET=test-launch-secret`

Codex should add parallel Admin launch configuration using:

- `HERMANADMIN_LAUNCH_SECRET=test-admin-launch-secret`
- `HERMANADMIN_LAUNCH_ISSUER=herman_portal_local`
- `HERMANADMIN_LAUNCH_AUDIENCE=herman_admin`
- local Herman Admin UI target:
  - `http://localhost:5173`

## Build Outcome For This Repo

Codex must evolve `herman_portal` into:

- the shared login surface for Herman apps
- the post-login available-apps launcher
- the email MFA gate for Herman Admin launch
- the issuer of Herman Admin launch tokens

Codex must not:

- create a second identity system for Herman Admin
- implement separate passwords for Herman Prompt and Herman Admin
- route users to apps based on password choice

## Scope Summary

Codex is responsible in this repo for:

1. available-apps landing page after login
2. app entitlement lookup for the authenticated user
3. Admin email MFA challenge flow
4. Herman Admin launch token minting
5. redirecting the browser into Herman Admin with the Admin launch token

Codex is not responsible in this repo for:

- Herman Admin permission enforcement
- Herman Admin scope enforcement
- Herman Admin session creation after token exchange

Those remain in `Herman-Admin`.

## Required Architecture Rules

1. `herman_portal` remains the only shared login surface in this phase.
2. `auth_users` remains the shared identity inventory.
3. `user_id_hash` is the bridge key between portal identity and Herman Admin entitlements.
4. Portal may determine whether the user can launch Admin, but it must not become the source of truth for detailed Admin permissions.
5. Herman Admin launch must require email MFA.
6. Herman Prompt launch must not require MFA in this phase.

## Execution Sequence

Codex should build this repo in the following order:

1. available-apps launcher
2. Admin entitlement resolver
3. email MFA flow for Admin launch
4. Herman Admin launch token service
5. redirect-to-admin handoff
6. portal-side testing and contract validation

## Phase 1: Available Apps Launcher

### Goal

After successful login, route the user to an authenticated launcher page that shows which Herman apps they can use.

### Codex Tasks

1. Add a post-login authenticated route such as `/apps` or `/home`.
2. Add a backend endpoint that returns available apps for the current authenticated session.
3. Render app tiles for:
   - `Herman Prompt`
   - `Herman Admin`
4. Support click-to-launch actions from that page.

### Required Behavior

- any valid authenticated user may see Herman Prompt if Prompt access is part of the current platform behavior
- Herman Admin must only appear when the user has active Admin entitlement

### Suggested API

- `GET /api/auth/apps`

### Suggested Response Shape

- `app_key`
- `label`
- `description`
- `enabled`
- `launch_mode`

### Acceptance Criteria

- Prompt-only users do not see Admin
- Admin-capable users do see Admin
- the page is only available after valid login

## Phase 2: Admin Entitlement Resolution

### Goal

Determine whether the authenticated portal user is allowed to launch Herman Admin.

### Codex Tasks

1. Resolve the authenticated portal user.
2. Read `user_id_hash` for that user.
3. Check the shared database for:
   - active `AdminUser`
4. Return Admin app availability based on that lookup.

### Important Rule

Portal must only answer:

- can this user launch Herman Admin

Portal must not:

- compute full permission policies
- compute final tenant, reseller, or group access lists

That work stays in `Herman-Admin`.

### Acceptance Criteria

- a user without active `AdminUser` cannot see or launch Herman Admin
- a user with active `AdminUser` can see the Admin tile

## Phase 3: Email MFA For Admin Launch

### Goal

Require step-up email verification before minting a Herman Admin launch token.

### Codex Tasks

1. Add backend endpoint to request an email MFA challenge for Admin launch.
2. Add backend endpoint to verify submitted code.
3. Add persistence for challenge records.
4. Add email delivery for one-time Admin launch codes.
5. Add launcher UI to enter and submit the code.

### Required MFA Behavior

- only required for Admin launch
- sent to the authenticated user email
- code stored hashed
- code must expire
- code must be one-time use
- retry and resend limits required

### Recommended Table

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

### Suggested Endpoints

- `POST /api/auth/mfa/admin/request`
- `POST /api/auth/mfa/admin/verify`

### Acceptance Criteria

- user cannot launch Admin without completing MFA
- Prompt launch is unaffected
- invalid or expired code fails cleanly

## Phase 4: Herman Admin Launch Token Minting

### Goal

After successful Admin MFA, issue a signed Admin launch token for the Herman Admin app.

### Codex Tasks

1. Add an Admin launch token service parallel to the Prompt launch token flow.
2. Use an Admin-specific audience and token purpose.
3. Include MFA assurance in the issued token.
4. Build the redirect URL into Herman Admin.

### Required Token Claims

- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`
- `iat`
- `exp`

### Optional Claims

- `admin_role`
- `launch_request_id`
- `source = herman_portal`

### Security Rules

- short TTL
- signed token only
- token must only be minted after successful MFA
- Prompt token must not be accepted as an Admin token

### Suggested Endpoint

- `POST /api/auth/launch/admin`

This may be:

- a separate endpoint after MFA verification

or:

- combined with MFA verification

Either is acceptable if the result is explicit and testable.

## Phase 5: Redirect Handoff To Herman Admin

### Goal

Redirect the user into Herman Admin with the Admin launch token after successful MFA.

### Codex Tasks

1. Add Admin app base URL configuration.
2. Build redirect URL with launch token.
3. Ensure the browser is redirected to Herman Admin after successful verification.

### Required Configuration

Codex should add explicit environment/config entries for:

- Herman Admin UI base URL
- Admin launch signing secret or signing key reference
- Admin launch token TTL
- email MFA sender configuration

## Expected Files And Areas To Change

Codex should expect work in areas such as:

- portal backend auth routes
- auth service layer
- launch token service layer
- frontend login-to-launch routing
- launcher page components
- email/MFA challenge persistence and sending services

Exact file names should be discovered from the current repo structure rather than invented.

## Testing Requirements For This Repo

Codex must verify:

1. normal portal login still works
2. invitation acceptance still works
3. Prompt launch still works
4. authenticated user lands on available-apps page
5. Admin tile appears only for valid admins
6. Admin launch triggers MFA challenge
7. valid MFA code enables Admin launch token issuance
8. invalid MFA code blocks Admin launch
9. redirect to Herman Admin is correctly formed

## Do Not Change In This Repo

Codex must not move Admin authorization logic into portal.

Portal must not become the owner of:

- `AdminPermission`
- `AdminScope`
- Herman Admin runtime authorization decisions

Portal should remain responsible for:

- login
- session authentication
- launcher UX
- Admin launch eligibility check
- Admin MFA
- Admin launch token issuance

## Definition Of Done For `herman_portal`

This repo is complete for this feature when:

1. login lands the user on an available-apps page
2. Admin tile visibility depends on valid admin entitlement
3. launching Herman Admin requires email MFA
4. successful MFA issues a Herman Admin launch token
5. the browser is redirected into Herman Admin using that token
6. Prompt launch still works as before
