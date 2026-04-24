import type { AuthSession } from "./types";

const AUTH_API_BASE_URL = "/api/auth";
const DEV_ADMIN_HEADER =
  typeof import.meta !== "undefined" && import.meta.env.VITE_DEV_ADMIN_USER
    ? String(import.meta.env.VITE_DEV_ADMIN_USER)
    : "";

export class AuthApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(DEV_ADMIN_HEADER ? { "X-Admin-User": DEV_ADMIN_HEADER } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = (await response.text()) || `Request failed with status ${response.status}`;
    throw new AuthApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const authApi = {
  exchangeLaunchToken(launchToken: string) {
    return request<AuthSession>("/launch/exchange", {
      method: "POST",
      body: JSON.stringify({ launch_token: launchToken }),
    });
  },
  getCurrentSession() {
    return request<AuthSession>("/me");
  },
  logout() {
    return request<{ success: boolean }>("/logout", { method: "POST" });
  },
};
