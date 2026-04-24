import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { DASHBOARD_RANGE_OPTIONS, getRangeWindow, type DashboardRangeKey } from "../../features/dashboard/api";
import { getDefaultRangeKey, reportTypeOptions, resolveReportScope } from "../../features/reports/config";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";
import type { Group, ReportExportPayload, ReportScopeType } from "../../lib/types";

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

export function ExportsPage() {
  const queryClient = useQueryClient();
  const { visibleTenants, selectedTenantId, isLoading: scopeLoading } = useOrganizationScope();
  const [reportType, setReportType] = useState<(typeof reportTypeOptions)[number]["value"]>("executive_summary");
  const [scopeType, setScopeType] = useState<ReportScopeType>(selectedTenantId ? "organization" : "global");
  const [organizationId, setOrganizationId] = useState(selectedTenantId ?? "");
  const [resellerId, setResellerId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>(getDefaultRangeKey());
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [statusFilter, setStatusFilter] = useState("all");

  const groupsQuery = useQuery({
    queryKey: ["exports-page-groups", organizationId || "all"],
    queryFn: () => tenantApi.getGroups(organizationId || undefined),
    enabled: !scopeLoading,
  });

  const resellersQuery = useQuery({
    queryKey: ["exports-page-resellers"],
    queryFn: () => tenantApi.listResellers(),
    enabled: !scopeLoading,
  });

  const exportsQuery = useQuery({
    queryKey: ["exports-page-jobs", scopeType, organizationId, groupId, statusFilter],
    queryFn: () =>
      tenantApi.listReportExports({
        scope_type: scopeType === "global" ? undefined : scopeType,
        scope_id:
          scopeType === "organization"
            ? organizationId || undefined
            : scopeType === "group"
              ? groupId || undefined
              : scopeType === "reseller"
                ? resellerId || undefined
                : undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    enabled: !scopeLoading,
  });

  useEffect(() => {
    if (selectedTenantId && !organizationId) {
      setOrganizationId(selectedTenantId);
    }
  }, [organizationId, selectedTenantId]);

  const availableGroups = useMemo(() => {
    const groups = groupsQuery.data?.items ?? [];
    return groups
      .filter((group) => !organizationId || group.tenant_id === organizationId)
      .sort((left, right) => left.group_name.localeCompare(right.group_name));
  }, [groupsQuery.data, organizationId]);

  useEffect(() => {
    if (scopeType === "group" && groupId && !availableGroups.some((group) => group.id === groupId)) {
      setGroupId("");
    }
  }, [availableGroups, groupId, scopeType]);

  const resolvedScope = useMemo(
    () =>
      resolveReportScope({
        scopeType,
        organizationId,
        groupId,
        resellerId,
        tenants: visibleTenants,
        groups: availableGroups,
        resellers: resellersQuery.data?.items ?? [],
      }),
    [availableGroups, groupId, organizationId, resellerId, scopeType, visibleTenants, resellersQuery.data],
  );

  const createPayload = (): ReportExportPayload | null => {
    if (!resolvedScope.valid) {
      return null;
    }
    const window = getRangeWindow(rangeKey);
    return {
      report_type: reportType,
      dimension: resolvedScope.dimension,
      scope_id: resolvedScope.scopeId,
      filters: {},
      start_date: window.start,
      end_date: window.end,
      format,
    };
  };

  const exportMutation = useMutation({
    mutationFn: () => {
      const payload = createPayload();
      if (!payload) {
        throw new Error("Select a valid export scope before creating the file.");
      }
      return tenantApi.createReportExport(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exports-page-jobs"] });
    },
  });

  if (scopeLoading || groupsQuery.isLoading || resellersQuery.isLoading || exportsQuery.isLoading) {
    return <LoadingBlock label="Loading exports..." />;
  }

  const jobs = exportsQuery.data?.items ?? [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Exports</h1>
          <p className="page-subtitle">
            Create CSV or PDF report files and review recent export jobs across your current visible admin scope.
          </p>
        </div>
        <Link className="secondary-button" to="/reports">
          Open reporting
        </Link>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Create Export</h3>
            <div className="muted">Build a shareable file from the same reporting scopes used in the analytics workspace.</div>
          </div>

          {exportMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(exportMutation.error)}</div>
          ) : null}
          {exportMutation.data?.resource ? (
            <div className="section-note section-note--success">
              Export completed and saved to {exportMutation.data.resource.file_path ?? "the server export directory"}.
            </div>
          ) : null}

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="export_report_type">Report Type</label>
              <select
                className="field"
                id="export_report_type"
                value={reportType}
                onChange={(event) => setReportType(event.target.value as (typeof reportTypeOptions)[number]["value"])}
              >
                {reportTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export_scope_type">Scope</label>
              <select
                className="field"
                id="export_scope_type"
                value={scopeType}
                onChange={(event) => setScopeType(event.target.value as ReportScopeType)}
              >
                <option value="global">All Visible Organizations</option>
                <option value="reseller">Single Reseller Portfolio</option>
                <option value="organization">Single Organization</option>
                <option value="group">Single Group</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export_format">Format</label>
              <select className="field" id="export_format" value={format} onChange={(event) => setFormat(event.target.value as "csv" | "pdf")}>
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="export_organization">Organization</label>
              <select
                className="field"
                id="export_organization"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                disabled={scopeType === "global" || scopeType === "reseller"}
              >
                <option value="">Select organization</option>
                {visibleTenants.map((tenant) => (
                  <option key={tenant.tenant.id} value={tenant.tenant.id}>
                    {tenant.tenant.tenant_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export_reseller">Reseller</label>
              <select
                className="field"
                id="export_reseller"
                value={resellerId}
                onChange={(event) => setResellerId(event.target.value)}
                disabled={scopeType !== "reseller"}
              >
                <option value="">Select reseller</option>
                {(resellersQuery.data?.items ?? []).map((reseller) => (
                  <option key={reseller.id} value={reseller.id}>
                    {reseller.reseller_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export_group">Group</label>
              <select
                className="field"
                id="export_group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                disabled={scopeType !== "group"}
              >
                <option value="">Select group</option>
                {availableGroups.map((group: Group) => (
                  <option key={group.id} value={group.id}>
                    {group.group_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="export_range">Range</label>
              <select
                className="field"
                id="export_range"
                value={rangeKey}
                onChange={(event) => setRangeKey(event.target.value as DashboardRangeKey)}
              >
                {DASHBOARD_RANGE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="section-note">Export scope: {resolvedScope.scopeLabel}</div>

          <div>
            <button
              className="primary-button"
              disabled={!createPayload() || exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
              type="button"
            >
              {exportMutation.isPending ? "Creating..." : "Create Export"}
            </button>
          </div>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Export Notes</h3>
            <div className="muted">CSV exports are metric-friendly. PDF exports are shareable snapshots for stakeholder review.</div>
          </div>
          <div className="section-note">Each export stores the generated file path so operations or admins can retrieve the artifact directly from the shared workspace.</div>
          <div className="section-note">Group-level exports are useful for delegated group admins who need their own dashboard metrics and reporting surface.</div>
          <div className="section-note">Use the Reporting page when you want to preview analytics before generating a file.</div>
        </div>
      </div>

      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Recent Export Jobs</h3>
            <div className="muted">History across the current admin-visible scope.</div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select className="select-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="complete">Complete</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </select>
            <button
              className="ghost-button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["exports-page-jobs"] })}
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          {jobs.length === 0 ? (
            <div className="empty-state table-empty-state">No export jobs match the current filters yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Scope</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.report_type}</td>
                    <td>{job.scope_type} / {job.scope_id}</td>
                    <td>{job.format.toUpperCase()}</td>
                    <td><StatusBadge value={job.status} /></td>
                    <td>{formatDateTime(job.created_at)}</td>
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
