import { describe, it, expect, vi } from "vitest";
import { resilientJson, HttpError, onWake, backoffMs } from "../lib/resilient-fetch";

const html = (status: number) => new Response("<!DOCTYPE html><html><body>Service waking</body></html>", { status, headers: { "content-type": "text/html" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("resilientJson (Render cold start)", () => {
  it("retries a GET through HTML / 502 / network errors until JSON arrives, and signals waking", async () => {
    const c = clock();
    const seq = [() => html(200), () => html(502), () => { throw new TypeError("fetch failed"); }, () => json(200, { ok: true })];
    const fetchImpl = vi.fn(async () => seq.shift()!());
    const states: boolean[] = [];
    const off = onWake((w) => states.push(w));
    await expect(resilientJson("/api/health", { method: "GET" }, { fetchImpl: fetchImpl as any, ...c })).resolves.toEqual({ ok: true });
    off();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(states).toEqual([true, false]);
  });

  it("never surfaces a raw JSON parse error; gives up after the ~75 s budget", async () => {
    const c = clock();
    const fetchImpl = vi.fn(async () => html(503));
    const err: any = await resilientJson("/api/markets", {}, { fetchImpl: fetchImpl as any, ...c }).catch((e: any) => e as any);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("SERVER_WAKE_TIMEOUT");
    expect(err.message).not.toMatch(/Unexpected token|JSON/);
    expect(c.now()).toBeLessThanOrEqual(75_000);
    expect(c.now()).toBeGreaterThan(60_000);
  });

  it("does not retry non-idempotent requests unless opted in", async () => {
    const c = clock();
    const fetchImpl = vi.fn(async () => html(503));
    const err: any = await resilientJson("/api/posts", { method: "POST" }, { fetchImpl: fetchImpl as any, ...c }).catch((e: any) => e as any);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(err.code).toBe("SERVER_UNAVAILABLE");
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  it("retries an opted-in POST (Connect intent creation)", async () => {
    const c = clock();
    const seq = [() => html(503), () => json(200, { code: "ATC-X" })];
    const fetchImpl = vi.fn(async () => seq.shift()!());
    await expect(resilientJson("/api/auth/connect/intents", { method: "POST" }, { retry: true, fetchImpl: fetchImpl as any, ...c })).resolves.toEqual({ code: "ATC-X" });
  });

  it("does not retry real API errors (JSON 4xx/500)", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "AUTH_REQUIRED", message: "Sign in" }));
    const err: any = await resilientJson("/api/me", {}, { fetchImpl: fetchImpl as any, ...clock() }).catch((e: any) => e as any);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([err.status, err.code]).toEqual([401, "AUTH_REQUIRED"]);
    const f500 = vi.fn(async () => json(500, { error: "INTERNAL", message: "Something went wrong" }));
    expect(((await resilientJson("/api/x", {}, { fetchImpl: f500 as any, ...clock() }).catch((e: any) => e as any)) as any).code).toBe("INTERNAL");
    expect(f500).toHaveBeenCalledTimes(1);
  });

  it("a JSON 503 from a running API (CONTRACTS_PENDING) is a real error: no retry, no waking banner, its own message", async () => {
    const states: boolean[] = [];
    const off = onWake((w) => states.push(w));
    for (const method of ["POST", "GET"]) {
      const f = vi.fn(async () => json(503, { error: "CONTRACTS_PENDING", message: "ATLAS contracts are pending deployment" }));
      const err: any = await resilientJson("/api/theses/x/prepare", { method }, { fetchImpl: f as any, ...clock() }).catch((e: any) => e);
      expect(f).toHaveBeenCalledTimes(1);
      expect([err.status, err.code, err.message]).toEqual([503, "CONTRACTS_PENDING", "ATLAS contracts are pending deployment"]);
    }
    off();
    expect(states).toEqual([]);
  });

  it("a 502 with a JSON body that is not an ATLAS error (proxy) still counts as waking", async () => {
    const c = clock();
    const seq = [() => json(502, { message: "upstream" }), () => json(200, { ok: 1 })];
    const f = vi.fn(async () => seq.shift()!());
    await expect(resilientJson("/api/health", {}, { fetchImpl: f as any, ...c })).resolves.toEqual({ ok: 1 });
  });

  it("backs off 1s, 2s, 4s, then 6s steps", () => {
    expect([0, 1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 6000, 6000]);
  });
});
