import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";
import type { Group, UserMembership } from "../../lib/types";

type UserActionKind = "deactivate" | "reinvite" | "delete";
type UserSortKey = "last_activity" | "name" | "organization" | "status";
type UserLimitDialogState = {
  mode: "create";
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
  admin_role: string;
};

type CreateUserForm = {
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  status: UserMembership["status"];
  initial_user_type: number;
  group_id: string;
};

const adminRoleOptions = [
  "super_admin",
  "support_admin",
  "reseller_super_user",
  "tenant_admin",
  "group_admin",
  "analyst",
] as const;

const defaultUserEditForm: UserEditForm = {
  first_name: "",
  last_name: "",
  email: "",
  title: "",
  status: "invited",
  is_primary: true,
  group_ids: [],
  admin_role: "",
};

const defaultCreateUserForm: CreateUserForm = {
  tenant_id: "",
  first_name: "",
  last_name: "",
  email: "",
  title: "",
  status: "invited",
  initial_user_type: 1,
  group_id: "",
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
    admin_role: user.admin_role?.role ?? "",
  };
}

function displayUserName(user: UserMembership) {
  if (user.profile?.first_name || user.profile?.last_name) {
    return `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim();
  }
  return user.profile?.email ?? user.user_id_hash;
}

function statusBadgeValue(user: UserMembership) {
  return user.status_summary?.badge ?? user.status;
}

function matchesSearch(user: UserMembership, search: string, groupNameById: Map<string, string>) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  const haystack = [
    user.user_id_hash,
    user.profile?.first_name,
    user.profile?.last_name,
    user.profile?.email,
    user.profile?.title,
    user.admin_role?.role,
    user.status_summary?.badge,
    ...user.group_memberships.map((membership) => groupNameById.get(membership.group_id) ?? membership.group_id),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedSearch);
}

function sortUsers(
  users: UserMembership[],
  sortKey: UserSortKey,
  tenantNameById: Map<string, string>,
) {
  return [...users].sort((left, right) => {
    if (sortKey === "name") {
      return displayUserName(left).localeCompare(displayUserName(right));
    }
    if (sortKey === "organization") {
      return (tenantNameById.get(left.tenant_id) ?? left.tenant_id).localeCompare(
        tenantNameById.get(right.tenant_id) ?? right.tenant_id,
      );
    }
    if (sortKey === "status") {
      return statusBadgeValue(left).localeCompare(statusBadgeValue(right));
    }
    const leftValue = left.profile?.last_activity_at ?? left.updated_at;
    const rightValue = right.profile?.last_activity_at ?? right.updated_at;
    return new Date(rightValue).getTime() - new Date(leftValue).getTime();
  });
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState("all");
  const [groupId, setGroupId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<UserSortKey>("last_activity");
  const [selectedUser, setSelectedUser] = useState<UserMembership | null>(null);
  const [userEditForm, setUserEditForm] = useState<UserEditForm>(defaultUserEditForm);
  const [pendingAction, setPendingAction] = useState<UserActionKind | null>(null);
  const [completedAction, setCompletedAction] = useState<UserActionKind | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserForm>(defaultCreateUserForm);
  const [userLimitDialog, setUserLimitDialog] = useState<UserLimitDialogState | null>(null);
  const queryClient = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["users-page-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const usersQuery = useQuery({
    queryKey: ["users-page-users", tenantId, groupId],
    queryFn: () => tenantApi.getUsers(tenantId === "all" ? undefined : tenantId, groupId || undefined),
  });
  const groupsQuery = useQuery({
    queryKey: ["users-page-groups"],
    queryFn: () => tenantApi.getGroups(),
  });
  const selectedUserDetailsQuery = useQuery({
    queryKey: ["users-page-user-memberships", selectedUser?.user_id_hash],
    queryFn: () => tenantApi.getUserMemberships(selectedUser!.user_id_hash),
    enabled: Boolean(selectedUser?.user_id_hash),
  });
  const createTenantUsersQuery = useQuery({
    queryKey: ["users-page-create-tenant-users", createUserForm.tenant_id],
    queryFn: () => tenantApi.getUsers(createUserForm.tenant_id),
    enabled: createDialogOpen && Boolean(createUserForm.tenant_id),
  });

  const tenantNameById = useMemo(
    () =>
      new Map((tenantsQuery.data?.items ?? []).map((item) => [item.tenant.id, item.tenant.tenant_name])),
    [tenantsQuery.data],
  );
  const groupNameById = useMemo(
    () => new Map((groupsQuery.data?.items ?? []).map((group) => [group.id, group.group_name])),
    [groupsQuery.data],
  );

  const visibleGroups = useMemo(() => {
    const groups = groupsQuery.data?.items ?? [];
    return groups.filter((group) => (tenantId === "all" ? true : group.tenant_id === tenantId));
  }, [groupsQuery.data, tenantId]);
  const activeSelectedUser = useMemo(() => {
    if (!selectedUser) {
      return null;
    }
    const detailedItems = selectedUserDetailsQuery.data?.items ?? [];
    return (
      detailedItems.find((item) => item.tenant_id === selectedUser.tenant_id) ??
      detailedItems[0] ??
      selectedUser
    );
  }, [selectedUser, selectedUserDetailsQuery.data]);
  const selectedUserGroups = useMemo(
    () => (groupsQuery.data?.items ?? []).filter((group) => group.tenant_id === activeSelectedUser?.tenant_id),
    [activeSelectedUser, groupsQuery.data],
  );
  const createAvailableGroups = useMemo(
    () => (groupsQuery.data?.items ?? []).filter((group) => group.tenant_id === createUserForm.tenant_id),
    [groupsQuery.data, createUserForm.tenant_id],
  );

  const filteredUsers = useMemo(() => {
    const users = usersQuery.data?.items ?? [];
    const statusScoped = users.filter((user) => {
      const matchesStatus = statusFilter === "all" ? true : statusBadgeValue(user) === statusFilter;
      return matchesStatus && matchesSearch(user, search, groupNameById);
    });
    return sortUsers(statusScoped, sortKey, tenantNameById);
  }, [groupNameById, search, sortKey, statusFilter, tenantNameById, usersQuery.data]);

  const invalidateUserQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-page-users"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-create-tenant-users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant"] }),
      queryClient.invalidateQueries({ queryKey: ["tenants"] }),
      queryClient.invalidateQueries({ queryKey: ["admins-page-admins"] }),
      queryClient.invalidateQueries({ queryKey: ["admins"] }),
    ]);
  };

  const openUserDialog = (user: UserMembership) => {
    setSelectedUser(user);
    setUserEditForm(buildUserEditForm(user));
    setPendingAction(null);
    setCompletedAction(null);
    updateUserMutation.reset();
    updateAdminRoleMutation.reset();
    userActionMutation.reset();
  };

  const closeUserDialog = () => {
    setSelectedUser(null);
    setUserEditForm(defaultUserEditForm);
    setPendingAction(null);
    setCompletedAction(null);
    updateUserMutation.reset();
    updateAdminRoleMutation.reset();
    userActionMutation.reset();
  };

  const resetCreateForm = (preferredTenantId = "") => {
    setCreateUserForm({
      ...defaultCreateUserForm,
      tenant_id: preferredTenantId,
    });
    createUserMutation.reset();
  };

  const openCreateDialog = () => {
    const defaultTenantId =
      tenantId !== "all"
        ? tenantId
        : tenantsQuery.data?.items?.[0]?.tenant.id ?? "";
    resetCreateForm(defaultTenantId);
    setCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    resetCreateForm("");
  };

  const toggleGroupSelection = (selectedGroupId: string) => {
    setUserEditForm((current) => ({
      ...current,
      group_ids: current.group_ids.includes(selectedGroupId)
        ? current.group_ids.filter((value) => value !== selectedGroupId)
        : [...current.group_ids, selectedGroupId],
    }));
  };

  const updateUserMutation = useMutation({
    mutationFn: () => {
      if (!activeSelectedUser) {
        throw new Error("No user selected.");
      }
      return tenantApi.updateUser(activeSelectedUser.user_id_hash, activeSelectedUser.tenant_id, {
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

  const updateAdminRoleMutation = useMutation({
    mutationFn: () => {
      if (!activeSelectedUser?.admin_role?.admin_id) {
        throw new Error("This user does not currently have an admin role assignment.");
      }
      if (!userEditForm.admin_role) {
        throw new Error("Select an admin role before saving.");
      }
      return tenantApi.updateAdmin(activeSelectedUser.admin_role.admin_id, {
        role: userEditForm.admin_role,
      });
    },
    onSuccess: async ({ resource }) => {
      await invalidateUserQueries();
      setSelectedUser((current) =>
        current
          ? {
              ...current,
              admin_role: {
                ...(current.admin_role ?? {
                  admin_id: resource.id,
                  is_active: resource.is_active,
                  permissions: [],
                  scope_types: [],
                }),
                admin_id: resource.id,
                role: resource.role,
                is_active: resource.is_active,
                permissions: resource.permissions.map((permission) => permission.permission_key),
                scope_types: resource.scopes.map((scope) => scope.scope_type),
              },
            }
          : current,
      );
    },
  });

  const userActionMutation = useMutation({
    mutationFn: (action: UserActionKind) => {
      if (!activeSelectedUser) {
        throw new Error("No user selected.");
      }
      return tenantApi.runUserAction(activeSelectedUser.user_id_hash, {
        tenant_id: activeSelectedUser.tenant_id,
        action,
      });
    },
    onSuccess: async ({ resource }) => {
      await invalidateUserQueries();
      setSelectedUser(resource);
      setUserEditForm(buildUserEditForm(resource));
    },
  });

  const createUserMutation = useMutation({
    mutationFn: () => {
      if (!createUserForm.tenant_id) {
        throw new Error("Select an organization before creating a user.");
      }
      if (!createUserForm.email.trim()) {
        throw new Error("Email is required.");
      }
      return tenantApi.createUser({
        tenant_id: createUserForm.tenant_id,
        group_ids: createUserForm.group_id ? [createUserForm.group_id] : [],
        status: createUserForm.status,
        is_primary: true,
        first_name: createUserForm.first_name || null,
        last_name: createUserForm.last_name || null,
        email: createUserForm.email || null,
        title: createUserForm.title || null,
        initial_user_type: createUserForm.initial_user_type,
      });
    },
    onSuccess: async ({ resource }) => {
      await invalidateUserQueries();
      setCreateDialogOpen(false);
      setSelectedUser(resource);
      setUserEditForm(buildUserEditForm(resource));
    },
  });

  const users = filteredUsers;
  const dialogUser = activeSelectedUser ?? selectedUser;
  const activeUsers = users.filter((user) => statusBadgeValue(user) === "active").length;
  const withSessions = users.filter((user) => (user.profile?.sessions_count ?? 0) > 0).length;
  const visibleOrganizations = new Set(users.map((user) => user.tenant_id)).size;
  const selectedCreateTenant =
    (tenantsQuery.data?.items ?? []).find((item) => item.tenant.id === createUserForm.tenant_id) ?? null;
  const currentUsersForCreateTenant = (createTenantUsersQuery.data?.items ?? []).filter((user) => user.status !== "deleted").length;

  function requestCreateUser() {
    const limit = tierUserLimit(selectedCreateTenant?.service_tier ?? null);
    if (!limit) {
      createUserMutation.mutate();
      return;
    }
    setUserLimitDialog({
      mode: "create",
      requestedUsers: 1,
      currentUsers: currentUsersForCreateTenant,
      limit,
      blocked: currentUsersForCreateTenant + 1 > limit,
    });
  }

  useEffect(() => {
    if (tenantId === "all") {
      setGroupId("");
      return;
    }
    const groupStillVisible = visibleGroups.some((group) => group.id === groupId);
    if (!groupStillVisible) {
      setGroupId("");
    }
  }, [groupId, tenantId, visibleGroups]);

  if (tenantsQuery.isLoading || usersQuery.isLoading || groupsQuery.isLoading) {
    return <LoadingBlock label="Loading users..." />;
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
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="primary-button" onClick={openCreateDialog} type="button">
            Create user
          </button>
          <Link
            className="secondary-button"
            state={{ tenantId: tenantId === "all" ? "" : tenantId }}
            to="/users/import"
          >
            Bulk Import Users
          </Link>
          <Link className="secondary-button" to="/orgs">
            View organizations
          </Link>
        </div>
      </div>

      <div className="kpi-grid users-page__kpis">
        <div className="card metric-card">
          <div className="metric-card__label">Users</div>
          <div className="metric-card__value">{users.length}</div>
          <div className="metric-card__trend">Within the current visible scope</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Active Users</div>
          <div className="metric-card__value">{activeUsers}</div>
          <div className="metric-card__trend">Based on current Herman Admin status interpretation</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">With Sessions</div>
          <div className="metric-card__value">{withSessions}</div>
          <div className="metric-card__trend">Users with captured conversation history</div>
        </div>
        <div className="card metric-card">
          <div className="metric-card__label">Organizations</div>
          <div className="metric-card__value">{visibleOrganizations}</div>
          <div className="metric-card__trend">Represented in the current results</div>
        </div>
      </div>

      <div className="panel users-page__panel">
        <div className="split-header users-page__filters">
          <div>
            <h3 className="panel-title">User Inventory</h3>
            <div className="muted">Filter by organization, group, status, or identity fields. User details and lifecycle actions remain available from the status column.</div>
          </div>
        </div>

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="users_search">Search</label>
            <input
              className="field"
              id="users_search"
              placeholder="Name, email, group, admin role, or user hash"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="users_tenant_filter">Organization</label>
            <select
              className="field"
              id="users_tenant_filter"
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
          <div>
            <label className="field-label" htmlFor="users_group_filter">Group</label>
            <select
              className="field"
              id="users_group_filter"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              <option value="">All groups</option>
              {visibleGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.group_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="users_status_filter">Status</label>
            <select
              className="field"
              id="users_status_filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="invited">Invited</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="users_sort_key">Sort By</label>
            <select
              className="field"
              id="users_sort_key"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as UserSortKey)}
            >
              <option value="last_activity">Last activity</option>
              <option value="name">Name</option>
              <option value="organization">Organization</option>
              <option value="status">Status</option>
            </select>
          </div>
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
                  <th>Admin Role</th>
                  <th>Title</th>
                  <th>Sessions</th>
                  <th>Improvement</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state table-empty-state">No users match the current filters.</div>
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td className="users-page__user-cell">
                        <button className="users-page__name-button" type="button" onClick={() => openUserDialog(user)}>
                          <strong>{displayUserName(user)}</strong>
                        </button>
                        <div className="muted">{user.profile?.email ?? "No email on file"}</div>
                        <div className="muted">Hash: {user.user_id_hash}</div>
                      </td>
                      <td className="users-page__org-cell">
                        <Link className="users-page__org-link" to={`/orgs/${user.tenant_id}`}>
                          {tenantNameById.get(user.tenant_id) ?? user.tenant_id}
                        </Link>
                      </td>
                      <td>
                        <button className="users-page__status-button" type="button" onClick={() => openUserDialog(user)}>
                          <StatusBadge value={statusBadgeValue(user)} />
                        </button>
                      </td>
                      <td>
                        {user.group_memberships.length > 0
                          ? user.group_memberships
                              .map((membership) => groupNameById.get(membership.group_id) ?? "Unknown group")
                              .join(", ")
                          : "Unassigned"}
                      </td>
                      <td>{user.admin_role?.role ?? "Not an admin"}</td>
                      <td>{user.profile?.title ?? "Member"}</td>
                      <td>{user.profile?.sessions_count ?? 0}</td>
                      <td>{user.profile?.avg_improvement_pct != null ? `${user.profile.avg_improvement_pct}%` : "Pending"}</td>
                      <td>{formatDateTime(user.profile?.last_activity_at ?? user.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {createDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeCreateDialog}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="create-user-dialog-title">Create User</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  Create a single organization membership using the existing Herman Admin onboarding flow.
                </div>
              </div>
              <button className="ghost-button" type="button" onClick={closeCreateDialog}>
                Close
              </button>
            </div>

            {createUserMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(createUserMutation.error)}
              </div>
            ) : null}

            <div className="stack" style={{ marginTop: 18 }}>
              <div className="field-row field-row--three">
                <div>
                  <label className="field-label" htmlFor="create_user_tenant">Organization</label>
                  <select
                    className="field"
                    id="create_user_tenant"
                    value={createUserForm.tenant_id}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, tenant_id: event.target.value, group_id: "" }))
                    }
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
                  <label className="field-label" htmlFor="create_user_initial_type">Initial User Type</label>
                  <select
                    className="field"
                    id="create_user_initial_type"
                    value={String(createUserForm.initial_user_type)}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, initial_user_type: Number(event.target.value) }))
                    }
                  >
                    {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                      <option key={value} value={value}>
                        Type {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="create_user_status">Initial Status</label>
                  <select
                    className="field"
                    id="create_user_status"
                    value={createUserForm.status}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({
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
              </div>

              <div className="field-row field-row--three">
                <div>
                  <label className="field-label" htmlFor="create_user_first_name">First Name</label>
                  <input
                    className="field"
                    id="create_user_first_name"
                    value={createUserForm.first_name}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, first_name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="create_user_last_name">Last Name</label>
                  <input
                    className="field"
                    id="create_user_last_name"
                    value={createUserForm.last_name}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, last_name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="create_user_email">Email</label>
                  <input
                    className="field"
                    id="create_user_email"
                    value={createUserForm.email}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="field-row field-row--three">
                <div>
                  <label className="field-label" htmlFor="create_user_title">Title</label>
                  <input
                    className="field"
                    id="create_user_title"
                    value={createUserForm.title}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="create_user_group">Initial Group</label>
                  <select
                    className="field"
                    id="create_user_group"
                    value={createUserForm.group_id}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, group_id: event.target.value }))
                    }
                  >
                    <option value="">No group assignment</option>
                    {createAvailableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.group_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="dialog-actions">
                <button
                  className="primary-button"
                  disabled={!createUserForm.tenant_id || !createUserForm.email.trim() || createUserMutation.isPending}
                  onClick={requestCreateUser}
                  type="button"
                >
                  {createUserMutation.isPending ? "Saving..." : "Create User"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeUserDialog}>
          <div
            className="dialog-card users-page__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-status-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="user-status-dialog-title">Manage User</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {dialogUser?.profile?.email ?? "No email on file"}
                </div>
                <div className="muted">User hash: {dialogUser?.user_id_hash}</div>
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
            {updateAdminRoleMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(updateAdminRoleMutation.error)}
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
              <div className="users-page__dialog-body">
                <div className="users-page__dialog-sidebar">
                  <div className="section-note">
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <StatusBadge value={statusBadgeValue(dialogUser ?? selectedUser)} />
                      <span>{dialogUser?.status_summary?.detail ?? "Current user membership status."}</span>
                    </div>
                  </div>

                  {dialogUser?.invitation_summary ? (
                    <div className="section-note">
                      Invitation state: <strong>{dialogUser.invitation_summary.state}</strong>
                      {dialogUser.invitation_summary.email ? ` for ${dialogUser.invitation_summary.email}` : ""}
                      {dialogUser.invitation_summary.sent_at ? ` / sent ${formatDateTime(dialogUser.invitation_summary.sent_at)}` : ""}
                      {dialogUser.invitation_summary.accepted_at ? ` / accepted ${formatDateTime(dialogUser.invitation_summary.accepted_at)}` : ""}
                      {dialogUser.invitation_summary.last_error ? ` / ${dialogUser.invitation_summary.last_error}` : ""}
                    </div>
                  ) : null}

                  <div className="panel panel--inset users-page__dialog-panel">
                    <h3 className="panel-title">Admin Role</h3>
                    <div className="users-page__dialog-panel-body">
                      {dialogUser?.admin_role ? (
                        <div className="stack" style={{ gap: 10 }}>
                          <select
                            className="field"
                            id="manage_user_admin_role"
                            value={userEditForm.admin_role}
                            onChange={(event) =>
                              setUserEditForm((current) => ({ ...current, admin_role: event.target.value }))
                            }
                          >
                            {adminRoleOptions.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <div className="muted">
                            Current permissions: {dialogUser.admin_role.permissions.join(", ") || "Inherited defaults only"}
                          </div>
                          <div className="dialog-actions">
                            <button
                              className="secondary-button"
                              disabled={updateAdminRoleMutation.isPending || !userEditForm.admin_role}
                              onClick={() => updateAdminRoleMutation.mutate()}
                              type="button"
                            >
                              {updateAdminRoleMutation.isPending ? "Saving..." : "Save Admin Role"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="section-note">
                          This user does not currently have a Herman Admin authorization role assignment.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="panel panel--inset users-page__dialog-panel">
                    <h3 className="panel-title">Groups</h3>
                    <div className="users-page__dialog-panel-body">
                      {selectedUserGroups.length === 0 ? (
                        <div className="section-note">This organization has no groups yet, so there is nothing to assign.</div>
                      ) : (
                        <div className="stack users-page__group-list">
                          {selectedUserGroups.map((group: Group) => (
                            <label key={group.id} className="users-page__group-option">
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
                  </div>

                  <div className="panel panel--inset users-page__dialog-panel">
                    <h3 className="panel-title">Lifecycle Actions</h3>
                    <div className="users-page__dialog-panel-body">
                      <div className="section-note">
                        Lifecycle actions below continue to use the current Herman Admin user-management semantics without changing any shared platform contract.
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
                  </div>
                </div>

                <div className="users-page__dialog-main">
                  <div className="panel panel--inset users-page__dialog-panel">
                    <h3 className="panel-title">Profile & Membership</h3>
                    <div className="users-page__dialog-panel-body">
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
                        <div className="users-page__primary-toggle">
                          <label className="field-label" htmlFor="manage_user_primary">Primary Membership</label>
                          <label className="users-page__primary-toggle-label">
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

                      <div className="dialog-actions users-page__dialog-save-row">
                        <button
                          className="primary-button"
                          disabled={updateUserMutation.isPending}
                          onClick={() => updateUserMutation.mutate()}
                          type="button"
                        >
                          {updateUserMutation.isPending ? "Saving..." : "Save User Updates"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="panel panel--inset users-page__dialog-panel">
                    <div className="split-header users-page__detail-header">
                      <div>
                        <h3 className="panel-title">Read-Only Detail Sections</h3>
                        <div className="muted" style={{ marginTop: 6 }}>
                          Foundational, effective, and supplemental profile data shown from the current Herman Admin data sources.
                        </div>
                      </div>
                      {selectedUserDetailsQuery.isLoading ? <div className="muted">Loading detail sections...</div> : null}
                    </div>
                    <div className="users-page__detail-grid">
                      {(dialogUser?.detail_sections ?? []).map((section) => (
                        <div className="section-note users-page__detail-card" key={section.key}>
                          <div className="users-page__detail-card-header">
                            <strong>{section.title}</strong>
                            <StatusBadge value={section.status} />
                          </div>
                          {section.fields.length > 0 ? (
                            <div className="users-page__detail-fields">
                              {section.fields.map((field) => (
                                <div className="users-page__detail-field" key={`${section.key}-${field.label}`}>
                                  <strong className="users-page__detail-field-label">{field.label}</strong>
                                  <span className="users-page__detail-field-value">{field.value}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="muted users-page__detail-empty">
                              {section.message ?? "No detail is currently available for this section."}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
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
                      : "This add would exceed the service tier limit."
                    : `Add user number ${userLimitDialog.currentUsers + 1} of total allowed ${userLimitDialog.limit}?`}
                </div>
              </div>
            </div>

            <div className={`section-note${userLimitDialog.blocked ? " section-note--danger" : ""}`} style={{ marginTop: 18 }}>
              {(selectedCreateTenant?.tenant.tenant_name ?? "This organization")} is currently using {userLimitDialog.currentUsers} of {userLimitDialog.limit} allowed users.
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              {!userLimitDialog.blocked ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    setUserLimitDialog(null);
                    createUserMutation.mutate();
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
