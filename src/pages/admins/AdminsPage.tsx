import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import type { AdminUser } from "../../lib/types";

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

export function AdminsPage() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState("");
  const [search, setSearch] = useState("");
  const [adminForm, setAdminForm] = useState({
    user_id_hash: "",
    display_name: "",
    email: "",
  });
  const [adminPermissionPreset, setAdminPermissionPreset] = useState<AdminPermissionPresetKey>("read_write");
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

  useEffect(() => {
    if (!tenantId && tenantsQuery.data?.items?.[0]?.tenant.id) {
      setTenantId(tenantsQuery.data.items[0].tenant.id);
    }
  }, [tenantId, tenantsQuery.data]);

  const invalidateAdminQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admins-page-admins"] }),
      queryClient.invalidateQueries({ queryKey: ["admins"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-onboarding"] }),
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail"] }),
    ]);
  };

  const createAdminMutation = useMutation({
    mutationFn: () => {
      if (!tenantId) {
        throw new Error("Select an organization before assigning an admin.");
      }
      return tenantApi.createAdmin({
        user_id_hash: adminForm.user_id_hash,
        role: "tenant_admin",
        permissions: adminPermissionPresets[adminPermissionPreset].permissions,
        scopes: [{ scope_type: "tenant", tenant_id: tenantId }],
        display_name: adminForm.display_name || null,
        email: adminForm.email || null,
      });
    },
    onSuccess: async () => {
      setAdminForm({ user_id_hash: "", display_name: "", email: "" });
      setAdminPermissionPreset("read_write");
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
      const matchesTenant = tenantId
        ? admin.scopes.some((scope) => scope.tenant_id === tenantId) || tenantId === "all"
        : true;
      const haystack = [admin.user_id_hash, admin.profile?.display_name, admin.profile?.email, admin.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesTenant && haystack.includes(search.toLowerCase());
    });
  }, [adminsQuery.data, search, tenantId]);

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
            Assign and review tenant-scoped admin roles during onboarding or after activation. Reseller-scoped admin setup still lives in the reseller workspace.
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
              Create a tenant-scoped admin with a permission preset and attach it directly to the selected organization.
            </div>
          </div>

          {createAdminMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(createAdminMutation.error)}</div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="admins_tenant_id">Organization</label>
            <select
              className="field"
              id="admins_tenant_id"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
            >
              <option value="">Select organization</option>
              {(tenantsQuery.data?.items ?? []).map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.tenant_name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="admins_display_name">Display Name</label>
              <input
                className="field"
                id="admins_display_name"
                value={adminForm.display_name}
                onChange={(event) => setAdminForm((current) => ({ ...current, display_name: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="admins_email">Email</label>
              <input
                className="field"
                id="admins_email"
                value={adminForm.email}
                onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="admins_permission_preset">Permission Preset</label>
            <select
              className="field"
              id="admins_permission_preset"
              value={adminPermissionPreset}
              onChange={(event) => setAdminPermissionPreset(event.target.value as AdminPermissionPresetKey)}
            >
              {Object.entries(adminPermissionPresets).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="primary-button"
            disabled={!tenantId || (!adminForm.email.trim() && !adminForm.display_name.trim()) || createAdminMutation.isPending}
            onClick={() => createAdminMutation.mutate()}
            type="button"
          >
            {createAdminMutation.isPending ? "Assigning..." : "Assign admin"}
          </button>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Admin Inventory</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Review tenant-scoped admin assignments and update permissions when an organization needs tighter access controls.
            </div>
          </div>

          <div className="filter-bar">
            <input
              className="search-input"
              placeholder="Search admins"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select className="select-input" value={tenantId || "all"} onChange={(event) => setTenantId(event.target.value === "all" ? "" : event.target.value)}>
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
                Scope changes remain locked to the existing tenant assignment on this branch so we can strengthen reseller foundation workflows without risking cross-system scope drift.
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
