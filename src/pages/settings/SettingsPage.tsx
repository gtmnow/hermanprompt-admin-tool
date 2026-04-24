import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import { formatDateTime } from "../../lib/format";

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
  endpoint_url: "",
  api_key: "",
  secret_reference: "",
  notes: "",
  is_active: true,
};

type SecretSelection = "local_storage" | "encrypted_vault";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(defaultForm);
  const [promptUiForm, setPromptUiForm] = useState(defaultPromptUiForm);
  const [platformLlmForm, setPlatformLlmForm] = useState(defaultPlatformLlmForm);
  const [platformLlmSecretSelection, setPlatformLlmSecretSelection] = useState<SecretSelection>("local_storage");

  const databaseInstancesQuery = useQuery({
    queryKey: ["database-instances"],
    queryFn: () => tenantApi.listDatabaseInstances(),
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

  const activeInstance = useMemo(
    () => databaseInstancesQuery.data?.items.find((instance) => instance.is_active) ?? null,
    [databaseInstancesQuery.data],
  );
  const activePromptUi = useMemo(
    () => promptUiInstancesQuery.data?.items.find((instance) => instance.is_active) ?? null,
    [promptUiInstancesQuery.data],
  );
  const activePlatformLlms = useMemo(
    () => platformManagedLlmsQuery.data?.items.filter((instance) => instance.is_active) ?? [],
    [platformManagedLlmsQuery.data],
  );

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
  const createPlatformLlmMutation = useMutation({
    mutationFn: () =>
      tenantApi.createPlatformManagedLlm({
        ...platformLlmForm,
        api_key: platformLlmSecretSelection === "local_storage" ? platformLlmForm.api_key || null : null,
        secret_reference: platformLlmSecretSelection === "encrypted_vault" ? platformLlmForm.secret_reference || null : null,
      }),
    onSuccess: () => {
      setPlatformLlmForm(defaultPlatformLlmForm);
      setPlatformLlmSecretSelection("local_storage");
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

  if (databaseInstancesQuery.isLoading || promptUiInstancesQuery.isLoading || secretVaultQuery.isLoading || platformManagedLlmsQuery.isLoading) {
    return <LoadingBlock label="Loading settings..." />;
  }

  const instances = databaseInstancesQuery.data?.items ?? [];
  const promptUiInstances = promptUiInstancesQuery.data?.items ?? [];
  const vaultStatus = secretVaultQuery.data?.resource ?? null;
  const platformManagedLlms = platformManagedLlmsQuery.data?.items ?? [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Configure which database instance this admin tool points at. All admin actions stay DB-only and do not call Herman Prompt or Herman Transform directly.
          </p>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Active Database Target</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Keep local development pointed at a safe local target until we deliberately switch the live DB later.
            </div>
          </div>

          <div className="key-value">
            <div className="muted">Current target</div>
            <div>{activeInstance?.label ?? "No active database configured"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Type</div>
            <div>{activeInstance?.db_kind ?? "Not set"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Host</div>
            <div>{activeInstance?.host ?? "Local / embedded"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Database</div>
            <div>{activeInstance?.database_name ?? "Not set"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Execution mode</div>
            <div>{activeInstance?.managed_via_db_only ? "DB only" : "Mixed integration"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Credential source</div>
            <div>{activeInstance?.secret_source ? activeInstance.secret_source.replace("_", " ") : "none"}</div>
          </div>
          <div className="key-value">
            <div className="muted">Vault reference</div>
            <div style={{ wordBreak: "break-word" }}>{activeInstance?.connection_secret_reference ?? "Not configured"}</div>
          </div>
          <div className="section-note">
            The UI exposes the target database selection and stores it in the admin schema for auditing and later live-environment switching.
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
            <h3 className="panel-title">Platform-Managed LLM Pool</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Maintain the shared HermanScience-managed LLMs that onboarding teams can assign to organizations before those orgs have their own licenses.
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
                    <th>LLM</th>
                    <th>Credential Source</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {platformManagedLlms.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.label}</strong>
                        <div className="muted">{item.provider_type} • {item.model_name}</div>
                      </td>
                      <td>{item.secret_source.replace("_", " ")}</td>
                      <td><StatusBadge value={item.is_active ? "active" : "inactive"} /></td>
                      <td>
                        <button
                          className="secondary-button"
                          onClick={() => togglePlatformLlmMutation.mutate({ configId: item.id, is_active: !item.is_active })}
                          type="button"
                        >
                          {item.is_active ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel stack">
          <div>
            <h3 className="panel-title">Register Database Instance</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              Save the real connection string into the vault and keep only the masked display value plus secret reference in the admin schema.
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
            Save database target
          </button>
        </div>
      </div>

      <div className="grid grid--two">
        <div className="panel stack">
          <div>
            <h3 className="panel-title">Add Platform-Managed LLM</h3>
            <div className="muted" style={{ marginTop: 8 }}>
              These shared entries become the allowed pool when an organization selects platform-managed credentials in onboarding.
            </div>
          </div>

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="platform_llm_label">Label</label>
              <input
                className="field"
                id="platform_llm_label"
                value={platformLlmForm.label}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, label: event.target.value }))}
              />
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
              <label className="field-label" htmlFor="platform_llm_model">Model</label>
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

          <div className="field-row">
            <div>
              <label className="field-label" htmlFor="platform_llm_secret_selection">Secret Selection</label>
              <select
                className="field"
                id="platform_llm_secret_selection"
                value={platformLlmSecretSelection}
                onChange={(event) => setPlatformLlmSecretSelection(event.target.value as SecretSelection)}
              >
                <option value="local_storage">Local Storage</option>
                <option value="encrypted_vault">Encrypted Vault</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="platform_llm_api_key">API Key</label>
              <input
                className="field"
                id="platform_llm_api_key"
                disabled={platformLlmSecretSelection === "encrypted_vault"}
                placeholder={platformLlmSecretSelection === "encrypted_vault" ? "Retrieved from vault" : "Enter managed key"}
                readOnly={platformLlmSecretSelection === "encrypted_vault"}
                type={platformLlmSecretSelection === "local_storage" ? "password" : "text"}
                value={platformLlmForm.api_key}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, api_key: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="platform_llm_secret_reference">Secret Vault</label>
              <input
                className="field"
                id="platform_llm_secret_reference"
                disabled={platformLlmSecretSelection === "local_storage"}
                placeholder={platformLlmSecretSelection === "local_storage" ? "Defined internally" : "Enter vault reference"}
                readOnly={platformLlmSecretSelection === "local_storage"}
                value={platformLlmSecretSelection === "local_storage" ? "Defined internally" : platformLlmForm.secret_reference}
                onChange={(event) => setPlatformLlmForm((current) => ({ ...current, secret_reference: event.target.value }))}
              />
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
            disabled={!platformLlmForm.label.trim() || !platformLlmForm.model_name.trim()}
            onClick={() => createPlatformLlmMutation.mutate()}
            type="button"
          >
            {createPlatformLlmMutation.isPending ? "Saving..." : "Add platform-managed LLM"}
          </button>
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
      </div>

      <div className="panel">
        <div className="split-header">
          <div>
            <h3 className="panel-title">Configured Database Instances</h3>
            <div className="muted">Use this list to verify the active target before we point the tool at the live HermanPrompt database.</div>
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
