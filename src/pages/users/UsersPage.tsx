import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";
import type { Group, UserMembership } from "../../lib/types";
import { parseImportedUsers } from "../../lib/userImport";

type UserActionKind = "deactivate" | "reinvite" | "delete";
type UserLimitDialogState = {
  requestedUsers: number;
  currentUsers: number;
  limit: number;
  blocked: boolean;
};

type UserEditForm = {
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  status: UserMembership["status"];
  is_primary: boolean;
  group_ids: string[];
};

const defaultUserEditForm: UserEditForm = {
  first_name: "",
  last_name: "",
  email: "",
  title: "",
  status: "invited",
  is_primary: true,
  group_ids: [],
};

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

function mutationMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

function tierUserLimit(limitSource?: { max_users: number | null; has_unlimited_users: boolean } | null) {
  if (!limitSource || limitSource.has_unlimited_users) {
    return null;
  }
  return limitSource.max_users;
}

function buildUserEditForm(user: UserMembership): UserEditForm {
  return {
    first_name: user.profile?.first_name ?? "",
    last_name: user.profile?.last_name ?? "",
    email: user.profile?.email ?? "",
    title: user.profile?.title ?? "",
    status: user.status,
    is_primary: user.is_primary,
    group_ids: user.group_memberships.map((membership) => membership.group_id),
  };
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState("all");
  const [importTenantId, setImportTenantId] = useState("");
  const [importText, setImportText] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserMembership | null>(null);
  const [userEditForm, setUserEditForm] = useState<UserEditForm>(defaultUserEditForm);
  const [pendingAction, setPendingAction] = useState<UserActionKind | null>(null);
  const [completedAction, setCompletedAction] = useState<UserActionKind | null>(null);
  const [userLimitDialog, setUserLimitDialog] = useState<UserLimitDialogState | null>(null);
  const queryClient = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["users-page-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const usersQuery = useQuery({
    queryKey: ["users-page-users"],
    queryFn: () => tenantApi.getUsers(),
  });
  const groupsQuery = useQuery({
    queryKey: ["users-page-groups"],
    queryFn: () => tenantApi.getGroups(),
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

  const selectedUserGroups = useMemo(
    () =>
      (groupsQuery.data?.items ?? []).filter((group) => group.tenant_id === selectedUser?.tenant_id),
    [groupsQuery.data, selectedUser],
  );

  const invalidateUserQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-page-users"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-tenants"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant"] }),
      queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    ]);
  };

  const openUserDialog = (user: UserMembership) => {
    setSelectedUser(user);
    setUserEditForm(buildUserEditForm(user));
    setPendingAction(null);
    setCompletedAction(null);
    userActionMutation.reset();
    updateUserMutation.reset();
  };

  const closeUserDialog = () => {
    setSelectedUser(null);
    setUserEditForm(defaultUserEditForm);
    setPendingAction(null);
    setCompletedAction(null);
    userActionMutation.reset();
    updateUserMutation.reset();
  };

  const toggleGroupSelection = (groupId: string) => {
    setUserEditForm((current) => ({
      ...current,
      group_ids: current.group_ids.includes(groupId)
        ? current.group_ids.filter((value) => value !== groupId)
        : [...current.group_ids, groupId],
    }));
  };

  const updateUserMutation = useMutation({
    mutationFn: () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return tenantApi.updateUser(selectedUser.user_id_hash, selectedUser.tenant_id, {
        first_name: userEditForm.first_name || null,
        last_name: userEditForm.last_name || null,
        email: userEditForm.email || null,
        title: userEditForm.title || null,
        status: userEditForm.status,
        is_primary: userEditForm.is_primary,
        group_ids: userEditForm.group_ids,
      });
    },
    onSuccess: async ({ resource }) => {
      await invalidateUserQueries();
      setSelectedUser(resource);
      setUserEditForm(buildUserEditForm(resource));
    },
  });

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
    onSuccess: async ({ resource }) => {
      await invalidateUserQueries();
      setSelectedUser(resource);
      setUserEditForm(buildUserEditForm(resource));
    },
  });

  useEffect(() => {
    if (!importTenantId && tenantsQuery.data?.items?.[0]?.tenant.id) {
      setImportTenantId(tenantsQuery.data.items[0].tenant.id);
    }
  }, [importTenantId, tenantsQuery.data]);

  useEffect(() => {
    if (tenantId !== "all") {
      setImportTenantId(tenantId);
    }
  }, [tenantId]);

  const parsedImportRows = useMemo(() => parseImportedUsers(importText), [importText]);

  const importUsersMutation = useMutation({
    mutationFn: async () => {
      if (!importTenantId) {
        throw new Error("Select an organization for the import.");
      }
      if (parsedImportRows.length === 0) {
        throw new Error("Paste at least one valid user row to import.");
      }

      const groups = await tenantApi.getGroups(importTenantId);
      const groupIdByName = new Map(
        groups.items.map((group) => [group.group_name.trim().toLowerCase(), group.id]),
      );

      for (const row of parsedImportRows) {
        const groupId = row.group_name ? groupIdByName.get(row.group_name.trim().toLowerCase()) : undefined;
        await tenantApi.createUser({
          user_id_hash: row.user_id_hash,
          tenant_id: importTenantId,
          group_ids: groupId ? [groupId] : [],
          status: row.status,
          is_primary: true,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          email: row.email || null,
          title: row.title || null,
        });
      }
    },
    onSuccess: async () => {
      setImportText("");
      await Promise.all([
        invalidateUserQueries(),
        queryClient.invalidateQueries({ queryKey: ["tenant-onboarding"] }),
        queryClient.invalidateQueries({ queryKey: ["activation-users"] }),
        queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail"] }),
      ]);
    },
  });

  if (tenantsQuery.isLoading || usersQuery.isLoading || groupsQuery.isLoading) {
    return <LoadingBlock label="Loading users..." />;
  }

  const users = usersQuery.data?.items ?? [];
  const activeUsers = users.filter((user) => user.status === "active").length;
  const withSessions = users.filter((user) => (user.profile?.sessions_count ?? 0) > 0).length;
  const groupNameById = new Map((groupsQuery.data?.items ?? []).map((group) => [group.id, group.group_name]));
  const selectedImportTenant = (tenantsQuery.data?.items ?? []).find((item) => item.tenant.id === importTenantId) ?? null;
  const currentUsersForImportTenant = users.filter((user) => user.tenant_id === importTenantId && user.status !== "deleted").length;

  function requestBulkImport() {
    const limit = tierUserLimit(selectedImportTenant?.service_tier ?? null);
    if (!limit) {
      importUsersMutation.mutate();
      return;
    }
    setUserLimitDialog({
      requestedUsers: parsedImportRows.length,
      currentUsers: currentUsersForImportTenant,
      limit,
      blocked: currentUsersForImportTenant + parsedImportRows.length > limit,
    });
  }

  return (
    <div className="stack users-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">
            Review the current Herman Prompt user inventory inside the admin tool, including auth-backed identity records, activity, organization context, and editable access assignments.
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
        <div className="split-header users-page__filters">
          <div>
            <h3 className="panel-title">Bulk Import Users</h3>
            <div className="muted">Paste CSV or tab-separated rows with headers like `email,first_name,last_name,title,group_name,status,user_id_hash`.</div>
          </div>
        </div>

        {importUsersMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(importUsersMutation.error)}</div>
        ) : null}

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="users_import_tenant">Import Into Organization</label>
            <select
              className="field"
              id="users_import_tenant"
              value={importTenantId}
              onChange={(event) => setImportTenantId(event.target.value)}
            >
              <option value="">Select organization</option>
              {(tenantsQuery.data?.items ?? []).map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.tenant_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="users_import_text">User Rows</label>
          <textarea
            className="field"
            id="users_import_text"
            rows={7}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="field-tip">The preview below ignores blank lines and auto-generates a user hash when one is not supplied.</div>
        </div>

        <div className="section-note">
          {parsedImportRows.length} row{parsedImportRows.length === 1 ? "" : "s"} ready to import.
        </div>

        <div>
          <button
            className="primary-button"
            disabled={!importTenantId || parsedImportRows.length === 0 || importUsersMutation.isPending}
            onClick={requestBulkImport}
            type="button"
          >
            {importUsersMutation.isPending ? "Importing..." : "Import users"}
          </button>
        </div>

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
                  <th>Groups</th>
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
                          : "Unnamed user"}
                      </strong>
                      <div className="muted">{user.profile?.email ?? "No email on file"}</div>
                    </td>
                    <td className="users-page__org-cell">
                      <Link className="users-page__org-link" to={`/orgs/${user.tenant_id}`}>
                        {tenantNameById.get(user.tenant_id) ?? user.tenant_id}
                      </Link>
                    </td>
                    <td>
                      <button className="users-page__status-button" type="button" onClick={() => openUserDialog(user)}>
                        <StatusBadge value={user.status} />
                      </button>
                    </td>
                    <td>
                      {user.group_memberships.length > 0
                        ? user.group_memberships
                            .map((membership) => groupNameById.get(membership.group_id) ?? "Unknown group")
                            .join(", ")
                        : "Unassigned"}
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
        <div className="dialog-backdrop" role="presentation" onClick={closeUserDialog}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-status-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="user-status-dialog-title">Manage User</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {selectedUser.profile?.email ?? "No email on file"}
                </div>
              </div>
              <button className="ghost-button" type="button" onClick={closeUserDialog}>
                Close
              </button>
            </div>

            {updateUserMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(updateUserMutation.error)}
              </div>
            ) : null}

            {userActionMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(userActionMutation.error)}
              </div>
            ) : null}

            {completedAction ? (
              <>
                <div className="section-note section-note--success" style={{ marginTop: 18 }}>
                  {actionCompletionMessage(completedAction)}
                </div>
                <div className="dialog-actions">
                  <button className="primary-button" type="button" onClick={closeUserDialog}>
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
              <div className="stack" style={{ marginTop: 18 }}>
                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="manage_user_first_name">First Name</label>
                    <input
                      className="field"
                      id="manage_user_first_name"
                      value={userEditForm.first_name}
                      onChange={(event) =>
                        setUserEditForm((current) => ({ ...current, first_name: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="manage_user_last_name">Last Name</label>
                    <input
                      className="field"
                      id="manage_user_last_name"
                      value={userEditForm.last_name}
                      onChange={(event) =>
                        setUserEditForm((current) => ({ ...current, last_name: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="manage_user_email">Email</label>
                    <input
                      className="field"
                      id="manage_user_email"
                      value={userEditForm.email}
                      onChange={(event) => setUserEditForm((current) => ({ ...current, email: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="manage_user_title">Title</label>
                    <input
                      className="field"
                      id="manage_user_title"
                      value={userEditForm.title}
                      onChange={(event) => setUserEditForm((current) => ({ ...current, title: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="manage_user_status">Status</label>
                    <select
                      className="field"
                      id="manage_user_status"
                      value={userEditForm.status}
                      onChange={(event) =>
                        setUserEditForm((current) => ({
                          ...current,
                          status: event.target.value as UserMembership["status"],
                        }))
                      }
                    >
                      <option value="invited">Invited</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <label className="field-label" htmlFor="manage_user_primary">Primary Membership</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                      <input
                        id="manage_user_primary"
                        checked={userEditForm.is_primary}
                        onChange={(event) =>
                          setUserEditForm((current) => ({ ...current, is_primary: event.target.checked }))
                        }
                        type="checkbox"
                      />
                      <span>Flag as the primary organization membership</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="field-label">Groups</div>
                  {selectedUserGroups.length === 0 ? (
                    <div className="section-note">This organization has no groups yet, so there is nothing to assign.</div>
                  ) : (
                    <div className="stack" style={{ gap: 10 }}>
                      {selectedUserGroups.map((group: Group) => (
                        <label key={group.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            checked={userEditForm.group_ids.includes(group.id)}
                            onChange={() => toggleGroupSelection(group.id)}
                            type="checkbox"
                          />
                          <span>
                            <strong>{group.group_name}</strong>
                            <span className="muted" style={{ marginLeft: 8 }}>
                              {group.profile?.business_unit ?? "Group"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="dialog-actions">
                  <button
                    className="primary-button"
                    disabled={updateUserMutation.isPending}
                    onClick={() => updateUserMutation.mutate()}
                    type="button"
                  >
                    {updateUserMutation.isPending ? "Saving..." : "Save User Updates"}
                  </button>
                </div>

                <div className="section-note">
                  Status changes and group assignments support the day-to-day tenant admin workflow. Lifecycle actions below remain available for deactivation, reinvite, and full delete handling.
                </div>

                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    disabled={userActionMutation.isPending || updateUserMutation.isPending}
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
                    disabled={userActionMutation.isPending || updateUserMutation.isPending}
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
                    disabled={userActionMutation.isPending || updateUserMutation.isPending}
                    onClick={() => {
                      setPendingAction("delete");
                      userActionMutation.reset();
                    }}
                    type="button"
                  >
                    Fully Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {userLimitDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setUserLimitDialog(null)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-limit-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="users-limit-dialog-title">User Limit Check</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {userLimitDialog.blocked
                    ? userLimitDialog.currentUsers >= userLimitDialog.limit
                      ? "No more users allowed."
                      : "This import would exceed the service tier limit."
                    : `Add users ${userLimitDialog.currentUsers + 1} through ${userLimitDialog.currentUsers + userLimitDialog.requestedUsers} of total allowed ${userLimitDialog.limit}?`}
                </div>
              </div>
            </div>

            <div className={`section-note${userLimitDialog.blocked ? " section-note--danger" : ""}`} style={{ marginTop: 18 }}>
              {(selectedImportTenant?.tenant.tenant_name ?? "This organization")} is currently using {userLimitDialog.currentUsers} of {userLimitDialog.limit} allowed users.
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              {!userLimitDialog.blocked ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    setUserLimitDialog(null);
                    importUsersMutation.mutate();
                  }}
                  type="button"
                >
                  Continue
                </button>
              ) : null}
              <button className="secondary-button" onClick={() => setUserLimitDialog(null)} type="button">
                {userLimitDialog.blocked ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
