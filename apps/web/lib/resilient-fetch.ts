/**
 * Cold-start-safe JSON fetch for the ATLAS API (free-tier Render sleeps; while it wakes, the proxy can answer with
 * an HTML error page or a 502/503/504). Pure module: no React, unit-tested in test/resilient-fetch.test.ts.
 *
 * - Retryable: network errors, any non-JSON body (HTML error page), and 502/503/504 without an ATLAS error body.
 *   Any JSON `{ error, message }` from the API is a real answer (incl. 503 CONTRACTS_PENDING) and is shown as-is.
 * - Only idempotent requests (GET/HEAD) or callers that opt in (`retry: true`, e.g. creating a Connect intent, which
 *   is safe because an unredeemed intent just expires) are retried, with backoff, for up to ~75 s.
 * - Callers never see a raw JSON parse error.
 */
export const WAKE_BUDGET_MS = 75_000;
export const WAKING_MESSAGE = "Waking up ATLAS servers… (up to a minute)";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export type WakeListener = (waking: boolean) => void;
const listeners = new Set<WakeListener>();
let waking = false;
let active = 0; // requests currently waiting for the API to wake
export const isWaking = () => waking;
export function onWake(l: WakeListener) { listeners.add(l); return () => { listeners.delete(l); }; }
function publish() { const v = active > 0; if (waking !== v) { waking = v; listeners.forEach((l) => l(v)); } }

export interface ResilientOptions {
  retry?: boolean;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Outcome = { kind: "ok"; status: number; data: unknown } | { kind: "error"; status: number; data: any } | { kind: "retry"; status: number; reason: string };

async function classify(res: Response): Promise<Outcome> {
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  let json = true;
  if (text) { try { data = JSON.parse(text); } catch { json = false; } }
  // A JSON body with an ATLAS error code is a real answer from a running API (e.g. 503 CONTRACTS_PENDING): never a cold start.
  const apiAnswer = json && !!data && typeof data === "object" && typeof (data as any).error === "string";
  if (apiAnswer) return res.ok ? { kind: "ok", status: res.status, data } : { kind: "error", status: res.status, data };
  if (res.status === 502 || res.status === 503 || res.status === 504) return { kind: "retry", status: res.status, reason: `HTTP ${res.status}` };
  if (!json) return { kind: "retry", status: res.status, reason: "non-JSON response" };
  return res.ok ? { kind: "ok", status: res.status, data } : { kind: "error", status: res.status, data };
}

export const backoffMs = (attempt: number) => Math.min(6_000, 1_000 * 2 ** attempt);

export async function resilientJson<T = unknown>(url: string, init: RequestInit, opt: ResilientOptions = {}): Promise<T> {
  const f = opt.fetchImpl ?? fetch;
  const sleep = opt.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opt.now ?? Date.now;
  const method = (init.method ?? "GET").toUpperCase();
  const retryable = opt.retry ?? (method === "GET" || method === "HEAD");
  const deadline = now() + (opt.budgetMs ?? WAKE_BUDGET_MS);
  let attempt = 0;
  let counted = false;
  try {
    for (;;) {
      let out: Outcome;
      try { out = await classify(await f(url, init)); }
      catch { out = { kind: "retry", status: 0, reason: "network error" }; }
      if (out.kind === "ok") return out.data as T;
      if (out.kind === "error") {
        const d = out.data ?? {};
        throw new HttpError(out.status, d.error ?? "ERROR", d.message ?? `Request failed (${out.status})`, d.details);
      }
      if (!retryable) throw new HttpError(503, "SERVER_UNAVAILABLE", "ATLAS servers are waking up or briefly unavailable. Try again in a moment.", { reason: out.reason });
      const wait = backoffMs(attempt++);
      if (now() + wait > deadline) throw new HttpError(503, "SERVER_WAKE_TIMEOUT", "ATLAS servers are taking longer than usual to wake up. Try again in a minute.", { reason: out.reason });
      if (!counted) { counted = true; active++; publish(); }
      await sleep(wait);
    }
  } finally { if (counted) { active--; publish(); } }
}
