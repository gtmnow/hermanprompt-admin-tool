import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { SimpleTrendChart } from "../../components/charts/SimpleTrendChart";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { DASHBOARD_RANGE_OPTIONS, getRangeLabel, getRangeWindow, type DashboardRangeKey } from "../../features/dashboard/api";
import {
  deriveBehaviorGaps,
  derivePromptQualitySignals,
  getDefaultRangeKey,
  reportTypeOptions,
  resolveReportScope,
} from "../../features/reports/config";
import { tenantApi } from "../../features/tenants/api";
import type { Group, ReportRunPayload, ReportScopeType } from "../../lib/types";

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

export function ReportsPage() {
  const { visibleTenants, selectedTenantId, isLoading: scopeLoading } = useOrganizationScope();
  const [reportType, setReportType] = useState<(typeof reportTypeOptions)[number]["value"]>("dashboard_summary");
  const [scopeType, setScopeType] = useState<ReportScopeType>(selectedTenantId ? "organization" : "global");
  const [organizationId, setOrganizationId] = useState(selectedTenantId ?? "");
  const [resellerId, setResellerId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>(getDefaultRangeKey());
  const [activeRequest, setActiveRequest] = useState<ReportRunPayload | null>(null);

  const resellersQuery = useQuery({
    queryKey: ["reports-page-resellers"],
    queryFn: () => tenantApi.listResellers(),
    enabled: !scopeLoading,
  });

  const groupsQuery = useQuery({
    queryKey: ["reports-page-groups", organizationId || "all"],
    queryFn: () => tenantApi.getGroups(organizationId || undefined),
    enabled: !scopeLoading,
  });

  useEffect(() => {
    if (selectedTenantId && !organizationId) {
      setOrganizationId(selectedTenantId);
    }
  }, [organizationId, selectedTenantId]);

  const groups = groupsQuery.data?.items ?? [];
  const availableGroups = useMemo(() => {
    const relevantGroups = groups.filter((group) => !organizationId || group.tenant_id === organizationId);
    return relevantGroups.sort((left, right) => left.group_name.localeCompare(right.group_name));
  }, [groups, organizationId]);

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

  const buildRequest = (): ReportRunPayload | null => {
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
      visualization_preferences: {},
    };
  };

  useEffect(() => {
    if (!activeRequest) {
      const nextRequest = buildRequest();
      if (nextRequest) {
        setActiveRequest(nextRequest);
      }
    }
  }, [activeRequest, rangeKey, reportType, resolvedScope]);

  const reportQuery = useQuery({
    queryKey: [
      "reports-page-report",
      activeRequest?.report_type ?? "none",
      activeRequest?.dimension ?? "none",
      activeRequest?.scope_id ?? "none",
      activeRequest?.start_date ?? "none",
      activeRequest?.end_date ?? "none",
    ],
    queryFn: () => tenantApi.runReport(activeRequest as ReportRunPayload),
    enabled: Boolean(activeRequest),
  });

  const exportMutation = useMutation({
    mutationFn: (format: "csv" | "pdf") => {
      const request = buildRequest();
      if (!request) {
        throw new Error("Select a valid scope before exporting.");
      }
      return tenantApi.createReportExport({
        report_type: request.report_type,
        dimension: request.dimension,
        scope_id: request.scope_id,
        filters: request.filters,
        start_date: request.start_date,
        end_date: request.end_date,
        format,
      });
    },
  });

  if (scopeLoading || groupsQuery.isLoading || resellersQuery.isLoading) {
    return <LoadingBlock label="Loading reporting workspace..." />;
  }

  const report = reportQuery.data?.resource;
  const selectedReportType = reportTypeOptions.find((option) => option.value === reportType);
  const rangeLabel = getRangeLabel(rangeKey);
  const qualitySignals = report ? derivePromptQualitySignals(report) : null;
  const behaviorGaps = report ? deriveBehaviorGaps(report) : [];
  const usageTrend = report?.charts.find((chart) => chart.label === "Usage Trend")?.points ?? [];
  const improvementTrend = report?.charts.find((chart) => chart.label === "Improvement Trend")?.points ?? [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporting</h1>
          <p className="page-subtitle">
            Generate KPI views, quality analysis, behavior-gap summaries, and export-ready reports for organizations and groups.
          </p>
        </div>
        <Link className="secondary-button" to="/exports">
          Open exports
        </Link>
      </div>

      <div className="panel stack">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Generate Report</h3>
            <div className="muted">{selectedReportType?.description}</div>
          </div>
          <div className="range-pill-group" role="tablist" aria-label="Reporting period">
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

        {reportQuery.error ? (
          <div className="section-note section-note--danger">{mutationMessage(reportQuery.error)}</div>
        ) : null}
        {exportMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(exportMutation.error)}</div>
        ) : null}
        {exportMutation.data?.resource ? (
          <div className="section-note section-note--success">
            Export created as {exportMutation.data.resource.format.toUpperCase()} and saved to {exportMutation.data.resource.file_path ?? "the server export directory"}.
          </div>
        ) : null}

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="report_type">Report Type</label>
            <select
              className="field"
              id="report_type"
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
            <label className="field-label" htmlFor="report_scope_type">Scope</label>
            <select
              className="field"
              id="report_scope_type"
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
            <label className="field-label" htmlFor="report_organization">Organization</label>
            <select
              className="field"
              id="report_organization"
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
        </div>

        {scopeType === "reseller" ? (
          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="report_reseller">Reseller</label>
              <select
                className="field"
                id="report_reseller"
                value={resellerId}
                onChange={(event) => setResellerId(event.target.value)}
              >
                <option value="">Select reseller</option>
                {(resellersQuery.data?.items ?? []).map((reseller) => (
                  <option key={reseller.id} value={reseller.id}>
                    {reseller.reseller_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {scopeType === "group" ? (
          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="report_group">Group</label>
              <select
                className="field"
                id="report_group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                <option value="">Select group</option>
                {availableGroups.map((group: Group) => (
                  <option key={group.id} value={group.id}>
                    {group.group_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button
            className="primary-button"
            disabled={!buildRequest() || reportQuery.isFetching}
            onClick={() => {
              const nextRequest = buildRequest();
              if (nextRequest) {
                setActiveRequest(nextRequest);
              }
            }}
            type="button"
          >
            {reportQuery.isFetching ? "Generating..." : "Generate Report"}
          </button>
          <button
            className="secondary-button"
            disabled={!report || exportMutation.isPending}
            onClick={() => exportMutation.mutate("csv")}
            type="button"
          >
            {exportMutation.isPending ? "Exporting..." : "Export CSV"}
          </button>
          <button
            className="ghost-button"
            disabled={!report || exportMutation.isPending}
            onClick={() => exportMutation.mutate("pdf")}
            type="button"
          >
            Export PDF
          </button>
        </div>

        <div className="section-note">
          Current scope: {resolvedScope.scopeLabel} for {rangeLabel.toLowerCase()}.
        </div>
      </div>

      {reportQuery.isLoading && !report ? <LoadingBlock label="Generating report..." /> : null}

      {report ? (
        <>
          <div className="kpi-grid">
            {report.kpis.map((item) => (
              <div className="card metric-card" key={item.label}>
                <div className="metric-card__label">{item.label}</div>
                <div className="metric-card__value">{item.value}</div>
                <div className="metric-card__trend">{selectedReportType?.label} / {rangeLabel}</div>
              </div>
            ))}
          </div>

          <div className="grid grid--two">
            <SimpleTrendChart
              title="Usage Trend"
              subtitle={`Observed session activity for ${resolvedScope.scopeLabel}`}
              data={usageTrend}
              color="#0284C7"
              emptyMessage="Not enough recorded activity is available yet to show a usage trend."
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
                  <h3 className="panel-title">Prompt Quality Analysis</h3>
                  <div className="muted">Derived from the current improvement and activity trends.</div>
                </div>
              </div>
              {qualitySignals ? (
                <div className="stack">
                  <div className="key-value">
                    <div className="muted">Quality Band</div>
                    <div>{qualitySignals.qualityBand}</div>
                  </div>
                  <div className="key-value">
                    <div className="muted">Average Improvement</div>
                    <div>{qualitySignals.averageImprovement}%</div>
                  </div>
                  <div className="section-note">{qualitySignals.trendDirection}</div>
                  <div className="section-note">{qualitySignals.engagementDirection}</div>
                </div>
              ) : null}
            </div>

            <div className="panel">
              <div className="split-header">
                <div>
                  <h3 className="panel-title">Behavior Gaps</h3>
                  <div className="muted">Signals that may need operational follow-up.</div>
                </div>
              </div>
              {behaviorGaps.length === 0 ? (
                <div className="section-note">No obvious behavior gaps were detected from the currently available analytics signals.</div>
              ) : (
                <div className="stack">
                  {behaviorGaps.map((gap) => (
                    <div className="section-note" key={gap}>
                      {gap}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="split-header">
              <div>
                <h3 className="panel-title">Report Metrics</h3>
                <div className="muted">Portable summary values used for exports and downstream communication.</div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tables.map((row, index) => (
                    <tr key={`${String(row.metric)}-${index}`}>
                      <td>{String(row.metric ?? `metric_${index}`)}</td>
                      <td>{String(row.value ?? "Not available")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
