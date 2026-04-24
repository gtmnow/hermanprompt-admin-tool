import { api } from "../../lib/api";
import { getRangeWindow, type DashboardRangeKey } from "../dashboard/api";
import type {
  AdminUser,
  AuditLogEntry,
  DatabaseInstanceConfig,
  Group,
  ListEnvelope,
  PlatformManagedLlmConfig,
  PromptUiInstanceConfig,
  ReportExportJob,
  ReportExportPayload,
  ReportRunPayload,
  ReportScopeType,
  ResellerPartner,
  ResellerTenantDefaults,
  ReportSummary,
  ResourceEnvelope,
  SecretVaultStatus,
  ServiceTierDefinition,
  SystemOverview,
  TenantLifecycleAction,
  TenantLifecycleActionResult,
  TenantOnboarding,
  TenantPortalConfig,
  TenantSummary,
  TenantValidationResult,
  UserMembership,
} from "../../lib/types";

export const tenantApi = {
  listResellers() {
    return api.getList<ResellerPartner>("/resellers");
  },
  createReseller(payload: { reseller_key: string; reseller_name: string; is_active?: boolean; service_tier_definition_id?: string | null }) {
    return api.postResource<ResellerPartner>("/resellers", payload);
  },
  updateReseller(resellerId: string, payload: Record<string, unknown>) {
    return api.patchResource<ResellerPartner>(`/resellers/${resellerId}`, payload);
  },
  getResellerDefaults(resellerId: string) {
    return api.getResource<ResellerTenantDefaults>(`/resellers/${resellerId}/tenant-defaults`);
  },
  updateResellerDefaults(resellerId: string, payload: Record<string, unknown>) {
    return api.putResource<ResellerTenantDefaults>(`/resellers/${resellerId}/tenant-defaults`, payload);
  },
  listTenants() {
    return api.getList<TenantSummary>("/tenants");
  },
  getTenant(tenantId: string) {
    return api.getResource<TenantSummary>(`/tenants/${tenantId}`);
  },
  createTenant(payload: {
    tenant_name: string;
    tenant_key: string | null;
    plan_tier: string | null;
    service_tier_definition_id: string | null;
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
  updateUser(userIdHash: string, tenantId: string, payload: Record<string, unknown>) {
    return api.patchResource<UserMembership>(
      `/users/${encodeURIComponent(userIdHash)}?tenant_id=${tenantId}`,
      payload,
    );
  },
  getGroups(tenantId?: string) {
    const query = tenantId ? `?tenant_id=${tenantId}` : "";
    return api.getList<Group>(`/groups${query}`);
  },
  updateGroup(groupId: string, payload: Record<string, unknown>) {
    return api.patchResource<Group>(`/groups/${groupId}`, payload);
  },
  getAdmins() {
    return api.getList<AdminUser>("/admins");
  },
  listAuditLog(filters?: { action_type?: string; target_type?: string }) {
    const params = new URLSearchParams();
    if (filters?.action_type) {
      params.set("action_type", filters.action_type);
    }
    if (filters?.target_type) {
      params.set("target_type", filters.target_type);
    }
    const query = params.toString();
    return api.getList<AuditLogEntry>(`/audit-log${query ? `?${query}` : ""}`);
  },
  updateAdmin(adminId: string, payload: Record<string, unknown>) {
    return api.patchResource<AdminUser>(`/admins/${adminId}`, payload);
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
  runReport(payload: ReportRunPayload) {
    return api.postResource<ReportSummary>("/reports/run", payload);
  },
  createReportExport(payload: ReportExportPayload) {
    return api.postResource<ReportExportJob>("/reports/export", payload);
  },
  listReportExports(filters?: {
    scope_type?: ReportScopeType;
    scope_id?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.scope_type) {
      params.set("scope_type", filters.scope_type);
    }
    if (filters?.scope_id) {
      params.set("scope_id", filters.scope_id);
    }
    if (filters?.status) {
      params.set("status", filters.status);
    }
    const query = params.toString();
    return api.getList<ReportExportJob>(`/reports/export${query ? `?${query}` : ""}`);
  },
  getReportExport(jobId: string) {
    return api.getResource<ReportExportJob>(`/reports/export/${jobId}`);
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
  overrideTenantActivation(tenantId: string, reason: string) {
    return api.postResource<TenantSummary>(`/tenants/${tenantId}/activation-override`, { reason });
  },
  runTenantAction(tenantId: string, action: TenantLifecycleAction) {
    return api.postResource<TenantLifecycleActionResult>(`/tenants/${tenantId}/actions`, { action });
  },
  getSystemOverview() {
    return api.getResource<SystemOverview>("/system/overview");
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
  listServiceTiers(filters?: { scope_type?: "organization" | "reseller"; include_inactive?: boolean }) {
    const params = new URLSearchParams();
    if (filters?.scope_type) {
      params.set("scope_type", filters.scope_type);
    }
    if (filters?.include_inactive) {
      params.set("include_inactive", "true");
    }
    const query = params.toString();
    return api.getList<ServiceTierDefinition>(`/settings/service-tiers${query ? `?${query}` : ""}`);
  },
  createServiceTier(payload: Record<string, unknown>) {
    return api.postResource<ServiceTierDefinition>("/settings/service-tiers", payload);
  },
  updateServiceTier(tierId: string, payload: Record<string, unknown>) {
    return api.patchResource<ServiceTierDefinition>(`/settings/service-tiers/${tierId}`, payload);
  },
  deleteServiceTier(tierId: string) {
    return api.deleteResource<ServiceTierDefinition>(`/settings/service-tiers/${tierId}`);
  },
};

export type TenantListResponse = Promise<ListEnvelope<TenantSummary>>;
export type TenantResourceResponse = Promise<ResourceEnvelope<TenantSummary>>;
