import { Shield, BarChart3, Building2, Cog, FileDown, Gauge, Rocket, Server, Tags, Users, UserCog, Layers3, Handshake } from "lucide-react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/activation", label: "Activation", icon: Rocket },
  { to: "/resellers", label: "Resellers", icon: Handshake },
  { to: "/orgs", label: "Organizations", icon: Building2 },
  { to: "/users", label: "Users", icon: Users },
  { to: "/groups", label: "Groups", icon: Layers3 },
  { to: "/admins", label: "Admins", icon: UserCog },
  { to: "/reports", label: "Reporting", icon: BarChart3 },
  { to: "/operations", label: "Operations", icon: Server },
  { to: "/exports", label: "Exports", icon: FileDown },
  { to: "/tiers", label: "Service Tiers", icon: Tags },
  { to: "/settings", label: "Settings", icon: Cog },
];

export function SideNav() {
  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {navItems.map((item) => {
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
