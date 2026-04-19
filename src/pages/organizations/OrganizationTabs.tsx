import { useOutletContext } from "react-router-dom";

import { StatusBadge } from "../../components/status/StatusBadge";
import { formatDateTime, titleCase } from "../../lib/format";
import type { AdminUser, Group, ReportSummary, TenantOnboarding, TenantSummary, UserMembership } from "../../lib/types";

type DetailOutletContext = {
  tenant: TenantSummary;
  users: UserMembership[];
  groups: Group[];
  admins: AdminUser[];
  onboarding: TenantOnboarding | undefined;
  report: ReportSummary | undefined;
};

function useDetailContext() {
  return useOutletContext<DetailOutletContext>();
}

export function OrganizationUsersTab() {
  const { users } = useDetailContext();
  return (
    <div className="panel">
      <h3 className="panel-title">Users</h3>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Groups</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.user_id_hash}</td>
                <td><StatusBadge value={user.status} /></td>
                <td>{user.group_memberships.length}</td>
                <td>{formatDateTime(user.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrganizationGroupsTab() {
  const { groups } = useDetailContext();
  return (
    <div className="panel">
      <h3 className="panel-title">Groups</h3>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>{group.group_name}</td>
                <td>{group.group_type ?? "General"}</td>
                <td><StatusBadge value={group.is_active ? "active" : "inactive"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrganizationAdminsTab() {
  const { admins } = useDetailContext();
  return (
    <div className="panel">
      <h3 className="panel-title">Admins</h3>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Admin</th>
              <th>Role</th>
              <th>Scope</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.id}>
                <td>{admin.user_id_hash}</td>
                <td>{titleCase(admin.role)}</td>
                <td>{admin.scopes.map((scope) => titleCase(scope.scope_type)).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrganizationLlmConfigTab() {
  const { tenant } = useDetailContext();
  return (
    <div className="panel stack">
      <div>
        <h3 className="panel-title">LLM Configuration</h3>
        <div className="muted">This mirrors the mockup panel with masked credentials and validation status.</div>
      </div>
      <div className="key-value">
        <div className="muted">Provider</div>
        <div>{tenant.llm_config?.provider_type ?? "Not configured"}</div>
      </div>
      <div className="key-value">
        <div className="muted">Model</div>
        <div>{tenant.llm_config?.model_name ?? "Not configured"}</div>
      </div>
      <div className="key-value">
        <div className="muted">API key</div>
        <div>{tenant.llm_config?.api_key_masked ?? "Not configured"}</div>
      </div>
      <div className="key-value">
        <div className="muted">Status</div>
        <div>
          {tenant.llm_config ? <StatusBadge value={tenant.llm_config.credential_status} /> : "No config saved"}
        </div>
      </div>
      <div className="key-value">
        <div className="muted">Last validation</div>
        <div>{tenant.llm_config?.last_validation_message ?? "Validation pending"}</div>
      </div>
    </div>
  );
}

export function OrganizationOnboardingTab() {
  const { onboarding } = useDetailContext();
  return (
    <div className="panel">
      <div className="split-header">
        <div>
          <h3 className="panel-title">Onboarding</h3>
          <div className="muted">Checklist and activation readiness</div>
        </div>
        {onboarding ? <StatusBadge value={onboarding.onboarding_status} /> : null}
      </div>
      <div className="checklist">
        {[
          ["Organization created", onboarding?.tenant_created],
          ["LLM configured", onboarding?.llm_configured],
          ["LLM validated", onboarding?.llm_validated],
          ["Groups created", onboarding?.groups_created],
          ["Users uploaded", onboarding?.users_uploaded],
          ["Admin assigned", onboarding?.admin_assigned],
        ].map(([label, value]) => (
          <div className="checklist-item" key={String(label)}>
            <span>{label}</span>
            <StatusBadge value={value ? "ready" : "draft"} />
          </div>
        ))}
      </div>
    </div>
  );
}
