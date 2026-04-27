# Herman Admin Current Build Status

Last updated: 2026-04-27

## Purpose

This document records the current implemented state of the Herman Admin build so the repo documentation reflects the actual codebase rather than only the original planning specs.

## Implemented use-case coverage

The current build includes the working foundation for use cases `1.1` through `8.2` from [hermanscience_full_use_cases.md](/Users/michaelanderson/projects/Herman-Admin/docs/hermanscience_full_use_cases.md:1).

## User Administration Build Backlog

The current User administration refactor backlog is tracked in [herman_user_admin_use_cases_assessed.xlsx](/Users/michaelanderson/projects/Herman-Admin/herman_user_admin_use_cases_assessed.xlsx). That workbook now includes:

- `Build Priority`
- `Current Support Level`
- `Refactoring Effort Required`

The next implementation tranche is the `Build Priority = 1` subset below.

### Priority 1 user administration use cases

| Functionality Group | Use Case | Current Support | Refactoring Effort |
| --- | --- | --- | --- |
| Core User Management | View user inventory | Partial | Medium |
| Core User Management | Search users | Partial | Medium |
| Core User Management | View user status | Partial | High |
| Core User Management | View user activity metrics | Full | Low |
| Core User Management | Assign users to organization | Partial | Low |
| Core User Management | Auto-generate `user_id_hash` | Full | Low |
| Core User Management | Create single user | Partial | Medium |
| Core User Management | Edit user profile | Partial | High |
| Core User Management | Assign/change user role | Not | High |
| Core User Management | Assign user to group | Full | Low |
| Core User Management | View user details | Not | High |
| Core User Management | Activate/deactivate user | Partial | Medium |
| Core User Management | Delete user | Partial | High |
| Identity & Access Control | Enforce unique identity | Partial | Medium |
| Identity & Access Control | Role-based access enforcement | Full | Low |
| Identity & Access Control | Org-level visibility restrictions | Full | Low |
| User Lifecycle Management | Track invite acceptance | Partial | Medium |
| User Lifecycle Management | Update Status | Partial | High |
| Analytics & Reporting | Track usage per user | Full | Low |
| Analytics & Reporting | Track improvement score | Full | Low |

### Priority 1 implementation themes

The priority 1 set clusters into a small number of concrete build tracks for the `/users` workspace:

1. Align the User administration screen with the actual backend user model.
2. Make organization-scoped inventory, search, and status views reliable.
3. Close lifecycle gaps around invite state, activation/deactivation, and deletion semantics.
4. Add the missing detail surface for user profile inspection and editing.
5. Preserve the already-working user metrics, role enforcement, org visibility, and canonical `user_id_hash` foundation while refactoring.

### Current priority 1 pain points already visible in the codebase

- The `/users` page currently loads the global user list and filters in the browser instead of using the tenant-scoped API path consistently.
- The screen shows membership status, but it does not yet expose invitation lifecycle state cleanly enough to serve as a trustworthy "current user status" view.
- Bulk import is implemented inline on the base User administration screen, which is functional but does not match the intended workflow.
- User detail coverage stops at membership/profile fields and does not yet surface the broader foundational and CQI/persona tables called for by the use cases.
- Role editing is not implemented on the User administration screen even though role-based enforcement already exists in the admin authorization model.

All lower-priority User administration use cases remain in the workbook and should continue to be treated as the backlog after the priority 1 tranche is complete.

### 1.1 - 1.4 Reseller foundation

- reseller creation and editing
- reseller-scoped defaults for new organizations
- reseller portfolio assignment and transfer-in foundation
- reseller-scoped admin creation
- reseller portfolio health summary

### 2.1 - 2.9 Customer activation foundation

- activation landing and multi-step activation wizard
- tenant creation and update
- onboarding checkpoints and readiness evaluation
- portal configuration capture
- runtime and LLM configuration with validation state
- user upload, bulk import, and admin setup
- activation readiness gating plus explicit super-admin override

### 3.1 - 3.3 User, group, and admin editing

- user edit and lifecycle actions
- group edit and membership workflows
- admin creation, editing, scoped delegation, and visibility

### 4.1 - 4.5 Reporting and exports

- report execution endpoints
- report builder page
- export job creation
- export history list and scoped export visibility
- downloadable report artifact generation foundation

### 5.1 - 5.5 Reseller operations and platform operations

- reseller portfolio health monitoring
- tenant reassignment / transfer support
- scoped operational views
- system overview foundation
- internal support and remediation surfaces

### 6.1 - 6.4 Audit and remediation support

- scoped audit log access
- request and action tracking via audit records
- onboarding/activation exception handling
- support-oriented tenant investigation paths

### 7.1 - 8.2 Scoped reporting and investigation

- tenant, group, reseller, and global reporting scope support
- scoped export support
- scoped investigation and cross-entity drill-down foundations

## Tiering capabilities added

The build now includes a DB-backed service tier model managed inside Herman Admin.

### What exists

- `service_tier_definitions` table for reseller and organization tiers
- editable super-admin screen at `/tiers`
- reseller tier assignment on the reseller workspace
- reseller default organization tier assignment
- organization tier selection in the activation workflow
- guarded delete rules so a tier cannot be removed while assigned to any active reseller or active organization
- backend validation for:
  - reseller portfolio capacity against assigned org tiers
  - organization user capacity during create/update/reinvite flows

### Stored tier attributes

- scope type: `organization` or `reseller`
- key and display name
- user limits
- unlimited-user flag
- optional organization-count limit for reseller tiers
- billing/admin fee fields
- additional usage fee text
- CQI assessment value
- active status and sort order

## Current major routes

- `/dashboard`
- `/activation`
- `/activation/new`
- `/activation/:tenantId`
- `/resellers`
- `/orgs`
- `/users`
- `/groups`
- `/admins`
- `/reports`
- `/operations`
- `/exports`
- `/tiers`
- `/settings`

## Backend areas in active use

- `app/api/auth.py`
- `app/api/v1/routes/resellers.py`
- `app/api/v1/routes/tenants.py`
- `app/api/v1/routes/groups.py`
- `app/api/v1/routes/users.py`
- `app/api/v1/routes/admins.py`
- `app/api/v1/routes/reports.py`
- `app/api/v1/routes/settings.py`
- `app/api/v1/routes/audit.py`
- `app/services.py`
- `app/models.py`

## Frontend areas in active use

- `src/pages/activation/`
- `src/pages/resellers/`
- `src/pages/organizations/`
- `src/pages/users/`
- `src/pages/groups/`
- `src/pages/admins/`
- `src/pages/reports/`
- `src/pages/operations/`
- `src/pages/exports/`
- `src/pages/settings/`
- `src/app/providers/AuthProvider.tsx`

## Current runtime assumptions

- Herman Admin now uses portal-issued Admin launch tokens plus server-backed Admin sessions
- protected API requests resolve the current admin from `admin_sessions`
- `AdminUser`, `AdminPermission`, and `AdminScope` remain the authorization source of truth
- `X-Admin-User` is now a dev-only fallback behind explicit environment settings
- Herman Portal remains the owner of end-user login and invite acceptance
- Herman Admin owns organization/admin configuration and operational control surfaces
- secrets continue to use the prototype vault abstraction until Azure Key Vault integration is finished
- live analytics still derive from shared prompt-platform data rather than finalized reporting rollups

## Recommended next build areas

1. Complete deployed portal-to-admin redirect wiring against the shared Admin launch-token contract.
2. Add explicit permission-management UX on top of the current scoped admin model.
3. Finalize Herman Portal login / invitation acceptance flows against the shared schema.
4. Move vault storage from `database_encrypted` to Azure Key Vault integration.
5. Replace derived reporting metrics with finalized production analytics rollups.

## Admin Auth Routes

Herman Admin now exposes the following auth routes outside `/api/v1`:

- `POST /api/auth/launch/exchange`
- `GET /api/auth/me`
- `POST /api/auth/logout`

The implemented auth/session flow is documented in [docs/admin_auth_session_flow.md](/Users/michaelanderson/projects/Herman-Admin/docs/admin_auth_session_flow.md:1).
