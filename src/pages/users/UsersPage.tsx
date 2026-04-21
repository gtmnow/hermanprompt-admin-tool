import { useMemo, useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";
import type { UserMembership } from "../../lib/types";

type UserActionKind = "deactivate" | "reinvite" | "delete";

function actionLabel(action: UserActionKind): string {
  switch (action) {
    case "deactivate":
      return "Deactivate User";
    case "reinvite":
      return "Re-Invite User";
    case "delete":
      return "Fully Delete";
  }
}

function actionCompletionMessage(action: UserActionKind): string {
  switch (action) {
    case "deactivate":
      return "The user has been deactivated successfully.";
    case "reinvite":
      return "The invitation has been re-sent successfully.";
    case "delete":
      return "The user has been deactivated and moved into the Deactivated_Users organization.";
  }
}

function actionConfirmationMessage(action: UserActionKind): string {
  switch (action) {
    case "deactivate":
      return "Are you sure you want to deactivate this user? Their access will be turned off until they are updated again by an administrator.";
    case "reinvite":
      return "Are you sure you want to send a fresh invitation to this user? This will replace any existing invitation token.";
    case "delete":
      return "Are you sure you want to fully delete this user? Their login will be deactivated and they will be moved into the Deactivated_Users organization while their scoring data is retained.";
  }
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState("all");
  const [selectedUser, setSelectedUser] = useState<UserMembership | null>(null);
  const [pendingAction, setPendingAction] = useState<UserActionKind | null>(null);
  const [completedAction, setCompletedAction] = useState<UserActionKind | null>(null);
  const queryClient = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["users-page-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const usersQuery = useQuery({
    queryKey: ["users-page-users"],
    queryFn: () => tenantApi.getUsers(),
  });

  const tenantNameById = useMemo(
    () =>
      new Map((tenantsQuery.data?.items ?? []).map((item) => [item.tenant.id, item.tenant.tenant_name])),
    [tenantsQuery.data],
  );

  const filteredUsers = useMemo(() => {
    const users = usersQuery.data?.items ?? [];
    return users.filter((user) => {
      const matchesTenant = tenantId === "all" ? true : user.tenant_id === tenantId;
      const haystack = [
        user.user_id_hash,
        user.profile?.first_name,
        user.profile?.last_name,
        user.profile?.email,
        user.profile?.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase());
      return matchesTenant && matchesSearch;
    });
  }, [search, tenantId, usersQuery.data]);

  const userActionMutation = useMutation({
    mutationFn: (action: UserActionKind) => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return tenantApi.runUserAction(selectedUser.user_id_hash, {
        tenant_id: selectedUser.tenant_id,
        action,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users-page-users"] }),
        queryClient.invalidateQueries({ queryKey: ["users-page-tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["tenant-users"] }),
        queryClient.invalidateQueries({ queryKey: ["tenant"] }),
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
      ]);
    },
  });

  if (tenantsQuery.isLoading || usersQuery.isLoading) {
    return <LoadingBlock label="Loading users..." />;
  }

  const users = usersQuery.data?.items ?? [];
  const activeUsers = users.filter((user) => user.status === "active").length;
  const withSessions = users.filter((user) => (user.profile?.sessions_count ?? 0) > 0).length;

  return (
    <div className="stack users-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">
            Review the current Herman Prompt user inventory inside the admin tool, including auth-backed identity records, activity, and organization context.
          </p>
        </div>
        <Link className="secondary-button" to="/orgs">
          View organizations
        </Link>
      </div>

      <div className="kpi-grid users-page__kpis">
        <div className="card metric-card">
          <div className="metric-card__label">Users</div>
          <div className="metric-card__value">{users.length}</div>
          <div className="metric-card__trend">Snapshot-backed total</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Active Users</div>
          <div className="metric-card__value">{activeUsers}</div>
          <div className="metric-card__trend">Currently active in the imported dataset</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">With Sessions</div>
          <div className="metric-card__value">{withSessions}</div>
          <div className="metric-card__trend">Users with captured conversation history</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Organizations</div>
          <div className="metric-card__value">{new Set(users.map((user) => user.tenant_id)).size}</div>
          <div className="metric-card__trend">Across current visible scope</div>
        </div>
      </div>

      <div className="panel users-page__panel">
        <div className="filter-bar users-page__filters">
          <input
            className="search-input users-page__search"
            placeholder="Search by name, email, or user hash"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select-input users-page__select"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
          >
            <option value="all">All organizations</option>
            {(tenantsQuery.data?.items ?? []).map((item) => (
              <option key={item.tenant.id} value={item.tenant.id}>
                {item.tenant.tenant_name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-card users-page__table-card">
          <div className="table-wrap">
            <table className="data-table users-page__table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organization</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Sessions</th>
                  <th>Improvement</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="users-page__user-cell">
                      <strong>
                        {user.profile?.first_name || user.profile?.last_name
                          ? `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim()
                          : user.user_id_hash}
                      </strong>
                      <div className="muted">{user.profile?.email ?? user.user_id_hash}</div>
                    </td>
                    <td className="users-page__org-cell">
                      <Link className="users-page__org-link" to={`/orgs/${user.tenant_id}`}>
                        {tenantNameById.get(user.tenant_id) ?? user.tenant_id}
                      </Link>
                    </td>
                    <td>
                      <button
                        className="users-page__status-button"
                        type="button"
                        onClick={() => {
                          setSelectedUser(user);
                          setPendingAction(null);
                          setCompletedAction(null);
                          userActionMutation.reset();
                        }}
                      >
                        <StatusBadge value={user.status} />
                      </button>
                    </td>
                    <td>{user.profile?.title ?? "Member"}</td>
                    <td>{user.profile?.sessions_count ?? 0}</td>
                    <td>{user.profile?.avg_improvement_pct != null ? `${user.profile.avg_improvement_pct}%` : "Pending"}</td>
                    <td>{formatDateTime(user.profile?.last_activity_at ?? user.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedUser ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => {
            setSelectedUser(null);
            setPendingAction(null);
            setCompletedAction(null);
            userActionMutation.reset();
          }}
        >
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-status-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="user-status-dialog-title">Update User Status</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {selectedUser.profile?.email ?? selectedUser.user_id_hash}
                </div>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setSelectedUser(null);
                  setPendingAction(null);
                  setCompletedAction(null);
                  userActionMutation.reset();
                }}
              >
                Close
              </button>
            </div>

            {userActionMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {userActionMutation.error instanceof Error ? userActionMutation.error.message : "Unable to update user status."}
              </div>
            ) : null}

            {completedAction ? (
              <>
                <div className="section-note section-note--success" style={{ marginTop: 18 }}>
                  {actionCompletionMessage(completedAction)}
                </div>
                <div className="dialog-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      setSelectedUser(null);
                      setPendingAction(null);
                      setCompletedAction(null);
                      userActionMutation.reset();
                    }}
                  >
                    Action Completed
                  </button>
                </div>
              </>
            ) : pendingAction ? (
              <>
                <div className="section-note" style={{ marginTop: 18 }}>
                  {actionConfirmationMessage(pendingAction)}
                </div>
                <div className="dialog-actions">
                  <button
                    className="primary-button"
                    disabled={userActionMutation.isPending}
                    onClick={() =>
                      userActionMutation.mutate(pendingAction, {
                        onSuccess: () => {
                          setPendingAction(null);
                          setCompletedAction(pendingAction);
                        },
                      })
                    }
                    type="button"
                  >
                    {userActionMutation.isPending ? "Processing..." : `Confirm ${actionLabel(pendingAction)}`}
                  </button>
                  <button
                    className="ghost-button"
                    disabled={userActionMutation.isPending}
                    onClick={() => {
                      setPendingAction(null);
                      userActionMutation.reset();
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="section-note" style={{ marginTop: 18 }}>
                  Choose how this user should be handled. Full delete will disable login and move the user into the
                  `Deactivated_Users` organization while keeping their scoring data in the database for now.
                </div>

                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    disabled={userActionMutation.isPending}
                    onClick={() => {
                      setPendingAction("deactivate");
                      userActionMutation.reset();
                    }}
                    type="button"
                  >
                    Deactivate User
                  </button>
                  <button
                    className="primary-button"
                    disabled={userActionMutation.isPending}
                    onClick={() => {
                      setPendingAction("reinvite");
                      userActionMutation.reset();
                    }}
                    type="button"
                  >
                    Re-Invite User
                  </button>
                  <button
                    className="ghost-button users-page__danger-button"
                    disabled={userActionMutation.isPending}
                    onClick={() => {
                      setPendingAction("delete");
                      userActionMutation.reset();
                    }}
                    type="button"
                  >
                    Fully Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
