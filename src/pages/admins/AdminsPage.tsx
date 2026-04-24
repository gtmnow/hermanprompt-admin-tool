import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { useAuth } from "../../app/providers/AuthProvider";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import type { AdminUser, Group, UserMembership } from "../../lib/types";

const adminPermissionPresets = {
  read_write: {
    label: "Tenant Admin",
    permissions: ["users.read", "users.write", "groups.read", "groups.write", "runtime.read", "runtime.write", "analytics.read"],
  },
  read_only: {
    label: "Read Only",
    permissions: ["users.read", "groups.read", "runtime.read", "analytics.read"],
  },
  reporting_only: {
    label: "Reporting Only",
    permissions: ["analytics.read", "analytics.export"],
  },
} as const;

const permissionCatalog = [
  "users.read",
  "users.write",
  "groups.read",
  "groups.write",
  "runtime.read",
  "runtime.write",
  "analytics.read",
  "analytics.export",
] as const;

type AdminPermissionPresetKey = keyof typeof adminPermissionPresets;
type AdminPermissionPresetSelection = AdminPermissionPresetKey | "custom";

type AdminEditForm = {
  display_name: string;
  email: string;
  is_active: boolean;
  permissions: string[];
};

const defaultAdminEditForm: AdminEditForm = {
  display_name: "",
  email: "",
  is_active: true,
  permissions: [...adminPermissionPresets.read_write.permissions],
};

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

function inferPermissionPreset(permissions: string[]): AdminPermissionPresetKey | "custom" {
  const sortedPermissions = [...permissions].sort().join("|");
  const matchedPreset = Object.entries(adminPermissionPresets).find(([, preset]) => {
    return [...preset.permissions].sort().join("|") === sortedPermissions;
  });
  return (matchedPreset?.[0] as AdminPermissionPresetKey | undefined) ?? "custom";
}

function buildAdminEditForm(admin: AdminUser): AdminEditForm {
  return {
    display_name: admin.profile?.display_name ?? "",
    email: admin.profile?.email ?? "",
    is_active: admin.is_active,
    permissions: admin.permissions.map((permission) => permission.permission_key),
  };
}

function buildUserLabel(user: UserMembership) {
  const fullName = `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim();
  const email = user.profile?.email?.trim() ?? "";
  if (fullName && email) {
    return `${email} (${fullName})`;
  }
  return email || fullName || user.user_id_hash;
}

function buildAdminProfile(user: UserMembership) {
  const displayName = `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim() || null;
  return {
    display_name: displayName,
    email: user.profile?.email?.trim() || null,
  };
}

function filterUsersByGroup(users: UserMembership[], groupId: string) {
  if (!groupId) {
    return users;
  }
  return users.filter((user) => user.group_memberships.some((membership) => membership.group_id === groupId));
}

function sortUsersByLabel(users: UserMembership[]) {
  return [...users].sort((left, right) => buildUserLabel(left).localeCompare(buildUserLabel(right)));
}

function sortGroupsByName(groups: Group[]) {
  return [...groups].sort((left, right) => left.group_name.localeCompare(right.group_name));
}

export function AdminsPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = session?.principal.role === "super_admin";

  const [tenantAdminTenantId, setTenantAdminTenantId] = useState("");
  const [tenantAdminGroupId, setTenantAdminGroupId] = useState("");
  const [tenantAdminUserIdHash, setTenantAdminUserIdHash] = useState("");
  const [tenantAdminPermissionPreset, setTenantAdminPermissionPreset] = useState<AdminPermissionPresetSelection>("read_write");
  const [tenantAdminPermissions, setTenantAdminPermissions] = useState<string[]>([...adminPermissionPresets.read_write.permissions]);
  const [tenantAdminSuccessMessage, setTenantAdminSuccessMessage] = useState<string | null>(null);

  const [superAdminTenantFilterId, setSuperAdminTenantFilterId] = useState("");
  const [superAdminGroupId, setSuperAdminGroupId] = useState("");
  const [superAdminUserIdHash, setSuperAdminUserIdHash] = useState("");
  const [superAdminPermissionPreset, setSuperAdminPermissionPreset] = useState<AdminPermissionPresetSelection>("read_write");
  const [superAdminPermissions, setSuperAdminPermissions] = useState<string[]>([...adminPermissionPresets.read_write.permissions]);
  const [superAdminSuccessMessage, setSuperAdminSuccessMessage] = useState<string | null>(null);

  const [inventoryTenantFilter, setInventoryTenantFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [adminEditForm, setAdminEditForm] = useState<AdminEditForm>(defaultAdminEditForm);
  const [editPermissionPreset, setEditPermissionPreset] = useState<AdminPermissionPresetKey | "custom">("custom");

  const tenantsQuery = useQuery({
    queryKey: ["admins-page-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const adminsQuery = useQuery({
    queryKey: ["admins-page-admins"],
    queryFn: () => tenantApi.getAdmins(),
  });
  const tenantAdminUsersQuery = useQuery({
    queryKey: ["admins-page-tenant-users", tenantAdminTenantId],
    queryFn: () => tenantApi.getUsers(tenantAdminTenantId),
    enabled: Boolean(tenantAdminTenantId),
  });
  const tenantAdminGroupsQuery = useQuery({
    queryKey: ["admins-page-tenant-groups", tenantAdminTenantId],
    queryFn: () => tenantApi.getGroups(tenantAdminTenantId),
    enabled: Boolean(tenantAdminTenantId),
  });
  const superAdminUsersQuery = useQuery({
    queryKey: ["admins-page-super-users", superAdminTenantFilterId || "all"],
    queryFn: () => tenantApi.getUsers(superAdminTenantFilterId || undefined),
    enabled: isSuperAdmin,
  });
  const superAdminGroupsQuery = useQuery({
    queryKey: ["admins-page-super-groups", superAdminTenantFilterId],
    queryFn: () => tenantApi.getGroups(superAdminTenantFilterId),
    enabled: isSuperAdmin && Boolean(superAdminTenantFilterId),
  });

  useEffect(() => {
    if (!tenantAdminTenantId && tenantsQuery.data?.items?.[0]?.tenant.id) {
      setTenantAdminTenantId(tenantsQuery.data.items[0].tenant.id);
    }
  }, [tenantAdminTenantId, tenantsQuery.data]);

  useEffect(() => {
    setTenantAdminGroupId("");
    setTenantAdminUserIdHash("");
    setTenantAdminSuccessMessage(null);
  }, [tenantAdminTenantId]);

  useEffect(() => {
    setSuperAdminGroupId("");
    setSuperAdminUserIdHash("");
    setSuperAdminSuccessMessage(null);
  }, [superAdminTenantFilterId]);

  useEffect(() => {
    setTenantAdminUserIdHash("");
    setTenantAdminSuccessMessage(null);
  }, [tenantAdminGroupId]);

  useEffect(() => {
    setSuperAdminUserIdHash("");
    setSuperAdminSuccessMessage(null);
  }, [superAdminGroupId]);

  const invalidateAdminQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admins-page-admins"] }),
      queryClient.invalidateQueries({ queryKey: ["admins"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-onboarding"] }),
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail"] }),
    ]);
  };

  const tenantAdminUsers = useMemo(
    () => sortUsersByLabel(filterUsersByGroup(tenantAdminUsersQuery.data?.items ?? [], tenantAdminGroupId)),
    [tenantAdminGroupId, tenantAdminUsersQuery.data],
  );
  const tenantAdminGroups = useMemo(
    () => sortGroupsByName(tenantAdminGroupsQuery.data?.items ?? []),
    [tenantAdminGroupsQuery.data],
  );
  const selectedTenantAdminUser = useMemo(
    () => tenantAdminUsers.find((user) => user.user_id_hash === tenantAdminUserIdHash) ?? null,
    [tenantAdminUserIdHash, tenantAdminUsers],
  );

  const superAdminUsers = useMemo(
    () => sortUsersByLabel(filterUsersByGroup(superAdminUsersQuery.data?.items ?? [], superAdminGroupId)),
    [superAdminGroupId, superAdminUsersQuery.data],
  );
  const superAdminGroups = useMemo(
    () => sortGroupsByName(superAdminGroupsQuery.data?.items ?? []),
    [superAdminGroupsQuery.data],
  );
  const selectedSuperAdminUser = useMemo(
    () => superAdminUsers.find((user) => user.user_id_hash === superAdminUserIdHash) ?? null,
    [superAdminUserIdHash, superAdminUsers],
  );

  const createTenantAdminMutation = useMutation({
    mutationFn: () => {
      if (!tenantAdminTenantId) {
        throw new Error("Select an organization before assigning a tenant admin.");
      }
      if (!selectedTenantAdminUser) {
        throw new Error("Select a user email before assigning a tenant admin.");
      }
      const profile = buildAdminProfile(selectedTenantAdminUser);
      return tenantApi.createAdmin({
        user_id_hash: selectedTenantAdminUser.user_id_hash,
        role: "tenant_admin",
        permissions: tenantAdminPermissions,
        scopes: [{ scope_type: "tenant", tenant_id: tenantAdminTenantId }],
        display_name: profile.display_name,
        email: profile.email,
      });
    },
    onMutate: async () => {
      setTenantAdminSuccessMessage(null);
    },
    onSuccess: async () => {
      setTenantAdminUserIdHash("");
      setTenantAdminGroupId("");
      setTenantAdminPermissionPreset("read_write");
      setTenantAdminPermissions([...adminPermissionPresets.read_write.permissions]);
      setTenantAdminSuccessMessage("Tenant admin assignment saved successfully.");
      await invalidateAdminQueries();
    },
  });

  const createSuperAdminMutation = useMutation({
    mutationFn: () => {
      if (!selectedSuperAdminUser) {
        throw new Error("Select a user email before assigning a super admin.");
      }
      const profile = buildAdminProfile(selectedSuperAdminUser);
      return tenantApi.createAdmin({
        user_id_hash: selectedSuperAdminUser.user_id_hash,
        role: "super_admin",
        permissions: superAdminPermissions,
        scopes: [{ scope_type: "global" }],
        display_name: profile.display_name,
        email: profile.email,
      });
    },
    onMutate: async () => {
      setSuperAdminSuccessMessage(null);
    },
    onSuccess: async () => {
      setSuperAdminUserIdHash("");
      setSuperAdminGroupId("");
      setSuperAdminTenantFilterId("");
      setSuperAdminPermissionPreset("read_write");
      setSuperAdminPermissions([...adminPermissionPresets.read_write.permissions]);
      setSuperAdminSuccessMessage("Super admin assignment saved successfully.");
      await invalidateAdminQueries();
    },
  });

  const updateAdminMutation = useMutation({
    mutationFn: () => {
      if (!selectedAdmin) {
        throw new Error("No admin selected.");
      }
      return tenantApi.updateAdmin(selectedAdmin.id, {
        is_active: adminEditForm.is_active,
        permissions: adminEditForm.permissions,
        display_name: adminEditForm.display_name || null,
        email: adminEditForm.email || null,
      });
    },
    onSuccess: async ({ resource }) => {
      await invalidateAdminQueries();
      setSelectedAdmin(resource);
      const nextForm = buildAdminEditForm(resource);
      setAdminEditForm(nextForm);
      setEditPermissionPreset(inferPermissionPreset(nextForm.permissions));
    },
  });

  const filteredAdmins = useMemo(() => {
    const admins = adminsQuery.data?.items ?? [];
    return admins.filter((admin) => {
      const matchesTenant = inventoryTenantFilter
        ? admin.scopes.some((scope) => scope.tenant_id === inventoryTenantFilter)
        : true;
      const haystack = [admin.user_id_hash, admin.profile?.display_name, admin.profile?.email, admin.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesTenant && haystack.includes(search.toLowerCase());
    });
  }, [adminsQuery.data, inventoryTenantFilter, search]);

  const openAdminDialog = (admin: AdminUser) => {
    const form = buildAdminEditForm(admin);
    setSelectedAdmin(admin);
    setAdminEditForm(form);
    setEditPermissionPreset(inferPermissionPreset(form.permissions));
    updateAdminMutation.reset();
  };

  const closeAdminDialog = () => {
    setSelectedAdmin(null);
    setAdminEditForm(defaultAdminEditForm);
    setEditPermissionPreset("custom");
    updateAdminMutation.reset();
  };

  const applyPermissionPreset = (presetKey: AdminPermissionPresetKey | "custom") => {
    setEditPermissionPreset(presetKey);
    if (presetKey === "custom") {
      return;
    }
    setAdminEditForm((current) => ({
      ...current,
      permissions: [...adminPermissionPresets[presetKey].permissions],
    }));
  };

  const togglePermission = (permission: string) => {
    setAdminEditForm((current) => {
      const permissions = current.permissions.includes(permission)
        ? current.permissions.filter((value) => value !== permission)
        : [...current.permissions, permission];
      return { ...current, permissions };
    });
    setEditPermissionPreset("custom");
  };

  const applyTenantAdminPermissionPreset = (presetKey: AdminPermissionPresetSelection) => {
    setTenantAdminPermissionPreset(presetKey);
    setTenantAdminSuccessMessage(null);
    if (presetKey === "custom") {
      return;
    }
    setTenantAdminPermissions([...adminPermissionPresets[presetKey].permissions]);
  };

  const toggleTenantAdminPermission = (permission: string) => {
    setTenantAdminPermissions((current) => {
      const permissions = current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission];
      return permissions;
    });
    setTenantAdminPermissionPreset("custom");
    setTenantAdminSuccessMessage(null);
  };

  const applySuperAdminPermissionPreset = (presetKey: AdminPermissionPresetSelection) => {
    setSuperAdminPermissionPreset(presetKey);
    setSuperAdminSuccessMessage(null);
    if (presetKey === "custom") {
      return;
    }
    setSuperAdminPermissions([...adminPermissionPresets[presetKey].permissions]);
  };

  const toggleSuperAdminPermission = (permission: string) => {
    setSuperAdminPermissions((current) => {
      const permissions = current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission];
      return permissions;
    });
    setSuperAdminPermissionPreset("custom");
    setSuperAdminSuccessMessage(null);
  };

  if (tenantsQuery.isLoading || adminsQuery.isLoading) {
    return <LoadingBlock label="Loading admins..." />;
  }

  const tenantNameById = new Map((tenantsQuery.data?.items ?? []).map((item) => [item.tenant.id, item.tenant.tenant_name]));

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Admins</h1>
          <p className="page-subtitle">
            Assign and review admin roles with separate flows for tenant-scoped access and platform-wide super admin access.
          </p>
        </div>
        <Link className="secondary-button" to="/activation">
          Open activation
        </Link>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Assign Tenant Admin</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Create a tenant-scoped admin with a permission preset. Filter users by organization and group, then assign by email.
            </div>
          </div>

          {createTenantAdminMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(createTenantAdminMutation.error)}</div>
          ) : null}
          {tenantAdminSuccessMessage ? (
            <div className="section-note">{tenantAdminSuccessMessage}</div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="tenant_admin_tenant_id">Organization</label>
            <select
              className="field"
              id="tenant_admin_tenant_id"
              value={tenantAdminTenantId}
              onChange={(event) => setTenantAdminTenantId(event.target.value)}
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
            <label className="field-label" htmlFor="tenant_admin_group_id">Group Filter</label>
            <select
              className="field"
              id="tenant_admin_group_id"
              value={tenantAdminGroupId}
              onChange={(event) => setTenantAdminGroupId(event.target.value)}
              disabled={!tenantAdminTenantId || tenantAdminGroupsQuery.isLoading}
            >
              <option value="">All groups</option>
              {tenantAdminGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.group_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="tenant_admin_user_id_hash">User Email</label>
            <select
              className="field"
              id="tenant_admin_user_id_hash"
              value={tenantAdminUserIdHash}
              onChange={(event) => {
                setTenantAdminUserIdHash(event.target.value);
                setTenantAdminSuccessMessage(null);
              }}
              disabled={!tenantAdminTenantId || tenantAdminUsersQuery.isLoading}
            >
              <option value="">{tenantAdminTenantId ? "Select user by email" : "Select organization first"}</option>
              {tenantAdminUsers.map((user) => (
                <option key={user.user_id_hash} value={user.user_id_hash}>
                  {buildUserLabel(user)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="tenant_admin_permission_preset">Permission Preset</label>
            <select
              className="field"
              id="tenant_admin_permission_preset"
              value={tenantAdminPermissionPreset}
              onChange={(event) => applyTenantAdminPermissionPreset(event.target.value as AdminPermissionPresetSelection)}
            >
              {Object.entries(adminPermissionPresets).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <div className="field-label">Permissions</div>
            <div className="stack" style={{ gap: 10 }}>
              {permissionCatalog.map((permission) => (
                <label key={permission} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    checked={tenantAdminPermissions.includes(permission)}
                    onChange={() => toggleTenantAdminPermission(permission)}
                    type="checkbox"
                  />
                  <span>{permission}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            className="primary-button"
            disabled={!tenantAdminTenantId || !tenantAdminUserIdHash || tenantAdminPermissions.length === 0 || createTenantAdminMutation.isPending}
            onClick={() => createTenantAdminMutation.mutate()}
            type="button"
          >
            {createTenantAdminMutation.isPending ? "Assigning..." : "Assign Tenant Admin"}
          </button>
        </div>

        {isSuperAdmin ? (
          <div className="panel stack">
            <div>
              <h3 className="panel-title">Assign Super Admin</h3>
              <div className="muted" style={{ marginTop: 8 }}>
                Platform-wide admin access is managed separately. Only existing super admins can view or use this card.
              </div>
            </div>

            {createSuperAdminMutation.error ? (
              <div className="section-note section-note--danger">{mutationMessage(createSuperAdminMutation.error)}</div>
            ) : null}
            {superAdminSuccessMessage ? (
              <div className="section-note">{superAdminSuccessMessage}</div>
            ) : null}

            <div>
              <label className="field-label" htmlFor="super_admin_tenant_filter">Organization Filter</label>
              <select
                className="field"
                id="super_admin_tenant_filter"
                value={superAdminTenantFilterId}
                onChange={(event) => {
                  setSuperAdminTenantFilterId(event.target.value);
                  setSuperAdminSuccessMessage(null);
                }}
              >
                <option value="">All organizations</option>
                {(tenantsQuery.data?.items ?? []).map((item) => (
                  <option key={item.tenant.id} value={item.tenant.id}>
                    {item.tenant.tenant_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="super_admin_group_id">Group Filter</label>
              <select
                className="field"
                id="super_admin_group_id"
                value={superAdminGroupId}
                onChange={(event) => {
                  setSuperAdminGroupId(event.target.value);
                  setSuperAdminSuccessMessage(null);
                }}
                disabled={!superAdminTenantFilterId || superAdminGroupsQuery.isLoading}
              >
                <option value="">All groups</option>
                {superAdminGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.group_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="super_admin_user_id_hash">User Email</label>
              <select
                className="field"
                id="super_admin_user_id_hash"
                value={superAdminUserIdHash}
                onChange={(event) => {
                  setSuperAdminUserIdHash(event.target.value);
                  setSuperAdminSuccessMessage(null);
                }}
                disabled={superAdminUsersQuery.isLoading}
              >
                <option value="">Select user by email</option>
                {superAdminUsers.map((user) => (
                  <option key={user.user_id_hash} value={user.user_id_hash}>
                    {buildUserLabel(user)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="super_admin_permission_preset">Permission Preset</label>
              <select
                className="field"
                id="super_admin_permission_preset"
                value={superAdminPermissionPreset}
                onChange={(event) => applySuperAdminPermissionPreset(event.target.value as AdminPermissionPresetSelection)}
              >
                {Object.entries(adminPermissionPresets).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <div className="field-label">Permissions</div>
              <div className="stack" style={{ gap: 10 }}>
                {permissionCatalog.map((permission) => (
                  <label key={permission} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      checked={superAdminPermissions.includes(permission)}
                      onChange={() => toggleSuperAdminPermission(permission)}
                      type="checkbox"
                    />
                    <span>{permission}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              className="primary-button"
              disabled={!superAdminUserIdHash || superAdminPermissions.length === 0 || createSuperAdminMutation.isPending}
              onClick={() => createSuperAdminMutation.mutate()}
              type="button"
            >
              {createSuperAdminMutation.isPending ? "Assigning..." : "Assign Super Admin"}
            </button>
          </div>
        ) : (
          <div className="panel stack">
            <div>
              <h3 className="panel-title">Super Admin Access</h3>
              <div className="muted" style={{ marginTop: 8 }}>
                This assignment card is visible only to existing super admins so platform-wide access stays tightly controlled.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Admin Inventory</h3>
          <div className="muted" style={{ marginTop: 8 }}>
            Review current admin assignments and tune permissions without mixing platform-wide admin creation into tenant-scoped onboarding work.
          </div>
        </div>

        <div className="filter-bar">
          <input
            className="search-input"
            placeholder="Search admins"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select-input"
            value={inventoryTenantFilter || "all"}
            onChange={(event) => setInventoryTenantFilter(event.target.value === "all" ? "" : event.target.value)}
          >
            <option value="all">All organizations</option>
            {(tenantsQuery.data?.items ?? []).map((item) => (
              <option key={item.tenant.id} value={item.tenant.id}>
                {item.tenant.tenant_name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Permissions</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAdmins.length === 0 ? (
                <tr>
                  <td colSpan={6}>No admins match the current filters.</td>
                </tr>
              ) : (
                filteredAdmins.map((admin) => (
                  <tr key={admin.id}>
                    <td>
                      <strong>{admin.profile?.display_name ?? "Unnamed admin"}</strong>
                      <div className="muted">{admin.profile?.email ?? "No email on file"}</div>
                    </td>
                    <td>{admin.role}</td>
                    <td>
                      {admin.scopes
                        .map((scope) => {
                          if (scope.tenant_id) {
                            return tenantNameById.get(scope.tenant_id) ?? scope.tenant_id;
                          }
                          return scope.scope_type;
                        })
                        .join(", ")}
                    </td>
                    <td>{admin.permissions.map((permission) => permission.permission_key).join(", ") || "No permissions"}</td>
                    <td>
                      <StatusBadge value={admin.is_active ? "active" : "inactive"} />
                    </td>
                    <td>
                      <button className="ghost-button" onClick={() => openAdminDialog(admin)} type="button">
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedAdmin ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeAdminDialog}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-edit-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="admin-edit-dialog-title">Manage Admin Role</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {selectedAdmin.profile?.email ?? "No email on file"}
                </div>
              </div>
              <button className="ghost-button" onClick={closeAdminDialog} type="button">
                Close
              </button>
            </div>

            {updateAdminMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(updateAdminMutation.error)}
              </div>
            ) : null}

            <div className="stack" style={{ marginTop: 18 }}>
              <div className="field-row field-row--three">
                <div>
                  <label className="field-label" htmlFor="edit_admin_display_name">Display Name</label>
                  <input
                    className="field"
                    id="edit_admin_display_name"
                    value={adminEditForm.display_name}
                    onChange={(event) =>
                      setAdminEditForm((current) => ({ ...current, display_name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="edit_admin_email">Email</label>
                  <input
                    className="field"
                    id="edit_admin_email"
                    value={adminEditForm.email}
                    onChange={(event) => setAdminEditForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </div>
                <div style={{ alignSelf: "end" }}>
                  <label className="field-label" htmlFor="edit_admin_active">Admin Status</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                    <input
                      id="edit_admin_active"
                      checked={adminEditForm.is_active}
                      onChange={(event) =>
                        setAdminEditForm((current) => ({ ...current, is_active: event.target.checked }))
                      }
                      type="checkbox"
                    />
                    <span>Active in tenant administration</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="edit_admin_permission_preset">Permission Preset</label>
                <select
                  className="field"
                  id="edit_admin_permission_preset"
                  value={editPermissionPreset}
                  onChange={(event) =>
                    applyPermissionPreset(event.target.value as AdminPermissionPresetKey | "custom")
                  }
                >
                  {Object.entries(adminPermissionPresets).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <div className="field-label">Permissions</div>
                <div className="stack" style={{ gap: 10 }}>
                  {permissionCatalog.map((permission) => (
                    <label key={permission} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        checked={adminEditForm.permissions.includes(permission)}
                        onChange={() => togglePermission(permission)}
                        type="checkbox"
                      />
                      <span>{permission}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="section-note">
                Scope changes remain locked to the existing assignment so we can manage roles safely without creating cross-tenant drift from this dialog.
              </div>

              <div className="dialog-actions">
                <button
                  className="primary-button"
                  disabled={adminEditForm.permissions.length === 0 || updateAdminMutation.isPending}
                  onClick={() => updateAdminMutation.mutate()}
                  type="button"
                >
                  {updateAdminMutation.isPending ? "Saving..." : "Save Admin Updates"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
