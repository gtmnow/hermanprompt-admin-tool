import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { WizardStepper } from "../../components/forms/WizardStepper";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";

const tenantSchema = z.object({
  tenant_name: z.string().min(2),
  tenant_key: z.string().min(2),
  plan_tier: z.string().optional(),
  reporting_timezone: z.string().min(2),
  external_customer_id: z.string().optional(),
});

type TenantFormValues = z.infer<typeof tenantSchema>;

const steps = [
  "Organization Info",
  "LLM Configuration",
  "Runtime Settings",
  "Groups Setup",
  "Users Upload",
  "Admin Setup",
  "Review & Activate",
];

export function ActivationWizardPage() {
  const { tenantId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [llmForm, setLlmForm] = useState({
    provider_type: "openai",
    model_name: "gpt-5.4",
    endpoint_url: "",
    api_key: "",
    secret_reference: "",
    credential_mode: "customer_managed",
    transformation_enabled: true,
    scoring_enabled: true,
  });
  const [runtimeForm, setRuntimeForm] = useState({
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
  });
  const [newGroupName, setNewGroupName] = useState("");
  const [newUserId, setNewUserId] = useState("");
  const [newAdminId, setNewAdminId] = useState("");

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      tenant_name: "",
      tenant_key: "",
      plan_tier: "enterprise",
      reporting_timezone: "America/New_York",
      external_customer_id: "",
    },
  });

  const tenantQuery = useQuery({
    queryKey: ["activation-tenant", tenantId],
    queryFn: () => tenantApi.getTenant(tenantId ?? ""),
    enabled: Boolean(tenantId),
  });
  const groupsQuery = useQuery({
    queryKey: ["activation-groups", tenantId],
    queryFn: () => tenantApi.getGroups(tenantId),
    enabled: Boolean(tenantId),
  });
  const usersQuery = useQuery({
    queryKey: ["activation-users", tenantId],
    queryFn: () => tenantApi.getUsers(tenantId),
    enabled: Boolean(tenantId),
  });
  const adminsQuery = useQuery({
    queryKey: ["activation-admins"],
    queryFn: () => tenantApi.getAdmins(),
  });
  const onboardingQuery = useQuery({
    queryKey: ["activation-onboarding-detail", tenantId],
    queryFn: () => tenantApi.getTenantOnboarding(tenantId ?? ""),
    enabled: Boolean(tenantId),
  });

  useEffect(() => {
    if (tenantQuery.data?.resource) {
      form.reset({
        tenant_name: tenantQuery.data.resource.tenant.tenant_name,
        tenant_key: tenantQuery.data.resource.tenant.tenant_key,
        plan_tier: tenantQuery.data.resource.tenant.plan_tier ?? "enterprise",
        reporting_timezone: tenantQuery.data.resource.tenant.reporting_timezone,
        external_customer_id: tenantQuery.data.resource.tenant.external_customer_id ?? "",
      });
      if (tenantQuery.data.resource.llm_config) {
        setLlmForm((current) => ({
          ...current,
          provider_type: tenantQuery.data?.resource.llm_config?.provider_type ?? current.provider_type,
          model_name: tenantQuery.data?.resource.llm_config?.model_name ?? current.model_name,
          endpoint_url: tenantQuery.data?.resource.llm_config?.endpoint_url ?? "",
          secret_reference: tenantQuery.data?.resource.llm_config?.secret_reference ?? "",
          credential_mode: tenantQuery.data?.resource.llm_config?.credential_mode ?? current.credential_mode,
          transformation_enabled: tenantQuery.data?.resource.llm_config?.transformation_enabled ?? true,
          scoring_enabled: tenantQuery.data?.resource.llm_config?.scoring_enabled ?? true,
        }));
      }
    }
  }, [form, tenantQuery.data]);

  const filteredAdmins = useMemo(() => {
    if (!tenantId) {
      return [];
    }
    return (adminsQuery.data?.items ?? []).filter((admin) =>
      admin.scopes.some((scope) => scope.tenant_id === tenantId),
    );
  }, [adminsQuery.data, tenantId]);

  const createTenantMutation = useMutation({
    mutationFn: (values: TenantFormValues) =>
      tenantApi.createTenant({
        tenant_name: values.tenant_name,
        tenant_key: values.tenant_key,
        plan_tier: values.plan_tier ?? null,
        reporting_timezone: values.reporting_timezone,
        reseller_partner_id: null,
        status: "onboarding",
        external_customer_id: values.external_customer_id || null,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      navigate(`/activation/${result.resource.tenant.id}`);
    },
  });

  const updateTenantMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => tenantApi.updateTenant(tenantId ?? "", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  const saveLlmMutation = useMutation({
    mutationFn: () => tenantApi.putLlmConfig(tenantId ?? "", llmForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const validateLlmMutation = useMutation({
    mutationFn: () => tenantApi.validateLlmConfig(tenantId ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const saveRuntimeMutation = useMutation({
    mutationFn: () => tenantApi.updateRuntimeSettings(tenantId ?? "", runtimeForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: () =>
      tenantApi.createGroup({
        tenant_id: tenantId,
        group_name: newGroupName,
        group_type: "Default",
      }),
    onSuccess: () => {
      setNewGroupName("");
      queryClient.invalidateQueries({ queryKey: ["activation-groups", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      tenantApi.createUser({
        user_id_hash: newUserId,
        tenant_id: tenantId,
        group_ids: (groupsQuery.data?.items.slice(0, 1) ?? []).map((group) => group.id),
        status: "invited",
        is_primary: true,
      }),
    onSuccess: () => {
      setNewUserId("");
      queryClient.invalidateQueries({ queryKey: ["activation-users", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: () =>
      tenantApi.createAdmin({
        user_id_hash: newAdminId,
        role: "tenant_admin",
        permissions: ["users.read", "users.write", "groups.read", "analytics.read"],
        scopes: [{ scope_type: "tenant", tenant_id: tenantId }],
      }),
    onSuccess: () => {
      setNewAdminId("");
      queryClient.invalidateQueries({ queryKey: ["activation-admins"] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const activateTenantMutation = useMutation({
    mutationFn: () => tenantApi.activateTenant(tenantId ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const activeTenant = tenantQuery.data?.resource;
  const onboarding = onboardingQuery.data?.resource;

  if (tenantId && tenantQuery.isLoading) {
    return <LoadingBlock label="Loading activation draft..." />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <div className="muted" style={{ marginBottom: 10 }}>
            <Link to="/activation">Activation</Link> / {tenantId ? "Resume workflow" : "New organization"}
          </div>
          <h1 className="page-title">Activation Wizard</h1>
          <p className="page-subtitle">
            Build the organization in the same seven-step structure shown in the approved wireframes.
          </p>
        </div>
        {onboarding ? <StatusBadge value={onboarding.onboarding_status} /> : null}
      </div>

      <div className="wizard-layout">
        <div className="stack">
          <div className="panel">
            <div className="split-header">
              <div>
                <h3 className="panel-title">{steps[activeStep]}</h3>
                <div className="muted">Step {activeStep + 1} of {steps.length}</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="ghost-button"
                  disabled={activeStep === 0}
                  onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  Back
                </button>
                <button
                  className="secondary-button"
                  disabled={activeStep === steps.length - 1}
                  onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>

            {activeStep === 0 ? (
              <form
                className="stack"
                onSubmit={form.handleSubmit((values) => {
                  if (tenantId) {
                    updateTenantMutation.mutate(values);
                  } else {
                    createTenantMutation.mutate(values);
                  }
                })}
              >
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="tenant_name">
                      Organization Name
                    </label>
                    <input className="field" id="tenant_name" {...form.register("tenant_name")} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="tenant_key">
                      Organization Key
                    </label>
                    <input className="field" id="tenant_key" {...form.register("tenant_key")} />
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="plan_tier">
                      Plan Tier
                    </label>
                    <input className="field" id="plan_tier" {...form.register("plan_tier")} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="reporting_timezone">
                      Timezone
                    </label>
                    <input className="field" id="reporting_timezone" {...form.register("reporting_timezone")} />
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="external_customer_id">
                    External Customer ID
                  </label>
                  <input className="field" id="external_customer_id" {...form.register("external_customer_id")} />
                </div>
                <button className="primary-button" type="submit">
                  {tenantId ? "Save organization info" : "Create organization draft"}
                </button>
              </form>
            ) : null}

            {activeStep === 1 ? (
              <div className="stack">
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="provider_type">
                      Provider
                    </label>
                    <input
                      className="field"
                      id="provider_type"
                      value={llmForm.provider_type}
                      onChange={(event) => setLlmForm((current) => ({ ...current, provider_type: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="model_name">
                      Model
                    </label>
                    <input
                      className="field"
                      id="model_name"
                      value={llmForm.model_name}
                      onChange={(event) => setLlmForm((current) => ({ ...current, model_name: event.target.value }))}
                    />
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="api_key">
                      API Key
                    </label>
                    <input
                      className="field"
                      id="api_key"
                      placeholder="Enter customer-managed key"
                      type="password"
                      value={llmForm.api_key}
                      onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="endpoint_url">
                      Endpoint
                    </label>
                    <input
                      className="field"
                      id="endpoint_url"
                      value={llmForm.endpoint_url}
                      onChange={(event) => setLlmForm((current) => ({ ...current, endpoint_url: event.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button className="secondary-button" disabled={!tenantId} onClick={() => saveLlmMutation.mutate()} type="button">
                    Save LLM config
                  </button>
                  <button className="primary-button" disabled={!tenantId} onClick={() => validateLlmMutation.mutate()} type="button">
                    Test connection
                  </button>
                  {activeTenant?.llm_config ? <StatusBadge value={activeTenant.llm_config.credential_status} /> : null}
                </div>
                <div className="section-note">
                  {activeTenant?.llm_config?.last_validation_message ?? "Save the configuration, then run validation."}
                </div>
              </div>
            ) : null}

            {activeStep === 2 ? (
              <div className="stack">
                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="enforcement_mode">
                      Enforcement Mode
                    </label>
                    <select
                      className="field"
                      id="enforcement_mode"
                      value={runtimeForm.enforcement_mode}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          enforcement_mode: event.target.value as "advisory" | "coaching" | "enforced",
                        }))
                      }
                    >
                      <option value="advisory">Advisory</option>
                      <option value="coaching">Coaching</option>
                      <option value="enforced">Enforced</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="data_retention_days">
                      Retention Days
                    </label>
                    <input
                      className="field"
                      id="data_retention_days"
                      type="number"
                      value={runtimeForm.data_retention_days ?? 30}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          data_retention_days: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="reporting_enabled">
                      Reporting Enabled
                    </label>
                    <select
                      className="field"
                      id="reporting_enabled"
                      value={String(runtimeForm.reporting_enabled)}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          reporting_enabled: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                </div>
                <button className="primary-button" disabled={!tenantId} onClick={() => saveRuntimeMutation.mutate()} type="button">
                  Save runtime settings
                </button>
              </div>
            ) : null}

            {activeStep === 3 ? (
              <div className="stack">
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_group_name">
                      New Group
                    </label>
                    <input
                      className="field"
                      id="new_group_name"
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                    />
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <button
                      className="primary-button"
                      disabled={!tenantId || !newGroupName}
                      onClick={() => createGroupMutation.mutate()}
                      type="button"
                    >
                      Add group
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(groupsQuery.data?.items ?? []).map((group) => (
                        <tr key={group.id}>
                          <td>{group.group_name}</td>
                          <td>{group.group_type ?? "Default"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {activeStep === 4 ? (
              <div className="stack">
                <div className="section-note">
                  The approved UX mentions CSV upload and preview. The backend import API is not in place yet, so this first pass uses manual user creation while keeping the step structure intact.
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_user">
                      User Identifier
                    </label>
                    <input className="field" id="new_user" value={newUserId} onChange={(event) => setNewUserId(event.target.value)} />
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <button className="primary-button" disabled={!tenantId || !newUserId} onClick={() => createUserMutation.mutate()} type="button">
                      Add user
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Status</th>
                        <th>Groups</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(usersQuery.data?.items ?? []).map((user) => (
                        <tr key={user.id}>
                          <td>{user.user_id_hash}</td>
                          <td><StatusBadge value={user.status} /></td>
                          <td>{user.group_memberships.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {activeStep === 5 ? (
              <div className="stack">
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_admin">
                      Tenant Admin Identifier
                    </label>
                    <input className="field" id="new_admin" value={newAdminId} onChange={(event) => setNewAdminId(event.target.value)} />
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <button className="primary-button" disabled={!tenantId || !newAdminId} onClick={() => createAdminMutation.mutate()} type="button">
                      Create admin
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Admin</th>
                        <th>Role</th>
                        <th>Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAdmins.map((admin) => (
                        <tr key={admin.id}>
                          <td>{admin.user_id_hash}</td>
                          <td>{admin.role}</td>
                          <td>{admin.scopes.map((scope) => scope.scope_type).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {activeStep === 6 ? (
              <div className="stack">
                <div className="checklist">
                  {[
                    ["Org created", onboarding?.tenant_created],
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
                <button
                  className="primary-button"
                  disabled={!tenantId}
                  onClick={() => activateTenantMutation.mutate()}
                  type="button"
                >
                  Activate organization
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="stack">
          <div className="panel">
            <h3 className="panel-title">Progress</h3>
            <div className="muted" style={{ marginTop: 8, marginBottom: 18 }}>
              Save draft progress at every step and use the side panel to track readiness.
            </div>
            <WizardStepper steps={steps} activeIndex={activeStep} />
          </div>

          <div className="panel">
            <h3 className="panel-title">Status Panel</h3>
            <div className="checklist" style={{ marginTop: 18 }}>
              {[
                ["Org", onboarding?.tenant_created],
                ["LLM", onboarding?.llm_validated],
                ["Groups", onboarding?.groups_created],
                ["Users", onboarding?.users_uploaded],
                ["Admins", onboarding?.admin_assigned],
              ].map(([label, value]) => (
                <div className="checklist-item" key={String(label)}>
                  <span>{label}</span>
                  <StatusBadge value={value ? "ready" : "draft"} />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
