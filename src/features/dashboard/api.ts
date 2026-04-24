import { api } from "../../lib/api";
import type { ReportSummary, SystemOverview, TenantOnboarding, TenantSummary } from "../../lib/types";

export type DashboardRangeKey = "24h" | "7d" | "30d" | "ytd" | "all";

export const DASHBOARD_RANGE_OPTIONS: Array<{ key: DashboardRangeKey; label: string; shortLabel: string }> = [
  { key: "24h", label: "Last 24 hours", shortLabel: "1D" },
  { key: "7d", label: "Last 7 days", shortLabel: "1W" },
  { key: "30d", label: "Last 30 days", shortLabel: "1M" },
  { key: "ytd", label: "Year to date", shortLabel: "YTD" },
  { key: "all", label: "All time", shortLabel: "All time" },
];

export function getRangeWindow(rangeKey: DashboardRangeKey) {
  const end = new Date();
  const start = new Date(end);

  if (rangeKey === "24h") {
    start.setHours(end.getHours() - 24);
  } else if (rangeKey === "7d") {
    start.setDate(end.getDate() - 7);
  } else if (rangeKey === "30d") {
    start.setDate(end.getDate() - 30);
  } else if (rangeKey === "ytd") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setFullYear(2000, 0, 1);
    start.setHours(0, 0, 0, 0);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function getRangeLabel(rangeKey: DashboardRangeKey) {
  return DASHBOARD_RANGE_OPTIONS.find((option) => option.key === rangeKey)?.label ?? "Last 30 days";
}

export async function getDashboardData(selectedTenantId?: string, rangeKey: DashboardRangeKey = "30d") {
  const reportDimension = selectedTenantId ? "organization" : "global";
  const reportScopeId = selectedTenantId ?? "global";
  const window = getRangeWindow(rangeKey);

  const [systemOverview, tenants, onboarding, report] = await Promise.all([
    api.getResource<SystemOverview>("/system/overview").catch(() => null),
    api.getList<TenantSummary>("/tenants"),
    api.getList<TenantOnboarding>("/onboarding/tenants"),
    api.postResource<ReportSummary>("/reports/run", {
      report_type: "system overview",
      dimension: reportDimension,
      scope_id: reportScopeId,
      filters: {},
      start_date: window.start,
      end_date: window.end,
      visualization_preferences: {},
    }),
  ]);

  return {
    systemOverview: systemOverview?.resource ?? null,
    tenants: tenants.items,
    onboarding: onboarding.items,
    report: report.resource,
  };
}
