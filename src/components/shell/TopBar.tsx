import { Bell, Building2, ChevronDown } from "lucide-react";

const logoUrl = new URL("../../../docs/herman_admin_demo_with_logo/assets/AI_confident_logo.png", import.meta.url)
  .href;

export function TopBar() {
  return (
    <header className="topbar">
      <div className="logo-wordmark">
        <img src={logoUrl} alt="HermanScience logo" />
        <div className="brand-tagline">CREATING AI-CONFIDENT WORKFORCES</div>
      </div>

      <div className="topbar-spacer" />

      <button className="pill-button" type="button">
        <Building2 size={16} />
        <span style={{ marginInline: 8 }}>Acme Corp (All Tenants)</span>
        <ChevronDown size={14} />
      </button>

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
