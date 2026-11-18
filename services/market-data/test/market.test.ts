import { describe, it, expect } from "vitest";
import { SyntheticProvider, BinancePublicProvider, checkCoverage, INTERVAL_MS } from "../src/index.js";

describe("SyntheticProvider", () => {
  it("is deterministic and well-formed", async () => {
    const p = new SyntheticProvider(() => 1_800_000_000_000);
    const a = await p.klines("BNBUSDT", "1h", { limit: 50 });
    const b = await p.klines("BNBUSDT", "1h", { limit: 50 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(50);
    expect(checkCoverage(a, "1h", a[0]!.openTime, a[49]!.closeTime).ok).toBe(true);
    expect(p.simulated).toBe(true);
  });
});

describe("coverage", () => {
  it("flags gaps and stale data", async () => {
    const p = new SyntheticProvider(() => 1_800_000_000_000);
    const c = await p.klines("BNBUSDT", "1h", { limit: 10 });
    const gapped = c.filter((_, i) => i !== 5);
    expect(checkCoverage(gapped, "1h", c[0]!.openTime, c[9]!.closeTime).issues.some((x) => x.startsWith("gap"))).toBe(true);
    expect(checkCoverage(c, "1h", c[0]!.openTime, c[9]!.closeTime + INTERVAL_MS["1h"] * 3).ok).toBe(false);
    expect(checkCoverage([], "1h", 0, 1).ok).toBe(false);
  });
});

describe("BinancePublicProvider", () => {
  it("parses klines and falls back across hosts", async () => {
    let calls = 0;
    const fake = (async (url: string) => {
      calls++;
      if (url.startsWith("https://a")) throw new Error("down");
      return new Response(JSON.stringify([[1, "1", "2", "0.5", "1.5", "10", 3599999, "15", 1, "0", "0", "0"]]));
    }) as unknown as typeof fetch;
    const p = new BinancePublicProvider(["https://a", "https://b"], fake);
    const k = await p.klines("BNBUSDT", "1h");
    expect(k[0]).toMatchObject({ open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(calls).toBe(2);
  });
});
