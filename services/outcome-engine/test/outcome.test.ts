import { describe, it, expect } from "vitest";
import { evaluateThesis, verifyEvidence } from "../src/index.js";
import { Comparator, Direction, EntryKind, OutcomeKind, toPrice8, METHODOLOGY_M1_HASH, type ThesisTerms } from "@atlas/shared-types";
import type { Candle } from "@atlas/market-data";

const H = 3600;
const START = 1_800_000_000 - (1_800_000_000 % H); // aligned
const mk = (i: number, o: number, h: number, l: number, c: number): Candle => ({ openTime: (START + i * H) * 1000, closeTime: (START + (i + 1) * H) * 1000 - 1, open: o, high: h, low: l, close: c, volume: 1, quoteVolume: 1 });
const long = (over: Partial<ThesisTerms> = {}): ThesisTerms => ({
  baseAsset: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", quoteAsset: "0x55d398326f99059fF775485246999027B3197955",
  direction: Direction.Long, entry: { kind: EntryKind.Market, price: 0n },
  target: { comparator: Comparator.GTE, price: toPrice8("110") }, invalidation: { comparator: Comparator.LTE, price: toPrice8("95") },
  evaluationDeadline: BigInt(START + 10 * H), methodologyHash: METHODOLOGY_M1_HASH, contentHash: METHODOLOGY_M1_HASH, ...over,
});
const run = (terms: ThesisTerms, candles: Candle[], now = START + 20 * H) => evaluateThesis({ terms, startTime: START, symbol: "BNBUSDT", candles, now, source: "test", simulated: true });
const flat = (n: number) => Array.from({ length: n }, (_, i) => mk(i, 100, 101, 99, 100));

describe("ATLAS-M1 evaluation", () => {
  it("target hit", () => {
    const c = flat(10); c[3] = mk(3, 100, 111, 99, 109);
    const e = run(long(), c);
    expect(e.outcome).toBe(OutcomeKind.TargetHit);
    expect(e.returnBps).toBe(1000);
    expect(e.observedAt).toBe(START + 3 * H);
  });
  it("invalidation hit", () => {
    const c = flat(10); c[2] = mk(2, 100, 101, 94, 96);
    expect(run(long(), c).outcome).toBe(OutcomeKind.InvalidationHit);
  });
  it("same-candle double touch => Unresolved (never in author's favour)", () => {
    const c = flat(10); c[4] = mk(4, 100, 112, 90, 100);
    const e = run(long(), c);
    expect(e.outcome).toBe(OutcomeKind.Unresolved);
  });
  it("expired at last close; still OPEN before deadline", () => {
    const c = flat(10); c[9] = mk(9, 100, 103, 99, 102);
    expect(run(long(), c)).toMatchObject({ outcome: OutcomeKind.Expired, returnBps: 200 });
    expect(run(long(), flat(5), START + 5 * H + 10).status).toBe("OPEN");
  });
  // Security table: "Price oracle data is missing or stale -> outcome remains unresolved"
  it("missing or stale data => Unresolved after deadline", () => {
    expect(run(long(), []).outcome).toBe(OutcomeKind.Unresolved);
    expect(run(long(), flat(6)).outcome).toBe(OutcomeKind.Unresolved);
    const gapped = flat(10).filter((_, i) => i !== 4);
    expect(run(long(), gapped).outcome).toBe(OutcomeKind.Unresolved);
  });
  it("a touch after a data gap is not trusted", () => {
    const c = flat(10).filter((_, i) => i !== 2); c[5] = mk(6, 100, 111, 99, 100);
    expect(run(long(), c).outcome).toBe(OutcomeKind.Unresolved);
  });
  it("limit entry never triggered => Void; triggers then evaluates; same-candle entry+exit => Unresolved", () => {
    const t = long({ entry: { kind: EntryKind.AtOrBelow, price: toPrice8("97") } });
    expect(run(t, flat(10)).outcome).toBe(OutcomeKind.Void);
    const c = flat(10); c[1] = mk(1, 100, 100, 96.5, 98); c[5] = mk(5, 100, 111, 99, 110);
    const e = run(t, c);
    expect(e.outcome).toBe(OutcomeKind.TargetHit);
    expect(e.entryPrice).toBe(97);
    const c2 = flat(10); c2[1] = mk(1, 100, 100, 94, 98);
    expect(run(t, c2).outcome).toBe(OutcomeKind.Unresolved);
  });
  it("short direction returns", () => {
    const s = long({ direction: Direction.Short, target: { comparator: Comparator.LTE, price: toPrice8("90") }, invalidation: { comparator: Comparator.GTE, price: toPrice8("105") } });
    const c = flat(10); c[2] = mk(2, 100, 101, 89, 90);
    expect(run(s, c)).toMatchObject({ outcome: OutcomeKind.TargetHit, returnBps: 1000 });
  });
  it("evidence is reproducible and tamper-evident", () => {
    const c = flat(10); c[3] = mk(3, 100, 111, 99, 109);
    const a = run(long(), c);
    const b = run(long(), c.map((x) => ({ ...x })));
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(verifyEvidence(a.evidence, a.evidenceHash)).toBe(true);
    const tampered = { ...a.evidence, result: { ...a.evidence.result, returnBps: 5000 } };
    expect(verifyEvidence(tampered, a.evidenceHash)).toBe(false);
  });
});
