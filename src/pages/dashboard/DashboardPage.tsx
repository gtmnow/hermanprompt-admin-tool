import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CircleAlert, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "../../app/providers/AuthProvider";
import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { CardHelpTooltip } from "../../components/cards/CardHelpTooltip";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { MultiTrendChart } from "../../components/charts/MultiTrendChart";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import {
  DASHBOARD_RANGE_OPTIONS,
  type DashboardRangeKey,
  type DashboardScopeDimension,
  getDashboardData,
  getRangeLabel,
} from "../../features/dashboard/api";
import type { AuthenticatedAdminPrincipal } from "../../lib/types";

const GPT_55_INPUT_COST_PER_TOKEN = 5 / 1_000_000;
const GPT_55_OUTPUT_COST_PER_TOKEN = 30 / 1_000_000;

type ResolvedDashboardScope = {
  dimension: DashboardScopeDimension;
  scopeId: string;
  selectedScopeLabel: string;
  activeUsersScopeLabel: string;
  effectiveTenantId: string | null;
  usesTenantList: boolean;
};

function resolveDashboardScope(
  principal: AuthenticatedAdminPrincipal | undefined,
  selectedTenantId: string | null,
  visibleTenants: ReturnType<typeof useOrganizationScope>["visibleTenants"],
): ResolvedDashboardScope {
  const selectedTenant = visibleTenants.find((tenant) => tenant.tenant.id === selectedTenantId) ?? null;
  const singleVisibleTenant = visibleTenants.length === 1 ? visibleTenants[0] ?? null : null;
  const effectiveTenant = selectedTenant ?? singleVisibleTenant;

  if (effectiveTenant) {
    return {
      dimension: "organization",
      scopeId: effectiveTenant.tenant.id,
      selectedScopeLabel: effectiveTenant.tenant.tenant_name,
      activeUsersScopeLabel: `Within ${effectiveTenant.tenant.tenant_name}`,
      effectiveTenantId: effectiveTenant.tenant.id,
      usesTenantList: true,
    };
  }

  const scopes = principal?.scopes ?? [];
  const groupScope = scopes.find((scope) => scope.scope_type === "group" && scope.group_id);
  if (groupScope?.group_id) {
    return {
      dimension: "group",
      scopeId: groupScope.group_id,
      selectedScopeLabel: "your assigned group",
      activeUsersScopeLabel: "Within your assigned group",
      effectiveTenantId: groupScope.tenant_id,
      usesTenantList: false,
    };
  }

  const tenantScope = scopes.find((scope) => scope.scope_type === "tenant" && scope.tenant_id);
  if (tenantScope?.tenant_id) {
    return {
      dimension: "organization",
      scopeId: tenantScope.tenant_id,
      selectedScopeLabel: "your assigned organization",
      activeUsersScopeLabel: "Within your assigned organization",
      effectiveTenantId: tenantScope.tenant_id,
      usesTenantList: false,
    };
  }

  const resellerScope = scopes.find((scope) => scope.scope_type === "reseller" && scope.reseller_partner_id);
  if (resellerScope?.reseller_partner_id) {
    return {
      dimension: "reseller",
      scopeId: resellerScope.reseller_partner_id,
      selectedScopeLabel: "your partner portfolio",
      activeUsersScopeLabel: "Across your partner portfolio",
      effectiveTenantId: null,
      usesTenantList: visibleTenants.length > 0,
    };
  }

  return {
    dimension: "global",
    scopeId: "global",
    selectedScopeLabel: visibleTenants.length > 0 ? "all visible organizations" : "your admin scope",
    activeUsersScopeLabel: visibleTenants.length > 0 ? "Across all visible organizations" : "Across your admin scope",
    effectiveTenantId: null,
    usesTenantList: visibleTenants.length > 0,
  };
}

export function DashboardPage() {
  const { session } = useAuth();
  const { isLoading: scopeIsLoading, selectedTenant, selectedTenantId, visibleTenants } = useOrganizationScope();
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>("30d");
  const canReadTenants = session?.principal.permissions.includes("tenants.read") ?? false;
  const dashboardScope = useMemo(
    () => resolveDashboardScope(session?.principal, selectedTenantId, visibleTenants),
    [selectedTenantId, session?.principal, visibleTenants],
  );
  const effectiveTenant = selectedTenant ?? (visibleTenants.length === 1 ? visibleTenants[0] ?? null : null);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", dashboardScope.dimension, dashboardScope.scopeId, rangeKey],
    queryFn: () => getDashboardData({ dimension: dashboardScope.dimension, scopeId: dashboardScope.scopeId }, rangeKey),
    enabled: !scopeIsLoading,
  });
  const onboardingQuery = useQuery({
    queryKey: ["dashboard-onboarding", dashboardScope.effectiveTenantId ?? dashboardScope.scopeId],
    queryFn: () => tenantApi.listOnboarding(),
    enabled: !scopeIsLoading && canReadTenants,
  });

  const scopedTenants = useMemo(() => {
    if (!dashboardScope.usesTenantList) {
      return [];
    }

    if (!dashboardScope.effectiveTenantId) {
      return visibleTenants;
    }

    return visibleTenants.filter((tenant) => tenant.tenant.id === dashboardScope.effectiveTenantId);
  }, [dashboardScope.effectiveTenantId, dashboardScope.usesTenantList, visibleTenants]);

  const scopedOnboarding = useMemo(() => {
    if (!onboardingQuery.data) {
      return [];
    }

    if (!dashboardScope.effectiveTenantId) {
      return onboardingQuery.data.items;
    }

    return onboardingQuery.data.items.filter((item) => item.tenant_id === dashboardScope.effectiveTenantId);
  }, [dashboardScope.effectiveTenantId, onboardingQuery.data]);

  const alerts = useMemo(() => {
    if (!dashboardQuery.data && !visibleTenants.length) {
      return [];
    }

    const invalidLlm = scopedTenants.filter(
      (tenant) => tenant.llm_config?.credential_status === "invalid",
    );
    const incomplete = scopedOnboarding.filter(
      (item) => item.onboarding_status !== "ready" && item.onboarding_status !== "live",
    );

    return [
      {
        label: `${invalidLlm.length} orgs with invalid LLM config`,
        href: "/orgs",
      },
      {
        label: `${incomplete.length} organizations need onboarding attention`,
        href: "/activation",
      },
    ];
  }, [dashboardQuery.data, scopedOnboarding, scopedTenants, visibleTenants.length]);

  if (scopeIsLoading || dashboardQuery.isLoading) {
    return <LoadingBlock label="Loading dashboard summary..." />;
  }

  if (dashboardQuery.error) {
    return <div className="empty-state">Dashboard failed to load: {dashboardQuery.error.message}</div>;
  }

  if (!dashboardQuery.data) {
    return <div className="empty-state">No dashboard data is available yet.</div>;
  }

  const { report, systemOverview } = dashboardQuery.data;
  const activeUsersKpi = report.kpis.find((item) => item.label === "Active Users")?.value ?? systemOverview?.active_user_count ?? 0;
  const averageImprovementKpi = report.kpis.find((item) => item.label === "Average Improvement")?.value ?? "N/A";
  const sessionCount = Number(report.tables.find((item) => item.metric === "session_count")?.value ?? 0);
  const selectedScopeLabel = effectiveTenant?.tenant.tenant_name ?? dashboardScope.selectedScopeLabel;
  const activeUsersScopeLabel = effectiveTenant
    ? `Within ${effectiveTenant.tenant.tenant_name}`
    : dashboardScope.activeUsersScopeLabel;
  const selectedRangeLabel = getRangeLabel(rangeKey);
  const usageTrend = report.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const improvementTrend = report.charts.find((chart) => chart.label === "Improvement Trend")?.points ?? [];
  const adminTokenTrend = report.charts.find((chart) => chart.label === "Admin Token Consumption Trend")?.points ?? [];
  const userResponseTokenTrend = report.charts.find((chart) => chart.label === "User Response Token Consumption Trend")?.points ?? [];
  const totalTokenTrend = report.charts.find((chart) => chart.label === "Total Token Utilization Trend")?.points ?? [];
  const tokenEfficiencyTrend = report.charts.find((chart) => chart.label === "User Token Efficiency Trend")?.points ?? [];
  const tokenUtilizationTrend = totalTokenTrend.map((point, index) => ({
    bucket: point.bucket,
    adminTokenConsumption: adminTokenTrend[index]?.value ?? 0,
    userResponseConsumption: userResponseTokenTrend[index]?.value ?? 0,
    totalTokenConsumption: point.value ?? 0,
  }));
  const tokenSavingsUsd = totalTokenTrend.reduce((sum, point, index) => {
    const totalTokens = Number(point.value ?? 0);
    const estimatedSavedTokens = Number(tokenEfficiencyTrend[index]?.value ?? 0);
    const adminTokens = Number(adminTokenTrend[index]?.value ?? 0);
    const outputTokens = Number(userResponseTokenTrend[index]?.value ?? 0);

    if (totalTokens <= 0 || estimatedSavedTokens <= 0) {
      return sum;
    }

    const savingsRate = Math.min(Math.max(estimatedSavedTokens / totalTokens, 0), 1);
    const adminSavingsUsd = adminTokens * savingsRate * GPT_55_INPUT_COST_PER_TOKEN;
    const outputSavingsUsd = outputTokens * savingsRate * GPT_55_OUTPUT_COST_PER_TOKEN;
    return sum + adminSavingsUsd + outputSavingsUsd;
  }, 0);
  const totalObservedTokens = totalTokenTrend.reduce((sum, point) => sum + Number(point.value ?? 0), 0);
  const totalEstimatedSavedTokens = tokenEfficiencyTrend.reduce((sum, point) => sum + Number(point.value ?? 0), 0);
  const tokenSavingsPercent =
    totalObservedTokens > 0 ? Math.min(Math.max((totalEstimatedSavedTokens / totalObservedTokens) * 100, 0), 100) : 0;
  const formattedTokenSavings = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tokenSavingsUsd);
  const formattedTokenSavingsPercent = `${tokenSavingsPercent.toFixed(1)}%`;

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Good afternoon, Michael</h1>
          <p className="page-subtitle">
            Here&apos;s what&apos;s happening across {selectedScopeLabel} for {selectedRangeLabel.toLowerCase()} in your current HermanPrompt admin scope.
          </p>
        </div>
        <Link className="primary-button" to="/activation">
          Start activation
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <CardHelpTooltip text="Shows how many users are currently active inside the selected dashboard scope." />
          <div className="metric-card__label">Active Users</div>
          <div className="metric-card__value">{activeUsersKpi}</div>
          <div className="metric-card__trend">
            {activeUsersScopeLabel}
          </div>
        </div>
        <div className="card metric-card">
          <CardHelpTooltip text="Shows how many captured HermanPrompt sessions occurred in the selected dashboard scope and date range." />
          <div className="metric-card__label">Total User Sessions</div>
          <div className="metric-card__value">{sessionCount}</div>
          <div className="metric-card__trend">User sessions in {selectedRangeLabel.toLowerCase()}</div>
        </div>
        <div className="card metric-card">
          <CardHelpTooltip text="Shows the average improvement between initial and final prompt scores for the selected reporting period." />
          <div className="metric-card__label">Avg. Prompt Quality Improvement</div>
          <div className="metric-card__value">{averageImprovementKpi}</div>
          <div className="metric-card__trend">Average improvement from initial to final prompt score for {selectedRangeLabel.toLowerCase()}</div>
        </div>
        <div className="card metric-card">
          <CardHelpTooltip text="Estimates dollar savings by applying the dashboard's token-efficiency estimate to admin input tokens and user response output tokens, then pricing those saved tokens at current GPT-5.5 API rates." />
          <div className="metric-card__label">Token Savings</div>
          <div className="metric-card__value" style={{ lineHeight: 1.2 }}>
            <span>{formattedTokenSavingsPercent}</span>
            <span style={{ display: "block", fontSize: 20, marginTop: 6 }}>{formattedTokenSavings}</span>
          </div>
          <div className="metric-card__trend">Estimated with GPT-5.5 pricing for {selectedRangeLabel.toLowerCase()}</div>
        </div>
      </div>

      <div className="split-header">
        <div>
          <h3 className="panel-title">Trends</h3>
          <div className="muted">Live HermanPrompt activity and improvement across the selected reporting window</div>
        </div>
        <div className="range-pill-group" role="tablist" aria-label="Dashboard reporting period">
          {DASHBOARD_RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={`range-pill ${rangeKey === option.key ? "range-pill--active" : ""}`}
              type="button"
              onClick={() => setRangeKey(option.key)}
              aria-pressed={rangeKey === option.key}
              title={option.label}
            >
              {option.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid--two">
        <SimpleTrendChart
          title="Usage Trend"
          subtitle={`Conversation activity for ${selectedRangeLabel.toLowerCase()}`}
          tooltipText="Shows how usage volume changes over time for the current dashboard scope and date range."
          data={usageTrend}
          color="#0284C7"
          emptyMessage="Not enough recorded session activity in this period to draw a usage trend yet."
        />
        <SimpleTrendChart
          title="Improvement Trend"
          subtitle={`Average improvement from initial to final prompt score across ${selectedScopeLabel}`}
          tooltipText="Shows whether prompt quality improvement is rising, flattening, or falling over the selected period."
          data={improvementTrend}
          plotNullAsZero
          emptyMessage="No scored sessions were found in this reporting window, so improvement is not plotted yet."
        />
      </div>

      <div className="grid grid--two">
        <MultiTrendChart
          title="Total Token Utilization"
          subtitle={`Token consumption for ${selectedRangeLabel.toLowerCase()}`}
          tooltipText="Shows actual token usage from prompt transformation requests in the current dashboard scope, separated into admin-side token load, user response token load, and total combined token consumption."
          data={tokenUtilizationTrend}
          series={[
            { key: "adminTokenConsumption", label: "Admin Token Consumption", color: "#0284C7" },
            { key: "userResponseConsumption", label: "User Response Consumption", color: "#16A34A" },
            { key: "totalTokenConsumption", label: "Total Token Consumption", color: "#F97316" },
          ]}
          emptyMessage="Not enough recorded session activity is available to estimate token utilization yet."
        />
        <SimpleTrendChart
          title="User Token Efficiency"
          subtitle={`Estimated token savings from prompt improvement across ${selectedScopeLabel}`}
          tooltipText="Estimates token savings by applying the average prompt-improvement percentage to the observed total token load for each bucket. This remains a temporary efficiency proxy until the prompt transformation tool emits direct token-savings measurements."
          data={tokenEfficiencyTrend}
          color="#7C3AED"
          emptyMessage="No prompt transformation activity was found in this reporting window, so token-efficiency estimates are not plotted yet."
        />
      </div>

      <div className="grid grid--two">
        <div className="panel">
          <CardHelpTooltip text="Highlights the highest-priority issues in the current scope that may need operator follow-up." />
          <div className="split-header">
            <div>
              <h3 className="panel-title">Alerts</h3>
              <div className="muted">Focus areas that need operator attention</div>
            </div>
          </div>
          <div className="alert-list">
            {alerts.map((alert) => (
              <Link className="alert-item" key={alert.label} to={alert.href}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <CircleAlert size={18} color="#d97706" />
                    <strong>{alert.label}</strong>
                  </div>
                  <ArrowRight size={16} color="#64748B" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="panel">
          <CardHelpTooltip text="Surfaces the most common next-step workflows from the dashboard." />
          <div className="split-header">
            <div>
              <h3 className="panel-title">Quick Actions</h3>
              <div className="muted">The first workflows teams reach for most often</div>
            </div>
          </div>
          <div className="stack">
            <Link className="section-note" to="/activation/new">
              <div className="inline-stat">
                <Rocket size={16} color="#0284C7" />
                Launch a new activation workflow
              </div>
            </Link>
            <Link className="section-note" to="/orgs">
              <div className="inline-stat">
                <Building2 size={16} color="#0284C7" />
                Review organization health and onboarding readiness
              </div>
            </Link>
            <Link className="section-note" to="/dashboard">
              <div className="inline-stat">
                <ShieldCheck size={16} color="#059669" />
                {scopedOnboarding.filter((item) => item.onboarding_status === "ready").length} orgs are ready to activate
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="panel">
        <CardHelpTooltip text="Summarizes onboarding progress and readiness signals pulled from the current backend onboarding records." />
        <div className="split-header">
          <div>
            <h3 className="panel-title">Onboarding Snapshot</h3>
            <div className="muted">Live checklist status derived from backend onboarding state</div>
          </div>
        </div>
        <div className="table-wrap">
          {scopedOnboarding.length === 0 ? (
            <div className="empty-state table-empty-state">No onboarding records are visible for this scope yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant ID</th>
                  <th>Status</th>
                  <th>LLM</th>
                  <th>Users</th>
                  <th>Admins</th>
                </tr>
              </thead>
              <tbody>
                {scopedOnboarding.slice(0, 6).map((item) => (
                  <tr key={item.tenant_id}>
                    <td>{item.tenant_id.slice(0, 8)}...</td>
                    <td>
                      <StatusBadge value={item.onboarding_status} />
                    </td>
                    <td>{item.llm_validated ? "Validated" : "Pending"}</td>
                    <td>{item.users_uploaded ? "Loaded" : "Pending"}</td>
                    <td>{item.admin_assigned ? "Assigned" : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
