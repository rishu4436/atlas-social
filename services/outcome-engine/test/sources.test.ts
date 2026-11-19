import { describe, it, expect } from "vitest";
import { evaluateWithSources, verifyEvidence } from "../src/index.js";
import { Comparator, Direction, EntryKind, OutcomeKind, toPrice8, METHODOLOGY_M1_HASH, METHODOLOGY_M1_1_HASH, type ThesisTerms } from "@atlas/shared-types";
import type { Candle, MarketDataProvider } from "@atlas/market-data";

const H = 3600;
const START = 1_800_000_000 - (1_800_000_000 % H);
const mk = (i: number, o: number, h: number, l: number, c: number): Candle => ({ openTime: (START + i * H) * 1000, closeTime: (START + (i + 1) * H) * 1000 - 1, open: o, high: h, low: l, close: c, volume: 1, quoteVolume: 1 });
const candles = () => { const c = Array.from({ length: 10 }, (_, i) => mk(i, 100, 101, 99, 100)); c[3] = mk(3, 100, 111, 99, 109); return c; };
const terms = (methodologyHash = METHODOLOGY_M1_1_HASH): ThesisTerms => ({
  baseAsset: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", quoteAsset: "0x55d398326f99059fF775485246999027B3197955",
  direction: Direction.Long, entry: { kind: EntryKind.Market, price: 0n },
  target: { comparator: Comparator.GTE, price: toPrice8("110") }, invalidation: { comparator: Comparator.LTE, price: toPrice8("95") },
  evaluationDeadline: BigInt(START + 10 * H), methodologyHash, contentHash: METHODOLOGY_M1_HASH,
});
const src = (id: string, ok: boolean | string, simulated = false): MarketDataProvider => ({
  id, simulated,
  klines: async () => { if (ok !== true) throw new Error(typeof ok === "string" ? ok : "HTTP 418"); return candles(); },
  ticker24h: async () => { throw new Error("unused"); },
});
const args = (m?: string, now = START + 20 * H) => ({ terms: terms(m), startTime: START, symbol: "BNBUSDT", now });

describe("evaluateWithSources (real-source fallback for outcome scoring)", () => {
  it("Binance first: scores from Binance and records the attempt", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", true), src("okx-public", true)], args());
    expect(e.scorable).toBe(true);
    expect(e.outcome).toBe(OutcomeKind.TargetHit);
    expect(e.evidence.source).toBe("binance-spot-public");
    expect(e.evidence.sourceAttempts).toEqual([{ source: "binance-spot-public", ok: true }]);
    expect(e.evidence.methodology.id).toBe("ATLAS-M1.1");
    expect(verifyEvidence(e.evidence, e.evidenceHash)).toBe(true);
  });
  it("falls back to OKX for the WHOLE window when Binance refuses, and records both attempts", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", false), src("okx-public", true)], args());
    expect(e.evidence.source).toBe("okx-public");
    expect(e.evidence.simulated).toBe(false);
    expect(e.evidence.sourceAttempts).toEqual([{ source: "binance-spot-public", ok: false, error: "HTTP 418" }, { source: "okx-public", ok: true }]);
    expect(e.outcome).toBe(OutcomeKind.TargetHit);
  });
  it("never uses a simulated provider, even if it is the only one that answers", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", false), { ...src("okx-public", true, true) }], args());
    expect(e.scorable).toBe(false);
    expect(e.evidence.simulated).toBe(false);
  });
  it("theses committed to ATLAS-M1 stay Binance-only (the committed rules are honoured)", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", false), src("okx-public", true)], args(METHODOLOGY_M1_HASH));
    expect(e.scorable).toBe(false);
    expect(e.attempts.map((a) => a.source)).toEqual(["binance-spot-public"]);
  });
  it("unlisted market (e.g. CAKE on OKX + Binance refused): unscorable with the reason; OPEN before the deadline", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", false), src("okx-public", "okx error 51001 Instrument ID doesn't exist")], args(undefined, START + 5 * H));
    expect(e.scorable).toBe(false);
    expect(e.status).toBe("OPEN");
    expect(e.reason).toMatch(/okx-public: okx error 51001/);
  });
  it("…and UNRESOLVED after the deadline, with the reason and attempts in hash-verifiable evidence", async () => {
    const e = await evaluateWithSources([src("binance-spot-public", false), src("okx-public", "okx error 51001")], args());
    expect(e.outcome).toBe(OutcomeKind.Unresolved);
    expect(e.evidence.unscorable).toMatch(/No allowed real price source/);
    expect(e.evidence.candles).toEqual([]);
    expect(e.evidence.source).toBe("none");
    expect(verifyEvidence(e.evidence, e.evidenceHash)).toBe(true);
  });
});
