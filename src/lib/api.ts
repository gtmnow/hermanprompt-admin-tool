import type { ListEnvelope, ResourceEnvelope } from "./types";

const API_BASE_URL = "/api/v1";
const DEV_ADMIN_HEADER = "local-dev-admin";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-User": DEV_ADMIN_HEADER,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
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
};
