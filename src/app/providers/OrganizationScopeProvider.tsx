import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

import { useQuery } from "@tanstack/react-query";

import { tenantApi } from "../../features/tenants/api";
import type { TenantSummary } from "../../lib/types";
import { useAuth } from "./AuthProvider";

type OrganizationScopeContextValue = {
  visibleTenants: TenantSummary[];
  selectedTenantId: string | null;
  selectedTenant: TenantSummary | null;
  hasMultipleVisibleTenants: boolean;
  isLoading: boolean;
  setSelectedTenantId: (tenantId: string | null) => void;
};

const OrganizationScopeContext = createContext<OrganizationScopeContextValue | null>(null);

export function OrganizationScopeProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const canReadTenants = session?.principal.permissions.includes("tenants.read") ?? false;

  const tenantsQuery = useQuery({
    queryKey: ["visible-tenants"],
    queryFn: () => tenantApi.listTenants(),
    enabled: canReadTenants,
  });

  const visibleTenants = tenantsQuery.data?.items ?? [];
  const hasMultipleVisibleTenants = visibleTenants.length > 1;
  const selectedTenant = visibleTenants.find((tenant) => tenant.tenant.id === selectedTenantId) ?? null;

  useEffect(() => {
    if (tenantsQuery.isLoading) {
      return;
    }

    if (visibleTenants.length === 0) {
      setSelectedTenantId(null);
      return;
    }

    if (visibleTenants.length === 1) {
      const onlyTenantId = visibleTenants[0]?.tenant.id ?? null;
      setSelectedTenantId((current) => (current === onlyTenantId ? current : onlyTenantId));
      return;
    }

    setSelectedTenantId((current) => {
      if (current && visibleTenants.some((tenant) => tenant.tenant.id === current)) {
        return current;
      }
      return null;
    });
  }, [tenantsQuery.isLoading, visibleTenants]);

  return (
    <OrganizationScopeContext.Provider
      value={{
        visibleTenants,
        selectedTenantId,
        selectedTenant,
        hasMultipleVisibleTenants,
        isLoading: tenantsQuery.isLoading,
        setSelectedTenantId,
      }}
    >
      {children}
    </OrganizationScopeContext.Provider>
  );
}

export function useOrganizationScope() {
  const context = useContext(OrganizationScopeContext);

  if (!context) {
    throw new Error("useOrganizationScope must be used within an OrganizationScopeProvider");
  }

  return context;
}
