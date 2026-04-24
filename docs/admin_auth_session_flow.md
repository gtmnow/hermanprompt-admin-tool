# Herman Admin Auth Session Flow

Last updated: 2026-04-23

## Purpose

This document describes the Herman Admin side of the new portal-to-admin authentication flow now implemented in this repository.

## Flow Summary

1. `herman_portal` authenticates the user and performs the Admin MFA step-up flow.
2. `herman_portal` redirects the browser into Herman Admin with an Admin launch token.
3. The Herman Admin frontend reads the `launch_token` query parameter and calls `POST /api/auth/launch/exchange`.
4. Herman Admin validates the Admin launch token using the Admin-specific token contract.
5. Herman Admin requires an active `admin_users` mapping for the token `user_id_hash`.
6. Herman Admin creates a server-backed row in `admin_sessions`.
7. Herman Admin sets an HttpOnly `herman_admin_session` cookie.
8. Subsequent browser requests use the server-backed Admin session.
9. Herman Admin resolves live permissions and scopes from `AdminUser`, `AdminPermission`, and `AdminScope` on every protected request.

## Token Validation Contract

Herman Admin accepts only Admin launch tokens with:

- issuer: `herman_portal_local`
- audience: `herman_admin`
- token use: `admin_launch`
- required claims:
  - `user_id_hash`
  - `email`
  - `display_name`
  - `mfa_verified = true`
  - `iat`
  - `exp`

Prompt launch tokens are rejected because the audience and token-use contract do not match the Admin validator.

## Session Model

Herman Admin now persists server-backed sessions in `admin_sessions`.

Stored fields:

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

Session behavior:

- session cookies are HttpOnly
- protected API access requires a valid non-revoked non-expired session
- logout revokes the current session and clears the cookie
- permission and scope changes take effect without reminting the launch token because authorization is loaded live from admin tables

## Endpoints

- `POST /api/auth/launch/exchange`
  - accepts `{ "launch_token": "..." }`
  - validates token contract and active admin mapping
  - creates the Admin session and sets the session cookie
- `GET /api/auth/me`
  - returns the current authenticated Admin principal plus session summary
- `POST /api/auth/logout`
  - revokes the current Admin session and clears the session cookie

## Frontend Behavior

- the Admin SPA no longer hardcodes `X-Admin-User` for normal operation
- the SPA initializes from either:
  - a fresh `launch_token` handoff, or
  - an existing Admin session cookie
- when no valid session exists, the UI shows an authenticated-entry-required state and links back to Herman Portal

## Dev-Only Fallback

`X-Admin-User` remains available only when all of the following are true:

- `HERMAN_ADMIN_ALLOW_DEV_HEADER_AUTH=true`
- `HERMAN_ADMIN_ENVIRONMENT=development`
- the caller explicitly sends `X-Admin-User`

The frontend can opt into that fallback only when `VITE_DEV_ADMIN_USER` is explicitly set.

## Current Local Assumptions

The docs driving this build did not freeze the cookie name, Admin session TTL, or launch-token query parameter name. The current implementation uses:

- cookie name: `herman_admin_session`
- Admin session TTL: 12 hours
- launch-token query parameter: `launch_token`

If portal wiring chooses different names later, update both repos together.
