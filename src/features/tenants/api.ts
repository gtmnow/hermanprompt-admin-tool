import { api } from "../../lib/api";
import type {
  AdminUser,
  Group,
  ListEnvelope,
  ReportSummary,
  ResourceEnvelope,
  TenantOnboarding,
  TenantSummary,
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
  }) {
    return api.postResource<TenantSummary>("/tenants", payload);
  },
  updateTenant(tenantId: string, payload: Record<string, unknown>) {
    return api.patchResource<TenantSummary>(`/tenants/${tenantId}`, payload);
  },
  getTenantOnboarding(tenantId: string) {
    return api.getResource<TenantOnboarding>(`/onboarding/tenants/${tenantId}`);
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
  getReport(tenantId: string, dimension: "organization" | "global" = "organization") {
    return api.postResource<ReportSummary>("/reports/run", {
      report_type: "utilization",
      dimension,
      scope_id: tenantId,
      filters: {},
      start_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
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
    return api.postResource(`/tenants/${tenantId}/llm-config/validate`, {});
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
  createAdmin(payload: Record<string, unknown>) {
    return api.postResource<AdminUser>("/admins", payload);
  },
  activateTenant(tenantId: string) {
    return api.patchResource<TenantSummary>(`/tenants/${tenantId}`, { status: "active" });
  },
};

export type TenantListResponse = Promise<ListEnvelope<TenantSummary>>;
export type TenantResourceResponse = Promise<ResourceEnvelope<TenantSummary>>;
