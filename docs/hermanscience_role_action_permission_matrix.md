# HermanScience Admin Portal – Role × Action Permission Matrix

## Purpose
This matrix maps the major administrative actions in the HermanScience Admin Portal to the roles that may perform them.

## Roles
- **HSA-SA** = HermanScience Super Admin
- **HSA-Support** = HermanScience Support Admin
- **Reseller-SA** = Partner Reseller Super User
- **Tenant-Admin** = Tenant Admin
- **Group-Admin** = Group Admin
- **Analyst-RO** = Read-Only Analyst

## Permission Legend
- **Full** = can perform the action within role scope
- **Limited** = can perform only in explicitly allowed cases or limited scope
- **View** = can view but not modify
- **No** = not allowed

## Scope Notes
- All permissions are still constrained by scope.
- No role may create or assign authority broader than its own.
- Reseller roles are limited to their own portfolio.
- Tenant roles are limited to their own tenant.
- Group roles are limited to assigned groups.
- Support access may require explicit grant depending on implementation.

---

## 1. Tenant and Reseller Administration

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| Create reseller partner tenant | Full | No | No | No | No | No |
| Edit reseller partner tenant metadata | Full | Limited | No | No | No | No |
| Assign reseller portfolio scope | Full | No | No | No | No | No |
| Reassign tenant to different reseller | Full | No | No | No | No | No |
| Create customer tenant | Full | No | Full | No | No | No |
| Edit customer tenant metadata | Full | Limited | Full | Limited | No | No |
| Change tenant status (draft, onboarding, active, suspended, inactive) | Full | Limited | Full | Limited | No | No |
| Activate tenant | Full | Limited | Full | Limited | No | No |
| Override activation gating rules | Full | Limited | No | No | No | No |
| Suspend or deactivate tenant | Full | Limited | Full | Limited | No | No |
| View tenant list in scope | Full | View | View | View | No | View |

---

## 2. Onboarding and Activation Workflow

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| Start onboarding workflow | Full | Limited | Full | Limited | No | No |
| View onboarding checklist | Full | View | View | View | No | View |
| Mark onboarding steps complete through actual configuration actions | Full | Limited | Full | Full | No | No |
| Review readiness blockers | Full | View | View | View | No | View |
| Activate tenant after gates pass | Full | Limited | Full | Limited | No | No |
| Operate tenant in partial onboarding state | Full | Limited | Full | Limited | No | No |

---

## 3. Runtime Configuration and LLM Setup

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View tenant LLM config summary | Full | View | View | View | No | No |
| Create or update tenant LLM config | Full | Limited | Full | Limited | No | No |
| Enter customer-managed API key | Full | Limited | Full | Limited | No | No |
| Rotate LLM credentials | Full | Limited | Full | Limited | No | No |
| Validate provider connectivity | Full | Limited | Full | Limited | No | No |
| Change provider/model/endpoint | Full | Limited | Full | Limited | No | No |
| Enable transformation | Full | Limited | Full | Limited | No | No |
| Disable transformation | Full | Limited | Full | Limited | No | No |
| Enable scoring | Full | Limited | Full | Limited | No | No |
| Disable scoring | Full | Limited | Full | Limited | No | No |
| Update runtime settings (enforcement, retention, export flags) | Full | Limited | Full | Limited | No | No |
| View masked credential status and validation results | Full | View | View | View | No | View |

---

## 4. User Management

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View users in scope | Full | View | View | View | View | View |
| Create or invite user | Full | Limited | Full | Full | Limited | No |
| Edit user status | Full | Limited | Full | Full | Limited | No |
| Suspend user | Full | Limited | Full | Full | Limited | No |
| Reactivate user | Full | Limited | Full | Full | Limited | No |
| Delete or soft-delete user membership | Full | Limited | Full | Full | No | No |
| View user detail page | Full | View | View | View | View | View |
| Update tenant membership attributes | Full | Limited | Full | Full | No | No |
| Move user across tenants | No | No | No | No | No | No |
| Bulk import users by CSV | Full | Limited | Full | Full | No | No |
| View import job status | Full | View | View | View | No | View |
| View row-level import errors | Full | View | View | View | No | View |

---

## 5. Group Management

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View groups in scope | Full | View | View | View | View | View |
| Create group | Full | Limited | Full | Full | Limited | No |
| Edit group metadata | Full | Limited | Full | Full | Limited | No |
| Reassign group parent within tenant | Full | Limited | Full | Full | No | No |
| Activate/deactivate group | Full | Limited | Full | Full | Limited | No |
| Assign users to groups | Full | Limited | Full | Full | Full | No |
| Remove users from groups | Full | Limited | Full | Full | Full | No |
| View group detail analytics | Full | View | View | View | View | View |

---

## 6. Admin and Role Delegation

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View admin users in scope | Full | View | View | View | No | View |
| Create HermanScience global admin | Full | No | No | No | No | No |
| Create reseller-scoped admin | Full | No | Limited | No | No | No |
| Create tenant-scoped admin | Full | Limited | Full | Full | No | No |
| Create group-scoped admin | Full | Limited | Full | Full | Limited | No |
| Edit admin permissions | Full | Limited | Limited | Limited | No | No |
| Edit admin scopes | Full | Limited | Limited | Limited | No | No |
| Deactivate admin | Full | Limited | Limited | Limited | No | No |
| Assign permissions broader than own delegable set | No | No | No | No | No | No |
| Assign scope broader than own scope | No | No | No | No | No | No |

---

## 7. Reporting and Analytics

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View dashboard KPIs in scope | Full | View | View | View | View | View |
| Run user-level reports | Full | View | View | View | View | View |
| Run group-level reports | Full | View | View | View | View | View |
| Run tenant-level reports | Full | View | View | View | No | View |
| Run reseller portfolio reports | Full | View | View | No | No | View |
| Run all-organization global reports | Full | View | No | No | No | No |
| View adoption reports | Full | View | View | View | View | View |
| View prompt quality reports | Full | View | View | View | View | View |
| View behavior gap reports | Full | View | View | View | View | View |
| View ROI evidence reports | Full | View | View | View | Limited | View |
| View system performance reports | Full | View | Limited | No | No | No |

---

## 8. Exports

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| Export user-scoped report data | Full | Limited | Full | Full | Limited | Limited |
| Export group-scoped report data | Full | Limited | Full | Full | Limited | Limited |
| Export tenant-scoped report data | Full | Limited | Full | Full | No | Limited |
| Export reseller portfolio data | Full | Limited | Full | No | No | No |
| Export global cross-tenant data | Full | Limited | No | No | No | No |
| View export job status | Full | View | View | View | View | View |
| Download completed export in scope | Full | Limited | Full | Full | Limited | Limited |

---

## 9. Operations, Support, and Audit

| Action | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| View system overview | Full | View | No | No | No | No |
| View system health | Full | View | Limited | No | No | No |
| View invalid credential counts | Full | View | View | View | No | View |
| View failed import jobs | Full | View | View | View | No | View |
| View failed export jobs | Full | View | View | View | No | View |
| Investigate tenant setup issues | Full | View | View | View | No | View |
| View audit log in scope | Full | View | View | View | No | Limited |
| Export audit log | Full | Limited | Limited | Limited | No | No |
| Access request IDs and diagnostics | Full | View | Limited | No | No | No |

---

## 10. Explicit Anti-Escalation Rules

| Rule | HSA-SA | HSA-Support | Reseller-SA | Tenant-Admin | Group-Admin | Analyst-RO |
|---|---|---:|---:|---:|---:|---:|
| Can create admin broader than own authority | No | No | No | No | No | No |
| Can assign global scope without explicit global permission | Limited | No | No | No | No | No |
| Can create reseller-scoped entity outside own portfolio | No | No | No | No | No | No |
| Can create tenant-scoped entity outside own scope | No | No | No | No | No | No |
| Can view cross-reseller data without global role | No | No | No | No | No | No |
| Can view cross-tenant data outside explicit authorization | No | No | No | No | No | No |

---

## Recommended Interpretation Notes

### HermanScience Super Admin
Full operational authority across the platform, including reseller creation, tenant reassignment, activation overrides, global reports, and internal health views.

### HermanScience Support Admin
Primarily read/support access. Write/remediation actions should be narrow, explicit, and auditable.

### Reseller Super User
Portfolio operator. Can create and manage customer tenants, but cannot create new reseller tenants or cross reseller boundaries.

### Tenant Admin
Organization operator. Can manage users, groups, tenant-scoped admins, reports, and allowed runtime settings within one tenant.

### Group Admin
Narrow manager role. Best suited for membership and group reporting tasks, not broad administration.

### Read-Only Analyst
Analysis role only. Can view reports and, if allowed, export within scope. No write actions.

---

## Open Product Decisions to Confirm
These items should be finalized in product policy because they change implementation details:

1. Should **Tenant Admin** be allowed to activate a tenant, or should activation be restricted to Reseller and HermanScience roles?
2. Should **Tenant Admin** be allowed to modify runtime settings and LLM configuration, or should those be reseller-controlled after initial setup?
3. Should **Group Admin** be allowed to create groups, or only manage membership inside existing groups?
4. Should **Read-Only Analyst** be allowed to export reports by default, or only view them?
5. Should **HermanScience Support Admin** be allowed to perform limited write remediation, or remain read-mostly?

---

## Suggested Next Artifact
The best companion document to this matrix is a **Role × Screen × Action matrix** that maps:
- who can see each screen
- which controls are enabled or hidden
- which actions should be blocked server-side even if exposed in UI

