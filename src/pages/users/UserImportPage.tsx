import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { tenantApi } from "../../features/tenants/api";
import { parseImportedUsers } from "../../lib/userImport";

type UserLimitDialogState = {
  requestedUsers: number;
  currentUsers: number;
  limit: number;
  blocked: boolean;
};

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

export function UserImportPage() {
  const location = useLocation();
  const preferredTenantId =
    typeof (location.state as { tenantId?: string } | null)?.tenantId === "string"
      ? (location.state as { tenantId?: string }).tenantId ?? ""
      : "";

  const [importTenantId, setImportTenantId] = useState("");
  const [importText, setImportText] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [userLimitDialog, setUserLimitDialog] = useState<UserLimitDialogState | null>(null);
  const queryClient = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["users-import-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const tenantUsersQuery = useQuery({
    queryKey: ["users-import-tenant-users", importTenantId],
    queryFn: () => tenantApi.getUsers(importTenantId),
    enabled: Boolean(importTenantId),
  });

  useEffect(() => {
    if (importTenantId) {
      return;
    }
    const fallbackTenantId = preferredTenantId || tenantsQuery.data?.items?.[0]?.tenant.id || "";
    if (fallbackTenantId) {
      setImportTenantId(fallbackTenantId);
    }
  }, [importTenantId, preferredTenantId, tenantsQuery.data]);

  const parsedImportRows = useMemo(() => parseImportedUsers(importText), [importText]);
  const selectedImportTenant =
    (tenantsQuery.data?.items ?? []).find((item) => item.tenant.id === importTenantId) ?? null;
  const currentUsersForImportTenant = (tenantUsersQuery.data?.items ?? []).filter((user) => user.status !== "deleted").length;

  const invalidateUserQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-page-users"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["users-page-tenants"] }),
      queryClient.invalidateQueries({ queryKey: ["users-import-tenant-users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant"] }),
      queryClient.invalidateQueries({ queryKey: ["tenants"] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-onboarding"] }),
      queryClient.invalidateQueries({ queryKey: ["activation-users"] }),
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail"] }),
    ]);
  };

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
          ...(row.user_id_hash ? { user_id_hash: row.user_id_hash } : {}),
          tenant_id: importTenantId,
          group_ids: groupId ? [groupId] : [],
          status: row.status,
          is_primary: true,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          email: row.email || null,
          title: row.title || null,
          initial_user_type: row.initial_user_type,
        });
      }
    },
    onMutate: async () => {
      setSuccessMessage(null);
    },
    onSuccess: async () => {
      setImportText("");
      setSuccessMessage(`Imported ${parsedImportRows.length} user row${parsedImportRows.length === 1 ? "" : "s"} successfully.`);
      await invalidateUserQueries();
    },
  });

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

  if (tenantsQuery.isLoading || (importTenantId && tenantUsersQuery.isLoading)) {
    return <LoadingBlock label="Loading import workspace..." />;
  }

  return (
    <div className="stack users-page">
      <div className="page-header">
        <div>
          <div className="muted" style={{ marginBottom: 10 }}>
            <Link to="/users">Users</Link> / Bulk Import
          </div>
          <h1 className="page-title">Bulk Import Users</h1>
          <p className="page-subtitle">
            Paste CSV or tab-separated rows to create multiple users through the existing Herman Admin import flow.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="secondary-button" to="/users">
            Back to users
          </Link>
        </div>
      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Import Configuration</h3>
          <div className="muted" style={{ marginTop: 8 }}>
            Supported headers include `email,first_name,last_name,title,group_name,status,user_id_hash,initial_user_type`.
          </div>
        </div>

        {importUsersMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(importUsersMutation.error)}</div>
        ) : null}
        {successMessage ? <div className="section-note section-note--success">{successMessage}</div> : null}

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

        <div>
          <label className="field-label" htmlFor="users_import_text">User Rows</label>
          <textarea
            className="field"
            id="users_import_text"
            rows={10}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="field-tip">
            The preview count ignores blank lines and preserves the existing import behavior of auto-generating a user hash when one is not supplied.
          </div>
        </div>

        <div className="section-note">
          {parsedImportRows.length} row{parsedImportRows.length === 1 ? "" : "s"} ready to import.
        </div>

        <div className="dialog-actions">
          <button
            className="primary-button"
            disabled={!importTenantId || parsedImportRows.length === 0 || importUsersMutation.isPending}
            onClick={requestBulkImport}
            type="button"
          >
            {importUsersMutation.isPending ? "Importing..." : "Import users"}
          </button>
        </div>
      </div>

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
