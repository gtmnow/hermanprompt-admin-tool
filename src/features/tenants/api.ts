import { api } from "../../lib/api";
import { getRangeWindow, type DashboardRangeKey } from "../dashboard/api";
import type {
  AdminUser,
  DatabaseInstanceConfig,
  Group,
  ListEnvelope,
  PlatformManagedLlmConfig,
  PromptUiInstanceConfig,
  ReportSummary,
  ResourceEnvelope,
  SecretVaultStatus,
  TenantOnboarding,
  TenantPortalConfig,
  TenantSummary,
  TenantValidationResult,
  UserMembership,
} from "../../lib/types";

export const tenantApi = {
  listTenants() {
    return api.getList<TenantSummary>("/tenants");
  },
  getTenant(tenantId: string) {
    return api.getResource<TenantSummary>(`/tenants/${tenantId}`);
  },
  createTenant(payload: {
    tenant_name: string;
    tenant_key: string;
    plan_tier: string | null;
    reporting_timezone: string;
    reseller_partner_id: string | null;
    status: "draft" | "onboarding";
    external_customer_id: string | null;
    organization_type?: string | null;
    industry?: string | null;
    primary_contact_name?: string | null;
    primary_contact_email?: string | null;
    service_mode?: string | null;
    deployment_notes?: string | null;
  }) {
    return api.postResource<TenantSummary>("/tenants", payload);
  },
  updateTenant(tenantId: string, payload: Record<string, unknown>) {
    return api.patchResource<TenantSummary>(`/tenants/${tenantId}`, payload);
  },
  getTenantOnboarding(tenantId: string) {
    return api.getResource<TenantOnboarding>(`/onboarding/tenants/${tenantId}`);
  },
  getPortalConfig(tenantId: string) {
    return api.getResource<TenantPortalConfig>(`/tenants/${tenantId}/portal-config`);
  },
  updatePortalConfig(tenantId: string, payload: Record<string, unknown>) {
    return api.putResource<TenantPortalConfig>(`/tenants/${tenantId}/portal-config`, payload);
  },
  listOnboarding() {
    return api.getList<TenantOnboarding>("/onboarding/tenants");
  },
  getUsers(tenantId?: string) {
    const query = tenantId ? `?tenant_id=${tenantId}` : "";
    return api.getList<UserMembership>(`/users${query}`);
  },
  getGroups(tenantId?: string) {
    const query = tenantId ? `?tenant_id=${tenantId}` : "";
    return api.getList<Group>(`/groups${query}`);
  },
  getAdmins() {
    return api.getList<AdminUser>("/admins");
  },
  getReport(
    tenantId: string,
    rangeKey: DashboardRangeKey = "30d",
    dimension: "organization" | "global" = "organization",
  ) {
    const window = getRangeWindow(rangeKey);
    return api.postResource<ReportSummary>("/reports/run", {
      report_type: "utilization",
      dimension,
      scope_id: tenantId,
      filters: {},
      start_date: window.start,
      end_date: window.end,
      visualization_preferences: {},
    });
  },
  getLlmConfig(tenantId: string) {
    return api.getResource<TenantSummary["llm_config"]>(`/tenants/${tenantId}/llm-config`);
  },
  putLlmConfig(tenantId: string, payload: Record<string, unknown>) {
    return api.putResource(`/tenants/${tenantId}/llm-config`, payload);
  },
  validateLlmConfig(tenantId: string) {
    return api.postResource<TenantValidationResult>(`/tenants/${tenantId}/llm-config/validate`, {});
  },
  getRuntimeSettings(tenantId: string) {
    return api.getResource<TenantSummary["runtime_settings"]>(`/tenants/${tenantId}/runtime-settings`);
  },
  updateRuntimeSettings(tenantId: string, payload: Record<string, unknown>) {
    return api.putResource(`/tenants/${tenantId}/runtime-settings`, payload);
  },
  createGroup(payload: Record<string, unknown>) {
    return api.postResource<Group>("/groups", payload);
  },
  createUser(payload: Record<string, unknown>) {
    return api.postResource<UserMembership>("/users", payload);
  },
  runUserAction(userIdHash: string, payload: Record<string, unknown>) {
    return api.postResource<UserMembership>(`/users/${encodeURIComponent(userIdHash)}/actions`, payload);
  },
  createAdmin(payload: Record<string, unknown>) {
    return api.postResource<AdminUser>("/admins", payload);
  },
  activateTenant(tenantId: string) {
    return api.patchResource<TenantSummary>(`/tenants/${tenantId}`, { status: "active" });
  },
  listDatabaseInstances() {
    return api.getList<DatabaseInstanceConfig>("/settings/database-instances");
  },
  getSecretVaultStatus() {
    return api.getResource<SecretVaultStatus>("/settings/secret-vault");
  },
  listPlatformManagedLlms(includeInactive = false) {
    const query = includeInactive ? "?include_inactive=true" : "";
    return api.getList<PlatformManagedLlmConfig>(`/settings/platform-managed-llms${query}`);
  },
  createPlatformManagedLlm(payload: Record<string, unknown>) {
    return api.postResource<PlatformManagedLlmConfig>("/settings/platform-managed-llms", payload);
  },
  updatePlatformManagedLlm(configId: string, payload: Record<string, unknown>) {
    return api.patchResource<PlatformManagedLlmConfig>(`/settings/platform-managed-llms/${configId}`, payload);
  },
  createDatabaseInstance(payload: Record<string, unknown>) {
    return api.postResource<DatabaseInstanceConfig>("/settings/database-instances", payload);
  },
  updateDatabaseInstance(instanceId: string, payload: Record<string, unknown>) {
    return api.patchResource<DatabaseInstanceConfig>(`/settings/database-instances/${instanceId}`, payload);
  },
  listPromptUiInstances() {
    return api.getList<PromptUiInstanceConfig>("/settings/prompt-ui-instances");
  },
  createPromptUiInstance(payload: Record<string, unknown>) {
    return api.postResource<PromptUiInstanceConfig>("/settings/prompt-ui-instances", payload);
  },
  updatePromptUiInstance(instanceId: string, payload: Record<string, unknown>) {
    return api.patchResource<PromptUiInstanceConfig>(`/settings/prompt-ui-instances/${instanceId}`, payload);
  },
};

export type TenantListResponse = Promise<ListEnvelope<TenantSummary>>;
export type TenantResourceResponse = Promise<ResourceEnvelope<TenantSummary>>;
