import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { WizardStepper } from "../../components/forms/WizardStepper";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import type { PlatformManagedLlmConfig } from "../../lib/types";

const tenantSchema = z.object({
  tenant_name: z.string().min(2),
  tenant_key: z.string().min(2),
  plan_tier: z.string().optional(),
  reporting_timezone: z.string().min(2),
  external_customer_id: z.string().optional(),
  organization_type: z.string().optional(),
  industry: z.string().optional(),
  primary_contact_name: z.string().optional(),
  primary_contact_email: z.string().optional(),
  service_mode: z.string().optional(),
  deployment_notes: z.string().optional(),
  portal_base_url: z.string().optional(),
  portal_logo_url: z.string().optional(),
  portal_welcome_message: z.string().optional(),
});

type TenantFormValues = z.infer<typeof tenantSchema>;

const steps = [
  "Organization Info",
  "LLM Configuration",
  "Runtime Settings",
  "Admin Users Upload",
  "Admin Setup",
  "Groups Setup",
  "Review & Activate",
];

const organizationTypeOptions = [
  "Enterprise",
  "SMB",
  "Startup",
  "Government",
  "Higher Education",
  "Healthcare",
  "Nonprofit",
  "Professional Services",
  "Consulting",
  "Customer Organization",
];

const industryOptions = [
  "Life Sciences",
  "Healthcare",
  "Biotech",
  "Pharmaceuticals",
  "Professional Services",
  "Technology",
  "Education",
  "Government",
  "Manufacturing",
  "Financial Services",
  "Marketing",
];

const planTierOptions = ["Enterprise", "Business", "Pilot"];

const serviceModeOptions = [
  { value: "managed_service", label: "Managed service" },
  { value: "self_service", label: "Self service" },
  { value: "hybrid", label: "Hybrid" },
  { value: "guided_activation", label: "Guided activation" },
];

const timezoneOptions = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
];

const providerOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom Endpoint" },
];

const modelOptionsByProvider: Record<string, string[]> = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  azure_openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4", "claude-opus-4"],
  custom: [],
};

const groupTypeOptions = [
  "Default",
  "Department",
  "Business Unit",
  "Functional Team",
  "Pilot Cohort",
  "Leadership",
];

const defaultLlmForm = {
  provider_type: "openai",
  model_name: "gpt-5.4",
  endpoint_url: "",
  api_key: "",
  secret_reference: "",
  platform_managed_config_id: "",
  credential_mode: "customer_managed",
  transformation_enabled: true,
  scoring_enabled: true,
};

type RuntimeFormValues = {
  enforcement_mode: "advisory" | "coaching" | "enforced";
  reporting_enabled: boolean;
  export_enabled: boolean;
  raw_prompt_retention_enabled: boolean;
  raw_prompt_admin_visibility: boolean;
  data_retention_days: number;
  feature_flags_json: Record<string, string | number | boolean>;
};

const defaultRuntimeForm: RuntimeFormValues = {
  enforcement_mode: "coaching" as "advisory" | "coaching" | "enforced",
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

const defaultGroupForm = {
  group_name: "",
  group_type: "Default",
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
};

const defaultAdminForm = {
  user_id_hash: "",
  display_name: "",
  email: "",
};

const adminPermissionPresets = {
  read_write: {
    label: "Read / Write",
    permissions: ["users.read", "users.write", "groups.read", "groups.write", "runtime.read", "runtime.write", "analytics.read"],
  },
  read_only: {
    label: "Read Only",
    permissions: ["users.read", "groups.read", "runtime.read", "analytics.read"],
  },
  reporting_only: {
    label: "Reporting Only",
    permissions: ["analytics.read"],
  },
} as const;

type AdminPermissionPresetKey = keyof typeof adminPermissionPresets;

function buildGeneratedUserId(sequence: number, now = new Date()) {
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `user-${timestamp}-${String(sequence).padStart(4, "0")}`;
}

function withCurrentOption(options: string[], currentValue?: string | null) {
  if (!currentValue || options.includes(currentValue)) {
    return options;
  }
  return [currentValue, ...options];
}

function withCurrentSelectOption(
  options: Array<{ value: string; label: string }>,
  currentValue?: string | null,
) {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }

  return [{ value: currentValue, label: currentValue }, ...options];
}

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this step.";
}

export function ActivationWizardPage() {
  const { tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [llmForm, setLlmForm] = useState(defaultLlmForm);
  const [runtimeForm, setRuntimeForm] = useState(defaultRuntimeForm);
  const [groupForm, setGroupForm] = useState(defaultGroupForm);
  const [userForm, setUserForm] = useState(defaultUserForm);
  const [adminForm, setAdminForm] = useState(defaultAdminForm);
  const [adminPermissionPreset, setAdminPermissionPreset] = useState<AdminPermissionPresetKey>("read_write");
  const [userGroupId, setUserGroupId] = useState("");

  function advanceToNextStep() {
    setActiveStep((current) => Math.min(steps.length - 1, current + 1));
  }

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      tenant_name: "",
      tenant_key: "",
      plan_tier: "enterprise",
      reporting_timezone: "America/New_York",
      external_customer_id: "",
      organization_type: "",
      industry: "",
      primary_contact_name: "",
      primary_contact_email: "",
      service_mode: "managed_service",
      deployment_notes: "",
      portal_base_url: "https://hermanportal-production.up.railway.app",
      portal_logo_url: "",
      portal_welcome_message: "",
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
  const platformManagedLlmsQuery = useQuery({
    queryKey: ["platform-managed-llms"],
    queryFn: () => tenantApi.listPlatformManagedLlms(),
  });

  useEffect(() => {
    const requestedStep = location.state && typeof location.state === "object" ? (location.state as { step?: number }).step : undefined;
    if (typeof requestedStep === "number") {
      setActiveStep(Math.max(0, Math.min(steps.length - 1, requestedStep)));
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!tenantQuery.data?.resource) {
      return;
    }

    const resource = tenantQuery.data.resource;
    form.reset({
      tenant_name: resource.tenant.tenant_name,
      tenant_key: resource.tenant.tenant_key,
      plan_tier: resource.tenant.plan_tier ?? "enterprise",
      reporting_timezone: resource.tenant.reporting_timezone,
      external_customer_id: resource.tenant.external_customer_id ?? "",
      organization_type: resource.profile?.organization_type ?? "",
      industry: resource.profile?.industry ?? "",
      primary_contact_name: resource.profile?.primary_contact_name ?? "",
      primary_contact_email: resource.profile?.primary_contact_email ?? "",
      service_mode: resource.profile?.service_mode ?? "managed_service",
      deployment_notes: resource.profile?.deployment_notes ?? "",
      portal_base_url: resource.portal_config?.portal_base_url ?? "https://hermanportal-production.up.railway.app",
      portal_logo_url: resource.portal_config?.logo_url ?? "",
      portal_welcome_message: resource.portal_config?.welcome_message ?? "",
    });

    if (resource.llm_config) {
      setLlmForm((current) => ({
        ...current,
        provider_type: resource.llm_config?.provider_type ?? current.provider_type,
        model_name: resource.llm_config?.model_name ?? current.model_name,
        endpoint_url: resource.llm_config?.endpoint_url ?? "",
        secret_reference: resource.llm_config?.secret_reference ?? "",
        platform_managed_config_id: resource.llm_config?.platform_managed_config_id ?? "",
        credential_mode: resource.llm_config?.credential_mode ?? current.credential_mode,
        transformation_enabled: resource.llm_config?.transformation_enabled ?? true,
        scoring_enabled: resource.llm_config?.scoring_enabled ?? true,
      }));
    }

    if (resource.runtime_settings) {
      setRuntimeForm({
        enforcement_mode: resource.runtime_settings.enforcement_mode,
        reporting_enabled: resource.runtime_settings.reporting_enabled,
        export_enabled: resource.runtime_settings.export_enabled,
        raw_prompt_retention_enabled: resource.runtime_settings.raw_prompt_retention_enabled,
        raw_prompt_admin_visibility: resource.runtime_settings.raw_prompt_admin_visibility,
        data_retention_days: resource.runtime_settings.data_retention_days ?? 30,
        feature_flags_json: resource.runtime_settings.feature_flags_json,
      });
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
        organization_type: values.organization_type || null,
        industry: values.industry || null,
        primary_contact_name: values.primary_contact_name || null,
        primary_contact_email: values.primary_contact_email || null,
        service_mode: values.service_mode || null,
        deployment_notes: values.deployment_notes || null,
      }),
    onSuccess: async (result, values) => {
      await tenantApi.updatePortalConfig(result.resource.tenant.id, {
        portal_base_url: values.portal_base_url || "https://hermanportal-production.up.railway.app",
        logo_url: values.portal_logo_url || null,
        welcome_message: values.portal_welcome_message || null,
        is_active: true,
      });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      navigate(`/activation/${result.resource.tenant.id}`, { state: { step: 1 } });
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
      advanceToNextStep();
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
      advanceToNextStep();
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: () =>
      tenantApi.createGroup({
        tenant_id: tenantId,
        group_name: groupForm.group_name,
        group_type: groupForm.group_type,
        business_unit: groupForm.business_unit,
        owner_name: groupForm.owner_name,
        description: groupForm.description,
      }),
    onSuccess: () => {
      setGroupForm(defaultGroupForm);
      queryClient.invalidateQueries({ queryKey: ["activation-groups", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      advanceToNextStep();
    },
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      tenantApi.createUser({
        user_id_hash: userForm.user_id_hash,
        tenant_id: tenantId,
        group_ids: userGroupId ? [userGroupId] : [],
        status: "invited",
        is_primary: true,
        first_name: userForm.first_name,
        last_name: userForm.last_name,
        email: userForm.email,
        title: userForm.title,
      }),
    onSuccess: () => {
      setUserForm({
        ...defaultUserForm,
        user_id_hash: buildGeneratedUserId((usersQuery.data?.items.length ?? 0) + 2),
      });
      setUserGroupId("");
      queryClient.invalidateQueries({ queryKey: ["activation-users", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      advanceToNextStep();
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: () =>
      tenantApi.createAdmin({
        user_id_hash: adminForm.user_id_hash,
        role: "tenant_admin",
        permissions: adminPermissionPresets[adminPermissionPreset].permissions,
        scopes: [{ scope_type: "tenant", tenant_id: tenantId }],
        display_name: adminForm.display_name,
        email: adminForm.email,
      }),
    onSuccess: () => {
      setAdminForm(defaultAdminForm);
      setAdminPermissionPreset("read_write");
      queryClient.invalidateQueries({ queryKey: ["activation-admins"] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      advanceToNextStep();
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
  const detectedUsers = usersQuery.data?.items ?? [];
  const hasDetectedUsers = detectedUsers.length > 0;
  const groups = groupsQuery.data?.items ?? [];
  const generatedUserId = useMemo(
    () => buildGeneratedUserId((usersQuery.data?.items.length ?? 0) + 1),
    [usersQuery.data?.items.length],
  );
  const onboardingBlockers = [
    !onboarding?.tenant_created ? "Save the organization record" : null,
    !onboarding?.llm_configured ? "Save the LLM configuration" : null,
    !onboarding?.llm_validated ? "Validate the LLM connection" : null,
    !onboarding?.users_uploaded ? "Ensure at least one user is available" : null,
    !onboarding?.admin_assigned ? "Assign a tenant admin" : null,
  ].filter((value): value is string => Boolean(value));

  useEffect(() => {
    if (hasDetectedUsers) {
      return;
    }

    setUserForm((current) => {
      if (!current.user_id_hash || current.user_id_hash.startsWith("user-")) {
        return { ...current, user_id_hash: generatedUserId };
      }
      return current;
    });
  }, [generatedUserId, hasDetectedUsers]);

  const modelOptions = modelOptionsByProvider[llmForm.provider_type] ?? [];
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
  const organizationTypeSelectOptions = withCurrentOption(
    organizationTypeOptions,
    form.watch("organization_type"),
  );
  const industrySelectOptions = withCurrentOption(industryOptions, form.watch("industry"));
  const planTierSelectOptions = withCurrentOption(
    planTierOptions.map((option) => option.toLowerCase()),
    form.watch("plan_tier"),
  );
  const serviceModeSelectOptions = withCurrentSelectOption(
    serviceModeOptions,
    form.watch("service_mode"),
  );
  const stepErrorMessage = (
    activeStep === 0
      ? createTenantMutation.error ?? updateTenantMutation.error
      : activeStep === 1
        ? saveLlmMutation.error ?? validateLlmMutation.error
        : activeStep === 2
          ? saveRuntimeMutation.error
          : activeStep === 3
            ? createUserMutation.error
            : activeStep === 4
              ? createAdminMutation.error
              : activeStep === 5
                ? createGroupMutation.error
                : activateTenantMutation.error
  );
  const nextStepDisabled = activeStep === steps.length - 1 || (activeStep === 0 && !tenantId);

  async function handleValidateLlm() {
    if (!tenantId) {
      return;
    }

    await saveLlmMutation.mutateAsync();
    await validateLlmMutation.mutateAsync();
  }

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
                  disabled={nextStepDisabled}
                  onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>

            {stepErrorMessage ? (
              <div className="section-note section-note--danger">{mutationMessage(stepErrorMessage)}</div>
            ) : null}

            {activeStep === 0 ? (
              <form
                className="stack"
                onSubmit={form.handleSubmit(async (values) => {
                  if (tenantId) {
                    await updateTenantMutation.mutateAsync(values);
                    await tenantApi.updatePortalConfig(tenantId, {
                      portal_base_url: values.portal_base_url || "https://hermanportal-production.up.railway.app",
                      logo_url: values.portal_logo_url || null,
                      welcome_message: values.portal_welcome_message || null,
                      is_active: true,
                    });
                    queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
                    queryClient.invalidateQueries({ queryKey: ["tenants"] });
                    advanceToNextStep();
                    return;
                  }
                  createTenantMutation.mutate(values);
                })}
              >
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="tenant_name">
                      Organization Name
                    </label>
                    <input className="field" id="tenant_name" {...form.register("tenant_name")} />
                    <div className="field-tip">Use the customer-facing organization name exactly as it should appear across admin views and reports.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="tenant_key">
                      Organization Key
                    </label>
                    <input className="field" id="tenant_key" {...form.register("tenant_key")} />
                    <div className="field-tip">Choose a short stable identifier, usually lowercase and slug-like, that will not need to change later.</div>
                  </div>
                </div>

                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="organization_type">
                      Organization Type
                    </label>
                    <select className="field" id="organization_type" {...form.register("organization_type")}>
                      <option value="">Select organization type</option>
                      {organizationTypeSelectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Pick the closest customer profile so downstream filtering and segmentation stay consistent.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="industry">
                      Industry
                    </label>
                    <select className="field" id="industry" {...form.register("industry")}>
                      <option value="">Select industry</option>
                      {industrySelectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">This should reflect the customer&apos;s primary operating industry, not necessarily every department using Herman Prompt.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="service_mode">
                      Service Mode
                    </label>
                    <select className="field" id="service_mode" {...form.register("service_mode")}>
                      <option value="">Select service mode</option>
                      {serviceModeSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Use managed service when HermanScience is expected to play an active operational role after launch.</div>
                  </div>
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="primary_contact_name">
                      Primary Contact Name
                    </label>
                    <input className="field" id="primary_contact_name" {...form.register("primary_contact_name")} />
                    <div className="field-tip">Enter the primary business or program owner for this deployment.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="primary_contact_email">
                      Primary Contact Email
                    </label>
                    <input className="field" id="primary_contact_email" {...form.register("primary_contact_email")} />
                    <div className="field-tip">Use the person we should contact for onboarding coordination, issue triage, and rollout decisions.</div>
                  </div>
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="plan_tier">
                      Plan Tier
                    </label>
                    <select className="field" id="plan_tier" {...form.register("plan_tier")}>
                      {planTierSelectOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">This is the commercial tier we want reflected in the admin system, not a billing code.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="reporting_timezone">
                      Timezone
                    </label>
                    <select className="field" id="reporting_timezone" {...form.register("reporting_timezone")}>
                      {timezoneOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Pick the timezone that should anchor dashboard rollups and scheduled reporting for this organization.</div>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="external_customer_id">
                    External Customer ID
                  </label>
                  <input className="field" id="external_customer_id" {...form.register("external_customer_id")} />
                  <div className="field-tip">Optional. Use this when the customer has an ID in CRM, billing, or another source of record we want to reference later.</div>
                </div>

                <div>
                  <label className="field-label" htmlFor="deployment_notes">
                    Deployment Notes
                  </label>
                  <textarea className="field" id="deployment_notes" rows={4} {...form.register("deployment_notes")} />
                  <div className="field-tip">Capture rollout context, special handling, stakeholder expectations, or anything an operator should know before activating.</div>
                </div>

                <div className="panel panel--inset">
                  <h3 className="panel-title">Portal Setup</h3>
                  <div className="muted" style={{ marginTop: 8, marginBottom: 18 }}>
                    Configure the tenant-facing Herman Portal branding content that will appear on login and invitation acceptance screens.
                  </div>
                  <div className="field-row">
                    <div>
                      <label className="field-label" htmlFor="portal_base_url">
                        Portal Base URL
                      </label>
                      <input className="field" id="portal_base_url" {...form.register("portal_base_url")} />
                      <div className="field-tip">Invitation links for this organization will point to this portal base URL.</div>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="portal_logo_url">
                        Portal Logo URL
                      </label>
                      <input className="field" id="portal_logo_url" {...form.register("portal_logo_url")} />
                      <div className="field-tip">Provide a hosted image URL for the customer logo that should appear on the Herman Portal login screen.</div>
                    </div>
                  </div>

                  <div>
                    <label className="field-label" htmlFor="portal_welcome_message">
                      Portal Welcome Message
                    </label>
                    <textarea className="field" id="portal_welcome_message" rows={4} {...form.register("portal_welcome_message")} />
                    <div className="field-tip">This message is shown above the login fields in the portal for this organization.</div>
                  </div>
                </div>

                <button className="primary-button" type="submit">
                  {createTenantMutation.isPending || updateTenantMutation.isPending
                    ? "Saving..."
                    : tenantId
                      ? "Save organization info"
                      : "Create organization draft"}
                </button>
                {!tenantId ? (
                  <div className="section-note">
                    Save the organization draft first. The remaining wizard steps unlock once the tenant record exists.
                  </div>
                ) : null}
              </form>
            ) : null}

            {activeStep === 1 ? (
              <div className="stack">
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="provider_type">
                      Provider
                    </label>
                    {llmForm.credential_mode === "platform_managed" ? (
                      <>
                        <select
                          className="field"
                          id="provider_type"
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
                        <div className="field-tip">Platform-managed mode is limited to the shared LLM pool configured by super admins.</div>
                      </>
                    ) : (
                      <>
                        <select
                          className="field"
                          id="provider_type"
                          value={llmForm.provider_type}
                          onChange={(event) => setLlmForm((current) => ({ ...current, provider_type: event.target.value }))}
                        >
                          {providerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="field-tip">Choose the provider this organization will use for prompt transformation and scoring validation.</div>
                      </>
                    )}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="model_name">
                      Model
                    </label>
                    {llmForm.credential_mode === "platform_managed" ? (
                      <input className="field" id="model_name" value={selectedPlatformManagedConfig?.model_name ?? llmForm.model_name} readOnly />
                    ) : modelOptions.length > 0 ? (
                      <select
                        className="field"
                        id="model_name"
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
                        id="model_name"
                        value={llmForm.model_name}
                        onChange={(event) => setLlmForm((current) => ({ ...current, model_name: event.target.value }))}
                      />
                    )}
                    <div className="field-tip">Select the default model we should validate and store for this tenant. Use custom entry only when the provider requires it.</div>
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="credential_mode">
                      Credential Mode
                    </label>
                    <select
                      className="field"
                      id="credential_mode"
                      value={llmForm.credential_mode}
                      onChange={(event) =>
                        setLlmForm((current) => ({
                          ...current,
                          credential_mode: event.target.value as "platform_managed" | "customer_managed",
                        }))
                      }
                    >
                      <option value="customer_managed">Customer managed</option>
                      <option value="platform_managed">Platform managed</option>
                    </select>
                    <div className="field-tip">Choose whether the tenant provides credentials or HermanScience manages them on the tenant&apos;s behalf.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="api_key">
                      API Key
                    </label>
                    <input
                      className="field"
                      disabled={llmForm.credential_mode === "platform_managed"}
                      id="api_key"
                      placeholder={llmForm.credential_mode === "platform_managed" ? "Managed by HermanScience shared LLM pool" : "Enter customer-managed key"}
                      type="password"
                      value={llmForm.api_key}
                      onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
                    />
                    <div className="field-tip">
                      {llmForm.credential_mode === "platform_managed"
                        ? "Shared platform-managed credentials come from the super-admin LLM pool and are not edited here."
                        : "Paste the customer-managed API key only when this org is bringing its own credentials. The backend will write it into the admin vault and keep only a masked value plus vault reference in Postgres."}
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="secret_reference">
                      Secret Reference
                    </label>
                    <input
                      className="field"
                      disabled={llmForm.credential_mode === "platform_managed"}
                      id="secret_reference"
                      value={llmForm.secret_reference}
                      onChange={(event) => setLlmForm((current) => ({ ...current, secret_reference: event.target.value }))}
                    />
                    <div className="field-tip">
                      {llmForm.credential_mode === "platform_managed"
                        ? "The selected shared LLM supplies the managed secret reference automatically."
                        : "Optional. Use this when the real credential already lives in another vault. If you paste an API key above, the admin backend will generate and save its own managed vault reference automatically."}
                    </div>
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="endpoint_url">
                      Endpoint
                    </label>
                    <input
                      className="field"
                      id="endpoint_url"
                      readOnly={llmForm.credential_mode === "platform_managed"}
                      value={llmForm.endpoint_url}
                      onChange={(event) => setLlmForm((current) => ({ ...current, endpoint_url: event.target.value }))}
                    />
                    <div className="field-tip">Leave blank for standard hosted endpoints. Fill this in for Azure or any custom-compatible deployment URL.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="transformation_enabled">
                      Transformation
                    </label>
                    <select
                      className="field"
                      id="transformation_enabled"
                      value={String(llmForm.transformation_enabled)}
                      onChange={(event) =>
                        setLlmForm((current) => ({
                          ...current,
                          transformation_enabled: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                    <div className="field-tip">Turn this off only if this tenant should not use prompt transformation features.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="scoring_enabled">
                      Scoring
                    </label>
                    <select
                      className="field"
                      id="scoring_enabled"
                      value={String(llmForm.scoring_enabled)}
                      onChange={(event) =>
                        setLlmForm((current) => ({
                          ...current,
                          scoring_enabled: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                    <div className="field-tip">Disable scoring only if the tenant should use transformation without evaluation or score tracking.</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    className="secondary-button"
                    disabled={!tenantId || saveLlmMutation.isPending || validateLlmMutation.isPending}
                    onClick={() => saveLlmMutation.mutate()}
                    type="button"
                  >
                    Save LLM config
                  </button>
                  <button
                    className="primary-button"
                    disabled={!tenantId || saveLlmMutation.isPending || validateLlmMutation.isPending}
                    onClick={() => {
                      void handleValidateLlm();
                    }}
                    type="button"
                  >
                    {saveLlmMutation.isPending || validateLlmMutation.isPending ? "Saving and testing..." : "Save and test connection"}
                  </button>
                  {activeTenant?.llm_config ? <StatusBadge value={activeTenant.llm_config.credential_status} /> : null}
                </div>
                <div className="section-note">
                  {llmForm.credential_mode === "platform_managed" && selectedPlatformManagedConfig
                    ? `This organization will use the shared platform-managed LLM "${selectedPlatformManagedConfig.label}" until it has its own licensed credentials.`
                    : null}
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
                    <div className="field-tip">Advisory is the lightest-touch rollout. Coaching adds stronger guidance. Enforced is for the strictest policy posture.</div>
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
                    <div className="field-tip">Define how long admin-layer data should remain available before cleanup policies apply.</div>
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
                    <div className="field-tip">Disable only if this tenant should not appear in reporting workflows during rollout.</div>
                  </div>
                </div>

                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="export_enabled">
                      Export Enabled
                    </label>
                    <select
                      className="field"
                      id="export_enabled"
                      value={String(runtimeForm.export_enabled)}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          export_enabled: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                    <div className="field-tip">Use this to control whether report exports should be available from the admin experience.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="raw_prompt_retention_enabled">
                      Raw Prompt Retention
                    </label>
                    <select
                      className="field"
                      id="raw_prompt_retention_enabled"
                      value={String(runtimeForm.raw_prompt_retention_enabled)}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          raw_prompt_retention_enabled: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="false">Disabled</option>
                      <option value="true">Enabled</option>
                    </select>
                    <div className="field-tip">Only enable raw prompt retention when the tenant&apos;s data policy allows storing original prompt text.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="raw_prompt_admin_visibility">
                      Admin Visibility
                    </label>
                    <select
                      className="field"
                      id="raw_prompt_admin_visibility"
                      value={String(runtimeForm.raw_prompt_admin_visibility)}
                      onChange={(event) =>
                        setRuntimeForm((current) => ({
                          ...current,
                          raw_prompt_admin_visibility: event.target.value === "true",
                        }))
                      }
                    >
                      <option value="false">Restricted</option>
                      <option value="true">Visible</option>
                    </select>
                    <div className="field-tip">This determines whether admin users can view retained raw prompts when investigating activity.</div>
                  </div>
                </div>

                <button className="primary-button" disabled={!tenantId} onClick={() => saveRuntimeMutation.mutate()} type="button">
                  Save runtime settings
                </button>
              </div>
            ) : null}

            {activeStep === 5 ? (
              <div className="stack">
                {filteredAdmins.length === 0 ? (
                  <div className="section-note section-note--warning">
                    Add at least one admin in Admin Setup before creating groups so each group owner can be selected from the organization&apos;s admin pool.
                  </div>
                ) : null}
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_group_name">
                      Group Name
                    </label>
                    <input
                      className="field"
                      id="new_group_name"
                      value={groupForm.group_name}
                      onChange={(event) => setGroupForm((current) => ({ ...current, group_name: event.target.value }))}
                    />
                    <div className="field-tip">Use a name the customer would immediately recognize, like a department, program, or rollout cohort.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="new_group_type">
                      Group Type
                    </label>
                    <select
                      className="field"
                      id="new_group_type"
                      value={groupForm.group_type}
                      onChange={(event) => setGroupForm((current) => ({ ...current, group_type: event.target.value }))}
                    >
                      {groupTypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Choose the grouping pattern that best explains why these users belong together operationally.</div>
                  </div>
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="group_business_unit">
                      Business Unit
                    </label>
                    <input
                      className="field"
                      id="group_business_unit"
                      value={groupForm.business_unit}
                      onChange={(event) => setGroupForm((current) => ({ ...current, business_unit: event.target.value }))}
                    />
                    <div className="field-tip">Use the customer&apos;s internal business-unit or department label if one exists.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="group_owner_name">
                      Group Owner
                    </label>
                    <select
                      className="field"
                      id="group_owner_name"
                      value={groupForm.owner_name}
                      onChange={(event) => setGroupForm((current) => ({ ...current, owner_name: event.target.value }))}
                    >
                      <option value="">Select an admin user</option>
                      {filteredAdmins.map((admin) => (
                        <option key={admin.id} value={admin.profile?.display_name ?? admin.user_id_hash}>
                          {admin.profile?.email ?? admin.user_id_hash}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Choose the group owner from the available admin users for this organization.</div>
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="group_description">
                    Description
                  </label>
                  <textarea
                    className="field"
                    id="group_description"
                    rows={3}
                    value={groupForm.description}
                    onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                  />
                  <div className="field-tip">Briefly explain the purpose of the group so future admins know when it should be used.</div>
                </div>

                <div>
                  <button
                    className="primary-button"
                    disabled={!tenantId || !groupForm.group_name || !groupForm.owner_name || filteredAdmins.length === 0}
                    onClick={() => createGroupMutation.mutate()}
                    type="button"
                  >
                    {createGroupMutation.isPending ? "Adding..." : "Add group"}
                  </button>
                </div>

                <div className="table-wrap">
                  {groups.length === 0 ? (
                    <div className="empty-state table-empty-state">No groups have been created for this organization yet.</div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Group</th>
                          <th>Business Unit</th>
                          <th>Owner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => (
                          <tr key={group.id}>
                            <td>
                              <strong>{group.group_name}</strong>
                              <div className="muted">{group.profile?.description ?? group.group_type ?? "No description"}</div>
                            </td>
                            <td>{group.profile?.business_unit ?? "Pending"}</td>
                            <td>{group.profile?.owner_name ?? "Pending"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {activeStep === 3 ? (
              <div className="stack">
                <div className="section-note">
                  This step is for adding the organization&apos;s initial users one at a time. Its primary purpose during onboarding is to create the first admin candidates, but you can add any user type here.
                </div>
                <div className="section-note">
                  Bulk uploads belong on the top-level <Link to="/users">Users</Link> screen. The activation wizard only supports adding users one at a time so we can establish the first organization admins cleanly.
                </div>
                {hasDetectedUsers ? (
                  <div className="section-note">
                    {detectedUsers.length} existing users were found for this organization in the live Herman Prompt snapshot. Those users remain available in the main <Link to="/users">Users</Link> screen.
                  </div>
                ) : null}

                <div className="field-row">
                  {groups.length > 0 ? (
                    <div>
                      <label className="field-label" htmlFor="user_group_id">
                        Initial Group
                      </label>
                      <select
                        className="field"
                        id="user_group_id"
                        value={userGroupId}
                        onChange={(event) => setUserGroupId(event.target.value)}
                      >
                        <option value="">No initial group</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                      <div className="field-tip">Optional. Assign the user to one admin-owned group during onboarding.</div>
                    </div>
                  ) : null}
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_user">
                      User Identifier
                    </label>
                    <input
                      className="field"
                      id="new_user"
                      value={userForm.user_id_hash}
                      readOnly
                    />
                    <div className="field-tip">Auto-generated from the current date/time plus the next sequential number for this organization.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="user_email">
                      Email
                    </label>
                    <input
                      className="field"
                      id="user_email"
                      value={userForm.email}
                      onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                    />
                    <div className="field-tip">Use a work email so this person can be selected easily in Admin Setup.</div>
                  </div>
                </div>

                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="user_first_name">
                      First Name
                    </label>
                    <input
                      className="field"
                      id="user_first_name"
                      value={userForm.first_name}
                      onChange={(event) => setUserForm((current) => ({ ...current, first_name: event.target.value }))}
                    />
                    <div className="field-tip">Optional, but recommended for cleaner directory and admin displays.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="user_last_name">
                      Last Name
                    </label>
                    <input
                      className="field"
                      id="user_last_name"
                      value={userForm.last_name}
                      onChange={(event) => setUserForm((current) => ({ ...current, last_name: event.target.value }))}
                    />
                    <div className="field-tip">Optional, but recommended for cleaner directory and admin displays.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="user_title">
                      Title
                    </label>
                    <input
                      className="field"
                      id="user_title"
                      value={userForm.title}
                      onChange={(event) => setUserForm((current) => ({ ...current, title: event.target.value }))}
                    />
                    <div className="field-tip">Use a short role title if it helps other admins understand who this user is in the org.</div>
                  </div>
                </div>

                <div>
                  <button
                    className="primary-button"
                    disabled={!tenantId || !userForm.user_id_hash || createUserMutation.isPending}
                    onClick={() => createUserMutation.mutate()}
                    type="button"
                  >
                    {createUserMutation.isPending ? "Adding..." : "Add user"}
                  </button>
                </div>

                <div className="table-wrap">
                  {filteredAdmins.length === 0 ? (
                    <div className="empty-state table-empty-state">No admin users have been assigned yet. Add users here, then configure their admin access in the next step.</div>
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
                        {filteredAdmins.map((admin) => (
                          <tr key={admin.id}>
                            <td>
                              <strong>{admin.profile?.display_name ?? admin.user_id_hash}</strong>
                              <div className="muted">{admin.profile?.email ?? admin.user_id_hash}</div>
                            </td>
                            <td>{admin.role}</td>
                            <td>{admin.scopes.map((scope) => scope.scope_type).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {activeStep === 4 ? (
              <div className="stack">
                <div className="section-note">
                  Use this step to grant administrator access and fine tune what each admin can do in the admin tool. Typical starting points are read/write, read only, and reporting only access.
                </div>
                {hasDetectedUsers && !adminForm.user_id_hash ? (
                  <div className="section-note">
                    Start from an existing organization user, then assign the right admin permission level below.
                  </div>
                ) : null}
                {hasDetectedUsers ? (
                  <div className="field-row">
                    <div>
                      <label className="field-label" htmlFor="existing_user_admin">
                        Start From Existing User
                      </label>
                      <select
                        className="field"
                        id="existing_user_admin"
                        value=""
                        onChange={(event) => {
                          const selectedUser = detectedUsers.find((user) => user.user_id_hash === event.target.value);
                          if (!selectedUser) {
                            return;
                          }

                          setAdminForm({
                            user_id_hash: selectedUser.user_id_hash,
                            display_name:
                              `${selectedUser.profile?.first_name ?? ""} ${selectedUser.profile?.last_name ?? ""}`.trim()
                                || selectedUser.user_id_hash,
                            email: selectedUser.profile?.email ?? "",
                          });
                        }}
                      >
                        <option value="">Choose an existing user</option>
                        {detectedUsers.map((user) => (
                          <option key={user.id} value={user.user_id_hash}>
                            {user.profile?.email ?? user.user_id_hash}
                          </option>
                        ))}
                      </select>
                      <div className="field-tip">Choose a detected user to prefill the admin form instead of typing everything by hand.</div>
                    </div>
                  </div>
                ) : null}

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="admin_permission_preset">
                      Admin Access Level
                    </label>
                    <select
                      className="field"
                      id="admin_permission_preset"
                      value={adminPermissionPreset}
                      onChange={(event) => setAdminPermissionPreset(event.target.value as AdminPermissionPresetKey)}
                    >
                      {Object.entries(adminPermissionPresets).map(([value, preset]) => (
                        <option key={value} value={value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Administrator permissions are managed by the admin tool and can be adjusted again later.</div>
                  </div>
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="new_admin">
                      Tenant Admin Identifier
                    </label>
                    <input
                      className="field"
                      id="new_admin"
                      value={adminForm.user_id_hash}
                      onChange={(event) => setAdminForm((current) => ({ ...current, user_id_hash: event.target.value }))}
                    />
                    <div className="field-tip">This should match the user identifier for the person who will manage this organization in the admin tool.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="admin_email">
                      Email
                    </label>
                    <input
                      className="field"
                      id="admin_email"
                      value={adminForm.email}
                      onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                    />
                    <div className="field-tip">Use the admin&apos;s primary work email for support and access review purposes.</div>
                  </div>
                </div>

                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="admin_display_name">
                      Display Name
                    </label>
                    <input
                      className="field"
                      id="admin_display_name"
                      value={adminForm.display_name}
                      onChange={(event) => setAdminForm((current) => ({ ...current, display_name: event.target.value }))}
                    />
                    <div className="field-tip">Enter the name we should display in admin lists, audit views, and ownership panels.</div>
                  </div>
                  <div style={{ alignSelf: "end" }}>
                    <button className="primary-button" disabled={!tenantId || !adminForm.user_id_hash} onClick={() => createAdminMutation.mutate()} type="button">
                      {createAdminMutation.isPending ? "Creating..." : "Create admin"}
                    </button>
                  </div>
                </div>

                <div className="table-wrap">
                  {filteredAdmins.length === 0 ? (
                    <div className="empty-state table-empty-state">No tenant admins are assigned yet. Add one before activation.</div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Admin</th>
                          <th>Access</th>
                          <th>Scope</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAdmins.map((admin) => (
                          <tr key={admin.id}>
                            <td>
                              <strong>{admin.profile?.display_name ?? admin.user_id_hash}</strong>
                              <div className="muted">{admin.profile?.email ?? admin.user_id_hash}</div>
                            </td>
                            <td>
                              {admin.permissions.length >= 7
                                ? "Read / Write"
                                : admin.permissions.some((permission) => permission.permission_key === "analytics.read") && admin.permissions.length === 1
                                  ? "Reporting Only"
                                  : "Read Only"}
                            </td>
                            <td>{admin.scopes.map((scope) => scope.scope_type).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
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
                    ["Users uploaded", onboarding?.users_uploaded],
                    ["Admin assigned", onboarding?.admin_assigned],
                    ["Groups created (optional)", onboarding?.groups_created],
                  ].map(([label, value]) => (
                    <div className="checklist-item" key={String(label)}>
                      <span>{label}</span>
                      <StatusBadge value={value ? "ready" : "draft"} />
                    </div>
                  ))}
                </div>
                <div className="grid grid--two">
                  <div className="section-note">
                    <strong>{groups.length}</strong> groups are configured for this organization. This step is optional.
                  </div>
                  <div className="section-note">
                    <strong>{detectedUsers.length}</strong> users are currently available from the live Herman Prompt snapshot.
                  </div>
                </div>
                {onboardingBlockers.length > 0 ? (
                  <div className="panel panel--inset">
                    <h3 className="panel-title">Remaining blockers</h3>
                    <div className="checklist" style={{ marginTop: 18 }}>
                      {onboardingBlockers.map((blocker) => (
                        <div className="checklist-item checklist-item--warning" key={blocker}>
                          <span>{blocker}</span>
                          <StatusBadge value="warning" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="section-note">
                    This organization is ready for activation. The admin tool will only update admin-owned database state and readiness flags.
                  </div>
                )}
                <div className="section-note">
                  Activation remains a DB-state change only. This admin tool records the configuration and readiness markers in the database and does not drive Herman Prompt or Herman Transform directly.
                </div>
                <button
                  className="primary-button"
                  disabled={!tenantId || onboardingBlockers.length > 0 || activateTenantMutation.isPending}
                  onClick={() => activateTenantMutation.mutate()}
                  type="button"
                >
                  {activateTenantMutation.isPending ? "Activating..." : "Activate organization"}
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
            <WizardStepper
              steps={steps}
              activeIndex={activeStep}
              disabled={!tenantId}
              onStepSelect={(index) => {
                if (!tenantId && index > 0) {
                  return;
                }
                setActiveStep(index);
              }}
            />
          </div>

          <div className="panel">
            <h3 className="panel-title">Status Panel</h3>
            <div className="checklist" style={{ marginTop: 18 }}>
              {[
                ["Org", onboarding?.tenant_created],
                ["LLM", onboarding?.llm_validated],
                ["Admin Users", onboarding?.users_uploaded],
                ["Admins", onboarding?.admin_assigned],
                ["Groups (Optional)", onboarding?.groups_created],
              ].map(([label, value]) => (
                <div className="checklist-item" key={String(label)}>
                  <span>{label}</span>
                  <StatusBadge value={value ? "ready" : "draft"} />
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3 className="panel-title">Organization Snapshot</h3>
            <div className="key-value" style={{ marginTop: 18 }}>
              <div className="muted">Industry</div>
              <div>{activeTenant?.profile?.industry ?? "Pending"}</div>
            </div>
            <div className="key-value">
              <div className="muted">Primary contact</div>
              <div>{activeTenant?.profile?.primary_contact_email ?? "Pending"}</div>
            </div>
            <div className="key-value">
              <div className="muted">Groups</div>
              <div>{groups.length}</div>
            </div>
            <div className="key-value">
              <div className="muted">Portal logo</div>
              <div>{activeTenant?.portal_config?.logo_url ? "Custom" : "Default"}</div>
            </div>
            <div className="key-value">
              <div className="muted">Users</div>
              <div>{usersQuery.data?.items.length ?? 0}</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
