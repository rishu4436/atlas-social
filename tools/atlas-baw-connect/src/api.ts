export const DEFAULT_API = "https://atlas-social-api.onrender.com";

/** Only https, or plain http to this machine (local development). */
export function checkApiUrl(raw: string): string {
  const u = new URL(raw);
  const local = u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new Error("--api must be https:// (or http://localhost for development)");
  if (u.username || u.password) throw new Error("--api must not contain credentials");
  return u.toString().replace(/\/$/, "");
}

export class AtlasApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type Api = (path: string, body: unknown) => Promise<any>;

export function makeApi(base: string, fetchImpl: typeof fetch = fetch): Api {
  return async (path, body) => {
    const res = await fetchImpl(`${base}/auth/connect/handoff/${path}`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "atlas-social-connect/1.0.0" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AtlasApiError(res.status, j.error ?? `HTTP_${res.status}`, j.message ?? "ATLAS request failed");
    return j;
  };
}
