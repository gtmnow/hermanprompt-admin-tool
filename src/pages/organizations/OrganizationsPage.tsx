import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDate } from "../../lib/format";

export function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const tenantsQuery = useQuery({
    queryKey: ["tenants"],
    queryFn: () => tenantApi.listTenants(),
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => tenantApi.getUsers(),
  });

  const filteredItems = useMemo(() => {
    const tenants = tenantsQuery.data?.items ?? [];
    return tenants.filter((item) => {
      const matchesSearch =
        item.tenant.tenant_name.toLowerCase().includes(search.toLowerCase()) ||
        item.tenant.tenant_key.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = status === "all" ? true : item.tenant.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [search, status, tenantsQuery.data]);

  if (tenantsQuery.isLoading || usersQuery.isLoading) {
    return <LoadingBlock label="Loading organizations..." />;
  }

  const users = usersQuery.data?.items ?? [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">
            Browse the tenants in your current scope, check onboarding health, and jump into detailed management views.
          </p>
        </div>
        <Link className="primary-button" to="/activation/new">
          New organization
        </Link>
      </div>

      <div className="panel">
        <div className="filter-bar">
          <input
            className="search-input"
            placeholder="Search organizations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ maxWidth: 320 }}
          />
          <select className="select-input" value={status} onChange={(event) => setStatus(event.target.value)} style={{ maxWidth: 220 }}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="onboarding">Onboarding</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Status</th>
                  <th>Users</th>
                  <th>LLM</th>
                  <th>Plan</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const tenantUsers = users.filter((user) => user.tenant_id === item.tenant.id);
                  const activeUsers = tenantUsers.filter((user) => user.status === "active").length;
                  return (
                    <tr key={item.tenant.id}>
                      <td>
                        <Link to={`/orgs/${item.tenant.id}`} style={{ fontWeight: 700, color: "var(--text-strong)" }}>
                          {item.tenant.tenant_name}
                        </Link>
                        <div className="muted">{item.tenant.tenant_key}</div>
                      </td>
                      <td>
                        <StatusBadge value={item.tenant.status} />
                      </td>
                      <td>
                        <strong>{tenantUsers.length}</strong>
                        <div className="muted">{activeUsers} active</div>
                      </td>
                      <td>
                        {item.llm_config ? (
                          <StatusBadge value={item.llm_config.credential_status} />
                        ) : (
                          <StatusBadge value="draft" tone="warning" />
                        )}
                      </td>
                      <td>{item.tenant.plan_tier ?? "Not set"}</td>
                      <td>{formatDate(item.tenant.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
