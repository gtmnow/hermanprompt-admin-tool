type LoadTraceDetail = Record<string, unknown>;

type LoadTraceEvent = {
  atMs: number;
  label: string;
  detail?: LoadTraceDetail;
};

declare global {
  interface Window {
    __HERMAN_LOAD_TRACE__?: LoadTraceEvent[];
  }
}

const appStartMs = typeof performance !== "undefined" ? performance.now() : 0;

export function recordLoadTrace(label: string, detail?: LoadTraceDetail) {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return;
  }

  const event: LoadTraceEvent = {
    atMs: Number((performance.now() - appStartMs).toFixed(1)),
    label,
    detail,
  };

  if (!window.__HERMAN_LOAD_TRACE__) {
    window.__HERMAN_LOAD_TRACE__ = [];
  }
  window.__HERMAN_LOAD_TRACE__.push(event);
  console.info(`[load-trace +${event.atMs}ms] ${label}`, detail ?? {});
}
