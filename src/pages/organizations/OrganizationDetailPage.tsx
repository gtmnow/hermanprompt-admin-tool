import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { StatusBadge } from "../../components/status/StatusBadge";
import {
  DASHBOARD_RANGE_OPTIONS,
  type DashboardRangeKey,
  getRangeLabel,
} from "../../features/dashboard/api";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";

const detailTabs = [
  { label: "Overview", suffix: "" },
  { label: "Users", suffix: "/users" },
  { label: "Groups", suffix: "/groups" },
  { label: "Admins", suffix: "/admins" },
  { label: "Portal", suffix: "/portal" },
  { label: "LLM Config", suffix: "/llm-config" },
  { label: "Runtime", suffix: "/runtime" },
  { label: "Onboarding", suffix: "/onboarding" },
];

export function OrganizationDetailPage() {
  const { tenantId = "" } = useParams();
  const location = useLocation();
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>("30d");

  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => tenantApi.getTenant(tenantId),
    enabled: Boolean(tenantId),
  });
  const usersQuery = useQuery({
    queryKey: ["tenant-users", tenantId],
    queryFn: () => tenantApi.getUsers(tenantId),
    enabled: Boolean(tenantId),
  });
  const groupsQuery = useQuery({
    queryKey: ["tenant-groups", tenantId],
    queryFn: () => tenantApi.getGroups(tenantId),
    enabled: Boolean(tenantId),
  });
  const adminsQuery = useQuery({
    queryKey: ["admins", tenantId],
    queryFn: () => tenantApi.getAdmins(),
    enabled: Boolean(tenantId),
  });
  const onboardingQuery = useQuery({
    queryKey: ["tenant-onboarding", tenantId],
    queryFn: () => tenantApi.getTenantOnboarding(tenantId),
    enabled: Boolean(tenantId),
  });
  const reportQuery = useQuery({
    queryKey: ["tenant-report", tenantId, rangeKey],
    queryFn: () => tenantApi.getReport(tenantId, rangeKey),
    enabled: Boolean(tenantId),
  });

  const adminItems = useMemo(() => {
    return (adminsQuery.data?.items ?? []).filter((admin) =>
      admin.scopes.some((scope) => scope.tenant_id === tenantId),
    );
  }, [adminsQuery.data, tenantId]);

  if (
    tenantQuery.isLoading ||
    usersQuery.isLoading ||
    groupsQuery.isLoading ||
    onboardingQuery.isLoading ||
    reportQuery.isLoading ||
    adminsQuery.isLoading
  ) {
    return <LoadingBlock label="Loading organization detail..." />;
  }

  if (!tenantQuery.data) {
    return <div className="empty-state">Organization not found.</div>;
  }

  const tenant = tenantQuery.data.resource;
  const users = usersQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];
  const onboarding = onboardingQuery.data?.resource;
  const report = reportQuery.data?.resource;

  const activeUsers = users.filter((user) => user.status === "active").length;
  const sessionUsers = users.filter((user) => (user.profile?.sessions_count ?? 0) > 0).length;
  const averageImprovement = report?.kpis.find((item) => item.label === "Average Improvement")?.value ?? "N/A";
  const usageTrend = report?.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const improvementTrend = report?.charts.find((chart) => chart.label === "Improvement Trend")?.points ?? [];
  const rangeLabel = getRangeLabel(rangeKey);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <div className="muted" style={{ marginBottom: 10 }}>
            <Link to="/orgs">Organizations</Link> / {tenant.tenant.tenant_name}
          </div>
          <h1 className="page-title">{tenant.tenant.tenant_name}</h1>
          <p className="page-subtitle">
            Tenant key `{tenant.tenant.tenant_key}` with runtime configuration, onboarding state, and scoped admin controls.
          </p>
          <div className="muted" style={{ marginTop: 10 }}>
            {tenant.profile?.industry ?? "Industry pending"} / {tenant.profile?.service_mode ?? "Service mode pending"} / {tenant.profile?.primary_contact_email ?? "Primary contact pending"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="secondary-button" to={`/activation/${tenantId}`}>
            Edit setup
          </Link>
          <StatusBadge value={tenant.tenant.status} />
          {tenant.llm_config ? <StatusBadge value={tenant.llm_config.credential_status} /> : null}
        </div>
      </div>

      <div className="detail-tabs">
        {detailTabs.map((tab) => {
          const to = `/orgs/${tenantId}${tab.suffix}`;
          const isActive = tab.suffix === ""
            ? location.pathname === `/orgs/${tenantId}`
            : location.pathname === to;

          return (
            <NavLink
              className={`detail-tab${isActive ? " detail-tab--active" : ""}`}
              key={tab.label}
              to={to}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <div className="metric-card__label">Users</div>
          <div className="metric-card__value">{users.length}</div>
          <div className="metric-card__trend">{activeUsers} active</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Groups</div>
          <div className="metric-card__value">{groups.length}</div>
          <div className="metric-card__trend">Scoped group management</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Avg Improvement</div>
          <div className="metric-card__value">{averageImprovement}</div>
          <div className="metric-card__trend">Average session score delta for {rangeLabel.toLowerCase()}</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Users In Session</div>
          <div className="metric-card__value">{sessionUsers}</div>
          <div className="metric-card__trend">
            {adminItems.length} admin{adminItems.length === 1 ? "" : "s"} assigned
          </div>
        </div>
      </div>

      {location.pathname === `/orgs/${tenantId}` ? (
        <div className="stack">
          <div className="split-header">
            <div>
              <h3 className="panel-title">Reporting</h3>
              <div className="muted">Live activity and scoring snapshots for this organization</div>
            </div>
            <div className="range-pill-group" role="tablist" aria-label="Organization reporting period">
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
              subtitle={`Conversation activity for ${rangeLabel.toLowerCase()}`}
              data={usageTrend}
              color="#0284C7"
              emptyMessage="Not enough recorded session activity in this period to draw a usage trend yet."
            />
            <SimpleTrendChart
              title="Improvement Trend"
              subtitle="Average delta from initial to final prompt score"
              data={improvementTrend}
              emptyMessage="No scored sessions were found in this reporting window, so improvement is not plotted yet."
            />
          </div>

          <div className="grid grid--two">
            <div className="panel">
              <div className="split-header">
                <div>
                  <h3 className="panel-title">Organization Summary</h3>
                  <div className="muted">The core overview uses admin-owned settings plus live Herman Prompt activity</div>
                </div>
              </div>
              <div className="key-value">
                <div className="muted">Plan tier</div>
                <div>{tenant.tenant.plan_tier ?? "Not set"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Organization type</div>
                <div>{tenant.profile?.organization_type ?? "Not set"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Industry</div>
                <div>{tenant.profile?.industry ?? "Not set"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Reporting timezone</div>
                <div>{tenant.tenant.reporting_timezone}</div>
              </div>
              <div className="key-value">
                <div className="muted">Primary contact</div>
                <div>{tenant.profile?.primary_contact_name ?? tenant.profile?.primary_contact_email ?? "Not set"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Onboarding status</div>
                <div>{onboarding ? <StatusBadge value={onboarding.onboarding_status} /> : "No onboarding record"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Last onboarding update</div>
                <div>{formatDateTime(onboarding?.updated_at)}</div>
              </div>
              <div className="key-value">
                <div className="muted">LLM model</div>
                <div>{tenant.llm_config?.model_name ?? "Not configured"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Validation state</div>
                <div>{tenant.llm_config?.last_validation_message ?? "Validation has not been run yet"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Deployment notes</div>
                <div>{tenant.profile?.deployment_notes ?? "No deployment notes saved yet"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Portal logo</div>
                <div>{tenant.portal_config?.logo_url ? "Custom logo configured" : "Default logo"}</div>
              </div>
              <div className="key-value">
                <div className="muted">Portal welcome</div>
                <div>{tenant.portal_config?.welcome_message ?? "Default welcome message"}</div>
              </div>
            </div>

            <div className="panel">
              <div className="split-header">
                <div>
                  <h3 className="panel-title">Recent Users</h3>
                  <div className="muted">A quick tenant-scoped user snapshot</div>
                </div>
              </div>
              <div className="table-wrap">
                {users.length === 0 ? (
                  <div className="empty-state table-empty-state">No tenant-scoped users are visible yet for this organization.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Status</th>
                        <th>Groups</th>
                        <th>Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.slice(0, 5).map((user) => (
                        <tr key={user.id}>
                          <td>
                            {user.profile?.first_name || user.profile?.last_name
                              ? `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim()
                              : user.user_id_hash}
                            <div className="muted">{user.profile?.email ?? user.user_id_hash}</div>
                          </td>
                          <td>
                            <StatusBadge value={user.status} />
                          </td>
                          <td>{user.group_memberships.length}</td>
                          <td>{user.profile?.sessions_count ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="split-header">
                <div>
                  <h3 className="panel-title">Onboarding Checklist</h3>
                  <div className="muted">Checklist state comes from the backend onboarding record</div>
                </div>
              </div>
              <div className="checklist">
                {[
                  ["Organization created", onboarding?.tenant_created],
                  ["LLM configured", onboarding?.llm_configured],
                  ["LLM validated", onboarding?.llm_validated],
                  ["Users uploaded", onboarding?.users_uploaded],
                  ["Admin assigned", onboarding?.admin_assigned],
                ].map(([label, value]) => (
                  <div className="checklist-item" key={String(label)}>
                    <span>{label}</span>
                    <StatusBadge value={value ? "ready" : "draft"} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Outlet
          context={{
            tenant,
            users,
            groups,
            admins: adminItems,
            onboarding,
            report,
          }}
        />
      )}
    </div>
  );
}
