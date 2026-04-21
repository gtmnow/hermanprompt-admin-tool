import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../layouts/AppShell";
import { ActivationLandingPage } from "../../pages/activation/ActivationLandingPage";
import { ActivationWizardPage } from "../../pages/activation/ActivationWizardPage";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { GroupsPage } from "../../pages/groups/GroupsPage";
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
import { SettingsPage } from "../../pages/settings/SettingsPage";
import { UsersPage } from "../../pages/users/UsersPage";

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="panel">
      <h1 className="page-title" style={{ fontSize: 28 }}>
        {title}
      </h1>
      <p className="page-subtitle">This section is queued after the initial app shell and core organization workflow screens.</p>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/activation" element={<ActivationLandingPage />} />
          <Route path="/activation/new" element={<ActivationWizardPage />} />
          <Route path="/activation/:tenantId" element={<ActivationWizardPage />} />
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
          <Route path="/admins" element={<PlaceholderPage title="Admins" />} />
          <Route path="/reports" element={<PlaceholderPage title="Reporting" />} />
          <Route path="/operations" element={<PlaceholderPage title="Operations" />} />
          <Route path="/exports" element={<PlaceholderPage title="Exports" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
