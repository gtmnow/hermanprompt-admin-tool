import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CircleAlert, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { StatusBadge } from "../../components/status/StatusBadge";
import {
  DASHBOARD_RANGE_OPTIONS,
  type DashboardRangeKey,
  getDashboardData,
  getRangeLabel,
} from "../../features/dashboard/api";

export function DashboardPage() {
  const { selectedTenant, selectedTenantId } = useOrganizationScope();
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>("30d");
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", selectedTenantId ?? "all", rangeKey],
    queryFn: () => getDashboardData(selectedTenantId ?? undefined, rangeKey),
  });

  const scopedTenants = useMemo(() => {
    if (!dashboardQuery.data) {
      return [];
    }

    if (!selectedTenantId) {
      return dashboardQuery.data.tenants;
    }

    return dashboardQuery.data.tenants.filter((tenant) => tenant.tenant.id === selectedTenantId);
  }, [dashboardQuery.data, selectedTenantId]);

  const scopedOnboarding = useMemo(() => {
    if (!dashboardQuery.data) {
      return [];
    }

    if (!selectedTenantId) {
      return dashboardQuery.data.onboarding;
    }

    return dashboardQuery.data.onboarding.filter((item) => item.tenant_id === selectedTenantId);
  }, [dashboardQuery.data, selectedTenantId]);

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

  if (dashboardQuery.isLoading) {
    return <LoadingBlock label="Loading dashboard summary..." />;
  }

  if (!dashboardQuery.data) {
    return <div className="empty-state">No dashboard data is available yet.</div>;
  }

  const { report, systemOverview } = dashboardQuery.data;
  const activeUsersKpi = report.kpis.find((item) => item.label === "Active Users")?.value ?? systemOverview.active_user_count;
  const averageImprovementKpi = report.kpis.find((item) => item.label === "Average Improvement")?.value ?? "N/A";
  const reportTenantCount = report.tables.find((item) => item.metric === "tenant_count")?.value;
  const sessionUserCount = Number(report.tables.find((item) => item.metric === "session_user_count")?.value ?? 0);
  const activeOrganizationCount = selectedTenant ? 1 : Number(reportTenantCount ?? scopedTenants.length);
  const selectedScopeLabel = selectedTenant?.tenant.tenant_name ?? "all visible organizations";
  const selectedRangeLabel = getRangeLabel(rangeKey);
  const usageTrend = report.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const improvementTrend = report.charts.find((chart) => chart.label === "Improvement Trend")?.points ?? [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Good afternoon, Michael</h1>
          <p className="page-subtitle">
            Here&apos;s what&apos;s happening across {selectedScopeLabel} for {selectedRangeLabel.toLowerCase()} in your current Herman Prompt admin scope.
          </p>
        </div>
        <Link className="primary-button" to="/activation">
          Start activation
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <div className="metric-card__label">Active Users</div>
          <div className="metric-card__value">{activeUsersKpi}</div>
          <div className="metric-card__trend">
            {selectedTenant ? `Within ${selectedTenant.tenant.tenant_name}` : "Across all visible organizations"}
          </div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Active Organizations</div>
          <div className="metric-card__value">{activeOrganizationCount}</div>
          <div className="metric-card__trend">{scopedTenants.length} total organizations in view</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Avg Improvement</div>
          <div className="metric-card__value">{averageImprovementKpi}</div>
          <div className="metric-card__trend">Average delta from initial to final prompt score for {selectedRangeLabel.toLowerCase()}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Users In Session</div>
          <div className="metric-card__value">{sessionUserCount}</div>
          <div className="metric-card__trend">Authenticated users with captured Herman Prompt session activity</div>
        </div>
      </div>

      <div className="split-header">
        <div>
          <h3 className="panel-title">Trends</h3>
          <div className="muted">Live Herman Prompt activity and improvement across the selected reporting window</div>
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
          subtitle={`Captured Herman Prompt conversation activity for ${selectedRangeLabel.toLowerCase()}`}
          data={usageTrend}
          color="#0284C7"
          emptyMessage="Not enough recorded session activity in this period to draw a usage trend yet."
        />
        <SimpleTrendChart
          title="Improvement Trend"
          subtitle={`Average delta from initial to final prompt score across ${selectedScopeLabel}`}
          data={improvementTrend}
          emptyMessage="No scored sessions were found in this reporting window, so improvement is not plotted yet."
        />
      </div>

      <div className="grid grid--two">
        <div className="panel">
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
