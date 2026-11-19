import { describe, it, expect } from "vitest";
import {
  skillScoreV2, tierFor, detectNearDuplicates, analystsBoard, consistencyBoard, risingBoard, thesisMoves, planPointEvents, levelFor,
  achievementsFrom, isSubstantiveReview, SKILL_V2, POINTS_RULES_V1, type ArenaThesis, type PointFacts,
} from "../src/index.js";

const NOW = 1_800_000_000;
const DAY = 86_400;
let seq = 0;
function th(p: Partial<ArenaThesis> & { authorId?: string } = {}): ArenaThesis {
  seq++;
  const resolvedAt = p.resolvedAt === undefined ? NOW - seq * DAY : p.resolvedAt;
  return {
    id: `t${seq}`, authorId: "a", asset: "BNB", direction: "LONG", outcome: "TargetHit", returnBps: 300, confidence: 60,
    publishedAt: (resolvedAt ?? NOW) - 2 * DAY, resolvedAt, evidenceHash: "0xabc", outcomeState: "Evaluated",
    targetPrice: 600 + seq * 10, invalidationPrice: 500 - seq, horizonHours: 72, title: `thesis ${seq}`, ...p,
  };
}
const many = (n: number, f: (i: number) => Partial<ArenaThesis>) => Array.from({ length: n }, (_, i) => th(f(i)));

describe("Skill Score v2", () => {
  it("weights sum to 1 and the score is bounded to 0..100", () => {
    expect(Object.values(SKILL_V2.weights).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
    const best = skillScoreV2(many(60, (i) => ({ outcome: "TargetHit", returnBps: 5000, confidence: 100, resolvedAt: NOW - i * 3 * DAY })));
    const worst = skillScoreV2(many(60, (i) => ({ outcome: "InvalidationHit", returnBps: -5000, confidence: 100, resolvedAt: NOW - i * 3 * DAY, evidenceHash: null })));
    for (const r of [best, worst]) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); for (const c of r.components) { expect(c.normalized).toBeGreaterThanOrEqual(0); expect(c.normalized).toBeLessThanOrEqual(1); } }
    expect(best.score).toBeGreaterThan(80);
    expect(worst.score).toBeLessThan(15);
  });

  it("2/2 wins does not outrank a long, consistent record (Wilson + shrinkage)", () => {
    const lucky = skillScoreV2(many(2, () => ({ outcome: "TargetHit", returnBps: 400 })));
    const steady = skillScoreV2(many(40, (i) => ({ outcome: i % 5 < 3 ? "TargetHit" : "InvalidationHit", returnBps: i % 5 < 3 ? 300 : -150, resolvedAt: NOW - i * 4 * DAY })));
    expect(steady.score).toBeGreaterThan(lucky.score);
    expect(lucky.limitations[0]).toMatch(/Small sample/);
  });

  it("a high hit rate with huge losses scores below a modest hit rate with a good payoff (risk-aware expectancy)", () => {
    const fragile = skillScoreV2(many(20, (i) => ({ outcome: i % 10 === 0 ? "InvalidationHit" : "TargetHit", returnBps: i % 10 === 0 ? -6000 : 100, confidence: 60, resolvedAt: NOW - i * 4 * DAY })));
    const robust = skillScoreV2(many(20, (i) => ({ outcome: i % 20 < 11 ? "TargetHit" : "InvalidationHit", returnBps: i % 20 < 11 ? 600 : -200, confidence: 60, resolvedAt: NOW - i * 4 * DAY })));
    const e = (r: typeof fragile) => r.components.find((c) => c.key === "expectancy")!.normalized;
    expect(e(robust)).toBeGreaterThan(e(fragile));
  });

  it("calibration rewards honest confidence", () => {
    const honest = skillScoreV2(many(20, (i) => ({ outcome: i % 2 ? "TargetHit" : "InvalidationHit", confidence: 50, returnBps: i % 2 ? 200 : -200 })));
    const overconfident = skillScoreV2(many(20, (i) => ({ outcome: i % 2 ? "TargetHit" : "InvalidationHit", confidence: 100, returnBps: i % 2 ? 200 : -200 })));
    const c = (r: typeof honest) => r.components.find((x) => x.key === "calibration")!.normalized;
    expect(c(honest)).toBeGreaterThan(c(overconfident));
  });

  it("keeps the Thesis Return Drawdown metric (summed thesis returns, not a portfolio)", () => {
    const r = skillScoreV2([th({ returnBps: 500, resolvedAt: NOW - 3 * DAY }), th({ returnBps: -300, resolvedAt: NOW - 2 * DAY }), th({ outcome: "InvalidationHit", returnBps: -400, resolvedAt: NOW - DAY })]);
    expect(r.thesisReturnDrawdownBps).toBe(700);
    expect(r.limitations.join(" ")).toMatch(/not the drawdown of a funded portfolio/);
  });

  it("evidence completeness counts unresolved theses against coverage", () => {
    const r = skillScoreV2([th(), th({ evidenceHash: null, outcomeState: null }), th({ outcome: "Unresolved", returnBps: null })]);
    expect(r.evidenceCoverage).toBeCloseTo(1 / 3, 3);
  });
});

describe("eligibility tiers", () => {
  it("Unranked / Emerging / Ranked / Established boundaries", () => {
    expect(tierFor(0, 1, 1).tier).toBe("Unranked");
    expect(tierFor(1, 1, 1).tier).toBe("Emerging");
    expect(tierFor(9, 1, 3).tier).toBe("Emerging");
    expect(tierFor(10, 1, 1).tier).toBe("Ranked");
    expect(tierFor(10, 0.5, 4).tier).toBe("Unranked");
    expect(tierFor(30, 1, 3).tier).toBe("Ranked");
    expect(tierFor(30, 1, 4).tier).toBe("Established");
    expect(tierFor(50, 1, 10, true).tier).toBe("Unranked");
  });
});

describe("anti-abuse", () => {
  it("near-duplicate theses get credit once", () => {
    const a = th({ publishedAt: NOW - 10 * DAY, targetPrice: 700, invalidationPrice: 500, title: "x" });
    const b = th({ publishedAt: NOW - 10 * DAY + 3600, targetPrice: 701, invalidationPrice: 501, title: "y" });
    const c = th({ publishedAt: NOW - 10 * DAY + 7200, targetPrice: 800, invalidationPrice: 450, title: "z" });
    const d = th({ publishedAt: NOW - 8 * DAY, targetPrice: 700, invalidationPrice: 500, title: "w" }); // > 24h later: allowed
    const e = th({ authorId: "other", publishedAt: NOW - 10 * DAY + 60, targetPrice: 700, invalidationPrice: 500 });
    const dups = detectNearDuplicates([a, b, c, d, e]);
    expect([...dups.keys()]).toEqual([b.id]);
    expect(dups.get(b.id)!.duplicateOf).toBe(a.id);
  });

  it("spamming copies cannot raise a ranking", () => {
    const base = many(12, (i) => ({ authorId: "s", resolvedAt: NOW - i * 3 * DAY, publishedAt: NOW - i * 3 * DAY - DAY }));
    const copies = base.flatMap((t) => [1, 2, 3].map((k) => ({ ...t, id: `${t.id}c${k}`, publishedAt: t.publishedAt + k * 60, targetPrice: t.targetPrice! * 1.001 })));
    const clean = analystsBoard(base, { window: "all", now: NOW });
    const spam = analystsBoard([...base, ...copies], { window: "all", now: NOW });
    expect(spam.entries[0]!.score).toBe(clean.entries[0]!.score);
    expect(spam.entries[0]!.result.sample.excludedDuplicates).toBe(36);
    expect(spam.duplicates).toHaveLength(36);
  });
});

describe("boards", () => {
  const data = [
    ...many(12, (i) => ({ authorId: "ranked", resolvedAt: NOW - i * 5 * DAY, outcome: i % 3 ? "TargetHit" : "InvalidationHit", returnBps: i % 3 ? 300 : -150 })),
    ...many(4, (i) => ({ authorId: "rising", resolvedAt: NOW - i * 2 * DAY, publishedAt: NOW - i * 2 * DAY - DAY })),
    ...many(2, () => ({ authorId: "tiny" })),
  ];
  it("analysts rank only Ranked/Established; Emerging is listed but never ranked", () => {
    const b = analystsBoard(data, { window: "all", now: NOW });
    expect(b.entries.map((e) => e.authorId)).toEqual(["ranked"]);
    expect(b.entries[0]!.rank).toBe(1);
    expect(b.unranked.every((e) => e.rank === null && e.tier === "Emerging")).toBe(true);
  });
  it("windows filter by resolution time and 24h always warns", () => {
    expect(analystsBoard(data, { window: "7d", now: NOW }).entries).toHaveLength(0);
    expect(analystsBoard(data, { window: "24h", now: NOW }).insufficientEvidence).toBe(true);
  });
  it("asOf snapshots ignore later evidence", () => {
    const b = analystsBoard(data, { window: "all", now: NOW, asOf: NOW - 40 * DAY });
    expect(b.entries).toHaveLength(0);
  });
  it("rising stars only include emerging accounts with the visible threshold", () => {
    const b = risingBoard(data, { window: "30d", now: NOW });
    expect(b.entries.map((e) => e.authorId)).toEqual(["rising"]);
    expect(b.thresholds).toMatchObject({ minWindowResolved: 3, maxAllTimeResolved: 9 });
  });
  it("consistency requires multiple active weeks and reports coverage", () => {
    const b = consistencyBoard(data, { window: "all", now: NOW });
    expect(b.entries.map((e) => e.authorId)).toEqual(["ranked"]);
    expect(b.evidenceCoverage).toBeGreaterThan(0);
  });
  it("thesis moves are TargetHit reference outcomes, max 2 per author", () => {
    const m = thesisMoves(data, { window: "all", now: NOW });
    expect(m.every((t) => t.outcome === "TargetHit")).toBe(true);
    expect(m.filter((t) => t.authorId === "ranked").length).toBeLessThanOrEqual(2);
  });
  it("flagged authors are excluded from ranking", () => {
    const b = analystsBoard(data, { window: "all", now: NOW, flaggedAuthors: new Set(["ranked"]) });
    expect(b.entries).toHaveLength(0);
  });
});

describe("ATLAS Points", () => {
  const facts = (p: Partial<PointFacts> = {}): PointFacts => ({ userId: "u", onboarding: { identityKey: "56:0xreg:1", at: NOW - 100 * DAY }, theses: [], reviews: [], challenges: [], squadMilestones: [], ...p });
  const long = "This thesis has a clear invalidation level and the volume profile supports the breakout, but I would want a daily close above resistance before trusting it fully.";
  it("is deterministic and idempotent: re-planning yields identical keys", () => {
    const f = facts({ theses: [{ id: "x", publishedAt: NOW - DAY, resolvedAt: NOW, outcome: "InvalidationHit", duplicate: false, distinction: false }] });
    const a = planPointEvents(f), b = planPointEvents(f);
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.idempotencyKey)).size).toBe(a.length);
    // a losing thesis still earns participation XP for an honest, documented resolution
    expect(a.map((e) => e.kind)).toEqual(["onboarding", "thesis_published", "thesis_resolved"]);
    expect(a.reduce((s, e) => s + e.xp, 0)).toBe(45);
  });
  it("caps theses at 3 per day and gives duplicates nothing", () => {
    const theses = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, publishedAt: NOW + i * 60, resolvedAt: null, outcome: "Open" as const, duplicate: i === 0, distinction: false }));
    const ev = planPointEvents(facts({ onboarding: null, theses }));
    expect(ev.map((e) => e.sourceId)).toEqual(["t1", "t2", "t3"]);
  });
  it("reviews need substance, are capped daily, and own-thesis or repeated reviews earn 0", () => {
    expect(isSubstantiveReview("great call!")).toBe(false);
    expect(isSubstantiveReview(long)).toBe(true);
    const reviews = [
      { id: "r0", thesisAuthorId: "u", body: long, createdAt: NOW },
      { id: "r1", thesisAuthorId: "v", body: long, createdAt: NOW + 1 },
      { id: "r2", thesisAuthorId: "v", body: long, createdAt: NOW + 2 },
      { id: "r3", thesisAuthorId: "v", body: long + " Additionally the funding rate is neutral.", createdAt: NOW + 3 },
      { id: "r4", thesisAuthorId: "v", body: long + " Also open interest fell.", createdAt: NOW + 4 },
      { id: "r5", thesisAuthorId: "v", body: long + " And spot leads perps.", createdAt: NOW + 5 },
      { id: "r6", thesisAuthorId: "v", body: "short", createdAt: NOW + 6 },
    ];
    const ev = planPointEvents(facts({ onboarding: null, reviews }));
    expect(ev.map((e) => e.sourceId)).toEqual(["r1", "r3", "r4"]);
  });
  it("upheld challenges pay once per finding; squad milestones are capped", () => {
    const ev = planPointEvents(facts({ onboarding: null,
      challenges: [{ id: "c1", findingKey: "t:0xe", upheld: true, firstForFinding: true, at: NOW }, { id: "c2", findingKey: "t:0xe", upheld: true, firstForFinding: false, at: NOW }, { id: "c3", findingKey: "t:0xf", upheld: false, firstForFinding: true, at: NOW }],
      squadMilestones: [1, 2, 3, 4].map((i) => ({ squadId: `s${i}`, milestone: 5, at: NOW + i })) }));
    expect(ev.filter((e) => e.kind === "challenge_upheld")).toHaveLength(1);
    expect(ev.filter((e) => e.kind === "squad_milestone")).toHaveLength(3);
  });
  it("engagement and volume are worth 0 XP", () => {
    expect(POINTS_RULES_V1.actions.engagement.xp).toBe(0);
    expect(POINTS_RULES_V1.actions.volume.xp).toBe(0);
    expect(POINTS_RULES_V1.disclaimer).toMatch(/not a token, not cash, not an airdrop/);
  });
  it("levels derive from cumulative XP", () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(39).level).toBe(1);
    expect(levelFor(40).level).toBe(2);
    expect(levelFor(70).progress).toBeCloseTo(0.5, 5);
    expect(levelFor(99999).nextLevelAt).toBeNull();
  });
  it("achievements derive from the ledger", () => {
    const ev = planPointEvents(facts({ onboarding: { identityKey: "56:0xreg:2", at: NOW }, theses: [0, 1, 2].map((i) => ({ id: `t${i}`, publishedAt: NOW - (i * 8 + 2) * DAY, resolvedAt: NOW - i * 8 * DAY, outcome: "TargetHit" as const, duplicate: false, distinction: false })) }));
    const ids = achievementsFrom(ev).map((a) => a.id);
    expect(ids).toContain("thesis-pioneer");
    expect(ids).toContain("weekly-challenger");
    expect(ids).not.toContain("founding-agent-id"); // onboarding in 2027 is after the founding cutoff
    expect(achievementsFrom(planPointEvents(facts())).map((a) => a.id)).toEqual(["founding-agent-id"]);
  });
});
