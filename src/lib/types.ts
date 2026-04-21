export type ResourceEnvelope<T> = {
  resource: T;
  updated_at: string;
};

export type ListEnvelope<T> = {
  items: T[];
  page: number;
  page_size: number;
  total_count: number;
  filters: Record<string, string | number | boolean | null>;
};

export type TenantStatus = "draft" | "onboarding" | "active" | "suspended" | "inactive";
export type OnboardingStatus = "draft" | "in_progress" | "ready" | "live";

export type Tenant = {
  id: string;
  tenant_name: string;
  tenant_key: string;
  reseller_partner_id: string | null;
  status: TenantStatus;
  plan_tier: string | null;
  reporting_timezone: string;
  external_customer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantLLMConfig = {
  provider_type: string;
  model_name: string;
  endpoint_url: string | null;
  api_key_masked: string | null;
  secret_reference: string | null;
  secret_source: "vault_managed" | "external_reference" | "none";
  vault_provider: string | null;
  platform_managed_config_id: string | null;
  credential_mode: "platform_managed" | "customer_managed";
  credential_status: "unvalidated" | "valid" | "invalid" | "suspended";
  transformation_enabled: boolean;
  scoring_enabled: boolean;
  last_validated_at: string | null;
  last_validation_message: string | null;
};

export type TenantRuntimeSettings = {
  enforcement_mode: "advisory" | "coaching" | "enforced";
  reporting_enabled: boolean;
  export_enabled: boolean;
  raw_prompt_retention_enabled: boolean;
  raw_prompt_admin_visibility: boolean;
  data_retention_days: number | null;
  feature_flags_json: Record<string, string | number | boolean>;
};

export type TenantProfile = {
  organization_type: string | null;
  industry: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  service_mode: string | null;
  deployment_notes: string | null;
  last_activity_at: string | null;
  utilization_pct: number | null;
};

export type TenantPortalConfig = {
  id: string | null;
  portal_base_url: string;
  logo_url: string | null;
  welcome_message: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type TenantSummary = {
  tenant: Tenant;
  profile: TenantProfile | null;
  portal_config: TenantPortalConfig | null;
  llm_config: TenantLLMConfig | null;
  runtime_settings: TenantRuntimeSettings | null;
};

export type TenantOnboarding = {
  tenant_id: string;
  tenant_created: boolean;
  llm_configured: boolean;
  llm_validated: boolean;
  groups_created: boolean;
  users_uploaded: boolean;
  admin_assigned: boolean;
  first_login_detected: boolean;
  first_transform_detected: boolean;
  first_score_detected: boolean;
  onboarding_status: OnboardingStatus;
  updated_at: string;
};

export type TenantValidationResult = {
  validation_result: "unvalidated" | "valid" | "invalid" | "suspended";
  provider_echo: string;
  model_accessible: boolean;
  latency_ms: number | null;
  message: string | null;
};

export type UserMembership = {
  id: string;
  user_id_hash: string;
  tenant_id: string;
  status: "invited" | "active" | "inactive" | "suspended" | "deleted";
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  group_memberships: Array<{ group_id: string }>;
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    title: string | null;
    utilization_level: string | null;
    sessions_count: number;
    avg_improvement_pct: number | null;
    last_activity_at: string | null;
  } | null;
};

export type Group = {
  id: string;
  tenant_id: string;
  group_name: string;
  group_type: string | null;
  parent_group_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile: {
    description: string | null;
    business_unit: string | null;
    owner_name: string | null;
  } | null;
};

export type AdminScope = {
  id: string;
  scope_type: "global" | "reseller" | "tenant" | "group";
  reseller_partner_id: string | null;
  tenant_id: string | null;
  group_id: string | null;
  created_at: string;
};

export type AdminUser = {
  id: string;
  user_id_hash: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  permissions: Array<{ permission_key: string }>;
  scopes: AdminScope[];
  profile: {
    display_name: string | null;
    email: string | null;
  } | null;
};

export type DatabaseInstanceConfig = {
  id: string;
  label: string;
  db_kind: string;
  host: string | null;
  database_name: string | null;
  connection_string_masked: string | null;
  connection_secret_reference: string | null;
  secret_source: "vault_managed" | "external_reference" | "none";
  vault_provider: string | null;
  notes: string | null;
  is_active: boolean;
  managed_via_db_only: boolean;
  created_at: string;
  updated_at: string;
};

export type SecretVaultStatus = {
  provider: string;
  display_name: string;
  configured: boolean;
  writable: boolean;
  reference_prefix: string;
  key_source: string;
  azure_key_vault_url: string | null;
  managed_secret_count: number;
  warnings: string[];
};

export type PromptUiInstanceConfig = {
  id: string;
  label: string;
  base_url: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PlatformManagedLlmConfig = {
  id: string;
  label: string;
  provider_type: string;
  model_name: string;
  endpoint_url: string | null;
  api_key_masked: string | null;
  secret_reference: string | null;
  secret_source: "vault_managed" | "external_reference" | "none";
  vault_provider: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportSummary = {
  report_type: string;
  filters: {
    scope_type: "individual" | "group" | "organization" | "reseller" | "global";
    scope_id: string;
    start_date: string;
    end_date: string;
    include_csv_export: boolean;
  };
  kpis: Array<{ label: string; value: string | number; delta?: string | number | null }>;
  charts: Array<{
    label: string;
    points: Array<{ bucket: string; value: number | null }>;
  }>;
  tables: Array<Record<string, string | number | null>>;
  export_formats: string[];
};

export type SystemOverview = {
  tenant_count: number;
  active_tenant_count: number;
  reseller_count: number;
  active_user_count: number;
  active_group_count: number;
  invalid_credential_count: number;
  stalled_onboarding_count: number;
};

export type ReportExportJob = {
  id: string;
  report_type: string;
  scope_type: string;
  scope_id: string;
  format: "csv" | "pdf";
  status: string;
  file_path: string | null;
  created_at: string;
  completed_at: string | null;
};
