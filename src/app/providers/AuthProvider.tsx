import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { AuthApiError, authApi } from "../../lib/auth";
import type { AuthSession } from "../../lib/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  errorMessage: string | null;
  loginUrl: string;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const LOGIN_URL =
  typeof import.meta !== "undefined" && import.meta.env.VITE_AUTH_LOGIN_URL
    ? String(import.meta.env.VITE_AUTH_LOGIN_URL)
    : "http://localhost:5174/apps";
const LAUNCH_PARAM_NAME =
  typeof import.meta !== "undefined" && import.meta.env.VITE_AUTH_LAUNCH_PARAM
    ? String(import.meta.env.VITE_AUTH_LAUNCH_PARAM)
    : "launch_token";

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Authentication failed.";
}

async function initializeSession(): Promise<AuthSession | null> {
  const url = new URL(window.location.href);
  const launchToken = url.searchParams.get(LAUNCH_PARAM_NAME);
  if (launchToken) {
    const session = await authApi.exchangeLaunchToken(launchToken);
    url.searchParams.delete(LAUNCH_PARAM_NAME);
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    return session;
  }

  try {
    return await authApi.getCurrentSession();
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshSession = async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const nextSession = await initializeSession();
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    } catch (error) {
      setSession(null);
      setStatus("unauthenticated");
      setErrorMessage(parseErrorMessage(error));
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setSession(null);
      setStatus("unauthenticated");
      window.location.assign(LOGIN_URL);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      errorMessage,
      loginUrl: LOGIN_URL,
      refreshSession,
      logout,
    }),
    [errorMessage, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
