/** Outcome scoring provenance: real-source fallback (Binance → OKX), recorded attempts, and unscorable theses with a visible reason. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { Comparator, Direction, EntryKind, toPrice8, METHODOLOGY_M1_1_HASH, type ThesisTerms } from "@atlas/shared-types";
import type { Candle, MarketDataProvider } from "@atlas/market-data";
import { verifyEvidence } from "@atlas/outcome-engine";
import { harness, Client, uniq, type Harness } from "./helpers.js";
import { evaluateOpenTheses } from "../src/workers/outcomes.js";
import { termsToJson } from "../src/lib/theses.js";
import { readFileSync } from "node:fs";

let h: Harness; let A: Client; let author: string;
const hex = (n = 32) => `0x${randomBytes(n).toString("hex")}`;
const H = 3600;

async function published(asset: string, startAgoH: number, horizonH: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - startAgoH * H;
  const terms: ThesisTerms = {
    baseAsset: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", quoteAsset: "0x55d398326f99059fF775485246999027B3197955",
    direction: Direction.Long, entry: { kind: EntryKind.Market, price: 0n },
    target: { comparator: Comparator.GTE, price: toPrice8("110") }, invalidation: { comparator: Comparator.LTE, price: toPrice8("95") },
    evaluationDeadline: BigInt(start + horizonH * H), methodologyHash: METHODOLOGY_M1_1_HASH, contentHash: hex() as any,
  };
  const [t] = await h.deps.db.sys(
    `INSERT INTO theses (author_id, author_wallet, chain_id, registry, asset, symbol, direction, entry_kind, target_price, invalidation_price, horizon_hours, confidence, visibility, content, content_hash, terms, salt, commitment, chain_status, onchain_id, publish_tx, published_at, start_time, outcome)
     VALUES ($1,'0x0000000000000000000000000000000000000001',31337,'0x0000000000000000000000000000000000000002',$2,$2||'USDT','LONG','MARKET',110,95,$3,60,'PUBLIC',$4,$5,$6,'0x00',$7,'published',$8,$9,to_timestamp($10),to_timestamp($10),'Open') RETURNING id`,
    [author, asset, horizonH, { title: uniq("t"), summary: "s", body: "b" }, hex(), termsToJson(terms), hex(), String(Math.floor(Math.random() * 1e9)), hex(), start],
  );
  return { id: t.id as string, start };
}
const candlesFrom = (start: number, n: number, hitAt: number): Candle[] => Array.from({ length: n }, (_, i) => {
  const o = Math.floor(start / H) * H + (i + 1) * H;
  return { openTime: o * 1000, closeTime: (o + H) * 1000 - 1, open: 100, high: i === hitAt ? 111 : 101, low: 99, close: 100, volume: 1, quoteVolume: 1 };
});
const failing = (id: string, msg: string): MarketDataProvider => ({ id, simulated: false, klines: async () => { throw new Error(msg); }, ticker24h: async () => { throw new Error(msg); } });

beforeAll(async () => {
  h = await harness();
  A = new Client(h); await A.login(uniq("sc"));
  author = (await A.get("/auth/session")).body.userId;
});
afterAll(async () => { await h?.close(); });

describe("outcome scoring sources", () => {
  it("scores from OKX when Binance refuses, and stores the source + attempts in hash-checked evidence", async () => {
    const t = await published("BNB", 20, 30);
    const okx: MarketDataProvider = { id: "okx-public", simulated: false, klines: async () => candlesFrom(t.start, 19, 4), ticker24h: async () => { throw new Error("unused"); } };
    await evaluateOpenTheses(h.deps, { sources: [failing("binance-spot-public", "HTTP 418"), okx] });
    const [row] = await h.deps.db.sys(`SELECT outcome, scoring_status, scoring_source, evidence FROM theses WHERE id = $1`, [t.id]);
    expect(row.outcome).toBe("TargetHit");
    expect(row).toMatchObject({ scoring_status: "scored", scoring_source: "okx-public" });
    expect(row.evidence.source).toBe("okx-public");
    expect(row.evidence.simulated).toBe(false);
    expect(row.evidence.sourceAttempts).toEqual([{ source: "binance-spot-public", ok: false, error: "HTTP 418" }, { source: "okx-public", ok: true }]);
    const [h2] = await h.deps.db.sys(`SELECT evidence_hash FROM theses WHERE id = $1`, [t.id]);
    expect(verifyEvidence(row.evidence, h2.evidence_hash)).toBe(true);
    expect(row.evidence.methodology.id).toBe("ATLAS-M1.1");
  });
  it("CAKE (not listed on OKX, Binance refused): unscorable with the reason shown, never simulated", async () => {
    const t = await published("CAKE", 5, 48);
    await evaluateOpenTheses(h.deps, { sources: [failing("binance-spot-public", "HTTP 418"), failing("okx-public", "okx error 51001 Instrument ID doesn't exist")] });
    const d = (await A.get(`/theses/${t.id}`)).body;
    expect(d.outcome).toBe("Open");
    expect(d.scoring.status).toBe("unscorable");
    expect(d.scoring.note).toMatch(/CAKEUSDT.*okx-public: okx error 51001/);
  });
  it("an unscorable thesis past its deadline is Unresolved with the reason in its evidence", async () => {
    const t = await published("CAKE", 50, 24);
    await evaluateOpenTheses(h.deps, { sources: [failing("binance-spot-public", "HTTP 418"), failing("okx-public", "okx error 51001")] });
    const [row] = await h.deps.db.sys(`SELECT outcome, scoring_status, evidence FROM theses WHERE id = $1`, [t.id]);
    expect(row.outcome).toBe("Unresolved");
    expect(row.scoring_status).toBe("unscorable");
    expect(row.evidence.unscorable).toMatch(/No allowed real price source/);
    expect(row.evidence.candles).toEqual([]);
  });

  it("a resolution queues a durable proposal (outbox) in the same transaction; unscorable results are EVALUATED-only", async () => {
    const t = await published("BNB", 20, 30);
    const okx: MarketDataProvider = { id: "okx-public", simulated: false, klines: async () => candlesFrom(t.start, 19, 4), ticker24h: async () => { throw new Error("unused"); } };
    await evaluateOpenTheses(h.deps, { sources: [okx] });
    const [p] = await h.deps.db.sys(`SELECT state, outcome, outcome_kind, observed_at, observed_price, evidence_hash, attempts FROM outcome_proposals WHERE thesis_id = $1`, [t.id]);
    const [th] = await h.deps.db.sys(`SELECT evidence_hash, evidence FROM theses WHERE id = $1`, [t.id]);
    expect(p).toMatchObject({ state: "PROPOSAL_PENDING", outcome: "TargetHit", outcome_kind: 1, evidence_hash: th.evidence_hash, attempts: 0 });
    expect(Number(p.observed_at)).toBe(th.evidence.result.observedAt);
    expect(p.observed_price).toBe(String(Math.round(th.evidence.result.exitPrice * 1e8)));
    const u = await published("CAKE", 50, 24);
    await evaluateOpenTheses(h.deps, { sources: [failing("binance-spot-public", "HTTP 418")] });
    const [q] = await h.deps.db.sys(`SELECT state, note FROM outcome_proposals WHERE thesis_id = $1`, [u.id]);
    expect(q.state).toBe("EVALUATED");
    expect(q.note).toMatch(/unscorable/);
  });
  it("migration 009 backfill: a thesis the old worker resolved but never proposed is queued from its stored evidence", async () => {
    const t = await published("BNB", 20, 30);
    const okx: MarketDataProvider = { id: "okx-public", simulated: false, klines: async () => candlesFrom(t.start, 19, 4), ticker24h: async () => { throw new Error("unused"); } };
    await evaluateOpenTheses(h.deps, { sources: [okx] });
    const [orig] = await h.deps.db.sys(`SELECT * FROM outcome_proposals WHERE thesis_id = $1`, [t.id]);
    // simulate the pre-009 world: outcome written, no outbox row
    await h.deps.db.sys(`DELETE FROM outcome_proposal_events WHERE thesis_id = $1`, [t.id]);
    await h.deps.db.sys(`DELETE FROM outcome_proposals WHERE thesis_id = $1`, [t.id]);
    const sql = readFileSync(new URL("../migrations/009_outcome_proposals.sql", import.meta.url), "utf8");
    const inserts = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").filter((x) => /INSERT INTO outcome_proposals/.test(x));
    expect(inserts).toHaveLength(2);
    for (const stmt of inserts) await h.deps.db.sys(stmt);
    for (const stmt of inserts) await h.deps.db.sys(stmt); // idempotent
    const [b] = await h.deps.db.sys(`SELECT * FROM outcome_proposals WHERE thesis_id = $1`, [t.id]);
    expect(b.state).toBe("PROPOSAL_PENDING");
    expect(b.observed_at).toBe(orig.observed_at);
    expect(b.observed_price).toBe(orig.observed_price);
    expect(b.evidence_hash).toBe(orig.evidence_hash);
    expect(b.note).toMatch(/backfilled/);
    // the outbox is system-context only: the RLS app role cannot read or write it
    await expect(h.deps.db.as(null, (q) => q(`SELECT * FROM outcome_proposals`))).rejects.toThrow(/permission denied/);
    await expect(h.deps.db.as(null, (q) => q(`SELECT * FROM worker_runs`))).rejects.toThrow(/permission denied/);
  });
});
