import { useEffect, useMemo, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";
import type { PlatformManagedLlmTestResult } from "../../lib/types";

const defaultForm = {
  label: "",
  db_kind: "postgresql",
  host: "",
  database_name: "",
  connection_string: "",
  connection_string_masked: "",
  connection_secret_reference: "",
  notes: "",
  is_active: false,
  managed_via_db_only: true,
};

const defaultPromptUiForm = {
  label: "",
  base_url: "",
  notes: "",
  is_active: false,
};

const defaultPlatformLlmForm = {
  label: "",
  provider_type: "openai",
  model_name: "gpt-5.4",
  endpoint_url: "https://api.openai.com/v1",
  api_key: "",
  notes: "",
  is_active: true,
};

const providerDefaultEndpoints: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  azure_openai: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(defaultForm);
  const [promptUiForm, setPromptUiForm] = useState(defaultPromptUiForm);
  const [platformLlmForm, setPlatformLlmForm] = useState(defaultPlatformLlmForm);
  const [platformLlmTestResult, setPlatformLlmTestResult] = useState<PlatformManagedLlmTestResult | null>(null);
  const [platformLlmTestFingerprint, setPlatformLlmTestFingerprint] = useState<string | null>(null);
  const [selectedPlatformLlmId, setSelectedPlatformLlmId] = useState<string | null>(null);
  const [platformLlmEditForm, setPlatformLlmEditForm] = useState({
    endpoint_url: "",
    api_key: "",
    notes: "",
    is_active: true,
  });
  const previousProviderRef = useRef(platformLlmForm.provider_type);
  const previousEndpointRef = useRef(platformLlmForm.endpoint_url);

  const databaseInstancesQuery = useQuery({
    queryKey: ["database-instances"],
    queryFn: () => tenantApi.listDatabaseInstances(),
  });
  const runtimeDatabaseTargetQuery = useQuery({
    queryKey: ["runtime-database-target"],
    queryFn: () => tenantApi.getRuntimeDatabaseTarget(),
  });
  const promptUiInstancesQuery = useQuery({
    queryKey: ["prompt-ui-instances"],
    queryFn: () => tenantApi.listPromptUiInstances(),
  });
  const secretVaultQuery = useQuery({
    queryKey: ["secret-vault"],
    queryFn: () => tenantApi.getSecretVaultStatus(),
  });
  const platformManagedLlmsQuery = useQuery({
    queryKey: ["platform-managed-llms", "all"],
    queryFn: () => tenantApi.listPlatformManagedLlms(true),
  });

  const activePromptUi = useMemo(
    () => promptUiInstancesQuery.data?.items.find((instance) => instance.is_active) ?? null,
    [promptUiInstancesQuery.data],
  );
  const activePlatformLlms = useMemo(
    () => platformManagedLlmsQuery.data?.items.filter((instance) => instance.is_active) ?? [],
    [platformManagedLlmsQuery.data],
  );
  const currentPlatformLlmFingerprint = useMemo(
    () =>
      JSON.stringify({
        provider_type: platformLlmForm.provider_type.trim(),
        model_name: platformLlmForm.model_name.trim(),
        endpoint_url: platformLlmForm.endpoint_url.trim(),
        api_key: platformLlmForm.api_key,
      }),
    [platformLlmForm],
  );
  const platformLlmTestIsCurrent = platformLlmTestFingerprint === currentPlatformLlmFingerprint;
  const platformLlmTestPassed = platformLlmTestIsCurrent && platformLlmTestResult?.validation_result === "valid";

  useEffect(() => {
    const previousProvider = previousProviderRef.current;
    const previousEndpoint = previousEndpointRef.current;
    const currentProvider = platformLlmForm.provider_type;
    const currentEndpoint = platformLlmForm.endpoint_url;
    if (previousProvider !== currentProvider) {
      const previousDefault = providerDefaultEndpoints[previousProvider] ?? "";
      const nextDefault = providerDefaultEndpoints[currentProvider] ?? "";
      const shouldAutofill =
        !currentEndpoint.trim() ||
        currentEndpoint === previousEndpoint ||
        currentEndpoint === previousDefault;
      if (shouldAutofill && currentEndpoint !== nextDefault) {
        setPlatformLlmForm((current) => ({ ...current, endpoint_url: nextDefault }));
      }
    }
    previousProviderRef.current = currentProvider;
    previousEndpointRef.current = currentEndpoint;
  }, [platformLlmForm.endpoint_url, platformLlmForm.provider_type]);

  const createMutation = useMutation({
    mutationFn: () => tenantApi.createDatabaseInstance(form),
    onSuccess: () => {
      setForm(defaultForm);
      queryClient.invalidateQueries({ queryKey: ["database-instances"] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (instanceId: string) => tenantApi.updateDatabaseInstance(instanceId, { is_active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database-instances"] });
    },
  });
  const createPromptUiMutation = useMutation({
    mutationFn: () => tenantApi.createPromptUiInstance(promptUiForm),
    onSuccess: () => {
      setPromptUiForm(defaultPromptUiForm);
      queryClient.invalidateQueries({ queryKey: ["prompt-ui-instances"] });
    },
  });
  const activatePromptUiMutation = useMutation({
    mutationFn: (instanceId: string) => tenantApi.updatePromptUiInstance(instanceId, { is_active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-ui-instances"] });
    },
  });
  const testPlatformLlmMutation = useMutation({
    mutationFn: () =>
      tenantApi.testPlatformManagedLlm({
        provider_type: platformLlmForm.provider_type.trim(),
        model_name: platformLlmForm.model_name.trim(),
        endpoint_url: platformLlmForm.endpoint_url.trim(),
        api_key: platformLlmForm.api_key,
      }),
    onSuccess: ({ resource }) => {
      setPlatformLlmTestResult(resource);
      setPlatformLlmTestFingerprint(currentPlatformLlmFingerprint);
    },
  });
  const createPlatformLlmMutation = useMutation({
    mutationFn: () =>
      tenantApi.createPlatformManagedLlm({
        ...platformLlmForm,
        label: platformLlmForm.label.trim(),
        api_key: platformLlmForm.api_key || null,
        secret_reference: null,
      }),
    onSuccess: ({ resource }) => {
      setPlatformLlmForm(defaultPlatformLlmForm);
      setPlatformLlmTestResult(null);
      setPlatformLlmTestFingerprint(null);
      setSelectedPlatformLlmId(resource.id);
      setPlatformLlmEditForm({
        endpoint_url: resource.endpoint_url ?? "",
        api_key: "",
        notes: resource.notes ?? "",
        is_active: resource.is_active,
      });
      queryClient.invalidateQueries({ queryKey: ["platform-managed-llms"] });
    },
  });
  const togglePlatformLlmMutation = useMutation({
    mutationFn: ({ configId, is_active }: { configId: string; is_active: boolean }) =>
      tenantApi.updatePlatformManagedLlm(configId, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-managed-llms"] });
    },
  });
  const updatePlatformLlmMutation = useMutation({
    mutationFn: () =>
      selectedPlatformLlmId
        ? tenantApi.updatePlatformManagedLlm(selectedPlatformLlmId, {
            endpoint_url: platformLlmEditForm.endpoint_url || null,
            api_key: platformLlmEditForm.api_key || null,
            notes: platformLlmEditForm.notes || null,
            is_active: platformLlmEditForm.is_active,
          })
        : Promise.reject(new Error("No HermanScience LLM selected")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-managed-llms"] });
      setPlatformLlmEditForm((current) => ({ ...current, api_key: "" }));
    },
  });
  const deletePlatformLlmMutation = useMutation({
    mutationFn: () =>
      selectedPlatformLlmId
        ? tenantApi.deletePlatformManagedLlm(selectedPlatformLlmId)
        : Promise.reject(new Error("No HermanScience LLM selected")),
    onSuccess: () => {
      setSelectedPlatformLlmId(null);
      setPlatformLlmEditForm({
        endpoint_url: "",
        api_key: "",
        notes: "",
        is_active: true,
      });
      queryClient.invalidateQueries({ queryKey: ["platform-managed-llms"] });
    },
  });

  const platformManagedLlms = platformManagedLlmsQuery.data?.items ?? [];

  useEffect(() => {
    if (platformManagedLlms.length === 0) {
      if (selectedPlatformLlmId !== null) {
        setSelectedPlatformLlmId(null);
      }
      return;
    }

    const selectedStillExists = selectedPlatformLlmId
      ? platformManagedLlms.some((item) => item.id === selectedPlatformLlmId)
      : false;
    if (selectedStillExists) {
      return;
    }

    const fallback = platformManagedLlms[0];
    setSelectedPlatformLlmId(fallback.id);
    setPlatformLlmEditForm({
      endpoint_url: fallback.endpoint_url ?? "",
      api_key: "",
      notes: fallback.notes ?? "",
      is_active: fallback.is_active,
    });
  }, [platformManagedLlms, selectedPlatformLlmId]);

  if (
    databaseInstancesQuery.isLoading ||
    runtimeDatabaseTargetQuery.isLoading ||
    promptUiInstancesQuery.isLoading ||
    secretVaultQuery.isLoading ||
    platformManagedLlmsQuery.isLoading
  ) {
    return <LoadingBlock label="Loading settings..." />;
  }

  const instances = databaseInstancesQuery.data?.items ?? [];
  const runtimeDatabaseTarget = runtimeDatabaseTargetQuery.data?.resource ?? null;
  const promptUiInstances = promptUiInstancesQuery.data?.items ?? [];
  const vaultStatus = secretVaultQuery.data?.resource ?? null;
  const selectedPlatformLlm = platformManagedLlms.find((item) => item.id === selectedPlatformLlmId) ?? null;

  const openPlatformLlmEditor = (configId: string) => {
    const selected = platformManagedLlms.find((item) => item.id === configId);
    if (!selected) {
      return;
    }
    setSelectedPlatformLlmId(configId);
    setPlatformLlmEditForm({
      endpoint_url: selected.endpoint_url ?? "",
      api_key: "",
      notes: selected.notes ?? "",
      is_active: selected.is_active,
    });
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Confirm the live connected runtime database before doing writes, then manage saved admin-side reference records below.
          </p>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Runtime Database Target</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              HermanScience LLM changes are written to the database configured in the runtime environment variable, not to a saved database-instance record below.
            </div>
          </div>

          <div className="key-value">
            <div className="muted">Current target</div>
            <div>{runtimeDatabaseTarget?.database_url_masked ?? "No runtime database configured"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Driver</div>
            <div>{runtimeDatabaseTarget?.driver ?? "Not set"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Host</div>
            <div>{runtimeDatabaseTarget?.host ?? "Local / embedded"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Database</div>
            <div>{runtimeDatabaseTarget?.database_name ?? "Not set"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Source</div>
            <div>{runtimeDatabaseTarget?.source ?? "Unknown"}</div>
          </div>
          <div className="section-note">
            `Add HermanScience LLM` and `Configure HermanScience LLM` use this runtime target because the API session is bound to `HERMAN_ADMIN_DATABASE_URL`.
          </div>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Active Prompt UI</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Track which Herman Prompt UI deployment this admin tool is currently paired with for operator reference.
            </div>
          </div>

          <div className="key-value">
            <div className="muted">Current UI</div>
            <div>{activePromptUi?.label ?? "No active Prompt UI configured"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Base URL</div>
            <div style={{ wordBreak: "break-word" }}>
              {activePromptUi ? (
                <a href={activePromptUi.base_url} rel="noreferrer" target="_blank">{activePromptUi.base_url}</a>
              ) : (
                "Not set"
              )}
            </div>
          </div>
          <div className="key-value">
            <div className="muted">Notes</div>
            <div>{activePromptUi?.notes ?? "No notes saved"}</div>
          </div>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Secret Vault</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              All sensitive credentials should be written through this vault layer instead of being stored directly in admin tables.
            </div>
          </div>

          <div className="key-value">
            <div className="muted">Provider</div>
            <div>{vaultStatus?.display_name ?? "Not configured"}</div>
          </div>
          <div className="key-value">
            <div className="muted">State</div>
            <div>
              <StatusBadge value={vaultStatus?.configured ? "active" : "inactive"} />
            </div>
          </div>
          <div className="key-value">
            <div className="muted">Write support</div>
            <div>{vaultStatus?.writable ? "Enabled" : "Read-only / unavailable"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Reference prefix</div>
            <div style={{ wordBreak: "break-word" }}>{vaultStatus?.reference_prefix ?? "Not set"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Managed secrets</div>
            <div>{vaultStatus?.managed_secret_count ?? 0}</div>
          </div>
          <div className="key-value">
            <div className="muted">Key source</div>
            <div>{vaultStatus?.key_source ?? "Unknown"}</div>
          </div>
          {vaultStatus?.azure_key_vault_url ? (
            <div className="key-value">
              <div className="muted">Azure Vault URL</div>
              <div style={{ wordBreak: "break-word" }}>{vaultStatus.azure_key_vault_url}</div>
            </div>
          ) : null}
          {vaultStatus?.warnings?.map((warning) => (
            <div className="section-note" key={warning}>{warning}</div>
          ))}
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">HermanScience LLM Pool</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Maintain the shared HermanScience-provided LLMs that onboarding teams can assign to organizations before those orgs have their own licenses.
            </div>
          </div>

          <div className="key-value">
            <div className="muted">Active shared LLMs</div>
            <div>{activePlatformLlms.length}</div>
          </div>
          <div className="key-value">
            <div className="muted">Pool entries</div>
            <div>{platformManagedLlms.length}</div>
          </div>

          <div className="table-wrap" style={{ marginTop: 8 }}>
            {platformManagedLlms.length === 0 ? (
              <div className="empty-state table-empty-state">No platform-managed LLMs are configured yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Model</th>
                    <th>URL</th>
                    <th>Credential Source</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {platformManagedLlms.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="link-button"
                          onClick={() => openPlatformLlmEditor(item.id)}
                          type="button"
                        >
                          {item.label}
                        </button>
                      </td>
                      <td>
                        <button
                          className="link-button"
                          onClick={() => openPlatformLlmEditor(item.id)}
                          type="button"
                        >
                          {item.model_name}
                        </button>
                        <div className="muted">{item.provider_type}</div>
                      </td>
                      <td style={{ wordBreak: "break-word" }}>{item.endpoint_url ?? "Not configured"}</td>
                      <td>{item.secret_source.replace("_", " ")}</td>
                      <td><StatusBadge value={item.is_active ? "active" : "inactive"} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="ghost-button"
                            onClick={() => openPlatformLlmEditor(item.id)}
                            type="button"
                          >
                            Configure
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => togglePlatformLlmMutation.mutate({ configId: item.id, is_active: !item.is_active })}
                            type="button"
                          >
                            {item.is_active ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Register Database Instance</h3>
          <div className="muted" style={{ marginTop: 8 }}>
            Save reference metadata for known database environments. These records do not switch the live database connection used by the running API.
          </div>
        </div>

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="db_label">Label</label>
            <input
              className="field"
              id="db_label"
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="db_kind">Database Type</label>
            <select
              className="field"
              id="db_kind"
              value={form.db_kind}
              onChange={(event) => setForm((current) => ({ ...current, db_kind: event.target.value }))}
            >
              <option value="postgresql">PostgreSQL</option>
              <option value="sqlite">SQLite</option>
              <option value="mysql">MySQL</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="db_host">Host</label>
            <input
              className="field"
              id="db_host"
              value={form.host}
              onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="database_name">Database Name</label>
            <input
              className="field"
              id="database_name"
              value={form.database_name}
              onChange={(event) => setForm((current) => ({ ...current, database_name: event.target.value }))}
            />
          </div>
        </div>

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="connection_string">Connection String</label>
            <input
              className="field"
              id="connection_string"
              placeholder="postgresql://user:password@host:port/dbname"
              type="password"
              value={form.connection_string}
              onChange={(event) => setForm((current) => ({ ...current, connection_string: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="connection_secret_reference">External Secret Reference</label>
            <input
              className="field"
              id="connection_secret_reference"
              placeholder="Use only if the secret already lives in another vault"
              value={form.connection_secret_reference}
              onChange={(event) => setForm((current) => ({ ...current, connection_secret_reference: event.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="connection_string_masked">Masked Display Value</label>
          <input
            className="field"
            id="connection_string_masked"
            placeholder="postgresql://user:***@host/dbname"
            value={form.connection_string_masked}
            onChange={(event) => setForm((current) => ({ ...current, connection_string_masked: event.target.value }))}
          />
          <div className="section-note">
            Leave this blank when you paste the real connection string above. The backend will generate the masked display value automatically.
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="db_notes">Notes</label>
          <textarea
            className="field"
            id="db_notes"
            rows={4}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </div>

        <div className="field-row">
          <div>
            <label className="field-label" htmlFor="db_active">Set Active</label>
            <select
              className="field"
              id="db_active"
              value={String(form.is_active)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_active: event.target.value === "true",
                }))
              }
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="managed_via_db_only">Control Model</label>
            <select
              className="field"
              id="managed_via_db_only"
              value={String(form.managed_via_db_only)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  managed_via_db_only: event.target.value === "true",
                }))
              }
            >
              <option value="true">DB only</option>
              <option value="false">Mixed</option>
            </select>
          </div>
        </div>

        <button
          className="primary-button"
          disabled={!form.label.trim()}
          onClick={() => createMutation.mutate()}
          type="button"
        >
          Save database reference
        </button>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Add HermanScience LLM</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Create a shared HermanScience-provided model entry that organizations can select from the managed pool.
            </div>
          </div>

          <div className="field-row">
          <div>
            <label className="field-label" htmlFor="platform_llm_label">Pool Label</label>
            <input
              className="field"
              id="platform_llm_label"
              value={platformLlmForm.label}
              onChange={(event) => setPlatformLlmForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="OpenAI GPT-5.4 Shared Pool A"
              type="text"
            />
            <div className="section-note">
              Use a unique label so multiple HermanScience entries can exist for the same model.
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="platform_llm_provider">Provider</label>
            <select
              className="field"
                id="platform_llm_provider"
                value={platformLlmForm.provider_type}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, provider_type: event.target.value }))}
              >
                <option value="openai">OpenAI</option>
                <option value="azure_openai">Azure OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="xai">xAI / Grok</option>
                <option value="custom">Custom Endpoint</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="platform_llm_model">Model Name</label>
              <input
                className="field"
                id="platform_llm_model"
                value={platformLlmForm.model_name}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, model_name: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="platform_llm_endpoint">Endpoint URL</label>
              <input
                className="field"
                id="platform_llm_endpoint"
                value={platformLlmForm.endpoint_url}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, endpoint_url: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="platform_llm_api_key">LLM Key</label>
            <input
              className="field"
              id="platform_llm_api_key"
              placeholder="Enter the HermanScience-managed key"
              type="password"
              value={platformLlmForm.api_key}
              onChange={(event) => setPlatformLlmForm((current) => ({ ...current, api_key: event.target.value }))}
            />
            <div className="section-note">
              The key is encrypted and stored server-side. It is never shown again after save.
            </div>
          </div>

          <div className="panel" style={{ background: "rgba(248, 250, 252, 0.7)" }}>
            <div className="stack" style={{ gap: 10 }}>
              <div>
                <div className="panel-title" style={{ fontSize: "0.95rem" }}>Test Configuration</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Test the provider URL, model, and key before this HermanScience LLM is saved. The server runs the validation again before the insert commits to the runtime database.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="secondary-button"
                  disabled={
                    !platformLlmForm.provider_type.trim() ||
                    !platformLlmForm.model_name.trim() ||
                    !platformLlmForm.endpoint_url.trim() ||
                    !platformLlmForm.api_key.trim()
                  }
                  onClick={() => testPlatformLlmMutation.mutate()}
                  type="button"
                >
                  {testPlatformLlmMutation.isPending ? "Testing..." : "Test Configuration"}
                </button>
                {platformLlmTestPassed ? <StatusBadge value="valid" /> : null}
                {!platformLlmTestPassed && platformLlmTestResult && platformLlmTestIsCurrent ? <StatusBadge value="invalid" /> : null}
                {!platformLlmTestIsCurrent && platformLlmTestResult ? <StatusBadge value="stale" /> : null}
              </div>

              {platformLlmTestResult ? (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="key-value">
                    <div className="muted">Result</div>
                    <div>{platformLlmTestResult.validation_result === "valid" ? "Connection succeeded" : "Connection failed"}</div>
                  </div>
                  {platformLlmTestResult.error_code ? (
                    <div className="key-value">
                      <div className="muted">Error code</div>
                      <div>{platformLlmTestResult.error_code}</div>
                    </div>
                  ) : null}
                  <div className="key-value">
                    <div className="muted">Latency</div>
                    <div>{platformLlmTestResult.latency_ms !== null ? `${platformLlmTestResult.latency_ms} ms` : "Not measured"}</div>
                  </div>
                  <div className="section-note">
                    {platformLlmTestResult.message ?? "No message returned."}
                  </div>
                  {!platformLlmTestIsCurrent ? (
                    <div className="section-note" style={{ color: "#b45309" }}>
                      The form changed after the last test. Run the test again before saving.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {testPlatformLlmMutation.isError ? (
                <div className="section-note" style={{ color: "#b91c1c" }}>
                  {testPlatformLlmMutation.error instanceof Error ? testPlatformLlmMutation.error.message : "Configuration test failed."}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="platform_llm_notes">Notes</label>
            <textarea
              className="field"
              id="platform_llm_notes"
              rows={3}
              value={platformLlmForm.notes}
              onChange={(event) => setPlatformLlmForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="platform_llm_active">Availability</label>
            <select
              className="field"
              id="platform_llm_active"
              value={String(platformLlmForm.is_active)}
              onChange={(event) =>
                setPlatformLlmForm((current) => ({
                  ...current,
                  is_active: event.target.value === "true",
                }))
              }
            >
              <option value="true">Available in pool</option>
              <option value="false">Saved but unavailable</option>
            </select>
          </div>

          <button
            className="primary-button"
            disabled={!platformLlmForm.label.trim() || !platformLlmForm.model_name.trim() || !platformLlmTestPassed}
            onClick={() => createPlatformLlmMutation.mutate()}
            type="button"
          >
            {createPlatformLlmMutation.isPending ? "Saving..." : "Add HermanScience LLM"}
          </button>
          {createPlatformLlmMutation.isSuccess ? (
            <div className="section-note" style={{ color: "#166534" }}>
              HermanScience LLM saved to the runtime database target and opened in the configure panel.
            </div>
          ) : null}
          {createPlatformLlmMutation.isError ? (
            <div className="section-note" style={{ color: "#b91c1c" }}>
              {createPlatformLlmMutation.error instanceof Error ? createPlatformLlmMutation.error.message : "Saving the HermanScience LLM failed."}
            </div>
          ) : null}
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Configure HermanScience LLM</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Select a shared model from the pool above to update its URL or rotate its key. Model name and provider stay fixed after creation.
            </div>
          </div>

          {selectedPlatformLlm ? (
            <>
              <div className="key-value">
                <div className="muted">Model</div>
                <div>{selectedPlatformLlm.model_name}</div>
              </div>
              <div className="key-value">
                <div className="muted">Provider</div>
                <div>{selectedPlatformLlm.provider_type}</div>
              </div>
              <div className="key-value">
                <div className="muted">Stored key</div>
                <div>{selectedPlatformLlm.api_key_masked ?? "No key saved"}</div>
              </div>

              <div>
                <label className="field-label" htmlFor="platform_llm_edit_endpoint">Endpoint URL</label>
                <input
                  className="field"
                  id="platform_llm_edit_endpoint"
                  value={platformLlmEditForm.endpoint_url}
                  onChange={(event) => setPlatformLlmEditForm((current) => ({ ...current, endpoint_url: event.target.value }))}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="platform_llm_edit_key">LLM Key</label>
                <input
                  className="field"
                  id="platform_llm_edit_key"
                  placeholder="Leave blank to keep the current key"
                  type="password"
                  value={platformLlmEditForm.api_key}
                  onChange={(event) => setPlatformLlmEditForm((current) => ({ ...current, api_key: event.target.value }))}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="platform_llm_edit_notes">Notes</label>
                <textarea
                  className="field"
                  id="platform_llm_edit_notes"
                  rows={3}
                  value={platformLlmEditForm.notes}
                  onChange={(event) => setPlatformLlmEditForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="platform_llm_edit_active">Availability</label>
                <select
                  className="field"
                  id="platform_llm_edit_active"
                  value={String(platformLlmEditForm.is_active)}
                  onChange={(event) =>
                    setPlatformLlmEditForm((current) => ({
                      ...current,
                      is_active: event.target.value === "true",
                    }))
                  }
                >
                  <option value="true">Available in pool</option>
                  <option value="false">Saved but unavailable</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="primary-button"
                  onClick={() => updatePlatformLlmMutation.mutate()}
                  type="button"
                >
                  {updatePlatformLlmMutation.isPending ? "Saving..." : "Update HermanScience LLM"}
                </button>
                <button
                  className="secondary-button secondary-button--danger"
                  onClick={() => deletePlatformLlmMutation.mutate()}
                  type="button"
                >
                  {deletePlatformLlmMutation.isPending ? "Deleting..." : "Delete LLM"}
                </button>
              </div>
              {updatePlatformLlmMutation.isSuccess ? (
                <div className="section-note" style={{ color: "#166534" }}>
                  HermanScience LLM updated in the runtime database target.
                </div>
              ) : null}
              {updatePlatformLlmMutation.isError ? (
                <div className="section-note" style={{ color: "#b91c1c" }}>
                  {updatePlatformLlmMutation.error instanceof Error ? updatePlatformLlmMutation.error.message : "Updating the HermanScience LLM failed."}
                </div>
              ) : null}
              {deletePlatformLlmMutation.isError ? (
                <div className="section-note" style={{ color: "#b91c1c" }}>
                  {deletePlatformLlmMutation.error instanceof Error ? deletePlatformLlmMutation.error.message : "Deleting the HermanScience LLM failed."}
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state table-empty-state">Select an LLM from the pool above to configure it.</div>
          )}
        </div>

      </div>

      <div className="panel stack">
        <div>
          <h3 className="panel-title">Register Prompt UI</h3>
          <div className="muted" style={{ marginTop: 8 }}>
            Save the active Herman Prompt frontend deployment URL used by the admin team.
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="prompt_ui_label">Label</label>
          <input
            className="field"
            id="prompt_ui_label"
            value={promptUiForm.label}
            onChange={(event) => setPromptUiForm((current) => ({ ...current, label: event.target.value }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="prompt_ui_base_url">Base URL</label>
          <input
            className="field"
            id="prompt_ui_base_url"
            placeholder="https://herman-prompt-demo-production-5b99.up.railway.app"
            value={promptUiForm.base_url}
            onChange={(event) => setPromptUiForm((current) => ({ ...current, base_url: event.target.value }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="prompt_ui_notes">Notes</label>
          <textarea
            className="field"
            id="prompt_ui_notes"
            rows={3}
            value={promptUiForm.notes}
            onChange={(event) => setPromptUiForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="prompt_ui_active">Set Active</label>
          <select
            className="field"
            id="prompt_ui_active"
            value={String(promptUiForm.is_active)}
            onChange={(event) =>
              setPromptUiForm((current) => ({
                ...current,
                is_active: event.target.value === "true",
              }))
            }
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>

        <button
          className="primary-button"
          disabled={!promptUiForm.label.trim() || !promptUiForm.base_url.trim()}
          onClick={() => createPromptUiMutation.mutate()}
          type="button"
        >
          Save Prompt UI target
        </button>
      </div>

      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Configured Database Instances</h3>
            <div className="muted">These are saved reference records for operators. The running application still writes through the environment-configured runtime database shown above.</div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Location</th>
                <th>Mode</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{instance.label}</strong>
                      {instance.is_active ? <StatusBadge value="active" /> : null}
                    </div>
                    <div className="muted">{instance.connection_string_masked ?? "No masked connection string saved"}</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {instance.connection_secret_reference ?? "No vault reference saved"}
                    </div>
                  </td>
                  <td>{instance.db_kind}</td>
                  <td>{instance.host ?? instance.database_name ?? "Local"}</td>
                  <td>{instance.managed_via_db_only ? "DB only" : "Mixed"}</td>
                  <td>{formatDateTime(instance.updated_at)}</td>
                  <td>
                    <button
                      className="ghost-button"
                      disabled={instance.is_active}
                      onClick={() => activateMutation.mutate(instance.id)}
                      type="button"
                    >
                      Make active
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Configured Prompt UI Instances</h3>
            <div className="muted">Use this list to keep the admin app pointed at the currently active Herman Prompt frontend deployment.</div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>URL</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {promptUiInstances.map((instance) => (
                <tr key={instance.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{instance.label}</strong>
                      {instance.is_active ? <StatusBadge value="active" /> : null}
                    </div>
                    <div className="muted">{instance.notes ?? "No notes saved"}</div>
                  </td>
                  <td style={{ wordBreak: "break-word" }}>
                    <a href={instance.base_url} rel="noreferrer" target="_blank">{instance.base_url}</a>
                  </td>
                  <td>{formatDateTime(instance.updated_at)}</td>
                  <td>
                    <button
                      className="ghost-button"
                      disabled={instance.is_active}
                      onClick={() => activatePromptUiMutation.mutate(instance.id)}
                      type="button"
                    >
                      Make active
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
