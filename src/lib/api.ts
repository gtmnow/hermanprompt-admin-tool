import type { ListEnvelope, ResourceEnvelope } from "./types";

const API_BASE_URL = "/api/v1";
const DEV_ADMIN_HEADER =
  typeof import.meta !== "undefined" && import.meta.env.VITE_DEV_ADMIN_USER
    ? String(import.meta.env.VITE_DEV_ADMIN_USER)
    : "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(DEV_ADMIN_HEADER ? { "X-Admin-User": DEV_ADMIN_HEADER } : {}),
    ...(init?.headers ?? {}),
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const rawMessage = await response.text();
    let message = rawMessage;

    try {
      const parsed = JSON.parse(rawMessage) as { detail?: string };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        message = parsed.detail;
      }
    } catch {
      // Fall back to the raw response body when the server did not return JSON.
    }

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  getResource<T>(path: string) {
    return request<ResourceEnvelope<T>>(path);
  },
  getList<T>(path: string) {
    return request<ListEnvelope<T>>(path);
  },
  postResource<T>(path: string, body: unknown) {
    return request<ResourceEnvelope<T>>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  putResource<T>(path: string, body: unknown) {
    return request<ResourceEnvelope<T>>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  patchResource<T>(path: string, body: unknown) {
    return request<ResourceEnvelope<T>>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  deleteResource<T>(path: string) {
    return request<ResourceEnvelope<T>>(path, {
      method: "DELETE",
    });
  },
};
