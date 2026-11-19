/**
 * ATLAS Arena 1.0 API: boards, immutable idempotent snapshots, Proof Drawer data, XP ledger (idempotency, caps, RLS),
 * challenge adjudication, comparison and honesty guarantees (no realized P&L claims).
 * Thesis rows are inserted directly as test fixtures (the publish flow itself is covered in onchain.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { harness, Client, uniq, type Harness } from "./helpers.js";

let h: Harness;
let A: Client, B: Client, C: Client, M: Client;
const ids: Record<string, string> = {};
const DAY = 86_400;
const hex = (n = 32) => `0x${randomBytes(n).toString("hex")}`;

async function thesis(author: string, o: { daysAgo: number; outcome?: string; ret?: number | null; conf?: number; target?: number; inv?: number; evidence?: boolean; asset?: string; publishedDaysAgo?: number; title?: string }) {
  const outcome = o.outcome ?? "TargetHit";
  const [t] = await h.deps.db.sys(
    `INSERT INTO theses (author_id, author_wallet, chain_id, registry, asset, symbol, direction, entry_kind, target_price, invalidation_price, horizon_hours, confidence, visibility, content, content_hash, terms, salt, commitment,
       chain_status, onchain_id, publish_tx, published_at, start_time, outcome, return_bps, resolved_at, evidence_hash, outcome_state)
     VALUES ($1,'0x0000000000000000000000000000000000000001',31337,'0x0000000000000000000000000000000000000002',$2,$2||'USDT','LONG','MARKET',$3,$4,72,$5,'PUBLIC',$6,$7,'{}','0x00',$8,
       'published',$9,$10, now() - make_interval(secs => $11), now() - make_interval(secs => $11), $12, $13, ${outcome === "Open" ? "NULL" : "now() - make_interval(secs => $14)"}, $15, $16) RETURNING id`,
    [author, o.asset ?? "BNB", o.target ?? 600 + Math.random() * 100, o.inv ?? 400 + Math.random() * 50, o.conf ?? 60, { title: o.title ?? uniq("t"), summary: "s", body: "b" }, hex(), hex(), String(Math.floor(Math.random() * 1e9)), hex(),
      ((o.publishedDaysAgo ?? o.daysAgo + 2) * DAY), outcome, o.ret === undefined ? (outcome === "TargetHit" ? 300 : -150) : o.ret, o.daysAgo * DAY, o.evidence === false ? null : hex(), "Evaluated"].filter((_, i) => outcome !== "Open" || i !== 13),
  );
  return t.id as string;
}
const LONG = "The invalidation sits under the weekly value area, volume is expanding on up days, and funding is neutral, so the risk to reward looks reasonable if the daily close holds above resistance.";

beforeAll(async () => {
  h = await harness();
  A = new Client(h); B = new Client(h); C = new Client(h); M = new Client(h);
  await A.login(uniq("ana")); await B.login(uniq("ben")); await C.login(uniq("cal")); await M.login(uniq("mod"));
  for (const [k, c] of Object.entries({ A, B, C, M })) ids[k] = (await c.get("/auth/session")).body.userId;
  await h.deps.db.sys(`INSERT INTO user_roles (user_id, role) VALUES ($1,'moderator')`, [ids.M]);
  // A: 12 resolved theses across ~12 weeks (Ranked); B: 3 recent resolved (Emerging / Rising)
  for (let i = 0; i < 12; i++) await thesis(ids.A!, { daysAgo: 3 + i * 7, outcome: i % 3 === 2 ? "InvalidationHit" : "TargetHit", ret: i % 3 === 2 ? -150 : 300 + i * 10, target: 700 + i * 20, inv: 450 - i * 5 });
  for (let i = 0; i < 3; i++) await thesis(ids.B!, { daysAgo: 2 + i * 3, ret: 200, target: 900 + i * 50, inv: 300 + i });
});
afterAll(async () => { await h?.close(); });

describe("Arena boards", () => {
  it("lists boards and keeps Gainers/Squads honest about their release", async () => {
    const r = (await A.get("/leaderboards")).body;
    expect(r.boards.map((b: any) => b.type)).toEqual(["analysts", "gainers", "consistency", "rising", "ai-analysts", "contributors", "squads"]);
    expect(r.boards.find((b: any) => b.type === "gainers").status).toBe("coming_in_arena_2");
    expect(r.boards.find((b: any) => b.type === "squads").status).toBe("coming_in_arena_3");
  });

  it("Top Analysts ranks Ranked holders and lists Emerging unranked, with the full response envelope", async () => {
    const r = await new Client(h).get("/leaderboards/analysts?window=all");
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.methodology).toMatchObject({ id: "atlas-skill-v2", version: 2, status: "provisional" });
    expect(b.calculatedAt).toBeTruthy();
    expect(b).toHaveProperty("finalizedBlock");
    expect(b.evidenceCoverage).toBeGreaterThan(0.9);
    expect(b.snapshotId).toBeTruthy();
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0]).toMatchObject({ rank: 1, tier: "Ranked", resolved: 12 });
    expect(b.entries[0].profile.userId).toBe(ids.A);
    expect(b.entries[0].components.map((c: any) => c.weight)).toEqual([0.35, 0.25, 0.2, 0.1, 0.1]);
    expect(b.entries[0]).toHaveProperty("thesisReturnDrawdownBps");
    expect(b.unranked.map((e: any) => [e.profile.userId, e.tier, e.rank])).toEqual([[ids.B, "Emerging", null]]);
  });

  it("empty windows return an honest empty state instead of figures", async () => {
    const b = (await A.get("/leaderboards/analysts?window=7d")).body;
    expect(b.entries).toHaveLength(0);
    expect(b.emptyState).toMatch(/Verified rankings will appear here/);
    const d = (await A.get("/leaderboards/analysts?window=24h")).body;
    expect(d.warning).toMatch(/24h/);
    expect(d.snapshotId).toBeNull();
  });

  it("asset and min-sample filters apply without writing snapshots", async () => {
    const b = (await A.get("/leaderboards/analysts?window=all&asset=ETH")).body;
    expect(b.entries).toHaveLength(0);
    expect(b.snapshotId).toBeNull();
    expect(b.filters.assets).toContain("BNB");
    expect((await A.get("/leaderboards/analysts?window=all&minSample=50")).body.entries).toHaveLength(0);
  });

  it("Rising Stars and Consistent expose their thresholds", async () => {
    const rising = (await A.get("/leaderboards/rising?window=30d")).body;
    expect(rising.entries.map((e: any) => e.profile.userId)).toEqual([ids.B]);
    expect(rising.thresholds).toMatchObject({ minWindowResolved: 3, maxAllTimeResolved: 9 });
    const cons = (await A.get("/leaderboards/consistency?window=all")).body;
    expect(cons.entries.map((e: any) => e.profile.userId)).toEqual([ids.A]);
    expect(cons.thresholds).toMatchObject({ minResolved: 5, minActiveWeeks: 2 });
  });

  it("Gainers never shows realized P&L; Top Thesis Moves is labelled as not money earned", async () => {
    const g = (await A.get("/leaderboards/gainers?window=all")).body;
    expect(g.realizedPnl.available).toBe(false);
    expect(g.realizedPnl.message).toMatch(/Arena 2\.0/);
    expect(g.thesisMoves.label).toMatch(/not money earned/);
    expect(g.thesisMoves.items.filter((m: any) => m.profile.userId === ids.A).length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(g)).not.toMatch(/"pnl"\s*:\s*-?\d/i);
    expect((await A.get("/leaderboards/squads")).body.status).toBe("coming_in_arena_3");
  });
});

describe("snapshots are versioned, idempotent and immutable", () => {
  it("same inputs reuse the snapshot; new evidence creates a new one; history is a Rank Journey", async () => {
    const s1 = (await A.get("/leaderboards/analysts?window=all")).body.snapshotId;
    const s2 = (await A.get("/leaderboards/analysts?window=all")).body.snapshotId;
    expect(s2).toBe(s1);
    await thesis(ids.A!, { daysAgo: 1, ret: 500, target: 2000, inv: 100 });
    const s3 = (await A.get("/leaderboards/analysts?window=all")).body.snapshotId;
    expect(s3).not.toBe(s1);
    const hist = (await A.get(`/leaderboards/analysts/history?window=all&userId=${ids.A}`)).body;
    expect(hist.snapshots.length).toBeGreaterThanOrEqual(2);
    expect(hist.snapshots.at(-1).entry).toMatchObject({ rank: 1 });
    expect(hist.snapshots.every((s: any) => s.methodologyId === "atlas-skill-v2")).toBe(true);
  });

  it("snapshots, entries and the XP ledger cannot be modified, even by the owner role", async () => {
    await expect(h.deps.db.sys(`UPDATE leaderboard_snapshots SET evidence_coverage = 0`)).rejects.toThrow(/append-only/);
    await expect(h.deps.db.sys(`DELETE FROM leaderboard_entries`)).rejects.toThrow(/append-only/);
    await expect(h.deps.db.sys(`UPDATE scoring_methodologies SET description = 'x'`)).rejects.toThrow(/append-only/);
    await A.get("/points/me");
    await expect(h.deps.db.sys(`UPDATE point_events SET xp = 100`)).rejects.toThrow(/append-only/);
    // the app role cannot write rankings or XP at all
    await expect(h.deps.db.as(ids.A!, (q) => q(`INSERT INTO point_events (user_id, kind, xp, idempotency_key, source_id, rules_version, occurred_at) VALUES ($1,'review',8,'x','x','v',now())`, [ids.A]))).rejects.toThrow(/permission denied/);
    await expect(h.deps.db.as(ids.A!, (q) => q(`INSERT INTO user_levels (user_id, xp, level, rules_version) VALUES ($1, 99999, 10, 'x') ON CONFLICT (user_id) DO UPDATE SET xp = 99999`, [ids.A]))).rejects.toThrow(/permission denied/);
  });
});

describe("anti-abuse", () => {
  it("a near-duplicate thesis earns no ranking credit and is flagged", async () => {
    const before = (await A.get("/leaderboards/analysts?window=all")).body.entries[0];
    const [last] = await h.deps.db.sys(`SELECT target_price, invalidation_price FROM theses WHERE author_id = $1 ORDER BY published_at DESC LIMIT 1`, [ids.A]);
    await thesis(ids.A!, { daysAgo: 1, publishedDaysAgo: 3 - 0.01, ret: 500, target: Number(last.target_price) * 1.001, inv: Number(last.invalidation_price) });
    const after = (await A.get("/leaderboards/analysts?window=all")).body.entries[0];
    expect(after.score).toBe(before.score);
    expect(after.excludedDuplicates).toBe(1);
    const [f] = await h.deps.db.sys(`SELECT kind FROM ranking_integrity_flags WHERE user_id = $1`, [ids.A]);
    expect(f.kind).toBe("near_duplicate");
    const bd = (await A.get(`/users/${ids.A}/score-breakdown?window=all`)).body;
    expect(bd.theses.filter((t: any) => t.status === "excluded_duplicate")).toHaveLength(1);
  });

  it("an exclude-severity integrity flag removes the account from rankings", async () => {
    await h.deps.db.sys(`INSERT INTO ranking_integrity_flags (user_id, kind, severity, status, idempotency_key) VALUES ($1,'manual','exclude','open','test-exclude')`, [ids.B]);
    const r = (await A.get("/leaderboards/rising?window=30d")).body;
    expect(r.entries).toHaveLength(0);
    expect(r.unranked[0].tierReason).toMatch(/integrity/);
  });
});

describe("ATLAS Points ledger", () => {
  it("derives XP from an idempotent ledger; re-syncing never double-credits", async () => {
    const p1 = (await A.get("/points/me")).body;
    // onboarding 20 + 3/day cap is not hit (one thesis per day) -> 14 published * 10 (dup earns 0 => 13) + resolved 15 each (14 non-dup resolved)
    const [{ n }] = await h.deps.db.sys(`SELECT count(*)::int AS n FROM point_events WHERE user_id = $1`, [ids.A]);
    const p2 = (await A.get("/points/me")).body;
    const [{ n: n2 }] = await h.deps.db.sys(`SELECT count(*)::int AS n FROM point_events WHERE user_id = $1`, [ids.A]);
    expect(p2.xp).toBe(p1.xp);
    expect(n2).toBe(n);
    const [{ sum }] = await h.deps.db.sys(`SELECT sum(xp)::int AS sum FROM point_events WHERE user_id = $1`, [ids.A]);
    expect(p1.xp).toBe(sum);
    expect(p1.xp).toBe(20 + 13 * 10 + 13 * 15);
    expect(p1.level.level).toBeGreaterThan(1);
    expect(p1.disclaimer).toMatch(/not a token, not cash, not an airdrop/);
    expect(p1.achievements.find((a: any) => a.id === "founding-agent-id").earned).toBe(true);
    expect(p1.achievements.find((a: any) => a.id === "thesis-pioneer").earned).toBe(true);
  });

  it("reviews need substance and a daily cap; likes, follows and comments earn nothing", async () => {
    const theses = await h.deps.db.sys(`SELECT id FROM theses WHERE author_id = $1 ORDER BY published_at DESC LIMIT 5`, [ids.A]);
    const before = (await C.get("/points/me")).body.xp;
    for (const [i, t] of theses.entries()) await h.deps.db.sys(`INSERT INTO reviews (thesis_id, reviewer_id, stance, body, content_hash) VALUES ($1,$2,'NEUTRAL',$3,$4)`, [t.id, ids.C, `${LONG} Point ${i}.`, hex()]);
    await h.deps.db.sys(`INSERT INTO reviews (thesis_id, reviewer_id, stance, body, content_hash) SELECT id, $2, 'ENDORSE', 'nice', $3 FROM theses WHERE author_id = $1 ORDER BY published_at LIMIT 1`, [ids.A, ids.C, hex()]);
    const post = await A.post("/posts", { body: "engagement test #bnb" });
    await C.post(`/posts/${post.body.id}/like`);
    await C.post("/follows", { userId: ids.A });
    const after = (await C.get("/points/me")).body;
    expect(after.xp - before).toBe(3 * 8); // 5 substantive reviews on one day -> capped at 3; "nice" earns 0; likes/follows 0
    expect(after.byKind.map((k: any) => k.kind).sort()).toEqual(["onboarding", "review"]);
  });

  it("the private ledger is isolated by RLS", async () => {
    const hist = (await C.get("/points/me/history")).body;
    expect(hist.events.every((e: any) => typeof e.idempotency_key === "string")).toBe(true);
    const leak = await h.deps.db.as(ids.C!, (q) => q(`SELECT count(*)::int AS n FROM point_events WHERE user_id = $1`, [ids.A]));
    expect(leak[0].n).toBe(0);
    const anon = await h.deps.db.as(null, (q) => q(`SELECT count(*)::int AS n FROM point_events`));
    expect(anon[0].n).toBe(0);
    expect((await new Client(h).get("/points/me")).status).toBe(401);
  });

  it("an independently upheld evidence challenge pays +25 once per finding; adjudication is moderator-only and final", async () => {
    const [t] = await h.deps.db.sys(`SELECT id FROM theses WHERE author_id = $1 LIMIT 1`, [ids.A]);
    const ev = hex();
    const [c1] = await h.deps.db.sys(`INSERT INTO evidence_challenges (thesis_id, challenger_id, kind, evidence_hash, reason, reason_hash) VALUES ($1,$2,'price',$3,'wrong candle',$4) RETURNING id`, [t.id, ids.C, ev, hex()]);
    const before = (await C.get("/points/me")).body.xp;
    expect((await C.post(`/admin/challenges/${c1.id}/adjudicate`, { decision: "upheld", note: "self" })).status).toBe(403);
    expect((await M.post(`/admin/challenges/${c1.id}/adjudicate`, { decision: "upheld", note: "Evidence used the wrong candle" })).status).toBe(200);
    expect((await M.post(`/admin/challenges/${c1.id}/adjudicate`, { decision: "rejected", note: "again" })).status).toBe(409);
    // a second challenger reporting the same finding earns nothing
    const [c2] = await h.deps.db.sys(`INSERT INTO evidence_challenges (thesis_id, challenger_id, kind, evidence_hash, reason, reason_hash) VALUES ($1,$2,'price',$3,'same',$4) RETURNING id`, [t.id, ids.B, ev, hex()]);
    const bBefore = (await B.get("/points/me")).body.xp;
    await M.post(`/admin/challenges/${c2.id}/adjudicate`, { decision: "upheld", note: "duplicate finding" });
    expect((await C.get("/points/me")).body.xp - before).toBe(25);
    expect((await B.get("/points/me")).body.xp).toBe(bBefore);
  });

  it("contributors board ranks by XP and shows the disclaimer", async () => {
    const b = (await new Client(h).get("/leaderboards/contributors?window=all")).body;
    expect(b.entries[0].profile.userId).toBe(ids.A);
    expect(b.disclaimer).toMatch(/not a token/);
    expect(b.rules.engagement.xp).toBe(0);
    expect(b.snapshotId).toBeTruthy();
  });
});

describe("explainability and comparison", () => {
  it("score breakdown explains the rank (Proof Drawer)", async () => {
    const b = (await new Client(h).get(`/users/${ids.A}/score-breakdown?window=all`)).body;
    expect(b.components).toHaveLength(5);
    expect(b.components.reduce((s: number, c: any) => s + c.contribution, 0)).toBeCloseTo(b.score, 1);
    expect(b.ranks.analysts).toBe(1);
    expect(b.limitations.join(" ")).toMatch(/not realized P&L/);
    expect(b.period.from).toBeTruthy();
    expect(b.methodology.status).toBe("provisional");
  });

  it("methodology keeps the v1 Performance view and the stored versions", async () => {
    const m = (await new Client(h).get("/leaderboards/analysts/methodology")).body;
    expect(m.text).toMatch(/Skill Score v2/);
    expect(m.reputationV1).toMatch(/ATLAS reputation v1/);
    expect(m.versions[0]).toMatchObject({ id: "atlas-skill-v2", version: 2 });
  });

  it("compares 2-3 traders without inventing realized P&L", async () => {
    const r = (await A.get(`/traders/compare?ids=${ids.A},${ids.B}&window=all`)).body;
    expect(r.traders).toHaveLength(2);
    expect(r.traders.every((t: any) => t.realizedPnl.available === false)).toBe(true);
    expect((await A.get(`/traders/compare?ids=${ids.A}`)).status).toBe(400);
    const ev = (await A.get(`/traders/${ids.A}/performance-evidence`)).body;
    expect(ev.theses.length).toBeGreaterThan(10);
    expect(ev.disclosure).toMatch(/not realized profit/);
  });

  it("/leaderboards/me requires a session and reports each board separately", async () => {
    expect((await new Client(h).get("/leaderboards/me")).status).toBe(401);
    const me = (await A.get("/leaderboards/me?window=all")).body;
    expect(me.boards.analysts).toMatchObject({ rank: 1, tier: "Ranked" });
    expect(me.points.xp).toBeGreaterThan(0);
    const pub = (await new Client(h).get(`/users/${ids.A}/arena`)).body;
    expect(pub.achievements.map((a: any) => a.id)).toContain("thesis-pioneer");
  });

  it("the snapshot job is idempotent", async () => {
    const { runArenaSnapshots } = await import("../src/lib/arena.js");
    const first = await runArenaSnapshots(h.deps);
    const [{ n }] = await h.deps.db.sys(`SELECT count(*)::int AS n FROM leaderboard_snapshots`);
    const second = await runArenaSnapshots(h.deps);
    const [{ n: n2 }] = await h.deps.db.sys(`SELECT count(*)::int AS n FROM leaderboard_snapshots`);
    expect(n2).toBe(n);
    expect(second.map((s) => s.snapshotId)).toEqual(first.map((s) => s.snapshotId));
  });
});
