# Herman Portal Auth And Invitation Spec

Version: 2026-04-21

## Purpose

This document defines the updated requirements for the Herman Portal authentication experience and the admin-to-portal invitation lifecycle.

It is intended to serve as the implementation handoff for the next engineering pass across:

- Herman Admin
- Herman Portal
- the shared Postgres data model

The current production portal URL is:

- [https://hermanportal-production.up.railway.app/](https://hermanportal-production.up.railway.app/)

The planned portal implementation repository for the next build phase is:

- `/projects/herman_portal`

## Product Decision

The initial "accept invitation and set password" experience will live in Herman Portal, not in Herman Admin.

Responsibilities are split as follows:

- Herman Admin creates organizations, users, admins, portal configuration, and invitation records.
- Herman Admin sends invitation emails and manages invitation status, resend, revoke, and audit history.
- Herman Portal owns login, password setup, invitation acceptance, password reset, session establishment, and first authenticated landing.

This keeps the user-facing identity experience inside the portal where the user actually signs in.

## Scope

This specification covers:

- login portal requirements
- invitation acceptance requirements
- password setup requirements
- admin-owned organization portal configuration
- required database schema
- API and UX implications for the next implementation phase

This specification does not require full white-label theming. Rebranding is limited to logo only for this phase.

## Functional Requirements

### 1. Herman Portal Must Be A Fully Functional Login Portal

The portal must support:

- email + password login
- invitation acceptance for first-time users
- initial password setup from an invitation
- sign-out
- session persistence
- invalid or expired invitation handling
- password reset readiness, even if full reset UX is implemented in a later slice

The portal must present a single coherent auth surface rather than a disconnected invitation screen.

### 2. Invitation Acceptance Must Happen In Herman Portal

Invitation emails sent by Herman Admin must direct the user into Herman Portal.

The canonical public invite acceptance route should be:

- `https://hermanportal-production.up.railway.app/invite`

The route may later be branded or proxied per tenant domain, but the base behavior remains the same.

Required invite route behavior:

- read invitation token from query parameter
- validate token against the shared database
- verify invitation is active and unexpired
- display organization name
- display tenant-configured logo if available
- display tenant-configured welcome message if available
- allow invited user to set initial password
- activate the user account after successful password creation
- mark invitation as accepted
- establish authenticated session
- redirect into the portal application

### 3. Invitation Token TTL

Invitation tokens must expire 7 days after creation.

Required rules:

- TTL is exactly 7 days from `created_at`
- persisted as `expires_at`
- expired invitations cannot be accepted
- expired invitations remain visible in admin history
- admin users must be able to resend an invite, which creates a new token and a new expiration window
- only the most recent active invitation for a given user and tenant may be accepted

### 4. Password Setup Requirements

When accepting an invitation, the user must set their initial password.

Required behavior:

- password must be entered twice
- portal validates minimum password policy before submission
- password is stored only as a secure salted password hash
- plaintext password must never be stored in Herman Admin or portal config tables
- after successful password setup, the user becomes active and the invitation is marked accepted

Recommended password policy for this slice:

- minimum 12 characters
- at least 1 uppercase letter
- at least 1 lowercase letter
- at least 1 number
- at least 1 special character

### 5. Portal Rebranding

For this phase, portal rebranding is limited to logo only.

Supported org-level portal branding/configuration:

- portal URL
- portal logo
- portal welcome message

Out of scope for this phase:

- per-tenant theme colors
- font changes
- layout variations
- custom invitation templates beyond organization-specific copy values

### 6. Admin Tool Configuration Requirements

The org setup workflow in Herman Admin must allow configuration of:

- portal base URL
- portal logo URL or logo asset reference
- portal welcome message

These values must be stored in the shared database and treated as organization-owned configuration.

These values must be editable:

- during initial org setup
- from the organization detail/settings area after activation

### 7. Current Portal Default

Until tenant-specific portal URLs are introduced, the default portal base URL should be:

- `https://hermanportal-production.up.railway.app/`

The invite link generated by Herman Admin should use the tenant's configured portal base URL if present, otherwise this default.

## UX Requirements

### Portal Login Screen

The standard login screen must support:

- email field
- password field
- sign-in button
- "accept invitation" link or auto-routed invite flow
- future-friendly "forgot password" entry point
- organization logo when tenant context is known

### Invitation Acceptance Screen

The invitation acceptance screen must display:

- organization logo
- organization name
- welcome message
- invited email address
- password field
- confirm password field
- primary CTA that clearly indicates account creation or password setup

Required states:

- valid invitation
- expired invitation
- already accepted invitation
- revoked invitation
- invalid token

### Admin Tool User Workflow

When a Herman Admin operator creates a new user with status `invited`:

1. Herman Admin creates or updates the org-owned user record.
2. Herman Admin creates an invitation record with `expires_at = created_at + 7 days`.
3. Herman Admin sends invitation email using Resend.
4. The email links to the tenant-configured Herman Portal invite route.
5. The portal accepts the invite and completes password setup.
6. The portal updates the shared auth tables so the user can sign in normally afterward.

## Data Ownership

### Source Of Truth

`auth_users` remains the source of truth for portal-authenticated users.

Herman Admin may continue to maintain admin-owned workflow tables such as org memberships, admin permissions, onboarding state, and invitation audit records, but portal sign-in identity must resolve through `auth_users` plus the credential and invitation tables defined below.

### Identity Principles

- one human user may belong to one or more organizations over time if the platform later supports that
- this phase assumes org-scoped invitations
- email is the primary login identifier
- `user_id_hash` remains the stable internal user identifier used by the Herman platform
- passwords and sessions belong to auth-specific tables, not the admin membership table

## Database Schema Specification

This section defines the minimum required shared schema for the next build phase.

### 1. Existing Table: `auth_users`

`auth_users` remains the canonical identity inventory table used by the other Herman Prompt apps.

Expected responsibilities:

- stable `user_id_hash`
- tenant/org association
- email
- display name
- active/admin flags as needed by the platform
- created and updated timestamps

Required expectation for next phase:

- every invited or active portal user must have a corresponding `auth_users` row
- invitation acceptance must not create a parallel identity system outside `auth_users`

### 2. New Table: `auth_user_credentials`

Purpose:

- store password credentials separately from `auth_users`

Proposed columns:

```sql
create table auth_user_credentials (
  id uuid primary key,
  user_id_hash varchar(200) not null unique,
  password_hash varchar(255) not null,
  password_algorithm varchar(50) not null default 'argon2id',
  password_set_at timestamptz not null,
  password_reset_required boolean not null default false,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz null,
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_auth_user_credentials_user
    foreign key (user_id_hash) references auth_users(user_id_hash)
);
```

Notes:

- use Argon2id unless the portal stack requires a different modern password hasher
- one credentials row per user
- no plaintext or reversible password storage

### 3. New Table: `user_invitations`

Purpose:

- track admin-generated invitations and token lifecycle

Proposed columns:

```sql
create table user_invitations (
  id uuid primary key,
  user_id_hash varchar(200) not null,
  tenant_id varchar(36) not null,
  email varchar(200) not null,
  invite_token_hash varchar(128) not null unique,
  invite_url varchar(1000) null,
  status varchar(30) not null,
  provider varchar(50) null,
  provider_message_id varchar(255) null,
  created_by_admin_user_id varchar(36) null,
  expires_at timestamptz not null,
  sent_at timestamptz null,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_user_invitations_tenant
    foreign key (tenant_id) references tenants(id)
);

create index ix_user_invitations_user on user_invitations(user_id_hash);
create index ix_user_invitations_tenant on user_invitations(tenant_id);
create index ix_user_invitations_email on user_invitations(email);
create index ix_user_invitations_status on user_invitations(status);
```

Status values:

- `pending`
- `sent`
- `accepted`
- `expired`
- `revoked`
- `failed`

Rules:

- store only hashed token, never raw token
- raw token exists only in the outbound email URL
- acceptance compares token hash
- `expires_at` must be set to `created_at + interval '7 days'`

### 4. New Table: `tenant_portal_configs`

Purpose:

- store tenant-level Herman Portal configuration managed by Herman Admin

Proposed columns:

```sql
create table tenant_portal_configs (
  id uuid primary key,
  tenant_id varchar(36) not null unique,
  portal_base_url varchar(500) not null,
  logo_url varchar(1000) null,
  welcome_message text null,
  is_active boolean not null default true,
  created_by_admin_user_id varchar(36) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_tenant_portal_configs_tenant
    foreign key (tenant_id) references tenants(id)
);
```

Rules:

- `portal_base_url` defaults to `https://hermanportal-production.up.railway.app/`
- `logo_url` may reference a hosted asset
- `welcome_message` is plain display content, not a secret
- rebranding in this phase is logo only, but `welcome_message` supports basic org-specific onboarding language

### 5. New Table: `auth_sessions`

Purpose:

- support portal login session persistence and session revocation

Proposed columns:

```sql
create table auth_sessions (
  id uuid primary key,
  user_id_hash varchar(200) not null,
  tenant_id varchar(36) not null,
  session_token_hash varchar(128) not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_seen_at timestamptz null,
  ip_address varchar(100) null,
  user_agent varchar(500) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_auth_sessions_user
    foreign key (user_id_hash) references auth_users(user_id_hash),
  constraint fk_auth_sessions_tenant
    foreign key (tenant_id) references tenants(id)
);
```

Notes:

- if the portal uses signed JWT-only auth, this table may instead be used for refresh sessions or revocation state
- if the portal uses database-backed sessions, this becomes the primary session table

### 6. Optional Future Table: `password_reset_tokens`

This table is not required for the first invite/password slice, but the model should remain compatible with a future password reset flow.

## Required Admin Tool Changes

### Organization Setup

Herman Admin must expose portal configuration fields during org setup:

- portal URL
- logo URL
- welcome message

These should appear in the organization activation/setup workflow and in post-activation organization settings.

### Invitation Management

Herman Admin should support:

- create invite on invited user creation
- resend invite
- revoke invite
- view invite status
- show expiration date

### Invite URL Construction

Invite URL generation rule:

1. resolve `tenant_portal_configs.portal_base_url` for the tenant
2. fall back to `https://hermanportal-production.up.railway.app/`
3. append invite route and token

Example:

```text
https://hermanportal-production.up.railway.app/invite?token=<raw-token>
```

The tenant identifier may also be included in the query string if needed for context, but token verification must remain authoritative.

## Required Herman Portal Changes

### Routes

The portal must implement at least:

- `/login`
- `/invite`
- authenticated home route after successful sign-in

### `/invite` Flow

The portal `/invite` route must:

1. read the token
2. hash the token
3. load matching invitation
4. verify invitation status is `sent` or `pending`
5. verify `expires_at` is in the future
6. load org portal config
7. render logo and welcome message
8. collect and validate password
9. write `auth_user_credentials`
10. mark invitation `accepted`
11. ensure `auth_users.is_active = true`
12. create authenticated session
13. redirect user into the portal

### `/login` Flow

The portal login route must:

- authenticate by email and password
- resolve the corresponding `auth_users` row
- verify the user is active
- establish session
- route into the authenticated app

## Invitation Email Requirements

Invitation email content must be generated by Herman Admin.

Minimum dynamic fields:

- organization name
- invite link
- optional welcome message excerpt

Recommended sender model for this phase:

- email delivery via Resend
- sender address evolves later to a verified branded domain

## Audit And Compliance Requirements

The system must retain enough state to answer:

- who invited a user
- when the invite was sent
- when the invite expires
- whether the invite was accepted
- whether the invite was revoked
- when the password was first set

This is satisfied by combining:

- `user_invitations`
- admin audit logs
- `auth_user_credentials.password_set_at`
- session records where applicable

## Open Implementation Notes

- The current Herman Admin repo already contains a prototype `user_invitations` table and Resend handoff logic.
- The next implementation phase should align that prototype with this schema, especially:
  - add `expires_at`
  - add `revoked_at`
  - add `created_by_admin_user_id`
  - use tenant-specific portal URL when building invite links
- `tenant_portal_configs` does not yet exist and must be added.
- The Herman Portal repo must become the owner of invite acceptance and password setup UX.
- Logo-only branding should be implemented in a way that allows future expansion, but the current UI contract should not imply full theming.

## Implementation Sequence Recommendation

1. Add shared schema changes.
2. Update Herman Admin to manage `tenant_portal_configs`.
3. Update Herman Admin invitation creation to use `expires_at` and tenant portal URL.
4. Implement Herman Portal `/invite` and `/login` routes.
5. Implement credential hashing and session creation.
6. Add admin resend and revoke actions.
7. Validate end-to-end flow against the production portal base URL.
