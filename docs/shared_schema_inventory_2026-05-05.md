# Shared Schema Inventory

- Audit date: `2026-05-05`
- Canonical schema revision: `20260505_0013`
- Source systems reviewed: `Herman-Admin`, `herman_portal`, `herman-prompt`, `prompt_transformer`, `herman-db`
- Live database basis: shared Railway Postgres staging schema, inspected after applying `20260505_0013` on `2026-05-05`
- This snapshot supersedes the historical `2026-05-04` drift inventory for current-state discussion.
- Companion CSV: [shared_schema_inventory_2026-05-05.csv](/Users/michaelanderson/projects/Herman-Admin/docs/shared_schema_inventory_2026-05-05.csv)

## Post-0013 Highlights

- `admin_profiles` has been retired and no longer exists in the shared schema.
- `auth_users.is_admin` has been removed; `admin_users` is the sole admin-entitlement table.
- `password_reset_tokens` is aligned on `user_id_hash`.
- `user_tenant_membership` is authoritative; `auth_users.tenant_id` is a derived compatibility pointer with zero staging mismatches.
- `tenant_llm_config` platform-managed rows no longer store duplicated `provider_type`, `model_name`, or `endpoint_url` values.
- `final_profile` and `type_detail` reconcile cleanly in staging (`0` gaps in either direction).
- Derived orphan retention is now explicit: `conversation_prompt_scores` uses `conversation_deleted_at`, and `prompt_transform_requests` uses metadata retention markers.

## Columns

| Column | Meaning |
|---|---|
| `domain` | Functional area for the table |
| `primary_app_owner` | App or project that owns schema and write intent |
| `other_app_consumers` | Other apps that read or depend on the table |
| `role` | Table purpose |
| `authoritative_fields` | Fields that should be treated as source-of-truth |
| `duplicated_or_derived_fields` | Fields duplicated elsewhere or computed from other tables |
| `authority_status` | Current authority pattern such as `authoritative`, `derived`, `overlay_layer`, `legacy_metadata` |
| `live_schema_vs_code_status` | Current state such as `aligned` or `legacy_retained` |
| `issue_tags` | Machine-friendly structural notes or remaining cleanup tags |

## Inventory

| Table | Rows | Owner | Role | Authority Status | Status | Issue Tags |
|---|---:|---|---|---|---|---|
| `admin_audit_log` | 124 | `Herman-Admin` | audit_log | `authoritative` | `aligned` |  |
| `admin_permissions` | 54 | `Herman-Admin` | access_control | `authoritative` | `aligned` |  |
| `admin_scopes` | 9 | `Herman-Admin` | access_control | `authoritative` | `aligned` |  |
| `admin_sessions` | 34 | `Herman-Admin` | session_state | `authoritative` | `aligned` |  |
| `admin_users` | 9 | `Herman-Admin` | admin_entitlement | `authoritative` | `aligned` |  |
| `alembic_version` | 1 | `herman-db` | migration_metadata | `authoritative` | `aligned` |  |
| `alembic_version_herman_portal` | 1 | `legacy` | migration_metadata | `legacy_metadata` | `legacy_retained` | `LEGACY_MIGRATION_METADATA` |
| `auth_mfa_challenges` | 34 | `herman_portal` | auth_mfa | `authoritative` | `aligned` |  |
| `auth_sessions` | 114 | `herman_portal` | portal_session | `authoritative` | `aligned` |  |
| `auth_user_credentials` | 14 | `herman_portal` | credential_store | `authoritative` | `aligned` | `LAST_LOGIN_DUPLICATION` |
| `auth_users` | 16 | `shared` | principal_identity | `authoritative_with_derived_pointer` | `aligned` | `DERIVED_PRIMARY_TENANT_POINTER|IDENTITY_DUPLICATION` |
| `behaviorial_adj` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION|TABLE_NAMING_DRIFT` |
| `brain_chemistry` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `conversation_folders` | 6 | `herman-prompt` | prompt_ui_state | `authoritative` | `aligned` |  |
| `conversation_prompt_scores` | 1277 | `prompt_transformer` | derived_scoring | `derived` | `aligned` | `DERIVED_RETENTION_TRACKED` |
| `conversation_turns` | 101 | `herman-prompt` | turn_transcript | `authoritative_with_derived_columns` | `aligned` |  |
| `conversations` | 62 | `herman-prompt` | conversation_header | `authoritative_with_cached_copy` | `aligned` |  |
| `database_instance_configs` | 1 | `Herman-Admin` | ops_config | `authoritative` | `aligned` |  |
| `environment_details` | 9 | `prompt_transformer` | profile_layer | `overlay_layer` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `feedback` | 1 | `herman-prompt` | response_feedback | `authoritative` | `aligned` |  |
| `final_profile` | 47 | `prompt_transformer` | effective_profile | `derived_runtime_authority` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `group_profiles` | 1 | `Herman-Admin` | group_metadata | `authoritative` | `aligned` |  |
| `groups` | 1 | `Herman-Admin` | group_registry | `authoritative` | `aligned` |  |
| `guide_me_sessions` | 56 | `herman-prompt` | workflow_state | `authoritative_with_derived_columns` | `aligned` |  |
| `password_reset_tokens` | 1 | `herman_portal` | reset_token_state | `authoritative` | `aligned` |  |
| `platform_managed_llm_configs` | 3 | `Herman-Admin` | managed_llm_catalog | `authoritative` | `aligned` |  |
| `prompt_transform_requests` | 29 | `prompt_transformer` | transform_request_log | `derived` | `aligned` | `DERIVED_RETENTION_TRACKED` |
| `prompt_ui_instance_configs` | 1 | `Herman-Admin` | ops_config | `authoritative` | `aligned` |  |
| `report_export_jobs` | 2 | `Herman-Admin` | job_tracking | `authoritative` | `aligned` |  |
| `reseller_partners` | 2 | `Herman-Admin` | reseller_registry | `authoritative` | `aligned` |  |
| `reseller_tenant_defaults` | 2 | `Herman-Admin` | default_template | `template_not_runtime_authority` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `service_tier_definitions` | 7 | `Herman-Admin` | tier_catalog | `authoritative` | `aligned` |  |
| `tenant_llm_config` | 3 | `Herman-Admin` | tenant_llm_assignment | `authoritative_normalized` | `aligned` | `CUSTOMER_MANAGED_ONLY_FIELDS` |
| `tenant_onboarding_status` | 3 | `Herman-Admin` | operational_rollup | `derived_status_rollup` | `aligned` | `DERIVED_ONBOARDING_STATE` |
| `tenant_portal_configs` | 3 | `Herman-Admin` | tenant_branding | `authoritative` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `tenant_profiles` | 3 | `Herman-Admin` | tenant_metadata | `authoritative_with_derived_columns` | `aligned` |  |
| `tenant_runtime_settings` | 3 | `Herman-Admin` | tenant_policy | `authoritative` | `aligned` | `DEFAULTS_DUPLICATE_RUNTIME` |
| `tenants` | 3 | `Herman-Admin` | tenant_registry | `authoritative` | `aligned` | `PLAN_TIER_DUPLICATION` |
| `type_detail` | 47 | `prompt_transformer` | foundational_profile | `foundational_authority` | `aligned` | `PROFILE_LAYER_DUPLICATION` |
| `user_group_membership` | 0 | `Herman-Admin` | membership | `authoritative` | `aligned` |  |
| `user_invitations` | 10 | `Herman-Admin` | invitation_lifecycle | `current_state_plus_history` | `aligned` | `CURRENT_STATE_PLUS_HISTORY` |
| `user_membership_profiles` | 6 | `Herman-Admin` | membership_profile | `duplicated` | `aligned` | `IDENTITY_DUPLICATION|DERIVED_USAGE_FIELDS` |
| `user_tenant_membership` | 6 | `Herman-Admin` | membership | `authoritative` | `aligned` |  |
| `vault_secrets` | 6 | `Herman-Admin` | secret_store | `authoritative` | `aligned` |  |

## Remaining Structural Notes

- `alembic_version_herman_portal` remains in the schema as legacy migration metadata, but `herman-db` now owns the canonical shared migration stream.
- The profile-layer family still intentionally duplicates shape across `type_detail`, `brain_chemistry`, `environment_details`, `behaviorial_adj`, and `final_profile`; lifecycle governance is now cleaner, but the shape duplication remains architectural.
- `reseller_tenant_defaults` still structurally overlaps tenant runtime, portal, and LLM settings, even though current staging data does not show active platform-managed duplication rows.
- `user_membership_profiles` still mixes membership-specific metadata with duplicated identity and derived usage fields.

## Verification Metrics

- `admin_profiles_exists = 0`
- `auth_users.is_admin_exists = 0`
- `password_reset_tokens.user_id_hash_exists = 1`
- `password_reset_tokens.user_id_exists = 0`
- `admin_orphans = 0`
- `tenant_pointer_mismatches = 0`
- `current_invitation_rows = 6`
- `duplicate_current_invitations = 0`
- `final_without_type = 0`
- `type_without_final = 0`
- `platform_managed_dup_provider_notnull = 0`
- `platform_managed_dup_model_notnull = 0`
- `platform_managed_dup_endpoint_notnull = 0`
- `scores_missing_conversation = 1224` with `scores_marked_deleted = 1224`
- `requests_missing_conversation = 9` with retention metadata markers present on sampled orphan rows
