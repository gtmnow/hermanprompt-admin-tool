import { Shield, BarChart3, Building2, Cog, FileDown, Gauge, Rocket, Server, Tags, Users, UserCog, Layers3, Handshake } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { canViewRestrictedAdminScreens } from "../../lib/adminVisibility";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/orgs", label: "Organizations", icon: Building2 },
  { to: "/activation", label: "Activation", icon: Rocket },
  { to: "/groups", label: "Groups", icon: Layers3 },
  { to: "/users", label: "Users", icon: Users },
  { to: "/admins", label: "Admins", icon: UserCog },
  { to: "/reports", label: "Reporting", icon: BarChart3 },
  { to: "/exports", label: "Exports", icon: FileDown },
  { to: "/resellers", label: "Partners", icon: Handshake, restricted: true },
  { to: "/operations", label: "Operations", icon: Server, restricted: true },
  { to: "/tiers", label: "Service Tiers", icon: Tags, restricted: true },
  { to: "/settings", label: "Settings", icon: Cog, restricted: true },
];

export function SideNav() {
  const { session } = useAuth();
  const canViewRestricted = canViewRestrictedAdminScreens(session?.principal);

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {navItems.filter((item) => !item.restricted || canViewRestricted).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__footer-line">
          <Shield size={12} color="#059669" />
          All systems healthy
        </div>
      </div>
    </aside>
  );
}
