"use client";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

function csrf() {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("atlas_csrf="))?.split("=")[1] ?? "";
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    credentials: "same-origin",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), "x-atlas-csrf": csrf() },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "ERROR", data?.message ?? res.statusText, data?.details);
  return data as T;
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
