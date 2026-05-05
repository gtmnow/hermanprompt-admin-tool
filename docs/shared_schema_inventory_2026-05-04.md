# Shared Schema Inventory

- Audit date: `2026-05-04`
- Source systems reviewed: `Herman-Admin`, `herman_portal`, `herman-prompt`, `prompt_transformer`
- Live database basis: shared Railway Postgres schema, read-only inspection performed on `2026-05-04`
- Companion CSV: [shared_schema_inventory_2026-05-04.csv](/Users/michaelanderson/projects/Herman-Admin/docs/shared_schema_inventory_2026-05-04.csv)

## Columns

| Column | Meaning |
|---|---|
| `domain` | Functional area for the table |
| `primary_app_owner` | App that appears to own schema and write intent |
| `other_app_consumers` | Other apps that read or depend on the table |
| `role` | Table purpose |
| `authoritative_fields` | Fields that should be treated as source-of-truth |
| `duplicated_or_derived_fields` | Fields duplicated elsewhere or computed from other tables |
| `authority_status` | `authoritative`, `derived`, `shared_but_duplicated`, `broken_authority`, etc. |
| `live_schema_vs_code_status` | `aligned`, `live_drift_detected`, or `schema_code_mismatch` |
| `issue_tags` | Short machine-friendly drift labels |

## Inventory

| Table | Rows | Owner | Role | Authority Status | Status | Issue Tags |
|---|---:|---|---|---|---|---|
| `admin_audit_log` | 124 | `Herman-Admin` | audit_log | `authoritative` | `aligned` |  |
| `admin_permissions` | 54 | `Herman-Admin` | access_control | `authoritative` | `aligned` |  |
| `admin_profiles` | 9 | `Herman-Admin` | admin_profile | `duplicated` | `aligned` | `IDENTITY_DUPLICATION` |
| `admin_scopes` | 9 | `Herman-Admin` | access_control | `authoritative` | `aligned` |  |
| `admin_sessions` | 34 | `Herman-Admin` | session_state | `authoritative` | `aligned` |  |
| `admin_users` | 9 | `Herman-Admin` | admin_entitlement | `shared_but_duplicated` | `live_drift_detected` | `ADMIN_AUTH_ORPHANS`, `ADMIN_FLAG_OVERLAP` |
| `alembic_version` | 1 | `prompt_transformer` | migration_metadata | `authoritative` | `aligned` | `MULTI_MIGRATION_GOVERNANCE` |
| `alembic_version_herman_portal` | 1 | `herman_portal` | migration_metadata | `authoritative` | `aligned` | `MULTI_MIGRATION_GOVERNANCE` |
| `auth_mfa_challenges` | 34 | `herman_portal` | auth_mfa | `authoritative` | `aligned` |  |
| `auth_sessions` | 111 | `herman_portal` | portal_session | `authoritative` | `aligned` |  |
| `auth_user_credentials` | 14 | `herman_portal` | credential_store | `authoritative` | `aligned` | `LAST_LOGIN_DUPLICATION` |
| `auth_users` | 14 | `shared` | principal_identity | `shared_but_duplicated` | `aligned` | `USER_TENANT_AUTHORITY`, `ADMIN_FLAG_OVERLAP`, `IDENTITY_DUPLICATION` |
| `behaviorial_adj` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `brain_chemistry` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `conversation_folders` | 6 | `herman-prompt` | prompt_ui_state | `authoritative` | `aligned` | `PROMPT_SCHEMA_GOVERNANCE` |
| `conversation_prompt_scores` | 1271 | `prompt_transformer` | derived_scoring | `derived` | `live_drift_detected` | `SCORE_ORPHANS`, `UNOWNED_LIVE_COLUMNS` |
| `conversation_turns` | 97 | `herman-prompt` | turn_transcript | `authoritative_with_derived_columns` | `aligned` | `PROMPT_SCHEMA_GOVERNANCE` |
| `conversations` | 58 | `herman-prompt` | conversation_header | `authoritative_with_cached_copy` | `aligned` | `PROMPT_SCHEMA_GOVERNANCE` |
| `database_instance_configs` | 1 | `Herman-Admin` | ops_config | `authoritative` | `aligned` |  |
| `environment_details` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `feedback` | 1 | `herman-prompt` | response_feedback | `authoritative` | `aligned` | `FEEDBACK_LAYER_MISSING` |
| `final_profile` | 22 | `prompt_transformer` | effective_profile | `derived_runtime_authority` | `live_drift_detected` | `FINAL_PROFILE_STALENESS`, `PROFILE_LAYER_DUPLICATION` |
| `group_profiles` | 1 | `Herman-Admin` | group_metadata | `authoritative` | `aligned` |  |
| `groups` | 1 | `Herman-Admin` | group_registry | `authoritative` | `aligned` |  |
| `guide_me_sessions` | 54 | `herman-prompt` | workflow_state | `authoritative_with_derived_columns` | `aligned` | `PROMPT_SCHEMA_GOVERNANCE` |
| `password_reset_tokens` | 1 | `herman_portal` | reset_token_state | `broken_authority` | `schema_code_mismatch` | `PASSWORD_RESET_SCHEMA_DRIFT` |
| `platform_managed_llm_configs` | 3 | `Herman-Admin` | managed_llm_catalog | `authoritative` | `aligned` | `TENANT_LLM_DUPLICATION` |
| `prompt_transform_requests` | 12 | `prompt_transformer` | transform_request_log | `derived` | `live_drift_detected` | `PROMPT_REQUEST_ORPHANS` |
| `prompt_ui_instance_configs` | 1 | `Herman-Admin` | ops_config | `authoritative` | `aligned` |  |
| `report_export_jobs` | 2 | `Herman-Admin` | job_tracking | `authoritative` | `aligned` |  |
| `reseller_partners` | 2 | `Herman-Admin` | reseller_registry | `authoritative` | `aligned` |  |
| `reseller_tenant_defaults` | 2 | `Herman-Admin` | default_template | `template_not_runtime_authority` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `service_tier_definitions` | 7 | `Herman-Admin` | tier_catalog | `authoritative` | `aligned` |  |
| `tenant_llm_config` | 3 | `Herman-Admin` | tenant_llm_assignment | `authoritative_with_duplication` | `aligned` | `TENANT_LLM_DUPLICATION` |
| `tenant_onboarding_status` | 3 | `Herman-Admin` | operational_rollup | `derived_status_rollup` | `aligned` | `DERIVED_ONBOARDING_STATE` |
| `tenant_portal_configs` | 3 | `Herman-Admin` | tenant_branding | `authoritative` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `tenant_profiles` | 3 | `Herman-Admin` | tenant_metadata | `authoritative_with_derived_columns` | `aligned` |  |
| `tenant_runtime_settings` | 3 | `Herman-Admin` | tenant_policy | `authoritative` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `tenants` | 3 | `Herman-Admin` | tenant_registry | `authoritative` | `aligned` | `PLAN_TIER_DUPLICATION` |
| `type_detail` | 39 | `prompt_transformer` | foundational_profile | `foundational_authority` | `live_drift_detected` | `PROFILE_LAYER_DUPLICATION`, `FINAL_PROFILE_STALENESS` |
| `user_group_membership` | 0 | `Herman-Admin` | membership | `authoritative` | `aligned` | `USER_TENANT_AUTHORITY` |
| `user_invitations` | 10 | `Herman-Admin` | invitation_lifecycle | `shared_but_ambiguous` | `live_drift_detected` | `INVITATION_HISTORY_STATE_CONFLICT`, `PORTAL_INVITATION_QUERY_DRIFT` |
| `user_membership_profiles` | 6 | `Herman-Admin` | membership_profile | `duplicated` | `aligned` | `IDENTITY_DUPLICATION`, `DERIVED_USAGE_FIELDS` |
| `user_tenant_membership` | 6 | `Herman-Admin` | membership | `shared_but_duplicated` | `aligned` | `USER_TENANT_AUTHORITY` |
| `vault_secrets` | 6 | `Herman-Admin` | secret_store | `authoritative` | `aligned` |  |

## Key Issue Tags

- `PASSWORD_RESET_SCHEMA_DRIFT`: live `password_reset_tokens` schema does not match current portal code.
- `PORTAL_INVITATION_QUERY_DRIFT`: portal code does not currently read the live authoritative invitation lifecycle columns it depends on.
- `INVITATION_HISTORY_STATE_CONFLICT`: `user_invitations` is mixing current-state and historical invitation records.
- `USER_TENANT_AUTHORITY`: user-to-tenant authority is split between `auth_users.tenant_id` and `user_tenant_membership`.
- `ADMIN_FLAG_OVERLAP`: admin status exists in both `auth_users.is_admin` and `admin_users`.
- `ADMIN_AUTH_ORPHANS`: live admin rows exist without matching auth principals.
- `PROFILE_LAYER_DUPLICATION`: profile-layer tables intentionally duplicate shape but need stricter ownership/lifecycle rules.
- `FINAL_PROFILE_STALENESS`: `final_profile` is runtime-critical but derived, and live rows do not cleanly reconcile with foundational layers.
- `SCORE_ORPHANS`: derived scoring rows outlive or outnumber canonical conversations.
- `PROMPT_REQUEST_ORPHANS`: request-log rows reference missing conversations.
- `UNOWNED_LIVE_COLUMNS`: live columns exist without a matching current ORM owner.
- `DEFAULTS_DUPLICATE_RUNTIME`: reseller defaults duplicate tenant runtime tables and portal/LLM settings.
- `MULTI_MIGRATION_GOVERNANCE`: multiple incompatible schema-management patterns are active in one shared database.
- `PROMPT_SCHEMA_GOVERNANCE`: prompt schema is managed by startup DDL rather than a formal migration stream.
- `FEEDBACK_LAYER_MISSING`: docs/code refer to a feedback-adjustment layer table that does not exist in the live schema.

## Immediate Follow-Up Candidates

- Normalize authority between `auth_users.tenant_id` and `user_tenant_membership`.
- Decide whether `user_invitations` is a state table or a history table.
- Repair `password_reset_tokens` to match portal code and intended ownership.
- Formalize schema governance for `Herman-Admin` and `herman-prompt`.
- Define recompute and freshness rules for `type_detail` and `final_profile`.
