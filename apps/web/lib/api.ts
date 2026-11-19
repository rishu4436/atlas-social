"use client";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";
import { useSyncExternalStore } from "react";
import { HttpError, resilientJson, onWake, isWaking } from "./resilient-fetch";

/** API error with a stable code. Network/cold-start failures arrive as SERVER_UNAVAILABLE / SERVER_WAKE_TIMEOUT, never raw parse errors. */
export { HttpError as ApiError };
export { WAKING_MESSAGE } from "./resilient-fetch";

/** true while any request is waiting for the free-tier API to wake up (drives the "Waking up ATLAS servers…" banner). */
export function useWaking() {
  return useSyncExternalStore(onWake, isWaking, () => false);
}

function csrf() {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("atlas_csrf="))?.split("=")[1] ?? "";
}

/**
 * `retry`: wait out a sleeping API (backoff, ~75 s). Default: GET only. Opt in only for requests that are safe to repeat
 * (e.g. creating a Connect intent: an unredeemed intent just expires). Pass `retry: false` for polls.
 */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  return resilientJson<T>(`/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    credentials: "same-origin",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), "x-atlas-csrf": csrf() },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }, { retry: init.retry });
}

/** Where to go after any sign-in: profile setup until the account has saved its profile once, otherwise the feed. */
export async function pathAfterSignIn(): Promise<string> {
  try { const s = await api<any>("/auth/session"); return s?.profile?.needsSetup ? "/welcome/profile" : "/home"; } catch { return "/home"; }
}

/** Fire-and-forget warm-up so a sleeping free-tier API starts booting while the user reads the page. */
export function warmUpApi() {
  if (typeof window === "undefined") return;
  fetch("/api/health", { cache: "no-store", credentials: "omit" }).catch(() => {});
}

export const fetcher = (p: string) => api(p);
export function useApi<T = any>(path: string | null, cfg?: SWRConfiguration) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...cfg });
}
export const refresh = (key: string | ((k: string) => boolean)) => globalMutate(typeof key === "string" ? key : (k: any) => typeof k === "string" && (key as any)(k));

export function useSession() {
  const s = useApi<any>("/auth/session", { refreshInterval: 60_000 });
  return { ...s, session: s.data, authed: !!s.data?.authenticated };
}

export const short = (a?: string | null, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "");
export const timeAgo = (d: string | number | Date) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
};
export const fmtPrice = (v: number) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v >= 1 ? v.toFixed(v >= 100 ? 2 : 3) : v.toFixed(5));

/** Live beta: ATLAS registries not yet deployed on the configured chain. On-chain actions are disabled (never faked). */
export function useContractsStatus() {
  const c = useApi<any>("/config");
  return { pending: c.data?.contractsDeployed === false, note: c.data?.contractsNote as string | undefined, chainId: c.data?.chainId as number | undefined };
}
