import { Bell, Building2, ChevronDown } from "lucide-react";

import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";

const logoUrl = new URL("../../../docs/herman_admin_demo_with_logo/assets/AI_confident_logo.png", import.meta.url)
  .href;

export function TopBar() {
  const { hasMultipleVisibleTenants, isLoading, selectedTenantId, visibleTenants, setSelectedTenantId } =
    useOrganizationScope();
  const selectedLabel = hasMultipleVisibleTenants
    ? selectedTenantId
      ? visibleTenants.find((tenant) => tenant.tenant.id === selectedTenantId)?.tenant.tenant_name ?? "Select organization"
      : "All orgs"
    : visibleTenants[0]?.tenant.tenant_name ?? "No organizations";

  return (
    <header className="topbar">
      <div className="logo-wordmark">
        <img src={logoUrl} alt="HermanScience logo" />
        <div className="brand-tagline">CREATING AI-CONFIDENT WORKFORCES</div>
      </div>

      <div className="topbar-spacer" />

      <label className="topbar-scope-picker" htmlFor="tenant_scope_picker">
        <Building2 size={22} />
        <div className="topbar-scope-picker__value">{selectedLabel}</div>
        <ChevronDown size={20} className="topbar-scope-picker__chevron" />
        <select
          id="tenant_scope_picker"
          className="topbar-scope-picker__native"
          disabled={isLoading || visibleTenants.length === 0}
          value={selectedTenantId ?? "all"}
          onChange={(event) => setSelectedTenantId(event.target.value === "all" ? null : event.target.value)}
        >
          {hasMultipleVisibleTenants ? <option value="all">All orgs</option> : null}
          {visibleTenants.map((tenant) => (
            <option key={tenant.tenant.id} value={tenant.tenant.id}>
              {tenant.tenant.tenant_name}
            </option>
          ))}
        </select>
      </label>

      <button className="ghost-button" type="button" aria-label="Notifications">
        <Bell size={18} />
      </button>

      <div className="user-chip">
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, color: "var(--text-strong)" }}>Michael Anderson</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Super Admin • HermanScience
          </div>
        </div>
        <div className="user-chip__avatar">MA</div>
      </div>
    </header>
  );
}
