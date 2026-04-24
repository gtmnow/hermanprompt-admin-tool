import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";

function inferIssueSummary(args: {
  status: string;
  onboardingStatus: string | null;
  credentialStatus: string | null;
  hasAdmins: boolean;
}) {
  const { status, onboardingStatus, credentialStatus, hasAdmins } = args;
  if (credentialStatus === "invalid") {
    return "Invalid LLM credentials";
  }
  if (!hasAdmins) {
    return "No admin assigned";
  }
  if (status === "inactive" || status === "suspended") {
    return "Tenant not active";
  }
  if (onboardingStatus === "in_progress" || onboardingStatus === "draft") {
    return "Onboarding incomplete";
  }
  return "Healthy";
}

export function OperationsPage() {
  const [resellerFilter, setResellerFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [targetTypeFilter, setTargetTypeFilter] = useState("all");

  const resellersQuery = useQuery({
    queryKey: ["operations-resellers"],
    queryFn: () => tenantApi.listResellers(),
  });
  const tenantsQuery = useQuery({
    queryKey: ["operations-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const onboardingQuery = useQuery({
    queryKey: ["operations-onboarding"],
    queryFn: () => tenantApi.listOnboarding(),
  });
  const adminsQuery = useQuery({
    queryKey: ["operations-admins"],
    queryFn: () => tenantApi.getAdmins(),
  });
  const exportsQuery = useQuery({
    queryKey: ["operations-exports"],
    queryFn: () => tenantApi.listReportExports(),
  });
  const auditQuery = useQuery({
    queryKey: ["operations-audit", targetTypeFilter],
    queryFn: () => tenantApi.listAuditLog(targetTypeFilter === "all" ? undefined : { target_type: targetTypeFilter }),
  });
  const systemOverviewQuery = useQuery({
    queryKey: ["operations-system-overview"],
    queryFn: () => tenantApi.getSystemOverview(),
  });

  if (
    resellersQuery.isLoading ||
    tenantsQuery.isLoading ||
    onboardingQuery.isLoading ||
    adminsQuery.isLoading ||
    exportsQuery.isLoading ||
    auditQuery.isLoading ||
    systemOverviewQuery.isLoading
  ) {
    return <LoadingBlock label="Loading operations workspace..." />;
  }

  const resellers = resellersQuery.data?.items ?? [];
  const tenants = tenantsQuery.data?.items ?? [];
  const onboarding = onboardingQuery.data?.items ?? [];
  const admins = adminsQuery.data?.items ?? [];
  const exportJobs = exportsQuery.data?.items ?? [];
  const auditEntries = auditQuery.data?.items ?? [];
  const systemOverview = systemOverviewQuery.data?.resource;

  const tenantOptions = tenants.filter((tenant) =>
    resellerFilter === "all" ? true : tenant.tenant.reseller_partner_id === resellerFilter,
  );

  const scopedTenants = tenants.filter((tenant) => {
    const resellerMatches = resellerFilter === "all" ? true : tenant.tenant.reseller_partner_id === resellerFilter;
    const tenantMatches = tenantFilter === "all" ? true : tenant.tenant.id === tenantFilter;
    return resellerMatches && tenantMatches;
  });

  const issueRows = scopedTenants.map((tenant) => {
    const onboardingState = onboarding.find((item) => item.tenant_id === tenant.tenant.id);
    const tenantAdmins = admins.filter((admin) => admin.scopes.some((scope) => scope.tenant_id === tenant.tenant.id));
    const issueSummary = inferIssueSummary({
      status: tenant.tenant.status,
      onboardingStatus: onboardingState?.onboarding_status ?? null,
      credentialStatus: tenant.llm_config?.credential_status ?? null,
      hasAdmins: tenantAdmins.length > 0,
    });
    return {
      tenant,
      onboardingState,
      tenantAdmins,
      issueSummary,
    };
  });

  const filteredAuditEntries = auditEntries.filter((entry) => {
    if (tenantFilter !== "all") {
      return entry.target_id === tenantFilter || entry.after_json?.includes(tenantFilter) || entry.before_json?.includes(tenantFilter);
    }
    if (resellerFilter !== "all") {
      return entry.target_id === resellerFilter || entry.after_json?.includes(resellerFilter) || entry.before_json?.includes(resellerFilter);
    }
    return true;
  });

  const failedOrQueuedExports = exportJobs.filter((job) => job.status !== "complete");

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operations</h1>
          <p className="page-subtitle">
            Investigate onboarding, runtime, export, and audit issues within the current visible scope.
          </p>
        </div>
        <Link className="secondary-button" to="/reports">
          Open reporting
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <div className="metric-card__label">Tenants</div>
          <div className="metric-card__value">{systemOverview?.tenant_count ?? tenants.length}</div>
          <div className="metric-card__trend">Visible in current operational scope</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Invalid Credentials</div>
          <div className="metric-card__value">{systemOverview?.invalid_credential_count ?? 0}</div>
          <div className="metric-card__trend">Require runtime attention</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Stalled Onboarding</div>
          <div className="metric-card__value">{systemOverview?.stalled_onboarding_count ?? 0}</div>
          <div className="metric-card__trend">In-progress tenants needing follow-up</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Open Export Jobs</div>
          <div className="metric-card__value">{failedOrQueuedExports.length}</div>
          <div className="metric-card__trend">Queued or failed artifacts</div>
        </div>
      </div>

      <div className="panel stack">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Investigation Filters</h3>
            <div className="muted">Scope the issue queue and audit activity to a reseller or a specific tenant.</div>
          </div>
        </div>

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="operations_reseller">Reseller</label>
            <select className="field" id="operations_reseller" value={resellerFilter} onChange={(event) => {
              setResellerFilter(event.target.value);
              setTenantFilter("all");
            }}>
              <option value="all">All visible resellers</option>
              {resellers.map((reseller) => (
                <option key={reseller.id} value={reseller.id}>
                  {reseller.reseller_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="operations_tenant">Tenant</label>
            <select className="field" id="operations_tenant" value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)}>
              <option value="all">All tenants in scope</option>
              {tenantOptions.map((tenant) => (
                <option key={tenant.tenant.id} value={tenant.tenant.id}>
                  {tenant.tenant.tenant_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="operations_target_type">Audit Target Type</label>
            <select className="field" id="operations_target_type" value={targetTypeFilter} onChange={(event) => setTargetTypeFilter(event.target.value)}>
              <option value="all">All targets</option>
              <option value="tenant">Tenant</option>
              <option value="group">Group</option>
              <option value="admin_user">Admin</option>
              <option value="report_export_job">Export Job</option>
              <option value="reseller_partner">Reseller</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel">
          <div className="split-header">
            <div>
              <h3 className="panel-title">Issue Queue</h3>
              <div className="muted">Use this view to diagnose tenant setup problems and identify the next best action.</div>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            {issueRows.length === 0 ? (
              <div className="empty-state table-empty-state">No tenants match the current operations filters.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Status</th>
                    <th>Onboarding</th>
                    <th>LLM</th>
                    <th>Issue</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {issueRows.map(({ tenant, onboardingState, issueSummary }) => (
                    <tr key={tenant.tenant.id}>
                      <td>
                        <strong>{tenant.tenant.tenant_name}</strong>
                        <div className="muted">{tenant.profile?.service_mode ?? tenant.tenant.tenant_key}</div>
                      </td>
                      <td><StatusBadge value={tenant.tenant.status} /></td>
                      <td><StatusBadge value={onboardingState?.onboarding_status ?? "draft"} /></td>
                      <td>{tenant.llm_config?.credential_status ?? "Not configured"}</td>
                      <td>{issueSummary}</td>
                      <td>
                        <Link className="ghost-button" to={`/orgs/${tenant.tenant.id}`}>
                          Investigate
                        </Link>
                      </td>
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
              <h3 className="panel-title">Recent Audit Activity</h3>
              <div className="muted">Scope-filtered actions for compliance and investigation context.</div>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            {filteredAuditEntries.length === 0 ? (
              <div className="empty-state table-empty-state">No audit records match the current filters.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Request ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditEntries.slice(0, 20).map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{entry.action_type}</td>
                      <td>{entry.target_type} / {entry.target_id}</td>
                      <td>{entry.request_id ?? "Not captured"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Export Job Diagnostics</h3>
            <div className="muted">Operational view of recent export status and file availability.</div>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          {exportJobs.length === 0 ? (
            <div className="empty-state table-empty-state">No export jobs are visible yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Format</th>
                  <th>Completed</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {exportJobs.slice(0, 20).map((job) => (
                  <tr key={job.id}>
                    <td>{job.report_type}</td>
                    <td>{job.scope_type} / {job.scope_id}</td>
                    <td><StatusBadge value={job.status} /></td>
                    <td>{job.format.toUpperCase()}</td>
                    <td>{formatDateTime(job.completed_at)}</td>
                    <td>{job.file_path ?? "Pending"}</td>
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
