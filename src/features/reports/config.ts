import type { DashboardRangeKey } from "../dashboard/api";
import type { Group, ReportSummary, ReportScopeType, ResellerPartner, TenantSummary } from "../../lib/types";

export const reportTypeOptions = [
  { value: "dashboard_summary", label: "Dashboard Summary", description: "High-level KPI view for tenant or portfolio health." },
  { value: "prompt_quality_analysis", label: "Prompt Quality Analysis", description: "Focus on improvement trends and prompt-quality proof points." },
  { value: "behavior_gap_analysis", label: "Behavior Gap Analysis", description: "Highlight adoption, coverage, and usage gaps that need attention." },
  { value: "executive_summary", label: "Executive Summary", description: "Compact report for leadership review and customer communication." },
  { value: "adoption_summary", label: "Adoption Summary", description: "Usage-focused report for monitoring active users and session coverage." },
] as const;

export function resolveReportScope(args: {
  scopeType: ReportScopeType;
  organizationId: string;
  groupId: string;
  resellerId: string;
  tenants: TenantSummary[];
  groups: Group[];
  resellers: ResellerPartner[];
}) {
  const { scopeType, organizationId, groupId, resellerId, tenants, groups, resellers } = args;

  if (scopeType === "global") {
    return {
      valid: true,
      scopeId: "global",
      scopeLabel: "All visible organizations",
      dimension: "global" as const,
    };
  }

  if (scopeType === "organization") {
    const tenant = tenants.find((item) => item.tenant.id === organizationId);
    return {
      valid: Boolean(tenant),
      scopeId: tenant?.tenant.id ?? "",
      scopeLabel: tenant?.tenant.tenant_name ?? "Selected organization",
      dimension: "organization" as const,
    };
  }

  if (scopeType === "reseller") {
    const reseller = resellers.find((item) => item.id === resellerId);
    return {
      valid: Boolean(reseller),
      scopeId: reseller?.id ?? "",
      scopeLabel: reseller?.reseller_name ?? "Selected reseller",
      dimension: "reseller" as const,
    };
  }

  if (scopeType === "group") {
    const group = groups.find((item) => item.id === groupId);
    return {
      valid: Boolean(group),
      scopeId: group?.id ?? "",
      scopeLabel: group?.group_name ?? "Selected group",
      dimension: "group" as const,
    };
  }

  return {
    valid: false,
    scopeId: "",
    scopeLabel: "Unsupported scope",
    dimension: scopeType,
  };
}

export function derivePromptQualitySignals(report: ReportSummary) {
  const averageImprovementRaw = report.kpis.find((item) => item.label === "Average Improvement")?.value ?? 0;
  const averageImprovement = Number(String(averageImprovementRaw).replace("%", "")) || 0;
  const usageTrend = report.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const improvementTrend = report.charts.find((chart) => chart.label === "Improvement Trend")?.points ?? [];
  const firstImprovement = improvementTrend.find((point) => point.value != null)?.value ?? null;
  const lastImprovement = [...improvementTrend].reverse().find((point) => point.value != null)?.value ?? null;
  const firstUsage = usageTrend.find((point) => point.value != null)?.value ?? null;
  const lastUsage = [...usageTrend].reverse().find((point) => point.value != null)?.value ?? null;

  const qualityBand =
    averageImprovement >= 20 ? "Strong" : averageImprovement >= 10 ? "Healthy" : "Needs Attention";
  const trendDirection =
    firstImprovement != null && lastImprovement != null
      ? lastImprovement > firstImprovement
        ? "Improvement is rising across the selected window."
        : lastImprovement < firstImprovement
          ? "Improvement is flattening or slipping across the selected window."
          : "Improvement is stable across the selected window."
      : "Not enough scored sessions are available to judge improvement momentum yet.";
  const engagementDirection =
    firstUsage != null && lastUsage != null
      ? lastUsage >= firstUsage
        ? "Usage is keeping pace with or exceeding the opening period."
        : "Usage has softened since the opening period."
      : "Not enough session activity is available to judge usage momentum yet.";

  return {
    averageImprovement,
    qualityBand,
    trendDirection,
    engagementDirection,
  };
}

export function deriveBehaviorGaps(report: ReportSummary) {
  const activeUsers = Number(report.kpis.find((item) => item.label === "Active Users")?.value ?? 0);
  const activeGroups = Number(report.kpis.find((item) => item.label === "Active Groups")?.value ?? 0);
  const averageImprovement = Number(String(report.kpis.find((item) => item.label === "Average Improvement")?.value ?? 0).replace("%", "")) || 0;
  const sessionUserCount = Number(report.tables.find((item) => item.metric === "session_user_count")?.value ?? 0);
  const usageTrend = report.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const firstUsage = usageTrend.find((point) => point.value != null)?.value ?? null;
  const lastUsage = [...usageTrend].reverse().find((point) => point.value != null)?.value ?? null;

  const gaps: string[] = [];
  if (activeUsers === 0) {
    gaps.push("No active users are visible in this scope yet, so adoption and improvement cannot be demonstrated.");
  }
  if (sessionUserCount === 0) {
    gaps.push("No users with tracked session activity were found in the selected window.");
  }
  if (activeUsers > 0 && sessionUserCount > 0 && sessionUserCount < Math.max(1, Math.ceil(activeUsers * 0.5))) {
    gaps.push("Less than half of active users show captured session activity, which suggests uneven adoption.");
  }
  if (activeGroups === 0 && report.filters.scope_type !== "group") {
    gaps.push("No active groups are reflected in this scope, which limits control-zone reporting and delegated admin visibility.");
  }
  if (averageImprovement < 10) {
    gaps.push("Average improvement remains below the healthy threshold, so prompt-quality proof points are still thin.");
  }
  if (firstUsage != null && lastUsage != null && lastUsage < firstUsage * 0.75) {
    gaps.push("Usage has dropped materially across the selected period, which may indicate behavior decay after onboarding.");
  }

  return gaps;
}

export function getDefaultRangeKey(): DashboardRangeKey {
  return "30d";
}
