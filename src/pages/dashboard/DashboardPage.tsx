import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CircleAlert, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { CardHelpTooltip } from "../../components/cards/CardHelpTooltip";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { MultiTrendChart } from "../../components/charts/MultiTrendChart";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { StatusBadge } from "../../components/status/StatusBadge";
import {
  DASHBOARD_RANGE_OPTIONS,
  type DashboardRangeKey,
  getDashboardData,
  getRangeLabel,
} from "../../features/dashboard/api";

const GPT_55_INPUT_COST_PER_TOKEN = 5 / 1_000_000;
const GPT_55_OUTPUT_COST_PER_TOKEN = 30 / 1_000_000;

export function DashboardPage() {
  const { isLoading: scopeIsLoading, selectedTenant, selectedTenantId, visibleTenants } = useOrganizationScope();
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>("30d");
  const effectiveTenantId = selectedTenantId ?? (visibleTenants.length === 1 ? visibleTenants[0]?.tenant.id ?? null : null);
  const effectiveTenant = selectedTenant ?? (visibleTenants.length === 1 ? visibleTenants[0] ?? null : null);
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", effectiveTenantId ?? "all", rangeKey],
    queryFn: () => getDashboardData(effectiveTenantId ?? undefined, rangeKey),
    enabled: !scopeIsLoading,
  });

  const scopedTenants = useMemo(() => {
    if (!dashboardQuery.data) {
      return [];
    }

    if (!effectiveTenantId) {
      return dashboardQuery.data.tenants;
    }

    return dashboardQuery.data.tenants.filter((tenant) => tenant.tenant.id === effectiveTenantId);
  }, [dashboardQuery.data, effectiveTenantId]);

  const scopedOnboarding = useMemo(() => {
    if (!dashboardQuery.data) {
      return [];
    }

    if (!effectiveTenantId) {
      return dashboardQuery.data.onboarding;
    }

    return dashboardQuery.data.onboarding.filter((item) => item.tenant_id === effectiveTenantId);
  }, [dashboardQuery.data, effectiveTenantId]);

  const alerts = useMemo(() => {
    if (!dashboardQuery.data) {
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
  }, [dashboardQuery.data, scopedOnboarding, scopedTenants]);

  if (scopeIsLoading || dashboardQuery.isLoading) {
    return <LoadingBlock label="Loading dashboard summary..." />;
  }

  if (!dashboardQuery.data) {
    return <div className="empty-state">No dashboard data is available yet.</div>;
  }

  const { report, systemOverview } = dashboardQuery.data;
  const activeUsersKpi = report.kpis.find((item) => item.label === "Active Users")?.value ?? systemOverview?.active_user_count ?? 0;
  const averageImprovementKpi = report.kpis.find((item) => item.label === "Average Improvement")?.value ?? "N/A";
  const sessionCount = Number(report.tables.find((item) => item.metric === "session_count")?.value ?? 0);
  const selectedScopeLabel = effectiveTenant?.tenant.tenant_name ?? "all visible organizations";
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
            {effectiveTenant ? `Within ${effectiveTenant.tenant.tenant_name}` : "Across all visible organizations"}
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
