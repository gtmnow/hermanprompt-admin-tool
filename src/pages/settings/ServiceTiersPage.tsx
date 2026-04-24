import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";
import type { ServiceTierScope } from "../../lib/types";
import { formatDateTime } from "../../lib/format";

const emptyTierForm = {
  scope_type: "organization" as ServiceTierScope,
  tier_key: "",
  tier_name: "",
  description: "",
  max_users: "",
  has_unlimited_users: false,
  max_organizations: "",
  monthly_admin_fee: "",
  per_active_user_fee: "",
  additional_usage_fee: "",
  cqi_assessment: "",
  billing_notes: "",
  is_active: true,
  sort_order: "0",
};

function mutationMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while saving this change.";
}

function toPayload(form: typeof emptyTierForm) {
  return {
    scope_type: form.scope_type,
    tier_key: form.tier_key.trim(),
    tier_name: form.tier_name.trim(),
    description: form.description.trim() || null,
    max_users: form.has_unlimited_users || !form.max_users ? null : Number(form.max_users),
    has_unlimited_users: form.has_unlimited_users,
    max_organizations: form.scope_type === "reseller" && form.max_organizations ? Number(form.max_organizations) : null,
    monthly_admin_fee: form.monthly_admin_fee ? Number(form.monthly_admin_fee) : null,
    per_active_user_fee: form.per_active_user_fee ? Number(form.per_active_user_fee) : null,
    additional_usage_fee: form.additional_usage_fee.trim() || null,
    cqi_assessment: form.cqi_assessment ? Number(form.cqi_assessment) : null,
    billing_notes: form.billing_notes.trim() || null,
    is_active: form.is_active,
    sort_order: Number(form.sort_order || 0),
  };
}

export function ServiceTiersPage() {
  const queryClient = useQueryClient();
  const [selectedTierId, setSelectedTierId] = useState("");
  const [form, setForm] = useState(emptyTierForm);

  const serviceTiersQuery = useQuery({
    queryKey: ["service-tiers", "all"],
    queryFn: () => tenantApi.listServiceTiers({ include_inactive: true }),
  });

  const selectedTier = useMemo(
    () => serviceTiersQuery.data?.items.find((item) => item.id === selectedTierId) ?? null,
    [selectedTierId, serviceTiersQuery.data],
  );

  useEffect(() => {
    if (!selectedTier) {
      setForm(emptyTierForm);
      return;
    }
    setForm({
      scope_type: selectedTier.scope_type,
      tier_key: selectedTier.tier_key,
      tier_name: selectedTier.tier_name,
      description: selectedTier.description ?? "",
      max_users: selectedTier.max_users ? String(selectedTier.max_users) : "",
      has_unlimited_users: selectedTier.has_unlimited_users,
      max_organizations: selectedTier.max_organizations ? String(selectedTier.max_organizations) : "",
      monthly_admin_fee: selectedTier.monthly_admin_fee != null ? String(selectedTier.monthly_admin_fee) : "",
      per_active_user_fee: selectedTier.per_active_user_fee != null ? String(selectedTier.per_active_user_fee) : "",
      additional_usage_fee: selectedTier.additional_usage_fee ?? "",
      cqi_assessment: selectedTier.cqi_assessment != null ? String(selectedTier.cqi_assessment) : "",
      billing_notes: selectedTier.billing_notes ?? "",
      is_active: selectedTier.is_active,
      sort_order: String(selectedTier.sort_order),
    });
  }, [selectedTier]);

  const saveTierMutation = useMutation({
    mutationFn: () => {
      const payload = toPayload(form);
      if (selectedTierId) {
        return tenantApi.updateServiceTier(selectedTierId, payload);
      }
      return tenantApi.createServiceTier(payload);
    },
    onSuccess: async (result) => {
      setSelectedTierId(result.resource.id);
      await queryClient.invalidateQueries({ queryKey: ["service-tiers"] });
    },
  });

  const deleteTierMutation = useMutation({
    mutationFn: () => {
      if (!selectedTierId) {
        throw new Error("Select a tier first.");
      }
      return tenantApi.deleteServiceTier(selectedTierId);
    },
    onSuccess: async () => {
      setSelectedTierId("");
      setForm(emptyTierForm);
      await queryClient.invalidateQueries({ queryKey: ["service-tiers"] });
    },
  });

  if (serviceTiersQuery.isLoading) {
    return <LoadingBlock label="Loading service tiers..." />;
  }

  const tiers = serviceTiersQuery.data?.items ?? [];
  const organizationTiers = tiers.filter((item) => item.scope_type === "organization");
  const resellerTiers = tiers.filter((item) => item.scope_type === "reseller");

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Service Tiers</h1>
          <p className="page-subtitle">
            Manage the organization and reseller tier catalog that controls provisioning limits and commercial defaults.
          </p>
        </div>
      </div>

      {(saveTierMutation.error || deleteTierMutation.error) ? (
        <div className="section-note section-note--danger">
          {mutationMessage(saveTierMutation.error ?? deleteTierMutation.error)}
        </div>
      ) : null}

      <div className="grid grid--two">
        <div className="panel stack">
          <div className="split-header">
            <div>
              <h3 className="panel-title">{selectedTier ? "Edit Tier" : "Create Tier"}</h3>
              <div className="muted">This catalog is super-admin managed and powers tier assignment everywhere else in the app.</div>
            </div>
            {selectedTier ? <StatusBadge value={selectedTier.is_active ? "active" : "inactive"} /> : null}
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="scope_type">Scope</label>
              <select
                className="field"
                id="scope_type"
                value={form.scope_type}
                onChange={(event) => setForm((current) => ({ ...current, scope_type: event.target.value as ServiceTierScope }))}
              >
                <option value="organization">Organization</option>
                <option value="reseller">Reseller</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="tier_key">Tier Key</label>
              <input className="field" id="tier_key" value={form.tier_key} onChange={(event) => setForm((current) => ({ ...current, tier_key: event.target.value }))} />
            </div>
            <div>
              <label className="field-label" htmlFor="tier_name">Tier Name</label>
              <input className="field" id="tier_name" value={form.tier_name} onChange={(event) => setForm((current) => ({ ...current, tier_name: event.target.value }))} />
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="max_users">Max Users</label>
              <input
                className="field"
                disabled={form.has_unlimited_users}
                id="max_users"
                type="number"
                value={form.max_users}
                onChange={(event) => setForm((current) => ({ ...current, max_users: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="has_unlimited_users">User Limit Mode</label>
              <select
                className="field"
                id="has_unlimited_users"
                value={String(form.has_unlimited_users)}
                onChange={(event) => setForm((current) => ({ ...current, has_unlimited_users: event.target.value === "true" }))}
              >
                <option value="false">Limited</option>
                <option value="true">Unlimited</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="max_organizations">Max Organizations</label>
              <input
                className="field"
                disabled={form.scope_type !== "reseller"}
                id="max_organizations"
                type="number"
                value={form.max_organizations}
                onChange={(event) => setForm((current) => ({ ...current, max_organizations: event.target.value }))}
              />
            </div>
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="monthly_admin_fee">Monthly Admin Fee</label>
              <input className="field" id="monthly_admin_fee" type="number" step="0.01" value={form.monthly_admin_fee} onChange={(event) => setForm((current) => ({ ...current, monthly_admin_fee: event.target.value }))} />
            </div>
            <div>
              <label className="field-label" htmlFor="per_active_user_fee">Per Active User Fee</label>
              <input className="field" id="per_active_user_fee" type="number" step="0.01" value={form.per_active_user_fee} onChange={(event) => setForm((current) => ({ ...current, per_active_user_fee: event.target.value }))} />
            </div>
            <div>
              <label className="field-label" htmlFor="cqi_assessment">CQI Assessment</label>
              <input className="field" id="cqi_assessment" type="number" value={form.cqi_assessment} onChange={(event) => setForm((current) => ({ ...current, cqi_assessment: event.target.value }))} />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="additional_usage_fee">Additional Usage Fee</label>
            <input className="field" id="additional_usage_fee" value={form.additional_usage_fee} onChange={(event) => setForm((current) => ({ ...current, additional_usage_fee: event.target.value }))} />
          </div>

          <div>
            <label className="field-label" htmlFor="description">Description</label>
            <textarea className="field" id="description" rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </div>

          <div>
            <label className="field-label" htmlFor="billing_notes">Billing Notes</label>
            <textarea className="field" id="billing_notes" rows={3} value={form.billing_notes} onChange={(event) => setForm((current) => ({ ...current, billing_notes: event.target.value }))} />
          </div>

          <div className="field-row field-row--three">
            <div>
              <label className="field-label" htmlFor="is_active">Status</label>
              <select className="field" id="is_active" value={String(form.is_active)} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="sort_order">Sort Order</label>
              <input className="field" id="sort_order" type="number" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button className="primary-button" onClick={() => saveTierMutation.mutate()} type="button">
              {saveTierMutation.isPending ? "Saving..." : selectedTier ? "Save tier" : "Create tier"}
            </button>
            {selectedTier ? (
              <>
                <button className="ghost-button" onClick={() => { setSelectedTierId(""); setForm(emptyTierForm); }} type="button">
                  New tier
                </button>
                <button className="ghost-button" onClick={() => deleteTierMutation.mutate()} type="button">
                  {deleteTierMutation.isPending ? "Removing..." : "Remove tier"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="stack">
          <div className="panel stack">
            <div>
              <h3 className="panel-title">Organization Tiers</h3>
              <div className="muted">These tiers govern the user limits available to customer organizations.</div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Users</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {organizationTiers.map((tier) => (
                    <tr key={tier.id} onClick={() => setSelectedTierId(tier.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <strong>{tier.tier_name}</strong>
                        <div className="muted">{tier.tier_key}</div>
                      </td>
                      <td>{tier.has_unlimited_users ? "Unlimited" : tier.max_users ?? "Not set"}</td>
                      <td><StatusBadge value={tier.is_active ? "active" : "inactive"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel stack">
            <div>
              <h3 className="panel-title">Reseller Tiers</h3>
              <div className="muted">These tiers govern reseller portfolio capacity and optional organization-count caps.</div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Capacity</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {resellerTiers.map((tier) => (
                    <tr key={tier.id} onClick={() => setSelectedTierId(tier.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <strong>{tier.tier_name}</strong>
                        <div className="muted">{tier.max_organizations ? `${tier.max_organizations} orgs max` : "Org count not capped"}</div>
                      </td>
                      <td>{tier.has_unlimited_users ? "Unlimited users" : `${tier.max_users ?? 0} allocated users`}</td>
                      <td>{formatDateTime(tier.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
