import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { LoadingBlock } from "../../components/feedback/LoadingBlock";
import { StatusBadge } from "../../components/status/StatusBadge";
import { tenantApi } from "../../features/tenants/api";

export function ActivationLandingPage() {
  const tenantsQuery = useQuery({
    queryKey: ["activation-tenants"],
    queryFn: () => tenantApi.listTenants(),
  });
  const onboardingQuery = useQuery({
    queryKey: ["activation-onboarding"],
    queryFn: () => tenantApi.listOnboarding(),
  });

  const draftItems = useMemo(() => {
    if (!tenantsQuery.data || !onboardingQuery.data) {
      return [];
    }

    return tenantsQuery.data.items
      .filter((item) => item.tenant.status === "draft" || item.tenant.status === "onboarding")
      .map((item) => ({
        tenant: item,
        onboarding: onboardingQuery.data.items.find((entry) => entry.tenant_id === item.tenant.id),
      }));
  }, [onboardingQuery.data, tenantsQuery.data]);

  if (tenantsQuery.isLoading || onboardingQuery.isLoading) {
    return <LoadingBlock label="Loading activation workspace..." />;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Activation</h1>
          <p className="page-subtitle">
            Start a new organization onboarding workflow or resume in-progress activations already in your portfolio.
          </p>
        </div>
        <Link className="primary-button" to="/activation/new">
          Start activation
        </Link>
      </div>

      <div className="grid grid--two">
        <div className="panel">
          <h3 className="panel-title">Onboarding Summary</h3>
          <div className="checklist" style={{ marginTop: 18 }}>
            <div className="checklist-item">
              <span>Draft organizations</span>
              <StatusBadge value={String(draftItems.filter((item) => item.tenant.tenant.status === "draft").length)} />
            </div>
            <div className="checklist-item">
              <span>In-progress onboardings</span>
              <StatusBadge value={String(draftItems.filter((item) => item.onboarding?.onboarding_status === "in_progress").length)} />
            </div>
            <div className="checklist-item">
              <span>Ready to activate</span>
              <StatusBadge value={String(draftItems.filter((item) => item.onboarding?.onboarding_status === "ready").length)} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Activation Help</h3>
          <div className="stack" style={{ marginTop: 18 }}>
            <div className="section-note">Step through organization info, LLM config, runtime settings, groups, users, and admins before activation.</div>
            <div className="section-note">The review step will block activation until validation, users, and admin assignment are complete.</div>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Tenant status</th>
                <th>Onboarding</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => (
                <tr key={item.tenant.tenant.id}>
                  <td>
                    <strong>{item.tenant.tenant.tenant_name}</strong>
                    <div className="muted">{item.tenant.tenant.tenant_key}</div>
                  </td>
                  <td><StatusBadge value={item.tenant.tenant.status} /></td>
                  <td>
                    <StatusBadge value={item.onboarding?.onboarding_status ?? "draft"} />
                  </td>
                  <td>
                    <Link className="secondary-button activation-action-button" to={`/activation/${item.tenant.tenant.id}`}>
                      Resume
                    </Link>
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
