import { useEffect, useMemo, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { WizardStepper } from "../../components/forms/WizardStepper";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { businessUnitOptions } from "../../features/tenants/groupOptions";
import type { PlatformManagedLlmConfig, UserMembership } from "../../lib/types";
import { parseImportedUsers } from "../../lib/userImport";

const tenantSchema = z.object({
  tenant_name: z.string().min(2),
  tenant_key: z.string().optional(),
  reseller_partner_id: z.string().optional(),
  service_tier_definition_id: z.string().min(1),
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
  { value: "xai", label: "xAI / Grok" },
  { value: "custom", label: "Custom Endpoint" },
];

const modelOptionsByProvider: Record<string, string[]> = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  azure_openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4", "claude-opus-4"],
  xai: ["grok-4.20-reasoning", "grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4.20-multi-agent"],
  custom: [],
};

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

type SecretSelection = "local_storage" | "encrypted_vault";
type UserLimitDialogState = {
  kind: "single" | "bulk";
  requestedUsers: number;
  currentUsers: number;
  limit: number;
  blocked: boolean;
};

function inferSecretSelection(secretSource?: string | null, secretReference?: string | null): SecretSelection {
  if (secretSource === "external_reference") {
    return "encrypted_vault";
  }
  if (secretReference?.startsWith("https://")) {
    return "encrypted_vault";
  }
  return "local_storage";
}

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
  business_unit: "",
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

function buildOrganizationKeyPreview(tenantName: string) {
  const normalized = tenantName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "organization";
}

function tierUserLimit(limitSource?: { max_users: number | null; has_unlimited_users: boolean } | null) {
  if (!limitSource || limitSource.has_unlimited_users) {
    return null;
  }
  return limitSource.max_users;
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
  const [bulkImportText, setBulkImportText] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [secretSelection, setSecretSelection] = useState<SecretSelection>("local_storage");
  const [invitePromptUsers, setInvitePromptUsers] = useState<UserMembership[]>([]);
  const [userLimitDialog, setUserLimitDialog] = useState<UserLimitDialogState | null>(null);
  const lastAppliedResellerDefaultsId = useRef<string | null>(null);

  function advanceToNextStep() {
    setActiveStep((current) => Math.min(steps.length - 1, current + 1));
  }

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      tenant_name: "",
      tenant_key: "",
      reseller_partner_id: "",
      service_tier_definition_id: "",
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
  const resellersQuery = useQuery({
    queryKey: ["resellers"],
    queryFn: () => tenantApi.listResellers(),
  });
  const organizationTiersQuery = useQuery({
    queryKey: ["service-tiers", "organization"],
    queryFn: () => tenantApi.listServiceTiers({ scope_type: "organization" }),
  });
  const selectedResellerId = form.watch("reseller_partner_id");
  const resellerDefaultsQuery = useQuery({
    queryKey: ["reseller-defaults", selectedResellerId],
    queryFn: () => tenantApi.getResellerDefaults(selectedResellerId ?? ""),
    enabled: Boolean(selectedResellerId) && !tenantId,
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
      reseller_partner_id: resource.tenant.reseller_partner_id ?? "",
      service_tier_definition_id: resource.tenant.service_tier_definition_id ?? "",
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
      setSecretSelection(inferSecretSelection(resource.llm_config?.secret_source, resource.llm_config?.secret_reference));
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

  useEffect(() => {
    if (tenantId) {
      return;
    }
    const defaults = resellerDefaultsQuery.data?.resource;
    const resellerId = selectedResellerId ?? "";
    if (!defaults || !resellerId || lastAppliedResellerDefaultsId.current === resellerId) {
      return;
    }

    form.setValue(
      "service_tier_definition_id",
      defaults.default_service_tier_definition_id ?? form.getValues("service_tier_definition_id"),
    );
    form.setValue(
      "reporting_timezone",
      defaults.default_reporting_timezone ?? form.getValues("reporting_timezone"),
    );
    form.setValue("service_mode", defaults.default_service_mode ?? form.getValues("service_mode"));
    form.setValue("portal_base_url", defaults.default_portal_base_url ?? form.getValues("portal_base_url"));
    form.setValue("portal_logo_url", defaults.default_portal_logo_url ?? form.getValues("portal_logo_url"));
    form.setValue(
      "portal_welcome_message",
      defaults.default_portal_welcome_message ?? form.getValues("portal_welcome_message"),
    );

    lastAppliedResellerDefaultsId.current = resellerId;
  }, [form, resellerDefaultsQuery.data, selectedResellerId, tenantId]);

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
        tenant_key: values.tenant_key || null,
        plan_tier: null,
        service_tier_definition_id: values.service_tier_definition_id || null,
        reporting_timezone: values.reporting_timezone,
        reseller_partner_id: values.reseller_partner_id || null,
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
    mutationFn: () =>
      tenantApi.putLlmConfig(tenantId ?? "", {
        ...llmForm,
        api_key:
          llmForm.credential_mode === "customer_managed" && secretSelection === "local_storage"
            ? llmForm.api_key || null
            : null,
        secret_reference:
          llmForm.credential_mode === "platform_managed"
            ? llmForm.secret_reference || null
            : secretSelection === "encrypted_vault"
              ? llmForm.secret_reference || null
              : activeTenant?.llm_config?.secret_source === "vault_managed"
                ? llmForm.secret_reference || null
                : null,
      }),
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
        business_unit: groupForm.business_unit || null,
        description: groupForm.description || null,
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
        send_invite: false,
        is_primary: true,
        first_name: userForm.first_name,
        last_name: userForm.last_name,
        email: userForm.email,
        title: userForm.title,
      }),
    onSuccess: async (result) => {
      setUserForm({
        ...defaultUserForm,
        user_id_hash: buildGeneratedUserId((usersQuery.data?.items.length ?? 0) + 2),
      });
      setUserGroupId("");
      await queryClient.invalidateQueries({ queryKey: ["activation-users", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      setInvitePromptUsers([result.resource]);
    },
  });

  const parsedBulkUsers = useMemo(() => parseImportedUsers(bulkImportText), [bulkImportText]);

  const importUsersMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) {
        throw new Error("Create the organization draft before importing users.");
      }
      if (parsedBulkUsers.length === 0) {
        throw new Error("Paste at least one valid user row to import.");
      }

      const createdUsers: UserMembership[] = [];
      const groupIdByName = new Map(groups.map((group) => [group.group_name.trim().toLowerCase(), group.id]));
      for (const row of parsedBulkUsers) {
        const groupId = row.group_name ? groupIdByName.get(row.group_name.trim().toLowerCase()) : undefined;
        const result = await tenantApi.createUser({
          user_id_hash: row.user_id_hash,
          tenant_id: tenantId,
          group_ids: groupId ? [groupId] : [],
          status: row.status,
          send_invite: false,
          is_primary: true,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          email: row.email || null,
          title: row.title || null,
        });
        createdUsers.push(result.resource);
      }
      return createdUsers;
    },
    onSuccess: async (createdUsers) => {
      setBulkImportText("");
      await queryClient.invalidateQueries({ queryKey: ["activation-users", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      setInvitePromptUsers(createdUsers);
    },
  });

  const inviteUsersMutation = useMutation({
    mutationFn: async (users: UserMembership[]) => {
      if (!tenantId) {
        throw new Error("Create the organization draft before sending invitations.");
      }
      const invitableUsers = users.filter((user) => user.profile?.email);
      for (const user of invitableUsers) {
        await tenantApi.runUserAction(user.user_id_hash, {
          tenant_id: tenantId,
          action: "reinvite",
        });
      }
      return invitableUsers.length;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["activation-users", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
      setInvitePromptUsers([]);
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

  const overrideActivationMutation = useMutation({
    mutationFn: () => tenantApi.overrideTenantActivation(tenantId ?? "", overrideReason),
    onSuccess: () => {
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["activation-tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["activation-onboarding-detail", tenantId] });
    },
  });

  const activeTenant = tenantQuery.data?.resource;
  const onboarding = onboardingQuery.data?.resource;
  const detectedUsers = usersQuery.data?.items ?? [];
  const hasDetectedUsers = detectedUsers.length > 0;
  const groups = groupsQuery.data?.items ?? [];
  const isMinimalActivationMode = ["managed_service", "guided_activation", "hybrid"].includes(
    form.watch("service_mode") || activeTenant?.profile?.service_mode || "",
  );
  const generatedUserId = useMemo(
    () => buildGeneratedUserId((usersQuery.data?.items.length ?? 0) + 1),
    [usersQuery.data?.items.length],
  );
  const onboardingBlockers = [
    !onboarding?.tenant_created ? "Save the organization record" : null,
    !isMinimalActivationMode && !onboarding?.llm_configured ? "Save the LLM configuration" : null,
    !isMinimalActivationMode && !onboarding?.llm_validated ? "Validate the LLM connection" : null,
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
  const organizationTiers = organizationTiersQuery.data?.items ?? [];
  const organizationKeyPreview = buildOrganizationKeyPreview(form.watch("tenant_name") ?? "");
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
            ? createUserMutation.error ?? importUsersMutation.error
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

  function handleInviteDecision(shouldInvite: boolean) {
    if (!shouldInvite) {
      setInvitePromptUsers([]);
      advanceToNextStep();
      return;
    }
    inviteUsersMutation.mutate(invitePromptUsers);
  }

  function requestUserCreation(kind: "single" | "bulk", requestedUsers: number) {
    const limit = tierUserLimit(activeTenant?.service_tier ?? null);
    if (!limit) {
      if (kind === "single") {
        createUserMutation.mutate();
      } else {
        importUsersMutation.mutate();
      }
      return;
    }
    const currentUsers = detectedUsers.filter((user) => user.status !== "deleted").length;
    setUserLimitDialog({
      kind,
      requestedUsers,
      currentUsers,
      limit,
      blocked: currentUsers + requestedUsers > limit,
    });
  }

  function confirmUserCreation() {
    if (!userLimitDialog) {
      return;
    }
    const { kind } = userLimitDialog;
    setUserLimitDialog(null);
    if (kind === "single") {
      createUserMutation.mutate();
    } else {
      importUsersMutation.mutate();
    }
  }

  if (tenantId && tenantQuery.isLoading) {
    return <LoadingBlock label="Loading activation draft..." />;
  }
  if (organizationTiersQuery.isLoading) {
    return <LoadingBlock label="Loading service tiers..." />;
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
                    <label className="field-label" htmlFor="generated_tenant_key">
                      Generated Organization Key
                    </label>
                    <input className="field" id="generated_tenant_key" value={organizationKeyPreview} disabled readOnly />
                    <div className="field-tip">Herman Admin generates the internal key automatically from the organization name so the admin only needs to enter the name.</div>
                  </div>
                </div>

                <div className="field-row field-row--three">
                  <div>
                    <label className="field-label" htmlFor="reseller_partner_id">
                      Reseller
                    </label>
                    <select className="field" id="reseller_partner_id" {...form.register("reseller_partner_id")}>
                      <option value="">Direct / HermanScience managed</option>
                      {(resellersQuery.data?.items ?? []).map((reseller) => (
                        <option key={reseller.id} value={reseller.id}>
                          {reseller.reseller_name}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Select a reseller when this tenant should be created inside a reseller-owned portfolio and inherit reseller defaults.</div>
                  </div>
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
                    <label className="field-label" htmlFor="service_tier_definition_id">
                      Service Tier
                    </label>
                    <select className="field" id="service_tier_definition_id" {...form.register("service_tier_definition_id")}>
                      <option value="">Select service tier</option>
                      {organizationTiers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.tier_name}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Service tiers are defined by HermanScience super admins and control the organization&apos;s user limits.</div>
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
                      LLM Setup Source
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
                      <option value="platform_managed">HermanScience predefined setup</option>
                      <option value="customer_managed">Organization provided credentials</option>
                    </select>
                    <div className="field-tip">Choose whether this organization will use a predefined HermanScience LLM setup or provide its own credentials for LLM access.</div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="secret_selection">
                      Secret Selection
                    </label>
                    <select
                      className="field"
                      disabled={llmForm.credential_mode === "platform_managed"}
                      id="secret_selection"
                      value={secretSelection}
                      onChange={(event) => setSecretSelection(event.target.value as SecretSelection)}
                    >
                      <option value="local_storage">Local Storage</option>
                      <option value="encrypted_vault">Encrypted Vault</option>
                    </select>
                    <div className="field-tip">
                      {llmForm.credential_mode === "platform_managed"
                        ? "This organization is using a predefined HermanScience LLM setup, so its secret handling is inherited from the shared configuration."
                        : "Choose whether the organization key is entered here for internal storage or resolved from an existing vault reference."}
                    </div>
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="api_key">
                      API Key
                    </label>
                    <input
                      className="field"
                      disabled={llmForm.credential_mode === "platform_managed" || secretSelection === "encrypted_vault"}
                      id="api_key"
                      placeholder={
                        llmForm.credential_mode === "platform_managed"
                          ? "Managed by HermanScience shared LLM pool"
                          : secretSelection === "encrypted_vault"
                            ? "Retrieved from vault"
                            : "Enter customer-managed key"
                      }
                      readOnly={llmForm.credential_mode !== "customer_managed" || secretSelection === "encrypted_vault"}
                      type={secretSelection === "local_storage" ? "password" : "text"}
                      value={llmForm.api_key}
                      onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
                    />
                    <div className="field-tip">
                      {llmForm.credential_mode === "platform_managed"
                        ? "This organization is using a predefined HermanScience LLM setup, so the shared credentials are supplied from the super-admin LLM pool and are not edited here."
                        : secretSelection === "encrypted_vault"
                          ? "This key is expected to come from the referenced vault entry, so direct entry is disabled here."
                          : "Paste the organization-provided API key here. The backend will write it into the admin vault and keep only a masked value plus internal vault reference in Postgres."}
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="secret_reference">
                      Secret Vault
                    </label>
                    <input
                      className="field"
                      disabled={llmForm.credential_mode === "platform_managed" || secretSelection === "local_storage"}
                      id="secret_reference"
                      placeholder={
                        llmForm.credential_mode === "platform_managed"
                          ? "Managed by HermanScience shared LLM pool"
                          : secretSelection === "local_storage"
                            ? "Defined internally"
                            : "Enter vault reference"
                      }
                      readOnly={llmForm.credential_mode !== "customer_managed" || secretSelection === "local_storage"}
                      value={llmForm.credential_mode === "customer_managed" && secretSelection === "local_storage" ? "Defined internally" : llmForm.secret_reference}
                      onChange={(event) => setLlmForm((current) => ({ ...current, secret_reference: event.target.value }))}
                    />
                    <div className="field-tip">
                      {llmForm.credential_mode === "platform_managed"
                        ? "The selected predefined HermanScience LLM setup supplies the managed secret reference automatically."
                        : secretSelection === "local_storage"
                          ? "When a local API key is saved, Herman Admin generates and stores the encrypted vault reference internally instead of showing it here."
                          : "Enter the existing encrypted vault reference that should be used for this organization's LLM credential."}
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
                    ? `This organization will use the predefined HermanScience LLM setup "${selectedPlatformManagedConfig.label}" unless it is later switched to organization-provided credentials.`
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
                    <label className="field-label" htmlFor="group_business_unit">
                      Business Unit
                    </label>
                    <select
                      className="field"
                      id="group_business_unit"
                      value={groupForm.business_unit}
                      onChange={(event) => setGroupForm((current) => ({ ...current, business_unit: event.target.value }))}
                    >
                      <option value="">Select business unit</option>
                      {businessUnitOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <div className="field-tip">Choose the business area this control zone belongs to. Select Other when no standard unit fits.</div>
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
                    disabled={!tenantId || !groupForm.group_name}
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
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => (
                          <tr key={group.id}>
                            <td>
                              <strong>{group.group_name}</strong>
                              <div className="muted">{group.profile?.description ?? "No description"}</div>
                            </td>
                            <td>{group.profile?.business_unit ?? "Pending"}</td>
                            <td>{group.profile?.description ?? "Pending"}</td>
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
                  Paste CSV or tab-separated rows to import multiple users in one pass, or add a single user below when you only need one initial admin candidate.
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
                    disabled={!tenantId || !userForm.email.trim() || createUserMutation.isPending}
                    onClick={() => requestUserCreation("single", 1)}
                    type="button"
                  >
                    {createUserMutation.isPending ? "Adding..." : "Add user"}
                  </button>
                </div>

                <div className="panel panel--inset">
                  <h3 className="panel-title">Bulk Import</h3>
                  <div className="muted" style={{ marginTop: 8, marginBottom: 16 }}>
                    Supported headers include `email,first_name,last_name,title,group_name,status,user_id_hash`.
                  </div>
                  <textarea
                    className="field"
                    rows={6}
                    value={bulkImportText}
                    onChange={(event) => setBulkImportText(event.target.value)}
                  />
                  <div className="field-tip">
                    {parsedBulkUsers.length} row{parsedBulkUsers.length === 1 ? "" : "s"} ready to import. Group names are matched to existing groups when supplied.
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <button
                      className="secondary-button"
                      disabled={!tenantId || parsedBulkUsers.length === 0 || importUsersMutation.isPending}
                      onClick={() => requestUserCreation("bulk", parsedBulkUsers.length)}
                      type="button"
                    >
                      {importUsersMutation.isPending ? "Importing..." : "Import users from pasted rows"}
                    </button>
                  </div>
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
                              <strong>{admin.profile?.display_name ?? "Unnamed admin"}</strong>
                              <div className="muted">{admin.profile?.email ?? "No email on file"}</div>
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
                                || selectedUser.profile?.email
                                || "Unnamed admin",
                            email: selectedUser.profile?.email ?? "",
                          });
                        }}
                      >
                        <option value="">Choose an existing user</option>
                        {detectedUsers.map((user) => (
                          <option key={user.id} value={user.user_id_hash}>
                            {user.profile?.email ?? "User without email"}
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
                    <button className="primary-button" disabled={!tenantId || (!adminForm.email.trim() && !adminForm.display_name.trim())} onClick={() => createAdminMutation.mutate()} type="button">
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
                              <strong>{admin.profile?.display_name ?? "Unnamed admin"}</strong>
                              <div className="muted">{admin.profile?.email ?? "No email on file"}</div>
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
                {isMinimalActivationMode ? (
                  <div className="section-note">
                    {form.watch("service_mode") || activeTenant?.profile?.service_mode || "Managed service"} allows phased rollout, so LLM validation is optional for the first activation.
                  </div>
                ) : null}
                <div className="section-note">
                  Activation remains a DB-state change only. This admin tool records the configuration and readiness markers in the database and does not drive Herman Prompt or Herman Transform directly.
                </div>
                <div className="field-row">
                  <div>
                    <label className="field-label" htmlFor="activation_override_reason">Override Reason</label>
                    <input
                      className="field"
                      id="activation_override_reason"
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                    />
                    <div className="field-tip">HermanScience admins can bypass remaining gates when a customer needs manual escalation.</div>
                  </div>
                </div>
                <button
                  className="primary-button"
                  disabled={!tenantId || onboardingBlockers.length > 0 || activateTenantMutation.isPending}
                  onClick={() => activateTenantMutation.mutate()}
                  type="button"
                >
                  {activateTenantMutation.isPending ? "Activating..." : "Activate organization"}
                </button>
                <button
                  className="ghost-button"
                  disabled={!tenantId || !overrideReason.trim() || overrideActivationMutation.isPending}
                  onClick={() => overrideActivationMutation.mutate()}
                  type="button"
                >
                  {overrideActivationMutation.isPending ? "Overriding..." : "Override Activation"}
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

      {invitePromptUsers.length > 0 ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-users-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="invite-users-dialog-title">Invite New Users?</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {invitePromptUsers.length === 1
                    ? "The new user has been added. Do you want to email an invitation now?"
                    : `${invitePromptUsers.length} users were added. Do you want to email invitations now?`}
                </div>
              </div>
            </div>

            {inviteUsersMutation.error ? (
              <div className="section-note section-note--danger" style={{ marginTop: 14 }}>
                {mutationMessage(inviteUsersMutation.error)}
              </div>
            ) : null}

            <div className="section-note" style={{ marginTop: 18 }}>
              {invitePromptUsers.filter((user) => user.profile?.email).length} of {invitePromptUsers.length} newly added
              {" "}user{invitePromptUsers.length === 1 ? "" : "s"} have an email address on file and can receive an invitation.
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button
                className="primary-button"
                disabled={inviteUsersMutation.isPending}
                onClick={() => handleInviteDecision(true)}
                type="button"
              >
                {inviteUsersMutation.isPending ? "Sending..." : "Yes, send invites"}
              </button>
              <button
                className="secondary-button"
                disabled={inviteUsersMutation.isPending}
                onClick={() => handleInviteDecision(false)}
                type="button"
              >
                No, not now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {userLimitDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setUserLimitDialog(null)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-limit-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="split-header">
              <div>
                <h3 className="panel-title" id="user-limit-dialog-title">User Limit Check</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  {userLimitDialog.blocked
                    ? userLimitDialog.currentUsers >= userLimitDialog.limit
                      ? "No more users allowed."
                      : "This add would exceed the service tier limit."
                    : userLimitDialog.kind === "single"
                      ? `Add user number ${userLimitDialog.currentUsers + 1} of total allowed ${userLimitDialog.limit}?`
                      : `Add users ${userLimitDialog.currentUsers + 1} through ${userLimitDialog.currentUsers + userLimitDialog.requestedUsers} of total allowed ${userLimitDialog.limit}?`}
                </div>
              </div>
            </div>

            <div className={`section-note${userLimitDialog.blocked ? " section-note--danger" : ""}`} style={{ marginTop: 18 }}>
              {userLimitDialog.blocked
                ? `${activeTenant?.tenant?.tenant_name ?? "This organization"} is currently using ${userLimitDialog.currentUsers} of ${userLimitDialog.limit} allowed users.`
                : `${activeTenant?.tenant?.tenant_name ?? "This organization"} is currently using ${userLimitDialog.currentUsers} of ${userLimitDialog.limit} allowed users.`}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              {!userLimitDialog.blocked ? (
                <button className="primary-button" onClick={confirmUserCreation} type="button">
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
