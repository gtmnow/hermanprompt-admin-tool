import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { CardHelpTooltip } from "../../components/cards/CardHelpTooltip";
import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { titleCase } from "../../lib/format";
import type { ResellerLifecycleAction, ResellerTenantDefaults, UserMembership } from "../../lib/types";

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
    label: "Autonomous Partner",
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

function lifecycleActionLabel(action: ResellerLifecycleAction) {
  switch (action) {
    case "activate":
      return "Activate Partner";
    case "inactivate":
      return "Inactivate Partner";
    default:
      return "Delete Partner";
  }
}

function lifecycleActionDescription(action: ResellerLifecycleAction, partnerName: string, counts: {
  organizationCount: number;
  userCount: number;
  adminCount: number;
}) {
  if (action === "activate") {
    return `This will reactivate ${partnerName}, ${counts.adminCount} partner admin login(s), ${counts.organizationCount} organization(s), and ${counts.userCount} user account(s).`;
  }
  if (action === "inactivate") {
    return `This will disable ${partnerName}, ${counts.adminCount} partner admin login(s), ${counts.organizationCount} organization(s), and ${counts.userCount} user account(s) from accessing Herman applications. Records will remain in the database.`;
  }
  return `This will permanently delete inactive partner ${partnerName} and also delete ${counts.organizationCount} owned organization(s) and ${counts.userCount} related user account(s).`;
}

function buildUserLabel(user: UserMembership) {
  const fullName = `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim();
  const email = user.profile?.email?.trim() ?? "";
  if (fullName && email) {
    return `${email} (${fullName})`;
  }
  return email || fullName || user.user_id_hash;
}

function buildPartnerAdminProfile(user: UserMembership) {
  return {
    display_name: `${user.profile?.first_name ?? ""} ${user.profile?.last_name ?? ""}`.trim(),
    email: user.profile?.email?.trim() ?? "",
    user_id_hash: user.user_id_hash,
  };
}

export function ResellersPage() {
  const queryClient = useQueryClient();
  const [selectedResellerId, setSelectedResellerId] = useState("");
  const [createForm, setCreateForm] = useState({
    tenant_id: "",
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<ResellerLifecycleAction | null>(null);
  const [pendingTenantRemoval, setPendingTenantRemoval] = useState<{ tenantId: string; tenantName: string } | null>(null);

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
  const usersQuery = useQuery({
    queryKey: ["partner-admin-users"],
    queryFn: () => tenantApi.getUsers(),
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
        tenant_id: createForm.tenant_id,
        is_active: true,
        service_tier_definition_id: createForm.service_tier_definition_id || null,
      }),
    onMutate: async () => {
      setSuccessMessage(null);
    },
    onSuccess: async (result) => {
      setCreateForm({ tenant_id: "", service_tier_definition_id: "" });
      await queryClient.invalidateQueries({ queryKey: ["resellers"] });
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setSelectedResellerId(result.resource.id);
      setSuccessMessage("Partner created. Next, create a partner admin and assign organizations.");
    },
  });

  const updateResellerTierMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a partner first.");
      }
      return tenantApi.updateReseller(selectedResellerId, {
        service_tier_definition_id: selectedResellerTierId || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["resellers"] });
      setSuccessMessage("Partner tier updated.");
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a partner first.");
      }
      return tenantApi.updateResellerDefaults(selectedResellerId, {
        ...defaultsForm,
        default_service_tier: undefined,
        default_service_tier_definition_id: defaultsForm.default_service_tier_definition_id || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reseller-defaults", selectedResellerId] });
      setSuccessMessage("Partner defaults updated.");
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: () => {
      if (!selectedResellerId) {
        throw new Error("Select a partner first.");
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
      await queryClient.invalidateQueries({ queryKey: ["resellers"] });
      setSuccessMessage("Partner admin created.");
    },
  });

  const runResellerActionMutation = useMutation({
    mutationFn: (action: ResellerLifecycleAction) => {
      if (!selectedResellerId) {
        throw new Error("Select a partner first.");
      }
      return tenantApi.runResellerAction(selectedResellerId, action);
    },
    onMutate: async () => {
      setSuccessMessage(null);
    },
    onSuccess: async (result, action) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resellers"] }),
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["admins"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
      ]);
      setPendingLifecycleAction(null);
      setSuccessMessage(result.resource.message);
      if (action === "delete") {
        setSelectedResellerId("");
      }
    },
  });

  const assignTenantMutation = useMutation({
    mutationFn: (tenantId: string) => tenantApi.updateTenant(tenantId, { reseller_partner_id: selectedResellerId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
        queryClient.invalidateQueries({ queryKey: ["resellers"] }),
      ]);
      setSuccessMessage("Tenant assigned to partner.");
    },
  });

  const unassignTenantMutation = useMutation({
    mutationFn: (tenantId: string) => tenantApi.updateTenant(tenantId, { reseller_partner_id: null }),
    onMutate: async () => {
      setSuccessMessage(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
        queryClient.invalidateQueries({ queryKey: ["resellers"] }),
      ]);
      setPendingTenantRemoval(null);
      setSuccessMessage("Tenant moved to unassigned to a partner.");
    },
  });

  const users = usersQuery.data?.items ?? [];
  const partnerAdminCandidates = useMemo(() => {
    const seenEmails = new Set<string>();
    return [...users]
      .filter((user) => {
        const email = user.profile?.email?.trim().toLowerCase();
        if (!email || seenEmails.has(email)) {
          return false;
        }
        seenEmails.add(email);
        return true;
      })
      .sort((left, right) => buildUserLabel(left).localeCompare(buildUserLabel(right)));
  }, [users]);
  const selectedPartnerAdminUser = useMemo(
    () =>
      partnerAdminCandidates.find(
        (user) => user.profile?.email?.trim().toLowerCase() === adminForm.email.trim().toLowerCase(),
      ) ?? null,
    [adminForm.email, partnerAdminCandidates],
  );

  if (
    resellersQuery.isLoading ||
    tenantsQuery.isLoading ||
    adminsQuery.isLoading ||
    usersQuery.isLoading ||
    onboardingQuery.isLoading ||
    platformManagedLlmsQuery.isLoading ||
    resellerTiersQuery.isLoading ||
    organizationTiersQuery.isLoading
  ) {
    return <LoadingBlock label="Loading partner workspace..." />;
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
  const partnerCreationCandidates = tenants
    .filter((item) => !item.tenant.reseller_partner_id)
    .sort((left, right) => left.tenant.tenant_name.localeCompare(right.tenant.tenant_name));
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
  const lifecycleCounts = selectedReseller
    ? {
        organizationCount: selectedReseller.organization_count,
        userCount: selectedReseller.total_user_count,
        adminCount: selectedReseller.partner_admin_count,
      }
    : { organizationCount: 0, userCount: 0, adminCount: 0 };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Partners</h1>
          <p className="page-subtitle">
            Create partners, define their portfolio scope, assign partner admins, and seed tenant defaults without changing shared cross-system tables.
          </p>
        </div>
      </div>

      <div className="panel stack">
        <CardHelpTooltip text="Lists every partner in the database with current status, managed organization count, total users across owned organizations, and partner admin coverage." />
        <div>
          <h3 className="panel-title">Partner Inventory</h3>
          <div className="muted" style={{ marginTop: 8 }}>
            Review the full partner portfolio, select a partner for lifecycle management, and compare ownership size at a glance.
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Status</th>
                <th>Organizations</th>
                <th>Total Users</th>
                <th>Partner Admins</th>
              </tr>
            </thead>
            <tbody>
              {resellers.map((reseller) => (
                <tr
                  key={reseller.id}
                  style={{
                    cursor: "pointer",
                    background: reseller.id === selectedResellerId ? "rgba(15, 23, 42, 0.04)" : undefined,
                  }}
                  onClick={() => setSelectedResellerId(reseller.id)}
                >
                  <td>
                    <strong>{reseller.reseller_name}</strong>
                    <div className="muted">{reseller.reseller_key}</div>
                  </td>
                  <td><StatusBadge value={reseller.is_active ? "active" : "inactive"} /></td>
                  <td>{reseller.organization_count}</td>
                  <td>{reseller.total_user_count}</td>
                  <td>{reseller.partner_admin_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <CardHelpTooltip text="Creates a new partner record and assigns its starting partner tier before portfolio setup begins." />
          <div>
            <h3 className="panel-title">Create Partner</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Start a new partner record and then configure its admins, portfolio, and defaults from the workspace on the right.
            </div>
          </div>

          {createResellerMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(createResellerMutation.error)}</div>
          ) : null}
          {successMessage ? <div className="section-note section-note--success">{successMessage}</div> : null}

          <div>
            <label className="field-label" htmlFor="create_reseller_tenant_id">Organization</label>
            <select
              className="field"
              id="create_reseller_tenant_id"
              value={createForm.tenant_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, tenant_id: event.target.value }))}
            >
              <option value="">Select organization</option>
              {partnerCreationCandidates.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.tenant_name}
                </option>
              ))}
            </select>
            <div className="field-tip">Creating a partner uses the selected organization as the initial organization record for that partner.</div>
          </div>
          <div>
            <label className="field-label" htmlFor="create_reseller_tier">Partner Tier</label>
            <select
              className="field"
              id="create_reseller_tier"
              value={createForm.service_tier_definition_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, service_tier_definition_id: event.target.value }))}
            >
              <option value="">Select partner tier</option>
              {resellerTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.tier_name}
                </option>
              ))}
            </select>
          </div>

          <button
            className="primary-button"
            disabled={!createForm.tenant_id}
            onClick={() => createResellerMutation.mutate()}
            type="button"
          >
            {createResellerMutation.isPending ? "Creating..." : "Create partner"}
          </button>
          <div className="section-note">
            Creating a partner assigns the selected organization immediately, then opens the workspace on the right so you can add the partner admin and manage the remaining organizations.
          </div>
        </div>

        <div className="panel stack">
          <CardHelpTooltip text="Shows the selected partner's summary, tier assignment, and high-level portfolio KPIs." />
          {!selectedReseller ? (
            <div className="empty-state">Create or select a partner to open its foundation workspace.</div>
          ) : (
            <>
              <div className="split-header">
                <div>
                  <h3 className="panel-title">{selectedReseller.reseller_name}</h3>
                  <div className="muted">{selectedReseller.reseller_key}</div>
                  <div className="muted">{selectedReseller.service_tier?.tier_name ?? "No partner tier assigned"}</div>
                </div>
                <StatusBadge value={selectedReseller.is_active ? "active" : "inactive"} />
              </div>

              <div className={`section-note${selectedReseller.is_active ? "" : " section-note--danger"}`}>
                {selectedReseller.is_active
                  ? "This partner is active. Inactivation will disable partner admins and all owned organization/user access."
                  : "This partner is inactive. You can reactivate it to restore access, or delete it to remove the inactive partner and its owned organizations."}
              </div>

              <div className="field-row">
                <div>
                  <label className="field-label" htmlFor="selected_reseller_tier">Partner Tier</label>
                  <select
                    className="field"
                    id="selected_reseller_tier"
                    value={selectedResellerTierId}
                    onChange={(event) => setSelectedResellerTierId(event.target.value)}
                  >
                    <option value="">No partner tier assigned</option>
                    {resellerTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.tier_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button className="secondary-button" onClick={() => updateResellerTierMutation.mutate()} type="button">
                    {updateResellerTierMutation.isPending ? "Saving..." : "Save partner tier"}
                  </button>
                </div>
              </div>

              <div className="kpi-grid">
                <div className="card metric-card">
                  <CardHelpTooltip text="Shows how many tenants are currently assigned to this partner portfolio." />
                  <div className="metric-card__label">Portfolio Tenants</div>
                  <div className="metric-card__value">{assignedTenants.length}</div>
                  <div className="metric-card__trend">Currently assigned to this partner</div>
                </div>
                <div className="card metric-card">
                  <CardHelpTooltip text="Shows how many tenants under this partner are ready to activate or already live." />
                  <div className="metric-card__label">Ready To Activate</div>
                  <div className="metric-card__value">{readyTenants.length}</div>
                  <div className="metric-card__trend">Tenants ready or live under this portfolio</div>
                </div>
                <div className="card metric-card">
                  <CardHelpTooltip text="Shows how many partner-owned tenants still have onboarding work underway." />
                  <div className="metric-card__label">In Progress</div>
                  <div className="metric-card__value">{inProgressTenants.length}</div>
                  <div className="metric-card__trend">Onboarding work still underway</div>
                </div>
                <div className="card metric-card">
                  <CardHelpTooltip text="Shows how many partner-owned tenants are inactive or have configuration issues needing attention." />
                  <div className="metric-card__label">Needs Attention</div>
                  <div className="metric-card__value">{unhealthyTenants.length}</div>
                  <div className="metric-card__trend">Inactive or misconfigured portfolio tenants</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {selectedReseller.is_active ? (
                  <button
                    className="ghost-button"
                    disabled={runResellerActionMutation.isPending}
                    onClick={() => setPendingLifecycleAction("inactivate")}
                    type="button"
                  >
                    Inactivate Partner
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary-button"
                      disabled={runResellerActionMutation.isPending}
                      onClick={() => setPendingLifecycleAction("activate")}
                      type="button"
                    >
                      Activate Partner
                    </button>
                    <button
                      className="ghost-button"
                      disabled={runResellerActionMutation.isPending}
                      onClick={() => setPendingLifecycleAction("delete")}
                      type="button"
                    >
                      Delete Partner
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedReseller ? (
        <div className="grid grid--two">
          <div className="panel stack">
            <CardHelpTooltip text="Lets admins assign, unassign, and transfer tenants inside the selected partner tenant scope." />
            <div>
              <h3 className="panel-title">Tenant Scope for {selectedReseller.reseller_name}</h3>
              <div className="muted" style={{ marginTop: 8 }}>
                Assign customer tenants that this partner should own, including controlled transfers from other partners when needed.
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
                      <td colSpan={3}>No tenants are assigned to this partner yet.</td>
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
                            disabled={unassignTenantMutation.isPending || !selectedReseller?.is_active}
                            onClick={() =>
                              setPendingTenantRemoval({
                                tenantId: tenant.tenant.id,
                                tenantName: tenant.tenant.tenant_name,
                              })
                            }
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
                    <th>Unassigned to a Partner</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedTenants.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No tenants are currently unassigned to a partner.</td>
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
                            disabled={assignTenantMutation.isPending || !selectedReseller?.is_active}
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
                    <th>Current Partner</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transferCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No other partner-owned tenants are currently available to transfer.</td>
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
                            disabled={assignTenantMutation.isPending || !selectedReseller?.is_active}
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
            <CardHelpTooltip text="Summarizes onboarding, LLM, and health signals across the selected partner's tenants." />
            <div>
              <h3 className="panel-title">Tenant Health for {selectedReseller.reseller_name}</h3>
              <div className="muted" style={{ marginTop: 8 }}>
                Review onboarding, credential, and activation health across this partner's tenants.
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
                      <td colSpan={4}>No tenants are assigned to this partner yet.</td>
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
          </div>
        </div>
      ) : null}

      {selectedReseller ? (
        <div className="panel stack">
          <CardHelpTooltip text="Creates and reviews partner-scoped admin users with a dedicated setup flow based on existing users in the database." />
          <div>
            <h3 className="panel-title">Partner Administration for {selectedReseller.reseller_name}</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Create partner-scoped admins with a capability preset. Select an existing user by email, then assign partner scope.
            </div>
          </div>

          {createAdminMutation.error ? (
            <div className="section-note section-note--danger">{mutationMessage(createAdminMutation.error)}</div>
          ) : null}

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="reseller_admin_email">User Email</label>
              <input
                className="field"
                id="reseller_admin_email"
                list="reseller-admin-user-emails"
                placeholder="Select an existing user by email"
                value={adminForm.email}
                onChange={(event) => {
                  const nextEmail = event.target.value;
                  const matchedUser = partnerAdminCandidates.find(
                    (user) => user.profile?.email?.trim().toLowerCase() === nextEmail.trim().toLowerCase(),
                  );
                  if (matchedUser) {
                    const profile = buildPartnerAdminProfile(matchedUser);
                    setAdminForm({
                      user_id_hash: profile.user_id_hash,
                      display_name: profile.display_name,
                      email: profile.email,
                    });
                  } else {
                    setAdminForm((current) => ({
                      ...current,
                      user_id_hash: "",
                      email: nextEmail,
                    }));
                  }
                  setSuccessMessage(null);
                }}
              />
              <datalist id="reseller-admin-user-emails">
                {partnerAdminCandidates.map((user) => (
                  <option key={user.user_id_hash} value={user.profile?.email ?? ""}>
                    {buildUserLabel(user)}
                  </option>
                ))}
              </datalist>
              <div className="field-tip">Suggestions are pulled from users already in the database.</div>
            </div>
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
          </div>

          {!selectedPartnerAdminUser && adminForm.email.trim() ? (
            <div className="section-note section-note--danger">
              Select a user email from the database suggestions before creating a partner admin.
            </div>
          ) : null}

          <button
            className="primary-button"
            disabled={!selectedPartnerAdminUser || !selectedReseller?.is_active || createAdminMutation.isPending}
            onClick={() => createAdminMutation.mutate()}
            type="button"
          >
            {createAdminMutation.isPending ? "Creating..." : "Create partner admin"}
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
                    <td colSpan={3}>No partner-scoped admins exist for this partner yet.</td>
                  </tr>
                ) : (
                  resellerAdmins.map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        <strong>{admin.profile?.display_name ?? "Unnamed admin"}</strong>
                        <div className="muted">{admin.profile?.email ?? "No email on file"}</div>
                      </td>
                      <td>{titleCase(admin.role)}</td>
                      <td>{admin.permissions.length}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {selectedReseller ? (
        <div className="panel stack">
          <CardHelpTooltip text="Stores the default service, portal, and LLM settings applied when new tenants are created under this partner." />
          <div>
            <h3 className="panel-title">Tenant Defaults</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              These defaults are stored in admin-tool-owned tables and applied only when a new tenant is created under this partner.
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
                onChange={(event) =>
                  setDefaultsForm((current) => ({
                    ...current,
                    default_credential_mode: event.target.value,
                    default_platform_managed_config_id:
                      event.target.value === "customer_managed" ? "" : current.default_platform_managed_config_id,
                  }))
                }
              >
                <option value="platform_managed">HermanScience predefined setup</option>
                <option value="customer_managed">Organization provided credentials</option>
              </select>
              <div className="field-tip">Choose whether new orgs under this partner should default to a predefined HermanScience LLM setup or start with organization-provided credentials.</div>
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
                  setDefaultsForm((current) => ({
                    ...current,
                    default_platform_managed_config_id: event.target.value,
                    default_provider_type: event.target.value ? "" : current.default_provider_type,
                    default_model_name: event.target.value ? "" : current.default_model_name,
                    default_endpoint_url: event.target.value ? "" : current.default_endpoint_url,
                  }))
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
                disabled={defaultsForm.default_credential_mode === "platform_managed"}
                value={defaultsForm.default_provider_type ?? ""}
                onChange={(event) => setDefaultsForm((current) => ({ ...current, default_provider_type: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="default_model_name">Fallback Model</label>
              <input
                className="field"
                id="default_model_name"
                disabled={defaultsForm.default_credential_mode === "platform_managed"}
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
            {saveDefaultsMutation.isPending ? "Saving..." : "Save partner defaults"}
          </button>
        </div>
      ) : null}

      {selectedReseller && pendingLifecycleAction ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setPendingLifecycleAction(null)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="partner-lifecycle-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHelpTooltip text="Confirms the selected partner lifecycle action and summarizes how many partner admins, organizations, and users will be affected." />
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="partner-lifecycle-dialog-title">{lifecycleActionLabel(pendingLifecycleAction)}</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {lifecycleActionDescription(pendingLifecycleAction, selectedReseller.reseller_name, lifecycleCounts)}
                </div>
              </div>
            </div>

            <div className={`section-note${pendingLifecycleAction !== "activate" ? " section-note--danger" : ""}`} style={{ marginTop: 18 }}>
              Impacted partner admins: {lifecycleCounts.adminCount}. Impacted organizations: {lifecycleCounts.organizationCount}. Impacted users: {lifecycleCounts.userCount}.
            </div>

            {runResellerActionMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(runResellerActionMutation.error)}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button
                className={pendingLifecycleAction === "activate" ? "primary-button" : "ghost-button"}
                disabled={runResellerActionMutation.isPending}
                onClick={() => runResellerActionMutation.mutate(pendingLifecycleAction)}
                type="button"
              >
                {runResellerActionMutation.isPending ? "Working..." : lifecycleActionLabel(pendingLifecycleAction)}
              </button>
              <button
                className="secondary-button"
                disabled={runResellerActionMutation.isPending}
                onClick={() => setPendingLifecycleAction(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedReseller && pendingTenantRemoval ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setPendingTenantRemoval(null)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="partner-tenant-removal-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHelpTooltip text="Confirms removing the tenant from the current partner scope and returning it to the unassigned to a partner list." />
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="partner-tenant-removal-dialog-title">Remove Tenant From Partner</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {pendingTenantRemoval.tenantName} will be removed from {selectedReseller.reseller_name} and moved into Unassigned to a Partner.
                </div>
              </div>
            </div>

            <div className="section-note section-note--danger" style={{ marginTop: 18 }}>
              This only removes the tenant from the partner scope. It does not delete the tenant or its users.
            </div>

            {unassignTenantMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(unassignTenantMutation.error)}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button
                className="ghost-button"
                disabled={unassignTenantMutation.isPending}
                onClick={() => unassignTenantMutation.mutate(pendingTenantRemoval.tenantId)}
                type="button"
              >
                {unassignTenantMutation.isPending ? "Removing..." : "Confirm Remove"}
              </button>
              <button
                className="secondary-button"
                disabled={unassignTenantMutation.isPending}
                onClick={() => setPendingTenantRemoval(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
