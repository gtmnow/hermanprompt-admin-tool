import { api } from "../../lib/api";
import type { ReportSummary, SystemOverview, TenantOnboarding, TenantSummary } from "../../lib/types";

export async function getDashboardData() {
  const [systemOverview, tenants, onboarding, report] = await Promise.all([
    api.getResource<SystemOverview>("/system/overview"),
    api.getList<TenantSummary>("/tenants"),
    api.getList<TenantOnboarding>("/onboarding/tenants"),
    api.postResource<ReportSummary>("/reports/run", {
      report_type: "system overview",
      dimension: "global",
      scope_id: "global",
      filters: {},
      start_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      visualization_preferences: {},
    }),
  ]);

  return {
    systemOverview: systemOverview.resource,
    tenants: tenants.items,
    onboarding: onboarding.items,
    report: report.resource,
  };
}
