# HermanScience Admin Portal – Full Use Case Catalog

## Structure
Each use case includes:
- Actor
- What they know
- What they want to accomplish
- Why it matters

---

# 1. Partner (Reseller) Activation

## 1.1 Create a Reseller Partner Tenant
Actor: HermanScience Super Admin
Knows: New partner agreement, partner details
Goal: Create reseller tenant and assign admins
Why: Enables partner-led distribution

## 1.2 Assign Reseller Portfolio Scope
Actor: HermanScience Super Admin
Knows: Portfolio ownership rules
Goal: Define which tenants belong to reseller
Why: Ensures isolation and correct ownership

## 1.3 Grant Reseller Admin Capabilities
Actor: HermanScience Super Admin
Knows: Desired autonomy level
Goal: Allow tenant creation, restrict escalation
Why: Secure delegation model

## 1.4 Initialize Reseller Defaults
Actor: HermanScience Super Admin
Knows: Best practices
Goal: Preconfigure defaults/templates
Why: Faster onboarding consistency

---

# 2. Customer Tenant Activation

## 2.1 Create Customer Tenant
Actor: Reseller or HermanScience
Knows: Customer info
Goal: Create tenant under correct scope
Why: Start onboarding

## 2.2 Configure LLM Provider
Actor: Reseller or Tenant Admin
Knows: Provider + credentials
Goal: Configure LLM access
Why: Required for functionality

## 2.3 Validate LLM Configuration
Actor: Reseller or Tenant Admin
Knows: Credentials entered
Goal: Test connection
Why: Prevent activation failure

## 2.4 Define Runtime Settings
Actor: Tenant Admin
Knows: Org policies
Goal: Configure enforcement + retention
Why: Controls system behavior

## 2.5 Create Groups
Actor: Tenant Admin
Knows: Org structure
Goal: Create group hierarchy
Why: Enables segmentation

## 2.6 Import Users
Actor: Tenant Admin
Knows: User list
Goal: Bulk upload users
Why: Drives adoption

## 2.7 Assign Admins
Actor: Tenant Admin or Reseller
Knows: Admin candidates
Goal: Assign roles/scopes
Why: Delegation

## 2.8 Monitor Onboarding
Actor: Reseller or HermanScience
Knows: Partial setup
Goal: Track progress
Why: Avoid stalled onboarding

## 2.9 Activate Tenant
Actor: Reseller or HermanScience
Knows: Setup complete
Goal: Activate tenant
Why: Enable usage

---

# 3. User & Access Management

## 3.1 Manage Users
Actor: Tenant Admin
Goal: Update status, groups
Why: Maintain accuracy

## 3.2 Manage Groups
Actor: Tenant or Group Admin
Goal: Update group structure
Why: Organization + reporting

## 3.3 Manage Admin Roles
Actor: Tenant Admin
Goal: Assign permissions
Why: Security enforcement

---

# 4. Reporting & Analytics

## 4.1 View Dashboard
Actor: Tenant Admin
Goal: Monitor KPIs
Why: Value visibility

## 4.2 Analyze Prompt Quality
Actor: Analyst
Goal: Measure improvement
Why: Core value proof

## 4.3 Identify Behavior Gaps
Actor: Analyst
Goal: Detect issues
Why: Drive improvement

## 4.4 Generate Reports
Actor: Admin
Goal: Create reports
Why: Analysis + communication

## 4.5 Export Reports
Actor: Admin
Goal: Export CSV/PDF
Why: Share results

---

# 5. Reseller Portfolio Management

## 5.1 Manage Portfolio
Actor: Reseller
Goal: View all tenants
Why: Centralized control

## 5.2 Monitor Portfolio Health
Actor: Reseller
Goal: Identify inactive/misconfigured tenants
Why: Improve success rates

---

# 6. Operations & Support

## 6.1 Investigate Issues
Actor: HermanScience or Reseller
Goal: Diagnose tenant problems
Why: Reduce churn

## 6.2 Audit Actions
Actor: Admin
Goal: Review audit logs
Why: Compliance

---

# 7. Edge Cases

## 7.1 Reassign Tenant
Actor: HermanScience
Goal: Move tenant between resellers
Why: Business flexibility

## 7.2 Override Activation
Actor: HermanScience
Goal: Bypass requirements
Why: Resolve blockers

## 7.3 Partial Onboarding
Actor: Reseller
Goal: Setup without LLM
Why: Real-world delays

## 7.4 Service Mode Activation
Actor: Admin
Goal: Activate minimally
Why: Phased rollout

---

# 8. Cross-Scope Behavior

## 8.1 Scoped Reporting
Actors: All roles
Goal: View data within scope
Why: Security + relevance

## 8.2 Scoped Investigation
Actors: All roles
Goal: Diagnose within scope
Why: Controlled access

---

# END
