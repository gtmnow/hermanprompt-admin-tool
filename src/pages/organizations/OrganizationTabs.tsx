import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";

import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime, titleCase } from "../../lib/format";
import type {
  AdminUser,
  Group,
  PlatformManagedLlmConfig,
  ReportSummary,
  TenantLLMConfig,
  TenantOnboarding,
  TenantPortalConfig,
  TenantRuntimeSettings,
  TenantSummary,
  UserMembership,
} from "../../lib/types";

type DetailOutletContext = {
  tenant: TenantSummary;
  users: UserMembership[];
  groups: Group[];
  admins: AdminUser[];
  onboarding: TenantOnboarding | undefined;
  report: ReportSummary | undefined;
};

const defaultGroupForm = {
  group_name: "",
  group_type: "Working Group",
  business_unit: "",
  owner_name: "",
  description: "",
};

const defaultUserForm = {
  user_id_hash: "",
  first_name: "",
  last_name: "",
  email: "",
  title: "",
  status: "invited" as UserMembership["status"],
};

const defaultAdminForm = {
  user_id_hash: "",
  display_name: "",
  email: "",
};

const defaultLlmForm = {
  provider_type: "openai",
  model_name: "gpt-5.4",
  endpoint_url: "",
  api_key: "",
  secret_reference: "",
  platform_managed_config_id: "",
  credential_mode: "customer_managed" as TenantLLMConfig["credential_mode"],
  transformation_enabled: true,
  scoring_enabled: true,
};

const defaultRuntimeForm: TenantRuntimeSettings = {
  enforcement_mode: "coaching",
  reporting_enabled: true,
  export_enabled: true,
  raw_prompt_retention_enabled: false,
  raw_prompt_admin_visibility: false,
  data_retention_days: 30,
  feature_flags_json: {
    onboarding_assistant: true,
    portfolio_reporting: true,
  },
};

const llmProviderOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom Endpoint" },
];

const llmModelOptions: Record<string, string[]> = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  azure_openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4", "claude-opus-4"],
  custom: [],
};

const defaultTenantAdminPermissions = [
  "users.read",
  "users.write",
  "groups.read",
  "groups.write",
  "runtime.read",
  "analytics.read",
];

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

function useDetailContext() {
  return useOutletContext<DetailOutletContext>();
}

function useTenantInvalidate(tenantId: string) {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-users", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-groups", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["tenant-onboarding", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["admins", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    ]);
}

export function OrganizationUsersTab() {
  const { tenant, users, groups } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [userForm, setUserForm] = useState(defaultUserForm);
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const createUserMutation = useMutation({
    mutationFn: () =>
      tenantApi.createUser({
        user_id_hash: userForm.user_id_hash,
        tenant_id: tenantId,
        group_ids: selectedGroupId ? [selectedGroupId] : [],
        status: userForm.status,
        is_primary: true,
        first_name: userForm.first_name || null,
        last_name: userForm.last_name || null,
        email: userForm.email || null,
        title: userForm.title || null,
      }),
    onSuccess: async () => {
      setUserForm(defaultUserForm);
      setSelectedGroupId("");
      await invalidateTenant();
    },
  });

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Add Organization User</h3>
            <div className="muted">Create an admin-managed membership record directly inside {tenant.tenant.tenant_name}.</div>
          </div>
          <Link className="ghost-button" to={`/activation/${tenantId}`}>
            Open full workflow
          </Link>
        </div>

        {createUserMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(createUserMutation.error)}</div>
        ) : null}

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="org_user_hash">User Hash</label>
            <input
              className="field"
              id="org_user_hash"
              value={userForm.user_id_hash}
              onChange={(event) => setUserForm((current) => ({ ...current, user_id_hash: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_user_email">Email</label>
            <input
              className="field"
              id="org_user_email"
              value={userForm.email}
              onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_user_status">Status</label>
            <select
              className="field"
              id="org_user_status"
              value={userForm.status}
              onChange={(event) =>
                setUserForm((current) => ({ ...current, status: event.target.value as UserMembership["status"] }))
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
            <label className="field-label" htmlFor="org_user_first_name">First Name</label>
            <input
              className="field"
              id="org_user_first_name"
              value={userForm.first_name}
              onChange={(event) => setUserForm((current) => ({ ...current, first_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_user_last_name">Last Name</label>
            <input
              className="field"
              id="org_user_last_name"
              value={userForm.last_name}
              onChange={(event) => setUserForm((current) => ({ ...current, last_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_user_title">Title</label>
            <input
              className="field"
              id="org_user_title"
              value={userForm.title}
              onChange={(event) => setUserForm((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
        </div>

        <div style={{ maxWidth: 360 }}>
          <label className="field-label" htmlFor="org_user_group">Initial Group</label>
          <select
            className="field"
            id="org_user_group"
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
          >
            <option value="">No group assignment</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            className="primary-button"
            disabled={!userForm.user_id_hash.trim()}
            onClick={() => createUserMutation.mutate()}
            type="button"
          >
            {createUserMutation.isPending ? "Saving..." : "Add user"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Users</h3>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          {users.length === 0 ? (
            <div className="empty-state table-empty-state">No users are linked to this organization yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Groups</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.profile?.first_name || user.profile?.last_name
                          ? `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim()
                          : user.user_id_hash}
                      </strong>
                      <div className="muted">{user.profile?.email ?? user.user_id_hash}</div>
                    </td>
                    <td><StatusBadge value={user.status} /></td>
                    <td>
                      {user.group_memberships.length}
                      <div className="muted">{user.profile?.title ?? "Title pending"}</div>
                    </td>
                    <td>{formatDateTime(user.created_at)}</td>
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

export function OrganizationGroupsTab() {
  const { tenant, groups } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [groupForm, setGroupForm] = useState(defaultGroupForm);

  const createGroupMutation = useMutation({
    mutationFn: () =>
      tenantApi.createGroup({
        tenant_id: tenantId,
        group_name: groupForm.group_name,
        group_type: groupForm.group_type || null,
        business_unit: groupForm.business_unit || null,
        owner_name: groupForm.owner_name || null,
        description: groupForm.description || null,
      }),
    onSuccess: async () => {
      setGroupForm(defaultGroupForm);
      await invalidateTenant();
    },
  });

  return (
    <div className="stack">
      <div className="panel stack">
        <div>
          <h3 className="panel-title">Create Group</h3>
          <div className="muted">Add admin-owned teams, business units, or cohort groupings for this organization.</div>
        </div>

        {createGroupMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(createGroupMutation.error)}</div>
        ) : null}

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="org_group_name">Group Name</label>
            <input
              className="field"
              id="org_group_name"
              value={groupForm.group_name}
              onChange={(event) => setGroupForm((current) => ({ ...current, group_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_group_type">Group Type</label>
            <input
              className="field"
              id="org_group_type"
              value={groupForm.group_type}
              onChange={(event) => setGroupForm((current) => ({ ...current, group_type: event.target.value }))}
            />
          </div>
        </div>

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="org_group_business_unit">Business Unit</label>
            <input
              className="field"
              id="org_group_business_unit"
              value={groupForm.business_unit}
              onChange={(event) => setGroupForm((current) => ({ ...current, business_unit: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_group_owner">Owner</label>
            <input
              className="field"
              id="org_group_owner"
              value={groupForm.owner_name}
              onChange={(event) => setGroupForm((current) => ({ ...current, owner_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_group_description">Description</label>
            <input
              className="field"
              id="org_group_description"
              value={groupForm.description}
              onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
        </div>

        <div>
          <button
            className="primary-button"
            disabled={!groupForm.group_name.trim()}
            onClick={() => createGroupMutation.mutate()}
            type="button"
          >
            {createGroupMutation.isPending ? "Saving..." : "Create group"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Groups</h3>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          {groups.length === 0 ? (
            <div className="empty-state table-empty-state">No admin-owned groups have been created for this organization yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <strong>{group.group_name}</strong>
                      <div className="muted">{group.profile?.description ?? "No description yet"}</div>
                    </td>
                    <td>{group.profile?.business_unit ?? group.group_type ?? "General"}</td>
                    <td><StatusBadge value={group.is_active ? "active" : "inactive"} /></td>
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

export function OrganizationAdminsTab() {
  const { tenant, admins } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [adminForm, setAdminForm] = useState(defaultAdminForm);

  const createAdminMutation = useMutation({
    mutationFn: () =>
      tenantApi.createAdmin({
        user_id_hash: adminForm.user_id_hash,
        role: "tenant_admin",
        permissions: defaultTenantAdminPermissions,
        scopes: [{ scope_type: "tenant", tenant_id: tenantId }],
        display_name: adminForm.display_name || null,
        email: adminForm.email || null,
      }),
    onSuccess: async () => {
      setAdminForm(defaultAdminForm);
      await invalidateTenant();
    },
  });

  return (
    <div className="stack">
      <div className="panel stack">
        <div>
          <h3 className="panel-title">Assign Tenant Admin</h3>
          <div className="muted">Create a tenant-scoped admin with the standard user, group, runtime, and analytics permissions.</div>
        </div>

        {createAdminMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(createAdminMutation.error)}</div>
        ) : null}

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="org_admin_hash">User Hash</label>
            <input
              className="field"
              id="org_admin_hash"
              value={adminForm.user_id_hash}
              onChange={(event) => setAdminForm((current) => ({ ...current, user_id_hash: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_admin_name">Display Name</label>
            <input
              className="field"
              id="org_admin_name"
              value={adminForm.display_name}
              onChange={(event) => setAdminForm((current) => ({ ...current, display_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_admin_email">Email</label>
            <input
              className="field"
              id="org_admin_email"
              value={adminForm.email}
              onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
        </div>

        <div className="section-note">
          New admins are created as `tenant_admin` with standard scoped permissions for this organization.
        </div>

        <div>
          <button
            className="primary-button"
            disabled={!adminForm.user_id_hash.trim()}
            onClick={() => createAdminMutation.mutate()}
            type="button"
          >
            {createAdminMutation.isPending ? "Saving..." : "Assign admin"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Admins</h3>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          {admins.length === 0 ? (
            <div className="empty-state table-empty-state">No tenant admins are assigned to this organization yet.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Role</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>
                      <strong>{admin.profile?.display_name ?? admin.user_id_hash}</strong>
                      <div className="muted">{admin.profile?.email ?? admin.user_id_hash}</div>
                    </td>
                    <td>{titleCase(admin.role)}</td>
                    <td>{admin.scopes.map((scope) => titleCase(scope.scope_type)).join(", ")}</td>
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

export function OrganizationLlmConfigTab() {
  const { tenant } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [llmForm, setLlmForm] = useState(defaultLlmForm);
  const [validationMessage, setValidationMessage] = useState<string | null>(tenant.llm_config?.last_validation_message ?? null);
  const platformManagedLlmsQuery = useQuery({
    queryKey: ["platform-managed-llms"],
    queryFn: () => tenantApi.listPlatformManagedLlms(),
  });

  useEffect(() => {
    setLlmForm({
      provider_type: tenant.llm_config?.provider_type ?? defaultLlmForm.provider_type,
      model_name: tenant.llm_config?.model_name ?? defaultLlmForm.model_name,
      endpoint_url: tenant.llm_config?.endpoint_url ?? "",
      api_key: "",
      secret_reference: tenant.llm_config?.secret_reference ?? "",
      platform_managed_config_id: tenant.llm_config?.platform_managed_config_id ?? "",
      credential_mode: tenant.llm_config?.credential_mode ?? defaultLlmForm.credential_mode,
      transformation_enabled: tenant.llm_config?.transformation_enabled ?? true,
      scoring_enabled: tenant.llm_config?.scoring_enabled ?? true,
    });
    setValidationMessage(tenant.llm_config?.last_validation_message ?? null);
  }, [tenant]);

  const saveLlmMutation = useMutation({
    mutationFn: () =>
      tenantApi.putLlmConfig(tenantId, {
        provider_type: llmForm.provider_type,
        model_name: llmForm.model_name,
        endpoint_url: llmForm.endpoint_url || null,
        api_key: llmForm.api_key || null,
        secret_reference: llmForm.secret_reference || null,
        platform_managed_config_id: llmForm.platform_managed_config_id || null,
        credential_mode: llmForm.credential_mode,
        transformation_enabled: llmForm.transformation_enabled,
        scoring_enabled: llmForm.scoring_enabled,
      }),
    onSuccess: async () => {
      setLlmForm((current) => ({ ...current, api_key: "" }));
      await invalidateTenant();
    },
  });

  const validateLlmMutation = useMutation({
    mutationFn: () => tenantApi.validateLlmConfig(tenantId),
    onSuccess: async (result) => {
      setValidationMessage(result.resource.message ?? "Validation completed.");
      await invalidateTenant();
    },
  });

  const modelOptions = llmModelOptions[llmForm.provider_type] ?? [];
  const platformManagedOptions = platformManagedLlmsQuery.data?.items ?? [];
  const selectedPlatformManagedConfig =
    platformManagedOptions.find((item) => item.id === llmForm.platform_managed_config_id) ?? null;

  useEffect(() => {
    if (llmForm.credential_mode !== "platform_managed") {
      return;
    }
    const fallback = selectedPlatformManagedConfig ?? platformManagedOptions[0] ?? null;
    if (!fallback) {
      return;
    }
    setLlmForm((current) => ({
      ...current,
      platform_managed_config_id: fallback.id,
      provider_type: fallback.provider_type,
      model_name: fallback.model_name,
      endpoint_url: fallback.endpoint_url ?? "",
      secret_reference: fallback.secret_reference ?? "",
      api_key: "",
    }));
  }, [llmForm.credential_mode, platformManagedOptions, selectedPlatformManagedConfig]);

  function onPlatformManagedSelect(configId: string) {
    const nextConfig = platformManagedOptions.find((item) => item.id === configId);
    if (!nextConfig) {
      return;
    }
    setLlmForm((current) => ({
      ...current,
      platform_managed_config_id: nextConfig.id,
      provider_type: nextConfig.provider_type,
      model_name: nextConfig.model_name,
      endpoint_url: nextConfig.endpoint_url ?? "",
      secret_reference: nextConfig.secret_reference ?? "",
      api_key: "",
    }));
  }

  async function handleSaveAndValidate() {
    await saveLlmMutation.mutateAsync();
    await validateLlmMutation.mutateAsync();
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="split-header">
          <div>
            <h3 className="panel-title">LLM Configuration</h3>
            <div className="muted">Update provider settings, manage credential references, then validate the configuration.</div>
          </div>
          {tenant.llm_config ? <StatusBadge value={tenant.llm_config.credential_status} /> : <StatusBadge value="draft" tone="warning" />}
        </div>

        {saveLlmMutation.error || validateLlmMutation.error ? (
          <div className="section-note section-note--danger">
            {mutationMessage(saveLlmMutation.error ?? validateLlmMutation.error)}
          </div>
        ) : null}

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="org_llm_provider">Provider</label>
            {llmForm.credential_mode === "platform_managed" ? (
              <select
                className="field"
                id="org_llm_provider"
                value={llmForm.platform_managed_config_id}
                onChange={(event) => onPlatformManagedSelect(event.target.value)}
              >
                {platformManagedOptions.length === 0 ? <option value="">No platform-managed LLMs available</option> : null}
                {platformManagedOptions.map((option: PlatformManagedLlmConfig) => (
                  <option key={option.id} value={option.id}>
                    {option.label} • {option.provider_type} • {option.model_name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="field"
                id="org_llm_provider"
                value={llmForm.provider_type}
                onChange={(event) =>
                  setLlmForm((current) => ({
                    ...current,
                    provider_type: event.target.value,
                    model_name: llmModelOptions[event.target.value]?.[0] ?? current.model_name,
                  }))
                }
              >
                {llmProviderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="field-label" htmlFor="org_llm_model">Model</label>
            {llmForm.credential_mode === "platform_managed" ? (
              <input className="field" id="org_llm_model" readOnly value={selectedPlatformManagedConfig?.model_name ?? llmForm.model_name} />
            ) : modelOptions.length > 0 ? (
              <select
                className="field"
                id="org_llm_model"
                value={llmForm.model_name}
                onChange={(event) => setLlmForm((current) => ({ ...current, model_name: event.target.value }))}
              >
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field"
                id="org_llm_model"
                value={llmForm.model_name}
                onChange={(event) => setLlmForm((current) => ({ ...current, model_name: event.target.value }))}
              />
            )}
          </div>
          <div>
            <label className="field-label" htmlFor="org_llm_mode">Credential Mode</label>
            <select
              className="field"
              id="org_llm_mode"
              value={llmForm.credential_mode}
              onChange={(event) =>
                setLlmForm((current) => ({
                  ...current,
                  credential_mode: event.target.value as TenantLLMConfig["credential_mode"],
                }))
              }
            >
              <option value="customer_managed">Customer managed</option>
              <option value="platform_managed">Platform managed</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="org_llm_endpoint">Endpoint URL</label>
            <input
              className="field"
              id="org_llm_endpoint"
              readOnly={llmForm.credential_mode === "platform_managed"}
              value={llmForm.endpoint_url}
              onChange={(event) => setLlmForm((current) => ({ ...current, endpoint_url: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="org_llm_secret_ref">Secret Reference</label>
            <input
              className="field"
              id="org_llm_secret_ref"
              disabled={llmForm.credential_mode === "platform_managed"}
              value={llmForm.secret_reference}
              onChange={(event) => setLlmForm((current) => ({ ...current, secret_reference: event.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="org_llm_api_key">API Key</label>
          <input
            className="field"
            id="org_llm_api_key"
            disabled={llmForm.credential_mode === "platform_managed"}
            placeholder={
              llmForm.credential_mode === "platform_managed"
                ? "Managed by HermanScience shared LLM pool"
                : tenant.llm_config?.api_key_masked ?? "Paste a new key to rotate credentials"
            }
            type="password"
            value={llmForm.api_key}
            onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
          />
          <div className="field-tip">
            {llmForm.credential_mode === "platform_managed"
              ? "The selected shared pool entry provides the managed credential for this organization."
              : "Leave blank to keep the current stored secret or rely on the referenced vault secret."}
          </div>
        </div>

        <div className="field-row">
          <label className="checkbox-row">
            <input
              checked={llmForm.transformation_enabled}
              onChange={(event) => setLlmForm((current) => ({ ...current, transformation_enabled: event.target.checked }))}
              type="checkbox"
            />
            <span>Enable prompt transformation</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={llmForm.scoring_enabled}
              onChange={(event) => setLlmForm((current) => ({ ...current, scoring_enabled: event.target.checked }))}
              type="checkbox"
            />
            <span>Enable scoring</span>
          </label>
        </div>

        <div className="key-value">
          <div className="muted">Current secret source</div>
          <div>{tenant.llm_config?.secret_source ? tenant.llm_config.secret_source.replace("_", " ") : "Not configured"}</div>
        </div>
        {llmForm.credential_mode === "platform_managed" && selectedPlatformManagedConfig ? (
          <div className="section-note">
            This organization is using the shared platform-managed LLM "{selectedPlatformManagedConfig.label}" until a customer-managed license is assigned.
          </div>
        ) : null}
        <div className="key-value">
          <div className="muted">Last validation</div>
          <div>{validationMessage ?? "Validation pending"}</div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="secondary-button" onClick={() => saveLlmMutation.mutate()} type="button">
            {saveLlmMutation.isPending ? "Saving..." : "Save config"}
          </button>
          <button
            className="primary-button"
            disabled={saveLlmMutation.isPending || validateLlmMutation.isPending}
            onClick={() => void handleSaveAndValidate()}
            type="button"
          >
            {validateLlmMutation.isPending ? "Validating..." : "Save and validate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrganizationPortalTab() {
  const { tenant } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [portalForm, setPortalForm] = useState<TenantPortalConfig>({
    id: tenant.portal_config?.id ?? null,
    portal_base_url: tenant.portal_config?.portal_base_url ?? "https://hermanportal-production.up.railway.app",
    logo_url: tenant.portal_config?.logo_url ?? "",
    welcome_message: tenant.portal_config?.welcome_message ?? "",
    is_active: tenant.portal_config?.is_active ?? true,
    created_at: tenant.portal_config?.created_at ?? null,
    updated_at: tenant.portal_config?.updated_at ?? null,
  });

  useEffect(() => {
    setPortalForm({
      id: tenant.portal_config?.id ?? null,
      portal_base_url: tenant.portal_config?.portal_base_url ?? "https://hermanportal-production.up.railway.app",
      logo_url: tenant.portal_config?.logo_url ?? "",
      welcome_message: tenant.portal_config?.welcome_message ?? "",
      is_active: tenant.portal_config?.is_active ?? true,
      created_at: tenant.portal_config?.created_at ?? null,
      updated_at: tenant.portal_config?.updated_at ?? null,
    });
  }, [tenant]);

  const savePortalMutation = useMutation({
    mutationFn: () =>
      tenantApi.updatePortalConfig(tenantId, {
        portal_base_url: portalForm.portal_base_url,
        logo_url: portalForm.logo_url || null,
        welcome_message: portalForm.welcome_message || null,
        is_active: portalForm.is_active,
      }),
    onSuccess: async () => {
      await invalidateTenant();
    },
  });

  return (
    <div className="stack">
      <div className="panel stack">
        <div>
          <h3 className="panel-title">Portal Branding</h3>
          <div className="muted">Configure the tenant-facing Herman Portal URL, custom logo, and welcome message used on login and invitation acceptance.</div>
        </div>

        {savePortalMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(savePortalMutation.error)}</div>
        ) : null}

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="org_portal_base_url">Portal Base URL</label>
            <input
              className="field"
              id="org_portal_base_url"
              value={portalForm.portal_base_url}
              onChange={(event) => setPortalForm((current) => ({ ...current, portal_base_url: event.target.value }))}
            />
            <div className="field-tip">This base URL is used when Herman Admin generates portal invitation links for this organization.</div>
          </div>
          <div>
            <label className="field-label" htmlFor="org_portal_logo_url">Logo URL</label>
            <input
              className="field"
              id="org_portal_logo_url"
              placeholder="https://..."
              value={portalForm.logo_url ?? ""}
              onChange={(event) => setPortalForm((current) => ({ ...current, logo_url: event.target.value }))}
            />
            <div className="field-tip">Use a hosted image URL for the organization logo that should appear on the portal login and invite screens.</div>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="org_portal_welcome_message">Welcome Message</label>
          <textarea
            className="field"
            id="org_portal_welcome_message"
            rows={4}
            value={portalForm.welcome_message ?? ""}
            onChange={(event) => setPortalForm((current) => ({ ...current, welcome_message: event.target.value }))}
          />
          <div className="field-tip">This message appears above the portal login form for this organization.</div>
        </div>

        <label className="checkbox-row">
          <input
            checked={portalForm.is_active}
            onChange={(event) => setPortalForm((current) => ({ ...current, is_active: event.target.checked }))}
            type="checkbox"
          />
          <span>Portal configuration active</span>
        </label>

        <div>
          <button className="primary-button" onClick={() => savePortalMutation.mutate()} type="button">
            {savePortalMutation.isPending ? "Saving..." : "Save portal settings"}
          </button>
        </div>
      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Portal Preview Data</h3>
          <div className="muted">This is the content Herman Portal will use once the portal-side auth screens read the shared tenant portal config.</div>
        </div>
        <div className="key-value">
          <div className="muted">Portal URL</div>
          <div>{portalForm.portal_base_url}</div>
        </div>
        <div className="key-value">
          <div className="muted">Logo</div>
          <div>{portalForm.logo_url ? "Custom logo configured" : "Default logo"}</div>
        </div>
        <div className="key-value">
          <div className="muted">Welcome message</div>
          <div>{portalForm.welcome_message || "Default welcome message"}</div>
        </div>
        {portalForm.logo_url ? (
          <div>
            <img
              alt={`${tenant.tenant.tenant_name} portal logo preview`}
              src={portalForm.logo_url}
              style={{ maxHeight: 72, maxWidth: 320, objectFit: "contain" }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OrganizationRuntimeTab() {
  const { tenant } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);
  const [runtimeForm, setRuntimeForm] = useState<TenantRuntimeSettings>(
    tenant.runtime_settings ?? defaultRuntimeForm,
  );
  const [featureFlagsText, setFeatureFlagsText] = useState(
    JSON.stringify((tenant.runtime_settings ?? defaultRuntimeForm).feature_flags_json, null, 2),
  );

  useEffect(() => {
    const nextRuntime = tenant.runtime_settings ?? defaultRuntimeForm;
    setRuntimeForm(nextRuntime);
    setFeatureFlagsText(JSON.stringify(nextRuntime.feature_flags_json, null, 2));
  }, [tenant]);

  const saveRuntimeMutation = useMutation({
    mutationFn: () =>
      tenantApi.updateRuntimeSettings(tenantId, {
        ...runtimeForm,
        feature_flags_json: JSON.parse(featureFlagsText || "{}") as Record<string, string | number | boolean>,
      }),
    onSuccess: async () => {
      await invalidateTenant();
    },
  });

  return (
    <div className="stack">
      <div className="panel stack">
        <div>
          <h3 className="panel-title">Runtime Settings</h3>
          <div className="muted">Manage enforcement, retention, visibility, and feature flags for this organization.</div>
        </div>

        {saveRuntimeMutation.error ? (
          <div className="section-note section-note--danger">{mutationMessage(saveRuntimeMutation.error)}</div>
        ) : null}

        <div className="field-row field-row--three">
          <div>
            <label className="field-label" htmlFor="org_runtime_enforcement">Enforcement Mode</label>
            <select
              className="field"
              id="org_runtime_enforcement"
              value={runtimeForm.enforcement_mode}
              onChange={(event) =>
                setRuntimeForm((current) => ({
                  ...current,
                  enforcement_mode: event.target.value as TenantRuntimeSettings["enforcement_mode"],
                }))
              }
            >
              <option value="advisory">Advisory</option>
              <option value="coaching">Coaching</option>
              <option value="enforced">Enforced</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="org_runtime_retention">Retention Days</label>
            <input
              className="field"
              id="org_runtime_retention"
              min={1}
              type="number"
              value={runtimeForm.data_retention_days ?? ""}
              onChange={(event) =>
                setRuntimeForm((current) => ({
                  ...current,
                  data_retention_days: event.target.value ? Number(event.target.value) : null,
                }))
              }
            />
          </div>
        </div>

        <div className="field-row">
          <label className="checkbox-row">
            <input
              checked={runtimeForm.reporting_enabled}
              onChange={(event) => setRuntimeForm((current) => ({ ...current, reporting_enabled: event.target.checked }))}
              type="checkbox"
            />
            <span>Reporting enabled</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={runtimeForm.export_enabled}
              onChange={(event) => setRuntimeForm((current) => ({ ...current, export_enabled: event.target.checked }))}
              type="checkbox"
            />
            <span>Export enabled</span>
          </label>
        </div>

        <div className="field-row">
          <label className="checkbox-row">
            <input
              checked={runtimeForm.raw_prompt_retention_enabled}
              onChange={(event) =>
                setRuntimeForm((current) => ({ ...current, raw_prompt_retention_enabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Retain raw prompts</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={runtimeForm.raw_prompt_admin_visibility}
              onChange={(event) =>
                setRuntimeForm((current) => ({ ...current, raw_prompt_admin_visibility: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Allow admin raw prompt visibility</span>
          </label>
        </div>

        <div>
          <label className="field-label" htmlFor="org_runtime_flags">Feature Flags JSON</label>
          <textarea
            className="field"
            id="org_runtime_flags"
            rows={8}
            value={featureFlagsText}
            onChange={(event) => setFeatureFlagsText(event.target.value)}
          />
          <div className="field-tip">Enter a flat JSON object such as <code>{'{"portfolio_reporting": true}'}</code>.</div>
        </div>

        <div>
          <button className="primary-button" onClick={() => saveRuntimeMutation.mutate()} type="button">
            {saveRuntimeMutation.isPending ? "Saving..." : "Save runtime settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrganizationOnboardingTab() {
  const { tenant, onboarding } = useDetailContext();
  const tenantId = tenant.tenant.id;
  const invalidateTenant = useTenantInvalidate(tenantId);

  const activateTenantMutation = useMutation({
    mutationFn: () => tenantApi.activateTenant(tenantId),
    onSuccess: async () => {
      await invalidateTenant();
    },
  });

  const blockers = [
    !onboarding?.tenant_created ? "Save the organization record" : null,
    !onboarding?.llm_configured ? "Save the LLM configuration" : null,
    !onboarding?.llm_validated ? "Validate the LLM connection" : null,
    !onboarding?.groups_created ? "Create at least one group" : null,
    !onboarding?.users_uploaded ? "Ensure at least one user is available" : null,
    !onboarding?.admin_assigned ? "Assign a tenant admin" : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="stack">
      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Onboarding</h3>
            <div className="muted">Checklist and activation readiness</div>
          </div>
          {onboarding ? <StatusBadge value={onboarding.onboarding_status} /> : null}
        </div>

        {activateTenantMutation.error ? (
          <div className="section-note section-note--danger" style={{ marginTop: 16 }}>
            {mutationMessage(activateTenantMutation.error)}
          </div>
        ) : null}

        <div className="checklist" style={{ marginTop: 18 }}>
          {[
            ["Organization created", onboarding?.tenant_created],
            ["LLM configured", onboarding?.llm_configured],
            ["LLM validated", onboarding?.llm_validated],
            ["Groups created", onboarding?.groups_created],
            ["Users uploaded", onboarding?.users_uploaded],
            ["Admin assigned", onboarding?.admin_assigned],
          ].map(([label, value]) => (
            <div className="checklist-item" key={String(label)}>
              <span>{label}</span>
              <StatusBadge value={value ? "ready" : "draft"} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Activation</h3>
          <div className="muted">Use the blockers below to finish the remaining setup, then activate the organization.</div>
        </div>

        {blockers.length === 0 ? (
          <div className="section-note">This organization is ready for activation.</div>
        ) : (
          <div className="section-note">
            {blockers.length} remaining blocker{blockers.length === 1 ? "" : "s"}: {blockers.join(", ")}.
          </div>
        )}

        <div className="key-value">
          <div className="muted">Last onboarding update</div>
          <div>{formatDateTime(onboarding?.updated_at)}</div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="primary-button"
            disabled={blockers.length > 0}
            onClick={() => activateTenantMutation.mutate()}
            type="button"
          >
            {activateTenantMutation.isPending ? "Activating..." : "Activate organization"}
          </button>
          <Link className="secondary-button" to={`/activation/${tenantId}`}>
            Open activation wizard
          </Link>
        </div>
      </div>
    </div>
  );
}
