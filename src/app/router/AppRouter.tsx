import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../layouts/AppShell";
import { useAuth } from "../providers/AuthProvider";
import { AdminsPage } from "../../pages/admins/AdminsPage";
import { ActivationLandingPage } from "../../pages/activation/ActivationLandingPage";
import { ActivationWizardPage } from "../../pages/activation/ActivationWizardPage";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { ExportsPage } from "../../pages/exports/ExportsPage";
import { GroupsPage } from "../../pages/groups/GroupsPage";
import { OperationsPage } from "../../pages/operations/OperationsPage";
import { OrganizationDetailPage } from "../../pages/organizations/OrganizationDetailPage";
import {
  OrganizationAdminsTab,
  OrganizationGroupsTab,
  OrganizationLlmConfigTab,
  OrganizationOnboardingTab,
  OrganizationPortalTab,
  OrganizationRuntimeTab,
  OrganizationUsersTab,
} from "../../pages/organizations/OrganizationTabs";
import { OrganizationsPage } from "../../pages/organizations/OrganizationsPage";
import { ReportsPage } from "../../pages/reports/ReportsPage";
import { ResellersPage } from "../../pages/resellers/ResellersPage";
import { ServiceTiersPage } from "../../pages/settings/ServiceTiersPage";
import { SettingsPage } from "../../pages/settings/SettingsPage";
import { UsersPage } from "../../pages/users/UsersPage";

function AuthLoadingScreen() {
  return (
    <div className="page-wrap" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div className="panel stack" style={{ maxWidth: 540 }}>
        <h1 className="page-title">Loading Herman Admin</h1>
        <p className="page-subtitle">
          Validating your Admin session and loading the current authorization context.
        </p>
      </div>
    </div>
  );
}

function UnauthenticatedScreen({ loginUrl, errorMessage }: { loginUrl: string; errorMessage: string | null }) {
  return (
    <div className="page-wrap" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div className="panel stack" style={{ maxWidth: 620 }}>
        <h1 className="page-title">Admin Session Required</h1>
        <p className="page-subtitle">
          Herman Admin now requires a portal-issued Admin launch token and an active Admin session before the app can
          load.
        </p>
        {errorMessage ? <div className="section-note section-note--danger">{errorMessage}</div> : null}
        <div className="dialog-actions">
          <a className="primary-button" href={loginUrl}>
            Return to Herman Portal
          </a>
        </div>
      </div>
    </div>
  );
}

export function AppRouter() {
  const { errorMessage, loginUrl, status } = useAuth();

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status !== "authenticated") {
    return <UnauthenticatedScreen loginUrl={loginUrl} errorMessage={errorMessage} />;
  }

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/activation" element={<ActivationLandingPage />} />
          <Route path="/activation/new" element={<ActivationWizardPage />} />
          <Route path="/activation/:tenantId" element={<ActivationWizardPage />} />
          <Route path="/resellers" element={<ResellersPage />} />
          <Route path="/orgs" element={<OrganizationsPage />} />
          <Route path="/orgs/:tenantId" element={<OrganizationDetailPage />}>
            <Route path="users" element={<OrganizationUsersTab />} />
            <Route path="groups" element={<OrganizationGroupsTab />} />
            <Route path="admins" element={<OrganizationAdminsTab />} />
            <Route path="portal" element={<OrganizationPortalTab />} />
            <Route path="llm-config" element={<OrganizationLlmConfigTab />} />
            <Route path="runtime" element={<OrganizationRuntimeTab />} />
            <Route path="onboarding" element={<OrganizationOnboardingTab />} />
          </Route>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/exports" element={<ExportsPage />} />
          <Route path="/tiers" element={<ServiceTiersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
