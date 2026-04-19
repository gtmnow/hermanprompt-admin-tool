import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CircleAlert, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { StatusBadge } from "../../components/status/StatusBadge";
import { getDashboardData } from "../../features/dashboard/api";

export function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardData,
  });

  const alerts = useMemo(() => {
    if (!dashboardQuery.data) {
      return [];
    }

    const invalidLlm = dashboardQuery.data.tenants.filter(
      (tenant) => tenant.llm_config?.credential_status === "invalid",
    );
    const incomplete = dashboardQuery.data.onboarding.filter(
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
  }, [dashboardQuery.data]);

  if (dashboardQuery.isLoading) {
    return <LoadingBlock label="Loading dashboard summary..." />;
  }

  if (!dashboardQuery.data) {
    return <div className="empty-state">No dashboard data is available yet.</div>;
  }

  const { report, systemOverview, onboarding } = dashboardQuery.data;
  const improvementTrend = report.charts[0]?.points ?? [];
  const usageTrend = improvementTrend.map((point, index) => ({
    ...point,
    value: Math.round(point.value * 1.7 + index * 8),
  }));

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Good afternoon, Michael</h1>
          <p className="page-subtitle">
            Here&apos;s what&apos;s happening across your current Herman Prompt admin scope today.
          </p>
        </div>
        <Link className="primary-button" to="/activation">
          Start activation
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <div className="metric-card__label">Active Users</div>
          <div className="metric-card__value">{systemOverview.active_user_count}</div>
          <div className="metric-card__trend">Across all visible organizations</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Active Organizations</div>
          <div className="metric-card__value">{systemOverview.active_tenant_count}</div>
          <div className="metric-card__trend">{systemOverview.tenant_count} total organizations</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Avg Improvement</div>
          <div className="metric-card__value">
            {report.kpis.find((item) => item.label === "Average Improvement")?.value ?? "N/A"}
          </div>
          <div className="metric-card__trend">Rolling 30-day trend from report payload</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">LLM Issues</div>
          <div className="metric-card__value">{systemOverview.invalid_credential_count}</div>
          <div className="metric-card__trend">Connections currently requiring remediation</div>
        </div>
      </div>

      <div className="grid grid--two">
        <SimpleTrendChart
          title="Usage Trend"
          subtitle="Demo-aligned trend view for active platform usage"
          data={usageTrend}
          color="#0284C7"
        />
        <SimpleTrendChart
          title="Improvement Trend"
          subtitle="Average improvement trend across the current scope"
          data={improvementTrend}
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
                {onboarding.filter((item) => item.onboarding_status === "ready").length} orgs are ready to activate
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
              {onboarding.slice(0, 6).map((item) => (
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
        </div>
      </div>
    </div>
  );
}
