import type { CqiPreviewRequest, CqiPreviewResponse } from "./types";

const DEFAULT_BASE_URL = "/air-table-import";

const BASE_URL = (() => {
  const configured =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_AIRTABLE_IMPORT_BASE_URL
      ? String(import.meta.env.VITE_AIRTABLE_IMPORT_BASE_URL)
      : "";
  return configured ? configured : DEFAULT_BASE_URL;
})();

const ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/api/v1/cqi/preview`;

export async function fetchCqiProfilePreview(payload: CqiPreviewRequest): Promise<CqiPreviewResponse> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as CqiPreviewResponse;
}
