import { Bell, Building2, ChevronDown } from "lucide-react";

import { useAuth } from "../../app/providers/AuthProvider";
import { useOrganizationScope } from "../../app/providers/OrganizationScopeProvider";
import logoUrl from "../../assets/AI_confident_logo.png";
import { titleCase } from "../../lib/format";

function initialsFor(displayName: string | null | undefined, fallback: string) {
  const source = displayName?.trim() || fallback.trim() || "Admin User";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function TopBar() {
  const { logout, session } = useAuth();
  const { hasMultipleVisibleTenants, isLoading, selectedTenantId, visibleTenants, setSelectedTenantId } =
    useOrganizationScope();
  const profile = session?.principal.profile;
  const displayName = profile?.display_name || session?.principal.user_id_hash || "Admin User";
  const email = profile?.email || session?.principal.user_id_hash || "Authenticated Admin";
  const roleLabel = titleCase(session?.principal.role || "admin");
  const selectedLabel = isLoading
    ? "Loading organizations..."
    : hasMultipleVisibleTenants
      ? selectedTenantId
        ? visibleTenants.find((tenant) => tenant.tenant.id === selectedTenantId)?.tenant.tenant_name ?? "Select organization"
        : "All organizations"
      : visibleTenants[0]?.tenant.tenant_name ?? "All organizations";

  return (
    <header className="topbar">
      <div className="logo-wordmark">
        <img src={logoUrl} alt="HermanScience logo" />
      </div>

      <div className="topbar-spacer" />

      <label className="topbar-scope-picker" htmlFor="tenant_scope_picker">
        <Building2 size={18} />
        <div className="topbar-scope-picker__value">{selectedLabel}</div>
        <ChevronDown size={16} className="topbar-scope-picker__chevron" />
        <select
          id="tenant_scope_picker"
          className="topbar-scope-picker__native"
          disabled={isLoading || visibleTenants.length === 0}
          value={selectedTenantId ?? "all"}
          onChange={(event) => setSelectedTenantId(event.target.value === "all" ? null : event.target.value)}
        >
          {hasMultipleVisibleTenants ? <option value="all">All organizations</option> : null}
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
          <div style={{ fontWeight: 700, color: "var(--text-strong)" }}>{displayName}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {roleLabel} • {email}
          </div>
        </div>
        <button className="ghost-button" type="button" onClick={() => void logout()}>
          Sign out
        </button>
        <div className="user-chip__avatar">{initialsFor(profile?.display_name, session?.principal.user_id_hash ?? "AU")}</div>
      </div>
    </header>
  );
}
