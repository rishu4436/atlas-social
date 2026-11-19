import { describe, it, expect } from "vitest";
import { LiveChainProvider, OkxPublicProvider } from "../src/index.js";

const down = { id: "binance-spot-public", simulated: false, klines: async () => { throw new Error("HTTP 418"); }, ticker24h: async () => { throw new Error("HTTP 418"); } } as any;
const okxFetch = (async (url: string) => new Response(JSON.stringify(url.includes("ticker")
  ? { code: "0", data: [{ instId: "BNB-USDT", last: "110", open24h: "100", high24h: "111", low24h: "99", vol24h: "5", volCcy24h: "550", ts: "1700000000000" }] }
  : { code: "0", data: [["1700003600000", "1", "2", "0.5", "1.5", "10", "15", "15", "1"], ["1700000000000", "1", "2", "0.5", "1", "10", "10", "10", "1"]] }))) as any;

describe("LiveChainProvider", () => {
  it("falls back to another REAL source (never simulated) and reports which one served", async () => {
    const p = new LiveChainProvider([down, new OkxPublicProvider("https://okx.test", okxFetch)]);
    const t = await p.ticker24h("BNBUSDT");
    expect(t.lastPrice).toBe(110);
    expect(t.priceChangePercent).toBeCloseTo(10);
    expect(p.id).toBe("okx-public");
    expect(p.simulated).toBe(false);
    const k = await p.klines("BNBUSDT", "1h", { limit: 2 });
    expect(k.map((c) => c.openTime)).toEqual([1700000000000, 1700003600000]);
  });
  it("throws when every real source fails", async () => {
    await expect(new LiveChainProvider([down, down]).ticker24h("BNBUSDT")).rejects.toThrow(/418/);
  });
});
