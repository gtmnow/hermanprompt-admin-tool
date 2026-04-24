# Admin Auth Implementation Checklist

This document freezes the implementation details for the Admin launcher/auth build in `herman_portal`.

The source of truth for architecture and product behavior remains:

- `/Users/michaelanderson/projects/Herman-Admin/docs/herman_admin_auth_codex_instructions.md`
- `/Users/michaelanderson/projects/Herman-Admin/docs/herman_portal_admin_auth_codex_instructions.md`
- `/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_codex_build_instructions.md`
- `/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_launcher_build_plan.md`

This checklist exists to lock the portal-side implementation details before coding begins across `herman_portal` and `Herman-Admin`.

## Portal Session

- `herman_portal` login creates a server-backed authenticated portal session.
- The browser receives only a session cookie; it does not store long-lived auth state in local storage.
- The portal session is required for `/api/auth/me`, `/api/auth/apps`, Admin MFA, and app launch initiation.
- Portal logout invalidates the server-side session and clears the session cookie.

## Portal Auth Endpoints

- `POST /api/auth/login`
  - Authenticates the user.
  - Creates the server-backed portal session.
  - Returns authenticated user summary plus success state.
  - Does not directly redirect to HermanPrompt.
- `POST /api/auth/logout`
  - Invalidates the server-backed portal session.
- `GET /api/auth/me`
  - Returns the current authenticated portal user from the session.
- `GET /api/auth/apps`
  - Returns available apps for the authenticated session user.

## Apps Response Shape

- `app_key`
- `label`
- `description`
- `enabled`
- `launch_mode`
- Optional: `requires_mfa`

## Admin MFA Endpoints

- `POST /api/auth/mfa/admin/request`
  - Creates a one-time email MFA challenge for the session user.
- `POST /api/auth/mfa/admin/verify`
  - Verifies the submitted code for the session user.
  - Records MFA completion for Admin launch.
- MFA state is server-backed and tied to the portal session and user.
- The browser must not be the source of truth for MFA completion.

## Launch Endpoints

- `POST /api/auth/launch/admin`
  - Requires authenticated portal session.
  - Requires successful Admin MFA.
  - Returns the Admin redirect target or performs redirect handoff logic.
- `POST /api/auth/launch/prompt`
  - Requires authenticated portal session.
  - Does not require MFA in this phase.

## Admin Launch Token Claims

- `iss = herman_portal_local`
- `aud = herman_admin`
- `token_use = admin_launch`
- `user_id_hash`
- `email`
- `display_name`
- `mfa_verified = true`
- `iat`
- `exp`

## Prompt Launch Token

- Prompt launch tokens remain separate from Admin launch tokens.
- Herman Admin must not accept Prompt launch tokens.

## Herman Admin Exchange And Session

- `POST /api/auth/launch/exchange`
  - Accepts the Admin launch token.
  - Validates signature, issuer, audience, token use, and expiry.
  - Creates a server-backed Admin session.
- `GET /api/auth/me`
  - Returns the current Admin session principal.
- `POST /api/auth/logout`
  - Invalidates the Admin server-backed session.
- The Herman Admin session is independent from the portal session after exchange.

## Authorization Boundary

- Portal decides only whether the user can launch Admin.
- Herman Admin remains the source of truth for permissions and scopes after session creation.

## Build Gate

- Do not begin MFA UI or redirect wiring until these session behaviors, endpoint shapes, and token claims are treated as frozen.
