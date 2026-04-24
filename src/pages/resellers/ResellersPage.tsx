import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import type { ResellerTenantDefaults } from "../../lib/types";

const emptyDefaults: Omit<ResellerTenantDefaults, "id" | "reseller_partner_id" | "created_at" | "updated_at"> = {
  default_plan_tier: "",
  default_service_tier_definition_id: "",
  default_service_tier: null,
  default_reporting_timezone: "America/New_York",
  default_service_mode: "",
  default_portal_base_url: "",
  default_portal_logo_url: "",
  default_portal_welcome_message: "",
  default_enforcement_mode: "coaching",
  default_reporting_enabled: true,
  default_export_enabled: true,
  default_raw_prompt_retention_enabled: false,
  default_raw_prompt_admin_visibility: false,
  default_data_retention_days: 30,
  default_feature_flags_json: {
    onboarding_assistant: true,
    portfolio_reporting: true,
  },
  default_credential_mode: "customer_managed",
  default_platform_managed_config_id: "",
  default_provider_type: "",
  default_model_name: "",
  default_endpoint_url: "",
  default_transformation_enabled: true,
  default_scoring_enabled: true,
};

const resellerAdminPresets = {
  autonomous: {
    label: "Autonomous Reseller",
    permissions: [
      "resellers.read",
      "tenants.read",
      "tenants.create",
      "tenants.write",
      "groups.read",
      "groups.create",
      "groups.write",
      "users.read",
      "users.create",
      "users.write",
      "admins.read",
      "admins.create",
      "admins.write",
      "runtime.read",
      "runtime.write",
      "runtime.validate",
      "analytics.read",
      "analytics.export",
    ],
  },
  activation_only: {
    label: "Activation Operator",
    permissions: [
      "resellers.read",
      "tenants.read",
      "tenants.create",
      "tenants.write",
      "users.read",
      "users.create",
      "users.write",
      "groups.read",
      "groups.create",
      "groups.write",
      "runtime.read",
      "runtime.write",
      "runtime.validate",
    ],
  },
  reporting: {
    label: "Reporting Lead",
    permissions: ["resellers.read", "tenants.read", "analytics.read", "analytics.export"],
  },
} as const;

type ResellerAdminPresetKey = keyof typeof resellerAdminPresets;

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

export function ResellersPage() {
  const queryClient = useQueryClient();
  const [selectedResellerId, setSelectedResellerId] = useState("");
  const [createForm, setCreateForm] = useState({
    reseller_key: "",
    reseller_name: "",
    service_tier_definition_id: "",
  });
  const [defaultsForm, setDefaultsForm] = useState(emptyDefaults);
  const [selectedResellerTierId, setSelectedResellerTierId] = useState("");
  const [adminForm, setAdminForm] = useState({
    user_id_hash: "",
    display_name: "",
    email: "",
  });
  const [adminPreset, setAdminPreset] = useState<ResellerAdminPresetKey>("autonomous");

  const resellersQuery = useQuery({
    queryKey: ["resellers"],
    queryFn: () => tenantApi.listResellers(),
  });
  const tenantsQuery = useQuery({
    queryKey: ["tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const adminsQuery = useQuery({
    queryKey: ["admins"],
    queryFn: () => tenantApi.getAdmins(),
  });
  const onboardingQuery = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => tenantApi.listOnboarding(),
  });
  const platformManagedLlmsQuery = useQuery({
    queryKey: ["platform-managed-llms"],
    queryFn: () => tenantApi.listPlatformManagedLlms(),
  });
  const resellerTiersQuery = useQuery({
    queryKey: ["service-tiers", "reseller"],
    queryFn: () => tenantApi.listServiceTiers({ scope_type: "reseller" }),
  });
  const organizationTiersQuery = useQuery({
    queryKey: ["service-tiers", "organization"],
    queryFn: () => tenantApi.listServiceTiers({ scope_type: "organization" }),
  });
  const resellerDefaultsQuery = useQuery({
    queryKey: ["reseller-defaults", selectedResellerId],
    queryFn: () => tenantApi.getResellerDefaults(selectedResellerId),
    enabled: Boolean(selectedResellerId),
  });

  useEffect(() => {
    if (!selectedResellerId && resellersQuery.data?.items?.[0]?.id) {
      setSelectedResellerId(resellersQuery.data.items[0].id);
    }
  }, [resellersQuery.data, selectedResellerId]);

  useEffect(() => {
    const resource = resellerDefaultsQuery.data?.resource;
    if (!resource) {
      return;
    }
    setDefaultsForm({
      default_plan_tier: resource.default_plan_tier ?? "",
      default_service_tier_definition_id: resource.default_service_tier_definition_id ?? "",
      default_service_tier: resource.default_service_tier ?? null,
      default_reporting_timezone: resource.default_reporting_timezone ?? "America/New_York",
      default_service_mode: resource.default_service_mode ?? "",
      default_portal_base_url: resource.default_portal_base_url ?? "",
      default_portal_logo_url: resource.default_portal_logo_url ?? "",
      default_portal_welcome_message: resource.default_portal_welcome_message ?? "",
      default_enforcement_mode: resource.default_enforcement_mode ?? "coaching",
      default_reporting_enabled: resource.default_reporting_enabled,
      default_export_enabled: resource.default_export_enabled,
      default_raw_prompt_retention_enabled: resource.default_raw_prompt_retention_enabled,
      default_raw_prompt_admin_visibility: resource.default_raw_prompt_admin_visibility,
      default_data_retention_days: resource.default_data_retention_days ?? 30,
      default_feature_flags_json: resource.default_feature_flags_json,
      default_credential_mode: resource.default_credential_mode,
      default_platform_managed_config_id: resource.default_platform_managed_config_id ?? "",
      default_provider_type: resource.default_provider_type ?? "",
      default_model_name: resource.default_model_name ?? "",
      default_endpoint_url: resource.default_endpoint_url ?? "",
      default_transformation_enabled: resource.default_transformation_enabled,
      default_scoring_enabled: resource.default_scoring_enabled,
    });
  }, [resellerDefaultsQuery.data]);

  useEffect(() => {
    const reseller = resellersQuery.data?.items.find((item) => item.id === selectedResellerId);
    setSelectedResellerTierId(reseller?.service_tier_definition_id ?? "");
  }, [resellersQuery.data, selectedResellerId]);

  const createResellerMutation = useMutation({
    mutationFn: () =>
      tenantApi.createReseller({
        reseller_key: createForm.reseller_key.trim(),
        reseller_name: createForm.reseller_name.trim(),
        is_active: true,
        service_tier_definition_id: createForm.service_tier_definition_id || null,
      }),
    onSuccess: async (result) => {
      setCreateForm({ reseller_key: "", reseller_name: "", service_tier_definition_id: "" });
      await queryClient.invalidateQueries({ queryKey: ["resellers"] });
      setSelectedResellerId(result.resource.id);
    },
  });

  const updateResellerTierMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a reseller first.");
      }
      return tenantApi.updateReseller(selectedResellerId, {
        service_tier_definition_id: selectedResellerTierId || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["resellers"] });
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a reseller first.");
      }
      return tenantApi.updateResellerDefaults(selectedResellerId, {
        ...defaultsForm,
        default_service_tier: undefined,
        default_service_tier_definition_id: defaultsForm.default_service_tier_definition_id || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reseller-defaults", selectedResellerId] });
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a reseller first.");
      }
      return tenantApi.createAdmin({
        user_id_hash: adminForm.user_id_hash,
        role: "reseller_super_user",
        permissions: resellerAdminPresets[adminPreset].permissions,
        scopes: [{ scope_type: "reseller", reseller_partner_id: selectedResellerId }],
        display_name: adminForm.display_name || null,
        email: adminForm.email || null,
      });
    },
    onSuccess: async () => {
      setAdminForm({ user_id_hash: "", display_name: "", email: "" });
      setAdminPreset("autonomous");
      await queryClient.invalidateQueries({ queryKey: ["admins"] });
    },
  });

  const assignTenantMutation = useMutation({
    mutationFn: (tenantId: string) => tenantApi.updateTenant(tenantId, { reseller_partner_id: selectedResellerId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
      ]);
    },
  });

  const unassignTenantMutation = useMutation({
    mutationFn: (tenantId: string) => tenantApi.updateTenant(tenantId, { reseller_partner_id: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
      ]);
    },
  });

  if (
    resellersQuery.isLoading ||
    tenantsQuery.isLoading ||
    adminsQuery.isLoading ||
    onboardingQuery.isLoading ||
    platformManagedLlmsQuery.isLoading ||
    resellerTiersQuery.isLoading ||
    organizationTiersQuery.isLoading
  ) {
    return <LoadingBlock label="Loading reseller workspace..." />;
  }

  const resellers = resellersQuery.data?.items ?? [];
  const tenants = tenantsQuery.data?.items ?? [];
  const admins = adminsQuery.data?.items ?? [];
  const onboarding = onboardingQuery.data?.items ?? [];
  const platformManagedLlms = platformManagedLlmsQuery.data?.items ?? [];
  const resellerTiers = resellerTiersQuery.data?.items ?? [];
  const organizationTiers = organizationTiersQuery.data?.items ?? [];
  const selectedReseller = resellers.find((item) => item.id === selectedResellerId) ?? null;
  const assignedTenants = tenants.filter((item) => item.tenant.reseller_partner_id === selectedResellerId);
  const unassignedTenants = tenants.filter((item) => !item.tenant.reseller_partner_id);
  const transferCandidates = tenants.filter((item) => item.tenant.reseller_partner_id && item.tenant.reseller_partner_id !== selectedResellerId);
  const resellerAdmins = admins.filter((admin) =>
    admin.scopes.some((scope) => scope.scope_type === "reseller" && scope.reseller_partner_id === selectedResellerId),
  );
  const readyTenants = assignedTenants.filter((item) =>
    onboarding.some((status) => status.tenant_id === item.tenant.id && (status.onboarding_status === "ready" || status.onboarding_status === "live")),
  );
  const inProgressTenants = assignedTenants.filter((item) =>
    onboarding.some((status) => status.tenant_id === item.tenant.id && status.onboarding_status === "in_progress"),
  );
  const portfolioHealthRows = assignedTenants.map((item) => {
    const onboardingState = onboarding.find((status) => status.tenant_id === item.tenant.id);
    const issueSummary = item.llm_config?.credential_status === "invalid"
      ? "Invalid LLM credentials"
      : item.tenant.status !== "active"
        ? "Tenant not active"
        : onboardingState?.onboarding_status !== "live" && onboardingState?.onboarding_status !== "ready"
          ? "Onboarding incomplete"
          : "Healthy";
    return { tenant: item, onboardingState, issueSummary };
  });
  const unhealthyTenants = portfolioHealthRows.filter((item) => item.issueSummary !== "Healthy");
  const tenantNameByResellerId = new Map(resellers.map((reseller) => [reseller.id, reseller.reseller_name]));

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Resellers</h1>
          <p className="page-subtitle">
            Create reseller partners, define their portfolio scope, assign reseller admins, and seed tenant defaults without changing shared cross-system tables.
          </p>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Create Reseller</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Start a new reseller partner record and then configure its admins, portfolio, and defaults from the workspace on the right.
            </div>
          </div>

          {createResellerMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(createResellerMutation.error)}</div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="reseller_key">Reseller Key</label>
            <input
              className="field"
              id="reseller_key"
              value={createForm.reseller_key}
              onChange={(event) => setCreateForm((current) => ({ ...current, reseller_key: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="reseller_name">Reseller Name</label>
            <input
              className="field"
              id="reseller_name"
              value={createForm.reseller_name}
              onChange={(event) => setCreateForm((current) => ({ ...current, reseller_name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="create_reseller_tier">Reseller Tier</label>
            <select
              className="field"
              id="create_reseller_tier"
              value={createForm.service_tier_definition_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, service_tier_definition_id: event.target.value }))}
            >
              <option value="">Select reseller tier</option>
              {resellerTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.tier_name}
                </option>
              ))}
            </select>
          </div>

          <button
            className="primary-button"
            disabled={!createForm.reseller_key.trim() || !createForm.reseller_name.trim()}
            onClick={() => createResellerMutation.mutate()}
            type="button"
          >
            {createResellerMutation.isPending ? "Creating..." : "Create reseller"}
          </button>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reseller</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {resellers.map((reseller) => (
                  <tr
                    key={reseller.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedResellerId(reseller.id)}
                  >
                    <td>
                      <strong>{reseller.reseller_name}</strong>
                      <div className="muted">{reseller.reseller_key}</div>
                    </td>
                    <td>
                      <StatusBadge value={reseller.is_active ? "active" : "inactive"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel stack">
          {!selectedReseller ? (
            <div className="empty-state">Create or select a reseller to open its foundation workspace.</div>
          ) : (
            <>
              <div className="split-header">
                <div>
                  <h3 className="panel-title">{selectedReseller.reseller_name}</h3>
                  <div className="muted">{selectedReseller.reseller_key}</div>
                  <div className="muted">{selectedReseller.service_tier?.tier_name ?? "No reseller tier assigned"}</div>
                </div>
                <StatusBadge value={selectedReseller.is_active ? "active" : "inactive"} />
              </div>

              <div className="field-row">
                <div>
                  <label className="field-label" htmlFor="selected_reseller_tier">Reseller Tier</label>
                  <select
                    className="field"
                    id="selected_reseller_tier"
                    value={selectedResellerTierId}
                    onChange={(event) => setSelectedResellerTierId(event.target.value)}
                  >
                    <option value="">No reseller tier assigned</option>
                    {resellerTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.tier_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button className="secondary-button" onClick={() => updateResellerTierMutation.mutate()} type="button">
                    {updateResellerTierMutation.isPending ? "Saving..." : "Save reseller tier"}
                  </button>
                </div>
              </div>

              <div className="kpi-grid">
                <div className="card metric-card">
                  <div className="metric-card__label">Portfolio Tenants</div>
                  <div className="metric-card__value">{assignedTenants.length}</div>
                  <div className="metric-card__trend">Currently assigned to this reseller</div>
                </div>
                <div className="card metric-card">
                  <div className="metric-card__label">Ready To Activate</div>
                  <div className="metric-card__value">{readyTenants.length}</div>
                  <div className="metric-card__trend">Tenants ready or live under this portfolio</div>
                </div>
                <div className="card metric-card">
                  <div className="metric-card__label">In Progress</div>
                  <div className="metric-card__value">{inProgressTenants.length}</div>
                  <div className="metric-card__trend">Onboarding work still underway</div>
                </div>
                <div className="card metric-card">
                  <div className="metric-card__label">Needs Attention</div>
                  <div className="metric-card__value">{unhealthyTenants.length}</div>
                  <div className="metric-card__trend">Inactive or misconfigured portfolio tenants</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedReseller ? (
        <div className="grid grid--two">
          <div className="panel stack">
            <div>
              <h3 className="panel-title">Portfolio Scope</h3>
              <div className="muted" style={{ marginTop: 8 }}>
                Assign customer tenants that this reseller should own, including controlled transfers from other reseller portfolios when needed.
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Assigned Tenant</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedTenants.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No tenants are assigned to this reseller yet.</td>
                    </tr>
                  ) : (
                    assignedTenants.map((tenant) => (
                      <tr key={tenant.tenant.id}>
                        <td>
                          <strong>{tenant.tenant.tenant_name}</strong>
                          <div className="muted">{tenant.tenant.tenant_key}</div>
                        </td>
                        <td>
                          <StatusBadge value={tenant.tenant.status} />
                        </td>
                        <td>
                          <button
                            className="ghost-button"
                            disabled={unassignTenantMutation.isPending}
                            onClick={() => unassignTenantMutation.mutate(tenant.tenant.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Unassigned Tenant</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedTenants.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No unassigned tenants are currently available.</td>
                    </tr>
                  ) : (
                    unassignedTenants.map((tenant) => (
                      <tr key={tenant.tenant.id}>
                        <td>
                          <strong>{tenant.tenant.tenant_name}</strong>
                          <div className="muted">{tenant.tenant.tenant_key}</div>
                        </td>
                        <td>
                          <StatusBadge value={tenant.tenant.status} />
                        </td>
                        <td>
                          <button
                            className="secondary-button"
                            disabled={assignTenantMutation.isPending}
                            onClick={() => assignTenantMutation.mutate(tenant.tenant.id)}
                            type="button"
                          >
                            Assign
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Transfer Candidate</th>
                    <th>Current Reseller</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transferCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No other reseller-owned tenants are currently available to transfer.</td>
                    </tr>
                  ) : (
                    transferCandidates.map((tenant) => (
                      <tr key={tenant.tenant.id}>
                        <td>
                          <strong>{tenant.tenant.tenant_name}</strong>
                          <div className="muted">{tenant.tenant.tenant_key}</div>
                        </td>
                        <td>{tenantNameByResellerId.get(tenant.tenant.reseller_partner_id ?? "") ?? "Unknown"}</td>
                        <td>
                          <StatusBadge value={tenant.tenant.status} />
                        </td>
                        <td>
                          <button
                            className="secondary-button"
                            disabled={assignTenantMutation.isPending}
                            onClick={() => assignTenantMutation.mutate(tenant.tenant.id)}
                            type="button"
                          >
                            Transfer In
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Portfolio Health</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Review portfolio-wide onboarding, credential, and activation health for this reseller.
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Onboarding</th>
                  <th>LLM</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {portfolioHealthRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No tenants are assigned to this reseller yet.</td>
                  </tr>
                ) : (
                  portfolioHealthRows.map(({ tenant, onboardingState, issueSummary }) => (
                    <tr key={tenant.tenant.id}>
                      <td>
                        <strong>{tenant.tenant.tenant_name}</strong>
                        <div className="muted">{tenant.profile?.service_mode ?? tenant.tenant.tenant_key}</div>
                      </td>
                      <td><StatusBadge value={onboardingState?.onboarding_status ?? "draft"} /></td>
                      <td>{tenant.llm_config?.credential_status ?? "Not configured"}</td>
                      <td>{issueSummary}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="panel-title">Reseller Admin Capabilities</h3>
            <div className="muted" style={{ marginTop: 8 }}>
                Create reseller-scoped admins with a capability preset. These admins receive reseller scope, not global scope.
              </div>
            </div>

            {createAdminMutation.error ? (
              <div className="section-note section-note--danger">{mutationMessage(createAdminMutation.error)}</div>
            ) : null}

            <div className="field-row field-row--three">
              <div>
                <label className="field-label" htmlFor="reseller_admin_display_name">Display Name</label>
                <input
                  className="field"
                  id="reseller_admin_display_name"
                  value={adminForm.display_name}
                  onChange={(event) => setAdminForm((current) => ({ ...current, display_name: event.target.value }))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="reseller_admin_email">Email</label>
                <input
                  className="field"
                  id="reseller_admin_email"
                  value={adminForm.email}
                  onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="reseller_admin_preset">Capability Preset</label>
              <select
                className="field"
                id="reseller_admin_preset"
                value={adminPreset}
                onChange={(event) => setAdminPreset(event.target.value as ResellerAdminPresetKey)}
              >
                {Object.entries(resellerAdminPresets).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="primary-button"
              disabled={!adminForm.email.trim() && !adminForm.display_name.trim()}
              onClick={() => createAdminMutation.mutate()}
              type="button"
            >
              {createAdminMutation.isPending ? "Creating..." : "Create reseller admin"}
            </button>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Admin</th>
                    <th>Role</th>
                    <th>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {resellerAdmins.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No reseller-scoped admins exist for this reseller yet.</td>
                    </tr>
                  ) : (
                    resellerAdmins.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <strong>{admin.profile?.display_name ?? "Unnamed admin"}</strong>
                          <div className="muted">{admin.profile?.email ?? "No email on file"}</div>
                        </td>
                        <td>{admin.role}</td>
                        <td>{admin.permissions.length}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {selectedReseller ? (
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Tenant Defaults</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              These defaults are stored in admin-tool-owned tables and applied only when a new tenant is created under this reseller.
            </div>
          </div>

          {saveDefaultsMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(saveDefaultsMutation.error)}</div>
          ) : null}

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="default_service_tier_definition_id">Default Service Tier</label>
              <select
                className="field"
                id="default_service_tier_definition_id"
                value={defaultsForm.default_service_tier_definition_id ?? ""}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_service_tier_definition_id: event.target.value,
                  }))
                }
              >
                <option value="">Select default organization tier</option>
                {organizationTiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.tier_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_reporting_timezone">Default Timezone</label>
              <input
                className="field"
                id="default_reporting_timezone"
                value={defaultsForm.default_reporting_timezone ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_reporting_timezone: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="default_service_mode">Default Service Mode</label>
              <input
                className="field"
                id="default_service_mode"
                value={defaultsForm.default_service_mode ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_service_mode: event.target.value }))}
              />
            </div>
          </div>

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="default_portal_base_url">Portal Base URL</label>
              <input
                className="field"
                id="default_portal_base_url"
                value={defaultsForm.default_portal_base_url ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_portal_base_url: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="default_portal_logo_url">Portal Logo URL</label>
              <input
                className="field"
                id="default_portal_logo_url"
                value={defaultsForm.default_portal_logo_url ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_portal_logo_url: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="default_portal_welcome_message">Portal Welcome Message</label>
            <textarea
              className="field"
              id="default_portal_welcome_message"
              rows={3}
              value={defaultsForm.default_portal_welcome_message ?? ""}
              onChange={(event) =>
                setDefaultsForm((current) => ({ ...current, default_portal_welcome_message: event.target.value }))
              }
            />
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="default_enforcement_mode">Enforcement Mode</label>
              <select
                className="field"
                id="default_enforcement_mode"
                value={defaultsForm.default_enforcement_mode ?? "coaching"}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_enforcement_mode: event.target.value }))}
              >
                <option value="advisory">Advisory</option>
                <option value="coaching">Coaching</option>
                <option value="enforced">Enforced</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_data_retention_days">Retention Days</label>
              <input
                className="field"
                id="default_data_retention_days"
                type="number"
                value={defaultsForm.default_data_retention_days ?? 30}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_data_retention_days: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="field-label" htmlFor="default_credential_mode">Default LLM Setup Source</label>
              <select
                className="field"
                id="default_credential_mode"
                value={defaultsForm.default_credential_mode}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_credential_mode: event.target.value }))}
              >
                <option value="platform_managed">HermanScience predefined setup</option>
                <option value="customer_managed">Organization provided credentials</option>
              </select>
              <div className="field-tip">Choose whether new orgs under this reseller should default to a predefined HermanScience LLM setup or start with organization-provided credentials.</div>
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="default_reporting_enabled">Reporting</label>
              <select
                className="field"
                id="default_reporting_enabled"
                value={String(defaultsForm.default_reporting_enabled)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({ ...current, default_reporting_enabled: event.target.value === "true" }))
                }
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_export_enabled">Exports</label>
              <select
                className="field"
                id="default_export_enabled"
                value={String(defaultsForm.default_export_enabled)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({ ...current, default_export_enabled: event.target.value === "true" }))
                }
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_raw_prompt_retention_enabled">Raw Prompt Retention</label>
              <select
                className="field"
                id="default_raw_prompt_retention_enabled"
                value={String(defaultsForm.default_raw_prompt_retention_enabled)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_raw_prompt_retention_enabled: event.target.value === "true",
                  }))
                }
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="default_raw_prompt_admin_visibility">Admin Visibility</label>
              <select
                className="field"
                id="default_raw_prompt_admin_visibility"
                value={String(defaultsForm.default_raw_prompt_admin_visibility)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_raw_prompt_admin_visibility: event.target.value === "true",
                  }))
                }
              >
                <option value="false">Restricted</option>
                <option value="true">Visible</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_transformation_enabled">Transformation</label>
              <select
                className="field"
                id="default_transformation_enabled"
                value={String(defaultsForm.default_transformation_enabled)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_transformation_enabled: event.target.value === "true",
                  }))
                }
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_scoring_enabled">Scoring</label>
              <select
                className="field"
                id="default_scoring_enabled"
                value={String(defaultsForm.default_scoring_enabled)}
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_scoring_enabled: event.target.value === "true",
                  }))
                }
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="default_platform_managed_config_id">Platform-Managed LLM</label>
              <select
                className="field"
                id="default_platform_managed_config_id"
                value={defaultsForm.default_platform_managed_config_id ?? ""}
                onChange={(event) =>
                  setDefaultsForm((current) => ({ ...current, default_platform_managed_config_id: event.target.value }))
                }
              >
                <option value="">No shared LLM default</option>
                {platformManagedLlms.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} • {option.provider_type} • {option.model_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="default_provider_type">Fallback Provider</label>
              <input
                className="field"
                id="default_provider_type"
                value={defaultsForm.default_provider_type ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_provider_type: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="default_model_name">Fallback Model</label>
              <input
                className="field"
                id="default_model_name"
                value={defaultsForm.default_model_name ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_model_name: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="default_feature_flags_json">Feature Flags JSON</label>
            <textarea
              className="field"
              id="default_feature_flags_json"
              rows={4}
              value={JSON.stringify(defaultsForm.default_feature_flags_json, null, 2)}
              onChange={(event) => {
                try {
                  setDefaultsForm((current) => ({
                    ...current,
                    default_feature_flags_json: JSON.parse(event.target.value),
                  }));
                } catch {
                  // Keep the last valid JSON in state while the user edits.
                }
              }}
            />
          </div>

          <button className="primary-button" onClick={() => saveDefaultsMutation.mutate()} type="button">
            {saveDefaultsMutation.isPending ? "Saving..." : "Save reseller defaults"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
