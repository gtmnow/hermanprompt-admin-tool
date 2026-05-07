import type { AuthenticatedAdminPrincipal } from "./types";

export function canViewRestrictedAdminScreens(principal: AuthenticatedAdminPrincipal | null | undefined): boolean {
  return principal?.role === "super_admin" || principal?.role === "support_admin";
}
