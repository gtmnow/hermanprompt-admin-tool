import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";

const defaultGroupForm = {
  tenant_id: "",
  group_name: "",
  group_type: "Working Group",
  business_unit: "",
  owner_name: "",
  description: "",
};

export function GroupsPage() {
  const queryClient = useQueryClient();
  const { selectedTenantId } = useOrganizationScope();
  const [tenantId, setTenantId] = useState("all");
  const [search, setSearch] = useState("");
  const [groupForm, setGroupForm] = useState(defaultGroupForm);

  const tenantsQuery = useQuery({
    queryKey: ["groups-page-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const groupsQuery = useQuery({
    queryKey: ["groups-page-groups"],
    queryFn: () => tenantApi.getGroups(),
  });

  useEffect(() => {
    if (!groupForm.tenant_id && tenantsQuery.data?.items?.[0]?.tenant.id) {
      setGroupForm((current) => ({ ...current, tenant_id: tenantsQuery.data?.items[0].tenant.id ?? "" }));
    }
  }, [groupForm.tenant_id, tenantsQuery.data]);

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }

    setTenantId(selectedTenantId);
    setGroupForm((current) => ({
      ...current,
      tenant_id: current.tenant_id || selectedTenantId,
    }));
  }, [selectedTenantId]);

  const createGroupMutation = useMutation({
    mutationFn: () => tenantApi.createGroup(groupForm),
    onSuccess: () => {
      setGroupForm((current) => ({
        ...defaultGroupForm,
        tenant_id: current.tenant_id,
      }));
      queryClient.invalidateQueries({ queryKey: ["groups-page-groups"] });
      queryClient.invalidateQueries({ queryKey: ["activation-groups"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-groups"] });
    },
  });

  const filteredGroups = useMemo(() => {
    const groups = groupsQuery.data?.items ?? [];
    return groups.filter((group) => {
      const matchesTenant = tenantId === "all" ? true : group.tenant_id === tenantId;
      const haystack = [
        group.group_name,
        group.group_type,
        group.profile?.business_unit,
        group.profile?.owner_name,
        group.profile?.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesTenant && haystack.includes(search.toLowerCase());
    });
  }, [groupsQuery.data, search, tenantId]);

  if (tenantsQuery.isLoading || groupsQuery.isLoading) {
    return <LoadingBlock label="Loading groups..." />;
  }

  const tenantNameById = new Map((tenantsQuery.data?.items ?? []).map((item) => [item.tenant.id, item.tenant.tenant_name]));
  const groups = groupsQuery.data?.items ?? [];
  const groupCoverageGap = (tenantsQuery.data?.items ?? []).filter(
    (tenant) => !groups.some((group) => group.tenant_id === tenant.tenant.id),
  );

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Groups</h1>
          <p className="page-subtitle">
            Manage admin-owned groups for each organization. These groups support onboarding, reporting scope, and future assignment workflows inside the admin tool.
          </p>
        </div>
        <Link className="secondary-button" to="/activation">
          Open activation
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="card metric-card">
          <div className="metric-card__label">Groups</div>
          <div className="metric-card__value">{groups.length}</div>
          <div className="metric-card__trend">Admin-owned group records</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Active Groups</div>
          <div className="metric-card__value">{groups.filter((group) => group.is_active).length}</div>
          <div className="metric-card__trend">Currently enabled for management</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Organizations</div>
          <div className="metric-card__value">{new Set(groups.map((group) => group.tenant_id)).size}</div>
          <div className="metric-card__trend">Organizations with defined groups</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Owned Groups</div>
          <div className="metric-card__value">{groups.filter((group) => Boolean(group.profile?.owner_name)).length}</div>
          <div className="metric-card__trend">Groups with an assigned owner</div>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Create Group</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Use this when an organization needs scoped admin groupings before activation is complete.
            </div>
          </div>

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="group_tenant_id">Organization</label>
              <select
                className="field"
                id="group_tenant_id"
                value={groupForm.tenant_id}
                onChange={(event) => setGroupForm((current) => ({ ...current, tenant_id: event.target.value }))}
              >
                <option value="">Select organization</option>
                {(tenantsQuery.data?.items ?? []).map((item) => (
                  <option key={item.tenant.id} value={item.tenant.id}>
                    {item.tenant.tenant_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="group_name">Group Name</label>
              <input
                className="field"
                id="group_name"
                value={groupForm.group_name}
                onChange={(event) => setGroupForm((current) => ({ ...current, group_name: event.target.value }))}
              />
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="group_type">Group Type</label>
              <input
                className="field"
                id="group_type"
                value={groupForm.group_type}
                onChange={(event) => setGroupForm((current) => ({ ...current, group_type: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="group_business_unit">Business Unit</label>
              <input
                className="field"
                id="group_business_unit"
                value={groupForm.business_unit}
                onChange={(event) => setGroupForm((current) => ({ ...current, business_unit: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="group_owner_name">Owner</label>
              <input
                className="field"
                id="group_owner_name"
                value={groupForm.owner_name}
                onChange={(event) => setGroupForm((current) => ({ ...current, owner_name: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="group_description">Description</label>
            <textarea
              className="field"
              id="group_description"
              rows={4}
              value={groupForm.description}
              onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>

          <button
            className="primary-button"
            disabled={!groupForm.tenant_id || !groupForm.group_name.trim()}
            onClick={() => createGroupMutation.mutate()}
            type="button"
          >
            {createGroupMutation.isPending ? "Saving..." : "Save group"}
          </button>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">How Groups Fit</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              The imported Herman Prompt snapshot gives us realistic users and activity, while groups remain admin-owned setup records that the activation flow can shape.
            </div>
          </div>
          <div className="section-note">
            Create business-unit or team-level groups here first, then use the activation workflow to review readiness and assign tenant admins.
          </div>
          <div className="section-note">
            If an organization is already live in Herman Prompt, these groups still belong to the admin layer and can evolve without direct service calls.
          </div>
          <div className="section-note">
            {groupCoverageGap.length === 0
              ? "Every visible organization has at least one admin-owned group configured."
              : `${groupCoverageGap.length} visible organization${groupCoverageGap.length === 1 ? "" : "s"} still need an initial group before activation feels complete.`}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="filter-bar">
          <input
            className="search-input"
            placeholder="Search groups"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ maxWidth: 320 }}
          />
          <select
            className="select-input"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            style={{ maxWidth: 260 }}
          >
            <option value="all">All organizations</option>
            {(tenantsQuery.data?.items ?? []).map((item) => (
              <option key={item.tenant.id} value={item.tenant.id}>
                {item.tenant.tenant_name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-card">
          <div className="table-wrap">
            {filteredGroups.length === 0 ? (
              <div className="empty-state table-empty-state">
                No groups match the current filters yet. Create the first group above or switch to a broader organization scope.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Organization</th>
                    <th>Business Unit</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGroups.map((group) => (
                    <tr key={group.id}>
                      <td>
                        <strong>{group.group_name}</strong>
                        <div className="muted">{group.profile?.description ?? group.group_type ?? "No description yet"}</div>
                      </td>
                      <td>
                        <Link to={`/orgs/${group.tenant_id}`} style={{ fontWeight: 700, color: "var(--text-strong)" }}>
                          {tenantNameById.get(group.tenant_id) ?? group.tenant_id}
                        </Link>
                      </td>
                      <td>{group.profile?.business_unit ?? group.group_type ?? "Pending"}</td>
                      <td>{group.profile?.owner_name ?? "Pending"}</td>
                      <td><StatusBadge value={group.is_active ? "active" : "inactive"} /></td>
                      <td>{formatDateTime(group.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
