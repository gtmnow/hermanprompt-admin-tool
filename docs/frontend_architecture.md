# Herman Prompt Admin Tool
## Frontend Architecture Spec

Version: v1  
Purpose: This document translates approved UX wireframes and functional requirements into a frontend architecture plan that sits between UX design and engineering implementation. It maps screens to routes, components, data dependencies, and frontend behavior.

---

# 1. Frontend Architecture Goals

The frontend must:

- support task-based administration rather than a single mixed dashboard
- enforce role-aware navigation and route access
- provide clear workflows for activation, administration, reporting, and operations
- support scalable multi-tenant and reseller-aware UX
- map cleanly to backend APIs and shared design system components

The UI is organized into four primary work areas:

1. Activation
2. Administration
3. Reporting
4. Operations

---

# 2. Recommended Frontend Stack

- React
- TypeScript
- React Router
- React Query for server state
- Zustand or Context for global client state
- Component library: internal design system
- Charting: Recharts
- Tables: TanStack Table or equivalent
- Forms: React Hook Form + Zod

---

# 3. Application Shell

## 3.1 Global Layout

All authenticated screens should render inside a shared application shell.

### Root Layout Components
- `AppShell`
  - `TopBar`
  - `SideNav`
  - `ScopeSwitcher`
  - `UserMenu`
  - `ContentFrame`
  - `GlobalToastRegion`
  - `PermissionGate`

## 3.2 Top-Level Navigation

Navigation items are role-aware.

### Full navigation model
- Dashboard
- Activation
- Organizations
- Users
- Groups
- Admins
- Reporting
- Operations
- Exports
- Settings

### Role-based visibility
- HermanScience Super Admin: all sections
- HermanScience Support Admin: dashboard, organizations, users, reporting, operations, exports
- Partner Reseller Super User: dashboard, activation, organizations, users, groups, admins, reporting, exports, settings
- Tenant Admin: dashboard, users, groups, admins if permitted, reporting, exports, settings
- Group Admin: dashboard, users scoped to group, reporting, exports if permitted
- Read-Only Analyst: dashboard, reporting, exports if permitted

---

# 4. Routing Architecture

## 4.1 Route Map

| Route | Screen | Access | Purpose |
|---|---|---|---|
| `/` | App redirect | authenticated | Redirect to default landing page |
| `/dashboard` | Dashboard | scoped | High-level summary and alerts |
| `/activation` | Activation landing | reseller, HS admin | Start or resume onboarding |
| `/activation/new` | Activation wizard | reseller, HS admin | Provision new organization |
| `/activation/:tenantId` | Activation wizard resume | reseller, HS admin | Continue draft onboarding |
| `/orgs` | Organization list | scoped | View organizations in scope |
| `/orgs/:tenantId` | Organization detail | scoped | Deep tenant management view |
| `/orgs/:tenantId/overview` | Org overview tab | scoped | Summary, KPIs, trend |
| `/orgs/:tenantId/users` | Org users tab | scoped | Users within org |
| `/orgs/:tenantId/groups` | Org groups tab | scoped | Groups within org |
| `/orgs/:tenantId/admins` | Org admins tab | scoped | Org-level admin control |
| `/orgs/:tenantId/llm-config` | Org LLM config tab | scoped write or read | Runtime model config |
| `/orgs/:tenantId/reporting` | Org reporting tab | scoped | Org reporting view |
| `/orgs/:tenantId/onboarding` | Org onboarding tab | scoped | Onboarding checklist and status |
| `/users` | User list | scoped | Cross-scope user management |
| `/users/:userIdHash` | User detail | scoped | User analytics and activity |
| `/groups` | Group list | scoped | Group management |
| `/groups/:groupId` | Group detail | scoped | Group analytics and roster |
| `/admins` | Admin list | scoped | Admin management |
| `/admins/:adminId` | Admin detail/edit | scoped write or read | Role, permissions, scope |
| `/reports` | Report builder | scoped | Build and run reports |
| `/reports/:reportKey` | Saved or shareable report view | scoped | Render configured report |
| `/operations` | Operations dashboard | HS internal only | System health and platform ops |
| `/exports` | Export jobs | scoped | View export history and downloads |
| `/settings` | Settings landing | scoped | User and tenant settings |
| `/settings/profile` | Profile settings | authenticated | Personal preferences |
| `/settings/tenant` | Tenant settings | scoped write | Tenant runtime and policies |
| `/not-authorized` | Permission error | authenticated | Access denied |
| `*` | Not found | authenticated | 404 |

## 4.2 Route Grouping

### Public Routes
The admin tool itself does not own the end-user auth UX, but it now depends on a Herman Portal auth handoff contract.

For the platform-wide experience, the Herman Portal must implement public routes for:

- `/login`
- `/invite`

The detailed requirements and shared schema contract live in [portal_auth_and_invitation_spec.md](/Users/michaelanderson/projects/Herman-Admin/docs/portal_auth_and_invitation_spec.md:1).

### Protected Routes
All routes listed above are protected and require:
- valid auth token
- resolved role
- resolved scope
- route permission check

---

# 5. Frontend Module Structure

Recommended folder layout:

```text
src/
  app/
    router/
    providers/
    guards/
    layouts/
  pages/
    dashboard/
    activation/
    organizations/
    users/
    groups/
    admins/
    reports/
    operations/
    exports/
    settings/
  components/
    shell/
    tables/
    charts/
    forms/
    status/
    filters/
    feedback/
    onboarding/
    permissions/
  features/
    auth/
    tenants/
    users/
    groups/
    admins/
    reports/
    exports/
    llmConfig/
    onboarding/
    operations/
  api/
    client.ts
    auth.ts
    tenants.ts
    users.ts
    groups.ts
    admins.ts
    reports.ts
    exports.ts
    operations.ts
    llmConfig.ts
  state/
    sessionStore.ts
    scopeStore.ts
    uiStore.ts
  types/
  utils/
```

---

# 6. Screen-by-Screen Mapping

## 6.1 Dashboard

### Route
`/dashboard`

### Purpose
Provide a role-aware landing page with summary metrics, trends, and alerts.

### Page Component
- `DashboardPage`

### Screen Composition
- `DashboardHeader`
- `ScopeSummaryBar`
- `KPIGrid`
- `UsageTrendCard`
- `ImprovementTrendCard`
- `AlertsPanel`
- `QuickActionsPanel`
- `RecentActivityPanel`

### Data Dependencies
- summary metrics for current scope
- utilization trend
- improvement trend
- active alerts
- onboarding issues
- LLM config issues

### Suggested API Calls
- `GET /dashboard/summary`
- `GET /dashboard/trends`
- `GET /dashboard/alerts`

### Key UI States
- loading skeleton
- no data
- alert present
- limited scope view

---

## 6.2 Activation Landing

### Route
`/activation`

### Purpose
Allow reseller or HS admin to start new onboarding or resume existing drafts.

### Page Component
- `ActivationLandingPage`

### Screen Composition
- `ActivationHeader`
- `StartActivationButton`
- `ActivationDraftsTable`
- `OnboardingStatusSummary`
- `ActivationHelpPanel`

### Data Dependencies
- draft onboardings in scope
- onboarding completion status per draft

### Suggested API Calls
- `GET /onboarding/drafts`
- `GET /onboarding/summary`

---

## 6.3 Activation Wizard

### Routes
- `/activation/new`
- `/activation/:tenantId`

### Purpose
Provision and activate a customer organization through a guided workflow.

### Page Component
- `ActivationWizardPage`

### Shared Wizard Components
- `WizardHeader`
- `WizardStepper`
- `WizardStepFrame`
- `WizardSideStatusPanel`
- `WizardFooterActions`
- `SaveDraftButton`

### Step Components
1. `OrgInfoStep`
2. `LLMConfigStep`
3. `RuntimeSettingsStep`
4. `GroupSetupStep`
5. `UserUploadStep`
6. `AdminSetupStep`
7. `ReviewActivateStep`

### Step 1: Org Info Step
#### Components
- `OrgInfoForm`
- `PlanTierSelect`
- `TimezoneSelect`
- `ResellerAssignmentField` (HS only or prefilled for reseller)

#### APIs
- `POST /tenants`
- `PATCH /tenants/:tenantId`

### Step 2: LLM Config Step
#### Components
- `LLMProviderSelect`
- `ModelSelect`
- `ApiKeyField`
- `SecretReferenceField`
- `EndpointField`
- `VaultStatusHint`
- `ValidationStatusCard`
- `TestConnectionButton`
- `ValidationResultPanel`

#### APIs
- `PUT /tenants/:tenantId/llm-config`
- `POST /tenants/:tenantId/llm-config/validate`

### Step 3: Runtime Settings Step
#### Components
- `EnforcementModeSelect`
- `RetentionPolicyFields`
- `FeatureFlagToggleList`
- `ScoringToggle`
- `ReportingToggle`
- `RawPromptVisibilityToggle`

#### APIs
- `POST /tenants/:tenantId/runtime-settings`

### Step 4: Group Setup Step
#### Components
- `GroupTableEditor`
- `CreateGroupModal`
- `BulkGroupUploadOptional`

#### APIs
- `POST /groups`
- `PATCH /groups/:groupId`

### Step 5: User Upload Step
#### Components
- `CsvUploadDropzone`
- `ImportPreviewTable`
- `ImportValidationPanel`
- `ImportErrorsDownloadLink`
- `ConfirmImportButton`

#### APIs
- `POST /users/import`
- `GET /users/import/:jobId`

### Step 6: Admin Setup Step
#### Components
- `AdminCreationForm`
- `AdminRoleSelect`
- `AdminScopePicker`
- `PermissionMatrix`
- `AdminListPreview`

#### APIs
- `POST /admins`
- `PATCH /admins/:adminId`

### Step 7: Review & Activate Step
#### Components
- `ActivationChecklist`
- `ConfigSummaryPanel`
- `ActivationWarningsPanel`
- `ActivateTenantButton`

#### APIs
- `POST /tenants/:tenantId/activate`

### Key Frontend Behaviors
- step validation before continuing
- save draft at any time
- preserve partial state
- block activation until LLM validation passes
- display onboarding completeness

---

## 6.4 Organization List

### Route
`/orgs`

### Purpose
Browse organizations in visible scope.

### Page Component
- `OrganizationsPage`

### Screen Composition
- `OrganizationsHeader`
- `OrgFiltersBar`
- `OrganizationsTable`
- `OrgStatusBadge`
- `OrgQuickActionsMenu`

### Table Columns
- organization name
- reseller
- plan tier
- status
- provisioned users
- active users
- utilization
- LLM status
- onboarding status
- last activity

### APIs
- `GET /tenants`

---

## 6.5 Organization Detail

### Base Route
`/orgs/:tenantId`

### Purpose
Manage and inspect an individual organization.

### Container Component
- `OrganizationDetailPage`

### Shared Subcomponents
- `OrgHeader`
- `OrgBreadcrumbs`
- `OrgStatusBadge`
- `OrgTabNav`
- `OrgContextSummary`

### Tab Routing Strategy
Use nested routes or tab state synced to route.

---

### 6.5.1 Org Overview Tab
#### Route
`/orgs/:tenantId/overview`

#### Components
- `OrgOverviewTab`
- `OrgKPIGrid`
- `UsageTrendChartCard`
- `ImprovementTrendChartCard`
- `AttentionItemsPanel`

#### APIs
- `GET /analytics/tenant/:tenantId/summary`
- `GET /analytics/tenant/:tenantId/trends`

---

### 6.5.2 Org Users Tab
#### Route
`/orgs/:tenantId/users`

#### Components
- `OrgUsersTab`
- `UsersTable`
- `UserFiltersBar`
- `BulkActionsToolbar`

#### APIs
- `GET /users?tenant_id=:tenantId`

---

### 6.5.3 Org Groups Tab
#### Route
`/orgs/:tenantId/groups`

#### Components
- `OrgGroupsTab`
- `GroupsTable`
- `CreateGroupButton`
- `GroupAssignmentPanel`

#### APIs
- `GET /groups?tenant_id=:tenantId`

---

### 6.5.4 Org Admins Tab
#### Route
`/orgs/:tenantId/admins`

#### Components
- `OrgAdminsTab`
- `AdminsTable`
- `CreateAdminButton`
- `AdminScopeSummary`

#### APIs
- `GET /admins?tenant_id=:tenantId`

---

### 6.5.5 Org LLM Config Tab
#### Route
`/orgs/:tenantId/llm-config`

#### Secret Handling Rules
- pasted API keys must never be persisted directly in tenant-facing admin tables
- the backend writes new LLM credentials into the admin vault and returns only masked credential state plus a vault reference
- validation must check both provider/model completeness and whether the configured secret reference can be resolved
- external references such as Azure Key Vault secret URLs can be displayed and saved even before full external vault resolution is implemented

#### Components
- `OrgLLMConfigTab`
- `LLMConfigForm`
- `CredentialMaskedField`
- `CredentialSourceField`
- `SecretReferenceField`
- `ValidationStatusCard`
- `RevalidateButton`
- `RotateCredentialButton`

#### APIs
- `GET /tenants/:tenantId/llm-config`
- `PUT /tenants/:tenantId/llm-config`
- `POST /tenants/:tenantId/llm-config/validate`

---

### 6.5.6 Org Reporting Tab
#### Route
`/orgs/:tenantId/reporting`

#### Components
- `OrgReportingTab`
- `EmbeddedReportBuilder`
- `KPIGrid`
- `ReportChartArea`
- `ReportDataTable`

#### APIs
- `POST /reports/query`

---

### 6.5.7 Org Onboarding Tab
#### Route
`/orgs/:tenantId/onboarding`

#### Components
- `OrgOnboardingTab`
- `OnboardingChecklist`
- `OnboardingTimeline`
- `ActivationStatusBanner`
- `ResumeOnboardingButton`

#### APIs
- `GET /tenants/:tenantId/onboarding-status`

---

## 6.6 User List

### Route
`/users`

### Purpose
Provide scoped cross-organization or within-org user administration.

### Page Component
- `UsersPage`

### Components
- `UsersHeader`
- `UserFiltersBar`
- `UsersTable`
- `BulkActionMenu`
- `CsvImportButton` (if permitted)

### Table Columns
- user identifier
- organization
- group
- status
- utilization segment
- last activity
- sessions
- average improvement

### APIs
- `GET /users`
- `PATCH /users/:userIdHash`
- `DELETE /users/:userIdHash`

---

## 6.7 User Detail

### Route
`/users/:userIdHash`

### Purpose
Show how much the user has utilized the platform and how performance has changed.

### Page Component
- `UserDetailPage`

### Screen Composition
- `UserHeader`
- `UserStatusCard`
- `UserMembershipSummary`
- `UtilizationSummaryCard`
- `ScoreTrendChart`
- `SessionTrendChart`
- `PromptBehaviorInsightsCard`
- `RecentActivityTable`

### Metrics Displayed
- first use
- last activity
- total sessions
- active days
- utilization level
- average initial score
- average final score
- average improvement
- coaching rate
- missing dimension rates

### APIs
- `GET /analytics/user/:userIdHash`
- `GET /analytics/user/:userIdHash/trend`
- `GET /users/:userIdHash/activity`

---

## 6.8 Group List

### Route
`/groups`

### Purpose
Manage and browse groups in scope.

### Page Component
- `GroupsPage`

### Components
- `GroupsHeader`
- `GroupFiltersBar`
- `GroupsTable`
- `CreateGroupButton`

### APIs
- `GET /groups`

---

## 6.9 Group Detail

### Route
`/groups/:groupId`

### Purpose
Inspect and manage a specific group.

### Page Component
- `GroupDetailPage`

### Components
- `GroupHeader`
- `GroupKPICards`
- `GroupImprovementTrendChart`
- `GroupUtilizationTrendChart`
- `GroupUsersTable`
- `GroupAdminsPanel`

### APIs
- `GET /analytics/group/:groupId`
- `GET /users?group_id=:groupId`

---

## 6.10 Admin List

### Route
`/admins`

### Purpose
View and manage administrator accounts and scopes.

### Page Component
- `AdminsPage`

### Components
- `AdminsHeader`
- `AdminFiltersBar`
- `AdminsTable`
- `CreateAdminButton`

### Table Columns
- admin name or identifier
- role
- scope type
- scope summary
- permissions summary
- active status

### APIs
- `GET /admins`

---

## 6.11 Admin Detail / Edit

### Route
`/admins/:adminId`

### Purpose
Edit role, permissions, and scope without allowing hidden privilege escalation.

### Page Component
- `AdminDetailPage`

### Components
- `AdminHeader`
- `AdminRoleCard`
- `AdminScopePicker`
- `PermissionMatrix`
- `EscalationWarningBanner`
- `AdminAuditTrailPanel`

### APIs
- `GET /admins/:adminId`
- `PATCH /admins/:adminId`

### UX Rules
- scope selection must be visual and human-readable
- permissions must be grouped by domain
- invalid role/scope combinations blocked before submit
- if editor lacks authority, disable mutation controls

---

## 6.12 Reporting

### Route
`/reports`

### Purpose
Build reports across dimension levels and export them.

### Page Component
- `ReportsPage`

### Components
- `ReportBuilderHeader`
- `ReportTypeSelect`
- `DimensionSelector`
- `ScopeSelector`
- `DateRangePicker`
- `AdvancedFiltersDrawer`
- `RunReportButton`
- `ReportsKPIGrid`
- `ChartRenderer`
- `ReportTable`
- `ExportActionsBar`

### Supported Dimensions
- individual
- group
- organization
- reseller portfolio
- all organizations

### APIs
- `POST /reports/query`
- `POST /exports`
- `GET /exports/:jobId`

### UX Behavior
- changing dimension changes available scope controls
- every report has chart plus table
- filters are always visible
- export uses same filtered payload as rendered view

---

## 6.13 Operations

### Route
`/operations`

### Purpose
Internal HermanScience system health and performance view.

### Page Component
- `OperationsPage`

### Components
- `OperationsHeader`
- `SystemKPIGrid`
- `TrafficTrendChart`
- `ErrorTrendChart`
- `TenantIssueTable`
- `LLMValidationIssuePanel`

### APIs
- `GET /system/overview`
- `GET /system/issues`
- `GET /system/trends`

---

## 6.14 Exports

### Route
`/exports`

### Purpose
Track export requests and download generated files.

### Page Component
- `ExportsPage`

### Components
- `ExportsHeader`
- `ExportJobsTable`
- `ExportStatusBadge`
- `DownloadActionCell`

### APIs
- `GET /exports`
- `GET /exports/:jobId`

---

## 6.15 Settings

### Routes
- `/settings`
- `/settings/profile`
- `/settings/tenant`

### Purpose
House operator-facing configuration, including active database targeting, prompt UI pointers, and secret vault status.

### Components
- `SettingsPage`
- `ProfileSettingsForm`
- `TenantSettingsPanel`
- `NotificationSettingsPanel`
- `DatabaseInstanceRegistry`
- `PromptUiInstanceRegistry`
- `SecretVaultStatusPanel`

### APIs
- `GET /me`
- `PATCH /me`
- `GET /tenants/:tenantId/settings`
- `PATCH /tenants/:tenantId/settings`
- `GET /settings/secret-vault`
- `GET /settings/database-instances`
- `POST /settings/database-instances`
- `PATCH /settings/database-instances/:id`
- `GET /settings/prompt-ui-instances`
- `POST /settings/prompt-ui-instances`
- `PATCH /settings/prompt-ui-instances/:id`

### Secret Vault Notes
- database target credentials follow the same vault-backed pattern as tenant LLM credentials
- the UI may accept either:
  - a raw connection string, which the backend should store in the admin vault
  - an external secret reference, when the secret already exists in another vault
- settings screens should display masked values, secret source, and reference metadata, but never the underlying plaintext secret

---

# 7. Shared Component Library

## 7.1 Layout and Shell
- `AppShell`
- `TopBar`
- `SideNav`
- `PageHeader`
- `TabNav`
- `Breadcrumbs`
- `SectionCard`

## 7.2 Status and Feedback
- `StatusBadge`
- `HealthBadge`
- `OnboardingBadge`
- `PermissionPill`
- `AlertBanner`
- `InlineError`
- `EmptyState`
- `LoadingSkeleton`

## 7.3 Data Display
- `DataTable`
- `KPIGrid`
- `MetricCard`
- `DetailList`
- `AuditTimeline`

## 7.4 Charts
- `LineChartCard`
- `BarChartCard`
- `StackedBarChartCard`
- `DistributionChartCard`
- `ChartLegend`

## 7.5 Filters and Controls
- `FilterBar`
- `SearchInput`
- `DateRangePicker`
- `ScopeSelector`
- `DimensionSelector`
- `MultiSelectField`

## 7.6 Forms
- `FormSection`
- `TextField`
- `SelectField`
- `MaskedSecretField`
- `ToggleField`
- `CheckboxMatrix`
- `SubmitBar`

## 7.7 Wizard-Specific
- `WizardStepper`
- `WizardStepFrame`
- `ChecklistPanel`
- `StepStatusList`
- `SaveDraftButton`

---

# 8. State Management

## 8.1 Global Client State
Use Zustand or Context for:

- authenticated user
- active role
- visible scopes
- current scope selection
- UI preferences
- current tenant context if pinned

### Suggested Stores
- `sessionStore`
- `scopeStore`
- `uiStore`

## 8.2 Server State
Use React Query for:

- dashboard summaries
- lists and tables
- detail views
- report results
- export jobs
- onboarding status
- LLM validation state

## 8.3 Form State
Use React Hook Form + Zod for:

- activation wizard steps
- admin create/edit
- tenant settings
- LLM config

---

# 9. Frontend RBAC and Guards

## 9.1 Route Guards
Every protected route must pass through:

- `RequireAuth`
- `RequirePermission`
- `RequireScope`

### Example Wrapper
- `ProtectedRoute`
  - verifies auth
  - verifies route permission
  - redirects to `/not-authorized` when needed

## 9.2 Component Guards
Use UI-level permission wrappers for action controls.

### Components
- `PermissionGate`
- `ScopeGate`

### Typical Usage
- hide create button if no `users.create`
- disable export button if no `analytics.export`
- hide operations nav if not internal HS role

## 9.3 Guarding Principles
- frontend guards improve UX only
- backend remains source of truth
- never rely solely on hidden buttons for security

---

# 10. API Integration Layer

## 10.1 API Modules
Create feature-oriented client modules:

- `authApi`
- `tenantsApi`
- `usersApi`
- `groupsApi`
- `adminsApi`
- `reportsApi`
- `exportsApi`
- `operationsApi`
- `llmConfigApi`
- `onboardingApi`

## 10.2 API Client Standards
- auth token injection
- standard error normalization
- retry only for safe reads
- consistent pagination handling
- typed request and response models

## 10.3 Query Key Strategy
Examples:
- `["dashboard", scope]`
- `["tenant", tenantId]`
- `["users", filters]`
- `["report", reportPayload]`

---

# 11. UX Behavior Rules

## 11.1 Core Rules
- every primary screen must support loading, empty, error, and success states
- all major lists must support filtering, sorting, and pagination
- all charts must have a corresponding table view
- scope and applied filters must always be visible
- statuses must always be visible for LLM config, onboarding, and user/admin state

## 11.2 Wizard Rules
- do not allow silent failure between steps
- preserve draft state between navigation events
- show validation errors inline
- use a checklist summary before activation

## 11.3 Reporting Rules
- report dimension selection changes scope picker behavior
- export must exactly match displayed filtered result set
- do not render massive raw tables without pagination or server-side filtering

## 11.4 Admin Editing Rules
- prevent accidental broad-scope assignment
- require explicit confirmation for destructive changes
- show consequences when deactivating tenants or admins

---

# 12. Screen-to-API Matrix Summary

| Screen | Primary APIs |
|---|---|
| Dashboard | `/dashboard/summary`, `/dashboard/trends`, `/dashboard/alerts` |
| Activation Wizard | `/tenants`, `/tenants/:id/llm-config`, `/tenants/:id/llm-config/validate`, `/settings/secret-vault`, `/groups`, `/users/import`, `/admins`, `/tenants/:id/activate` |
| Organizations List | `/tenants` |
| Org Detail Overview | `/analytics/tenant/:id/summary`, `/analytics/tenant/:id/trends` |
| Org Users | `/users?tenant_id=` |
| Org Groups | `/groups?tenant_id=` |
| Org Admins | `/admins?tenant_id=` |
| Org LLM Config | `/tenants/:id/llm-config`, `/tenants/:id/llm-config/validate` |
| Org Onboarding | `/tenants/:id/onboarding-status` |
| Users List | `/users` |
| User Detail | `/analytics/user/:id`, `/analytics/user/:id/trend`, `/users/:id/activity` |
| Groups | `/groups` |
| Group Detail | `/analytics/group/:id`, `/users?group_id=` |
| Admins | `/admins`, `/admins/:id` |
| Reports | `/reports/query`, `/exports` |
| Operations | `/system/overview`, `/system/issues`, `/system/trends` |
| Exports | `/exports`, `/exports/:jobId` |
| Settings | `/me`, `/tenants/:id/settings`, `/settings/secret-vault`, `/settings/database-instances`, `/settings/prompt-ui-instances` |

---

# 13. Implementation Priorities

## Phase 1
- app shell
- auth and route guards
- dashboard
- activation wizard
- organizations list/detail
- users list/detail

## Phase 2
- groups
- admins
- reports
- exports

## Phase 3
- operations
- advanced settings
- saved reports
- richer visualization polish

---

# 14. Deliverables This Spec Supports

This document should be used to drive:

- React route definitions
- feature folder scaffolding
- component inventory
- frontend engineering tickets
- API hook implementation
- QA test planning for route and permission behavior

---

# 15. Recommended Follow-On Artifacts

After this spec, the best supporting artifacts are:

1. page-level behavior spec
2. component contract spec
3. route permission matrix
4. API mock data pack
5. QA test scenarios by role and scope
