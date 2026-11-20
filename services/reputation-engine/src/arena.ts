/**
 * ATLAS Arena 1.0 scoring (extends, does not replace, reputation v1 / ATLAS-M1 in ./index.ts).
 *
 * Everything here is a pure function over evidence records so it can be unit-tested, re-run for an
 * immutable snapshot, and explained component by component in the Proof Drawer.
 *
 * IMPORTANT: thesis returns are direction-adjusted reference-market moves under ATLAS-M1. They are NOT
 * realized P&L. Nothing in this module computes or implies money earned.
 */
import { wilsonLower, type OutcomeName } from "./index.js";

// ------------------------------------------------------------------------------------------ records
export interface ArenaThesis {
  id: string;
  authorId: string;
  asset: string;
  direction: "LONG" | "SHORT";
  outcome: OutcomeName;
  returnBps: number | null;
  confidence: number; // 0..100 declared at commit time
  publishedAt: number; // unix s
  resolvedAt: number | null; // unix s
  cancelledAfterStart?: boolean;
  evidenceHash: string | null;
  outcomeState: string | null; // Evaluated / Proposed / Challenged / Final
  targetPrice: number | null;
  invalidationPrice: number | null;
  horizonHours: number;
  contentHash?: string | null;
  title?: string | null;
  demo?: boolean;
  /** Set ONLY by provisionalRecords(): the separately labelled Provisional view. Never set on verified inputs. */
  basis?: "provisional";
  /** Set by verifiedRecords(): this thesis has an evaluated outcome that is not Final on-chain yet. */
  awaitingFinality?: boolean;
  /** The off-chain evaluated outcome hidden by verifiedRecords() until it is Final on-chain. */
  evaluatedOutcome?: OutcomeName;
  /** The off-chain evaluated return / resolution time hidden by verifiedRecords() (restored only by provisionalRecords()). */
  evaluatedReturnBps?: number | null;
  evaluatedResolvedAt?: number | null;
}

export const WINDOWS = { "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400, "90d": 90 * 86_400, all: null } as const;
export type ArenaWindow = keyof typeof WINDOWS;
export const WEEK = 7 * 86_400;

const WIN: OutcomeName[] = ["TargetHit"];
const RETURN_OUTCOMES: OutcomeName[] = ["TargetHit", "InvalidationHit", "Expired"];

// ------------------------------------------------------------------------------- finality (audit 2026-11-20 F2)
/**
 * Verified basis: an outcome counts only once it is FINAL on-chain: AtlasOutcomeRegistry state Final (after the public
 * dispute window), or a thesis-registry fact that is itself the on-chain record (Cancelled after start, Forfeited).
 * Off-chain evaluations (Evaluated), pending proposals, Proposed (dispute window running) and Challenged outcomes are
 * PROVISIONAL: they appear only in the separately labelled Provisional view and never move a verified rank, Skill Score,
 * board snapshot or Points.
 */
export const VERIFIED_BASIS = {
  id: "final-onchain-only",
  rule: "Only outcomes in the Final on-chain state (AtlasOutcomeRegistry, after the dispute window) or on-chain cancellations/forfeits count.",
} as const;
export type ArenaBasis = "verified" | "provisional";
export const isOutcomeFinal = (t: Pick<ArenaThesis, "outcome" | "outcomeState">) => t.outcomeState === "Final" || t.outcome === "Cancelled" || t.outcome === "Forfeited";
/** Outcome-only predicate (no finality check). Use isScored() for anything that ranks or scores. */
export const isScoredOutcome = (t: ArenaThesis) =>
  t.outcome === "TargetHit" || t.outcome === "InvalidationHit" || t.outcome === "Expired" || t.outcome === "Forfeited" || (t.outcome === "Cancelled" && !!t.cancelledAfterStart);
/** Counts toward a score: a scored outcome that is Final on-chain (or a record explicitly in the Provisional view). */
export const isScored = (t: ArenaThesis) => isScoredOutcome(t) && (isOutcomeFinal(t) || t.basis === "provisional");
const countsAsDisclosed = (t: ArenaThesis) => isOutcomeFinal(t) || t.basis === "provisional";
export const isAwaitingFinality = (t: ArenaThesis) => !!t.awaitingFinality || (t.outcome !== "Open" && t.basis !== "provisional" && !isOutcomeFinal(t));
/** Verified inputs: every non-final evaluated outcome is treated as still open (its evaluated outcome kept for display only). */
export function verifiedRecords(records: ArenaThesis[]): ArenaThesis[] {
  return records.map((t) => {
    const { basis: _b, ...rest } = t;
    if (rest.outcome === "Open" || isOutcomeFinal(rest)) return rest;
    return { ...rest, outcome: "Open", returnBps: null, resolvedAt: null, awaitingFinality: true, evaluatedOutcome: rest.outcome, evaluatedReturnBps: rest.returnBps, evaluatedResolvedAt: rest.resolvedAt };
  });
}
/** PROVISIONAL VIEW ONLY: evaluated outcomes count as if final. Never persist, snapshot or award Points from these. */
export function provisionalRecords(records: ArenaThesis[]): ArenaThesis[] {
  return records.map((t) => (t.awaitingFinality && t.evaluatedOutcome
    ? { ...t, outcome: t.evaluatedOutcome, returnBps: t.evaluatedReturnBps ?? null, resolvedAt: t.evaluatedResolvedAt ?? null, basis: "provisional" as const }
    : { ...t, basis: "provisional" as const }));
}
export const isWin = (t: ArenaThesis) => WIN.includes(t.outcome);
/** The moment a record counts toward a time window: its resolution (scored) or publication (everything else). */
export const evidenceTime = (t: ArenaThesis) => (isScored(t) || ((t.outcome === "Unresolved" || t.outcome === "Void") && countsAsDisclosed(t)) ? (t.resolvedAt ?? t.publishedAt) : t.publishedAt);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;
/** Pulls a bounded component toward a neutral prior when the sample is small: n/(n+k) weight on the data. */
const shrink = (v: number, n: number, prior = 0.5, k = 5) => prior + (v - prior) * (n / (n + k));

export function inWindow(t: ArenaThesis, window: ArenaWindow, now: number, asOf?: number): boolean {
  const end = asOf ?? now;
  const at = evidenceTime(t);
  if (at > end) return false;
  const span = WINDOWS[window];
  return span === null || at > end - span;
}

// ------------------------------------------------------------------------------- anti-abuse: dedupe
export const DUPLICATE_RULES = { windowSeconds: 24 * 3600, priceTolerance: 0.005 } as const;
export interface DuplicateFinding { thesisId: string; duplicateOf: string; reason: string }

/**
 * Near-duplicate detection. Within 24h, the same author publishing the same asset and direction with target and
 * invalidation prices within 0.5% (or an identical content hash / title) gets ranking and XP credit only once:
 * the earliest thesis is credited, later copies are kept in the public record but excluded from scoring.
 */
export function detectNearDuplicates(theses: ArenaThesis[], rules = DUPLICATE_RULES): Map<string, DuplicateFinding> {
  const out = new Map<string, DuplicateFinding>();
  const sorted = [...theses].sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
  const credited: ArenaThesis[] = [];
  const close = (a: number | null, b: number | null) => a !== null && b !== null && a > 0 && b > 0 && Math.abs(a / b - 1) <= rules.priceTolerance;
  const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const t of sorted) {
    const prior = credited.find((c) =>
      c.authorId === t.authorId && c.asset === t.asset && c.direction === t.direction && t.publishedAt - c.publishedAt <= rules.windowSeconds &&
      ((!!t.contentHash && t.contentHash === c.contentHash) || (norm(t.title).length > 0 && norm(t.title) === norm(c.title)) ||
        (close(t.targetPrice, c.targetPrice) && close(t.invalidationPrice, c.invalidationPrice))));
    if (prior) out.set(t.id, { thesisId: t.id, duplicateOf: prior.id, reason: `Near-duplicate of ${prior.id} (same asset/direction within 24h, terms within 0.5% or identical content)` });
    else credited.push(t);
  }
  return out;
}

// ------------------------------------------------------------------------------- Skill Score v2
export const SKILL_V2 = {
  id: "atlas-skill-v2",
  version: 2,
  status: "provisional" as const,
  weights: { success: 0.35, expectancy: 0.25, calibration: 0.2, consistency: 0.1, evidence: 0.1 },
  eligibility: { emergingMin: 1, rankedMin: 10, establishedMin: 30, minCoverage: 0.6, establishedMinWeeks: 4 },
  downsideFloorBps: 50,
};

export type Tier = "Established" | "Ranked" | "Emerging" | "Unranked";

export interface Component { key: keyof typeof SKILL_V2.weights; label: string; weight: number; raw: number | null; normalized: number; contribution: number; explanation: string }

export interface SkillResult {
  methodology: string;
  score: number; // 0..100
  tier: Tier;
  tierReason: string;
  components: Component[];
  sample: { published: number; credited: number; resolved: number; wins: number; losses: number; unresolved: number; void: number; open: number; excludedDuplicates: number; awaitingFinality: number };
  hitRate: number | null;
  wilsonLower: number | null;
  avgReturnBps: number | null;
  downsideDeviationBps: number | null;
  brier: number | null;
  thesisReturnDrawdownBps: number; // NOT portfolio drawdown: summed hypothetical thesis returns
  evidenceCoverage: number; // 0..1
  activeWeeks: number;
  period: { from: number | null; to: number | null };
  limitations: string[];
}

export function tierFor(resolved: number, coverage: number, activeWeeks: number, flagged = false): { tier: Tier; reason: string } {
  const e = SKILL_V2.eligibility;
  if (flagged) return { tier: "Unranked", reason: "Excluded pending an open integrity review." };
  if (resolved < e.emergingMin) return { tier: "Unranked", reason: "No qualifying resolved on-chain theses yet." };
  if (resolved < e.rankedMin) return { tier: "Emerging", reason: `${resolved} of ${e.rankedMin} qualifying resolved theses needed to be ranked.` };
  if (coverage < e.minCoverage) return { tier: "Unranked", reason: `Evidence coverage ${(coverage * 100).toFixed(0)}% is below the ${e.minCoverage * 100}% minimum.` };
  if (resolved >= e.establishedMin && activeWeeks >= e.establishedMinWeeks) return { tier: "Established", reason: `${resolved} resolved theses across ${activeWeeks} active weeks.` };
  return { tier: "Ranked", reason: resolved >= e.establishedMin ? `Needs ${e.establishedMinWeeks}+ active weeks for Established (has ${activeWeeks}).` : `${resolved} resolved theses (Established at ${e.establishedMin}).` };
}

/**
 * Skill Score v2 for one author over an already window-filtered, de-duplicated sample.
 * Each component is bounded to [0,1] before weighting, so no single extreme value can dominate.
 */
export function skillScoreV2(records: ArenaThesis[], opts: { excludedDuplicates?: number; flagged?: boolean } = {}): SkillResult {
  const w = SKILL_V2.weights;
  const scored = records.filter(isScored);
  const wins = scored.filter(isWin).length;
  const n = scored.length;
  const losses = n - wins;
  const unresolved = records.filter((r) => r.outcome === "Unresolved" && countsAsDisclosed(r)).length;

  // 1. statistically adjusted success: 95% Wilson lower bound of the hit rate (0 with no sample)
  const wl = n ? wilsonLower(wins, n)! : null;
  const success = wl ?? 0;

  // 2. risk-aware expectancy: mean thesis return divided by downside deviation, squashed with tanh and shrunk by sample
  const rets = scored.filter((r) => RETURN_OUTCOMES.includes(r.outcome) && r.returnBps !== null).map((r) => r.returnBps as number);
  const avg = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : null;
  const dd = rets.length ? Math.sqrt(rets.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / rets.length) : null;
  const ratio = avg === null ? 0 : avg / Math.max(SKILL_V2.downsideFloorBps, dd ?? 0);
  const expectancy = avg === null ? 0.5 : shrink(0.5 + Math.tanh(ratio / 2) / 2, rets.length);

  // 3. confidence calibration: Brier 0 -> 1, coin-flip Brier 0.25 -> 0.5, >= 0.5 -> 0; shrunk by sample
  const brier = n ? scored.reduce((s, r) => s + (r.confidence / 100 - (isWin(r) ? 1 : 0)) ** 2, 0) / n : null;
  const calibration = brier === null ? 0.5 : shrink(clamp01(0.5 + (0.25 - brier) * 2), n);

  // 4. consistency across time: Wilson lower bound of the share of active weeks that were net-positive
  const weeks = new Map<number, { w: number; l: number; ret: number }>();
  for (const r of scored) {
    const k = Math.floor((r.resolvedAt ?? r.publishedAt) / WEEK);
    const b = weeks.get(k) ?? { w: 0, l: 0, ret: 0 };
    if (isWin(r)) b.w++; else b.l++;
    b.ret += r.returnBps ?? 0;
    weeks.set(k, b);
  }
  const posWeeks = [...weeks.values()].filter((b) => b.w >= b.l && b.ret >= 0).length;
  const consistency = weeks.size ? wilsonLower(posWeeks, weeks.size)! : 0;

  // 5. evidence completeness: resolved theses with stored, reproducible evidence (or on-chain finality) over all that should have resolved
  const due = n + unresolved;
  const withEvidence = scored.filter((r) => !!r.evidenceHash || r.outcomeState === "Final").length;
  const coverage = due ? withEvidence / due : 0;

  // thesis-return drawdown (kept from v1, explicitly NOT a funded-portfolio drawdown)
  let cum = 0, peak = 0, mdd = 0;
  for (const x of scored.filter((r) => RETURN_OUTCOMES.includes(r.outcome) && r.returnBps !== null).sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0)).map((r) => r.returnBps as number)) {
    cum += x; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum);
  }

  const comps: Component[] = [
    { key: "success", label: "Statistically adjusted success", weight: w.success, raw: wl === null ? null : r4(wl), normalized: r4(success), contribution: 0, explanation: `95% Wilson lower bound of ${wins}/${n} wins. Small samples are pulled down automatically.` },
    { key: "expectancy", label: "Risk-aware thesis expectancy", weight: w.expectancy, raw: avg === null ? null : r2(avg), normalized: r4(expectancy), contribution: 0, explanation: avg === null ? "No resolved returns yet: neutral 0.5." : `Average ${r2(avg)} bps per thesis vs downside deviation ${r2(dd ?? 0)} bps (floor ${SKILL_V2.downsideFloorBps}); bounded with tanh and shrunk by sample size.` },
    { key: "calibration", label: "Confidence calibration", weight: w.calibration, raw: brier === null ? null : r4(brier), normalized: r4(calibration), contribution: 0, explanation: brier === null ? "No scored theses yet: neutral 0.5." : `Brier score ${r4(brier)} of declared confidence vs outcome (0 is perfect, 0.25 is a coin flip).` },
    { key: "consistency", label: "Consistency across time", weight: w.consistency, raw: weeks.size ? r4(posWeeks / weeks.size) : null, normalized: r4(consistency), contribution: 0, explanation: `${posWeeks} of ${weeks.size} active weeks were net-positive (Wilson lower bound).` },
    { key: "evidence", label: "Evidence completeness", weight: w.evidence, raw: due ? r4(coverage) : null, normalized: r4(coverage), contribution: 0, explanation: `${withEvidence} of ${due} due theses have stored ATLAS-M1 evidence or on-chain finality.` },
  ];
  for (const c of comps) c.contribution = r2(100 * c.weight * c.normalized);
  const score = r2(comps.reduce((s, c) => s + c.contribution, 0));
  const { tier, reason } = tierFor(n, coverage, weeks.size, opts.flagged);
  const times = records.map(evidenceTime);
  const limitations = [
    "Thesis returns are reference-market moves under ATLAS-M1, not realized P&L. Fees, slippage and position size are not included.",
    "Thesis Return Drawdown sums hypothetical thesis returns; it is not the drawdown of a funded portfolio.",
    "Provisional methodology: weights are product decisions that have not yet been statistically validated.",
  ];
  if (n < SKILL_V2.eligibility.rankedMin) limitations.unshift(`Small sample: ${n} resolved theses. Treat this score as low-confidence.`);
  if (opts.excludedDuplicates) limitations.push(`${opts.excludedDuplicates} near-duplicate theses were excluded from scoring.`);
  return {
    methodology: SKILL_V2.id, score, tier, tierReason: reason, components: comps,
    sample: { published: records.length + (opts.excludedDuplicates ?? 0), credited: records.length, resolved: n, wins, losses, unresolved, void: records.filter((r) => r.outcome === "Void" && countsAsDisclosed(r)).length, open: records.filter((r) => r.outcome === "Open").length, excludedDuplicates: opts.excludedDuplicates ?? 0, awaitingFinality: records.filter(isAwaitingFinality).length },
    hitRate: n ? r4(wins / n) : null, wilsonLower: wl === null ? null : r4(wl), avgReturnBps: avg === null ? null : r2(avg), downsideDeviationBps: dd === null ? null : r2(dd),
    brier: brier === null ? null : r4(brier), thesisReturnDrawdownBps: r2(mdd), evidenceCoverage: r4(coverage), activeWeeks: weeks.size,
    period: { from: times.length ? Math.min(...times) : null, to: times.length ? Math.max(...times) : null }, limitations,
  };
}

// ------------------------------------------------------------------------------- boards
export interface BoardOptions { window: ArenaWindow; now: number; asOf?: number; asset?: string; minSample?: number; flaggedAuthors?: Set<string>; firstSeen?: Map<string, number> }
export interface BoardEntry { authorId: string; rank: number | null; score: number; tier: Tier; result: SkillResult; demo: boolean; extra?: Record<string, unknown> }
export interface BoardResult { entries: BoardEntry[]; unranked: BoardEntry[]; evidenceCoverage: number; duplicates: DuplicateFinding[]; thresholds: Record<string, unknown>; insufficientEvidence: boolean; sampleSize: number }

/** Shared preparation: dedupe across ALL history (so a copy cannot dodge detection by window), then filter. */
export function prepare(all: ArenaThesis[], o: BoardOptions) {
  const dups = detectNearDuplicates(all);
  const byAuthor = new Map<string, { credited: ArenaThesis[]; dup: number; allCredited: ArenaThesis[] }>();
  for (const t of all) {
    const g = byAuthor.get(t.authorId) ?? { credited: [], dup: 0, allCredited: [] };
    const upTo = o.asOf ?? o.now;
    if (t.publishedAt > upTo) { byAuthor.set(t.authorId, g); continue; }
    if (dups.has(t.id)) { if (inWindow(t, o.window, o.now, o.asOf)) g.dup++; }
    else {
      g.allCredited.push(t);
      if (inWindow(t, o.window, o.now, o.asOf) && (!o.asset || t.asset === o.asset)) g.credited.push(t);
    }
    byAuthor.set(t.authorId, g);
  }
  return { dups, byAuthor };
}

const coverageOf = (rs: SkillResult[]) => {
  const due = rs.reduce((s, r) => s + r.sample.resolved + r.sample.unresolved, 0);
  return due ? r4(rs.reduce((s, r) => s + r.evidenceCoverage * (r.sample.resolved + r.sample.unresolved), 0) / due) : 0;
};
const rankSort = (a: BoardEntry, b: BoardEntry) => b.score - a.score || b.result.sample.resolved - a.result.sample.resolved || a.authorId.localeCompare(b.authorId);

/** Top Analysts: Ranked + Established by Skill Score v2; Emerging listed separately and never ranked. */
export function analystsBoard(all: ArenaThesis[], o: BoardOptions): BoardResult {
  const { dups, byAuthor } = prepare(all, o);
  const out: BoardEntry[] = [];
  for (const [authorId, g] of byAuthor) {
    if (!g.credited.length) continue;
    const res = skillScoreV2(g.credited, { excludedDuplicates: g.dup, flagged: o.flaggedAuthors?.has(authorId) });
    out.push({ authorId, rank: null, score: res.score, tier: res.tier, result: res, demo: g.credited.some((t) => t.demo) });
  }
  const min = Math.max(SKILL_V2.eligibility.rankedMin, o.minSample ?? 0);
  const ranked = out.filter((e) => (e.tier === "Ranked" || e.tier === "Established") && e.result.sample.resolved >= min).sort(rankSort);
  ranked.forEach((e, i) => (e.rank = i + 1));
  const unranked = out.filter((e) => !ranked.includes(e) && e.result.sample.resolved >= (o.minSample ?? 0)).sort(rankSort);
  return { entries: ranked, unranked, evidenceCoverage: coverageOf(out.map((e) => e.result)), duplicates: [...dups.values()], thresholds: { ...SKILL_V2.eligibility, minSample: min }, insufficientEvidence: o.window === "24h" || ranked.length === 0, sampleSize: out.reduce((s, e) => s + e.result.sample.resolved, 0) };
}

export const CONSISTENCY_V1 = { id: "atlas-consistency-v1", version: 1, status: "provisional" as const, weights: { weeklyConsistency: 0.45, riskAdjusted: 0.35, drawdown: 0.2 }, minResolved: 5, minActiveWeeks: 2, minCoverage: 0.6 };

/** Consistent: risk-adjusted consistency from thesis data, with evidence coverage shown. */
export function consistencyBoard(all: ArenaThesis[], o: BoardOptions): BoardResult {
  const { dups, byAuthor } = prepare(all, o);
  const out: BoardEntry[] = [];
  for (const [authorId, g] of byAuthor) {
    if (!g.credited.length) continue;
    const res = skillScoreV2(g.credited, { excludedDuplicates: g.dup, flagged: o.flaggedAuthors?.has(authorId) });
    const k = res.components.find((c) => c.key === "consistency")!.normalized;
    const ra = res.components.find((c) => c.key === "expectancy")!.normalized;
    const ddScore = 1 / (1 + res.thesisReturnDrawdownBps / 1000);
    const W = CONSISTENCY_V1.weights;
    const score = r2(100 * (W.weeklyConsistency * k + W.riskAdjusted * ra + W.drawdown * ddScore));
    const ok = res.sample.resolved >= Math.max(CONSISTENCY_V1.minResolved, o.minSample ?? 0) && res.activeWeeks >= CONSISTENCY_V1.minActiveWeeks && res.evidenceCoverage >= CONSISTENCY_V1.minCoverage && !o.flaggedAuthors?.has(authorId);
    out.push({ authorId, rank: null, score, tier: ok ? res.tier : "Unranked", result: res, demo: g.credited.some((t) => t.demo), extra: { qualifies: ok, weeklyConsistency: k, riskAdjusted: ra, drawdownScore: r4(ddScore) } });
  }
  const ranked = out.filter((e) => e.extra!.qualifies).sort(rankSort);
  ranked.forEach((e, i) => (e.rank = i + 1));
  return { entries: ranked, unranked: out.filter((e) => !e.extra!.qualifies).sort(rankSort), evidenceCoverage: coverageOf(out.map((e) => e.result)), duplicates: [...dups.values()], thresholds: { minResolved: CONSISTENCY_V1.minResolved, minActiveWeeks: CONSISTENCY_V1.minActiveWeeks, minCoverage: CONSISTENCY_V1.minCoverage }, insufficientEvidence: o.window === "24h" || ranked.length === 0, sampleSize: out.reduce((s, e) => s + e.result.sample.resolved, 0) };
}

export const RISING_V1 = { id: "atlas-rising-v1", version: 1, status: "provisional" as const, minWindowResolved: 3, maxAllTimeResolved: 9, maxAccountAgeDays: 120 };

/** Rising Stars: Emerging accounts only (fewer than 10 resolved theses all-time, first thesis within 120 days). */
export function risingBoard(all: ArenaThesis[], o: BoardOptions): BoardResult {
  const { dups, byAuthor } = prepare(all, o);
  const end = o.asOf ?? o.now;
  const out: BoardEntry[] = [];
  for (const [authorId, g] of byAuthor) {
    const allResolved = g.allCredited.filter((t) => isScored(t) && evidenceTime(t) <= end).length;
    const first = Math.min(...g.allCredited.map((t) => t.publishedAt), o.firstSeen?.get(authorId) ?? Infinity);
    if (!g.credited.length || allResolved > RISING_V1.maxAllTimeResolved || !Number.isFinite(first) || end - first > RISING_V1.maxAccountAgeDays * 86_400) continue;
    const res = skillScoreV2(g.credited, { excludedDuplicates: g.dup, flagged: o.flaggedAuthors?.has(authorId) });
    const ok = res.sample.resolved >= Math.max(RISING_V1.minWindowResolved, o.minSample ?? 0) && !o.flaggedAuthors?.has(authorId);
    out.push({ authorId, rank: null, score: res.score, tier: res.tier, result: res, demo: g.credited.some((t) => t.demo), extra: { qualifies: ok, allTimeResolved: allResolved, firstThesisAt: first } });
  }
  const ranked = out.filter((e) => e.extra!.qualifies).sort(rankSort);
  ranked.forEach((e, i) => (e.rank = i + 1));
  return { entries: ranked, unranked: out.filter((e) => !e.extra!.qualifies).sort(rankSort), evidenceCoverage: coverageOf(out.map((e) => e.result)), duplicates: [...dups.values()], thresholds: { ...RISING_V1 }, insufficientEvidence: o.window === "24h" || ranked.length === 0, sampleSize: out.reduce((s, e) => s + e.result.sample.resolved, 0) };
}

/** Top Thesis Moves: largest favourable reference-market outcomes of TargetHit theses. NOT money earned. */
export function thesisMoves(all: ArenaThesis[], o: BoardOptions, limit = 20, perAuthor = 2) {
  const dups = detectNearDuplicates(all);
  const per = new Map<string, number>();
  return all
    .filter((t) => !dups.has(t.id) && t.outcome === "TargetHit" && isScored(t) && t.returnBps !== null && inWindow(t, o.window, o.now, o.asOf) && (!o.asset || t.asset === o.asset))
    .sort((a, b) => (b.returnBps as number) - (a.returnBps as number) || a.id.localeCompare(b.id))
    .filter((t) => { const c = per.get(t.authorId) ?? 0; if (c >= perAuthor) return false; per.set(t.authorId, c + 1); return true; })
    .slice(0, limit);
}

// ------------------------------------------------------------------------------- ATLAS Points
export const POINTS_RULES_V1 = {
  id: "atlas-points-v1",
  version: 1,
  actions: {
    onboarding: { xp: 20, label: "First verified Agent ID onboarding", limit: "Once per Agent ID identity" },
    thesis_published: { xp: 10, label: "Properly structured on-chain thesis", limit: "Once per thesis, max 3 per UTC day, near-duplicates earn 0", dailyCap: 3 },
    thesis_resolved: { xp: 15, label: "Thesis reaches a documented resolution (win or lose)", limit: "Once per resolved thesis" },
    review: { xp: 8, label: "Substantive, valid review", limit: "120+ characters and 20+ words, not your own thesis, not a repeat, max 3 per UTC day", dailyCap: 3, minChars: 120, minWords: 20 },
    challenge_upheld: { xp: 25, label: "Evidence challenge independently upheld", limit: "Once per unique finding (thesis + evidence)" },
    evidence_distinction: { xp: 15, label: "Evidence-quality distinction", limit: "Thesis finalized on-chain with stored evidence, reviewed by another holder, no upheld challenge" },
    squad_milestone: { xp: 10, label: "Squad research milestone", limit: "Squad reaches 5/15/30 resolved on-chain theses and you authored one; max 3 lifetime", milestones: [5, 15, 30], lifetimeCap: 3 },
    engagement: { xp: 0, label: "Likes, follows, comments, reposts", limit: "Never earn XP" },
    volume: { xp: 0, label: "Trading volume or transaction count", limit: "Never earn XP" },
  },
  disclaimer: "ATLAS Points are non-transferable XP for useful contributions. They are not a token, not cash, not an airdrop, and carry no promise of future value. Never take financial risk to earn them.",
} as const;
export type PointKind = "onboarding" | "thesis_published" | "thesis_resolved" | "review" | "challenge_upheld" | "evidence_distinction" | "squad_milestone";

export interface PointFacts {
  userId: string;
  onboarding: { identityKey: string; at: number } | null;
  /** final: the outcome is Final on-chain (resolution XP is awarded only then). */
  theses: { id: string; publishedAt: number; resolvedAt: number | null; outcome: OutcomeName; duplicate: boolean; distinction: boolean; final: boolean }[];
  reviews: { id: string; thesisAuthorId: string; body: string; createdAt: number }[];
  challenges: { id: string; findingKey: string; upheld: boolean; firstForFinding: boolean; at: number }[];
  squadMilestones: { squadId: string; milestone: number; at: number }[];
}
export interface PlannedPointEvent { userId: string; kind: PointKind; xp: number; idempotencyKey: string; sourceId: string; occurredAt: number; rulesVersion: string }

export function isSubstantiveReview(body: string, rules = POINTS_RULES_V1.actions.review) {
  const t = body.trim();
  return t.length >= rules.minChars && t.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length >= rules.minWords;
}
const day = (s: number) => Math.floor(s / 86_400);

/**
 * Deterministic planner: the same facts always produce the same events with the same idempotency keys, so the
 * ledger can be re-synced any number of times without double-crediting. Caps are applied in time order.
 */
export function planPointEvents(f: PointFacts, rules = POINTS_RULES_V1): PlannedPointEvent[] {
  const A = rules.actions;
  const ev: PlannedPointEvent[] = [];
  const add = (kind: PointKind, xp: number, key: string, sourceId: string, at: number) => ev.push({ userId: f.userId, kind, xp, idempotencyKey: key, sourceId, occurredAt: at, rulesVersion: rules.id });
  if (f.onboarding) add("onboarding", A.onboarding.xp, `onboarding:${f.onboarding.identityKey}`, f.onboarding.identityKey, f.onboarding.at);

  const perDay = new Map<number, number>();
  for (const t of [...f.theses].sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id))) {
    if (t.duplicate) continue;
    const c = perDay.get(day(t.publishedAt)) ?? 0;
    if (c < A.thesis_published.dailyCap) { perDay.set(day(t.publishedAt), c + 1); add("thesis_published", A.thesis_published.xp, `thesis-published:${t.id}`, t.id, t.publishedAt); }
    if (["TargetHit", "InvalidationHit", "Expired"].includes(t.outcome) && t.resolvedAt && t.final === true) add("thesis_resolved", A.thesis_resolved.xp, `thesis-resolved:${t.id}`, t.id, t.resolvedAt);
    if (t.distinction && t.resolvedAt) add("evidence_distinction", A.evidence_distinction.xp, `distinction:${t.id}`, t.id, t.resolvedAt);
  }

  const revDay = new Map<number, number>();
  const seen = new Set<string>();
  for (const r of [...f.reviews].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const norm = r.body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (r.thesisAuthorId === f.userId || !isSubstantiveReview(r.body) || seen.has(norm)) continue;
    seen.add(norm);
    const c = revDay.get(day(r.createdAt)) ?? 0;
    if (c >= A.review.dailyCap) continue;
    revDay.set(day(r.createdAt), c + 1);
    add("review", A.review.xp, `review:${r.id}`, r.id, r.createdAt);
  }

  for (const c of f.challenges) if (c.upheld && c.firstForFinding) add("challenge_upheld", A.challenge_upheld.xp, `challenge:${c.findingKey}`, c.id, c.at);

  let squads = 0;
  for (const m of [...f.squadMilestones].sort((a, b) => a.at - b.at || a.milestone - b.milestone)) {
    if (squads >= A.squad_milestone.lifetimeCap) break;
    squads++;
    add("squad_milestone", A.squad_milestone.xp, `squad:${m.squadId}:${m.milestone}`, m.squadId, m.at);
  }
  return ev;
}

export const LEVEL_THRESHOLDS = [0, 40, 100, 200, 350, 550, 800, 1100, 1500, 2000, 2600];
export function levelFor(xp: number) {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (xp >= LEVEL_THRESHOLDS[i]!) level = i + 1;
  const floor = LEVEL_THRESHOLDS[level - 1]!;
  const next = LEVEL_THRESHOLDS[level] ?? null;
  return { level, xp, levelFloor: floor, nextLevelAt: next, progress: next === null ? 1 : r4((xp - floor) / (next - floor)) };
}

export const ACHIEVEMENTS = [
  { id: "founding-agent-id", name: "Founding Agent ID", description: "Verified an Agent ID on ATLAS during the founding season (before 2027-01-01 UTC).", icon: "shield" },
  { id: "thesis-pioneer", name: "Thesis Pioneer", description: "First on-chain thesis reached a documented resolution, win or lose.", icon: "flag" },
  { id: "evidence-reviewer", name: "Evidence Reviewer", description: "Three substantive reviews credited under the points rules.", icon: "search" },
  { id: "weekly-challenger", name: "Weekly Challenger", description: "Resolved on-chain theses in three different weeks.", icon: "calendar" },
  { id: "squad-contributor", name: "Squad Contributor", description: "Authored a resolved thesis that helped a squad reach a research milestone.", icon: "users" },
] as const;
export const FOUNDING_CUTOFF = Date.UTC(2027, 0, 1) / 1000;

/** Achievements are derived from the ledger only, so they can never disagree with the XP history. */
export function achievementsFrom(events: Pick<PlannedPointEvent, "kind" | "occurredAt" | "idempotencyKey">[]) {
  const by = (k: PointKind) => events.filter((e) => e.kind === k).sort((a, b) => a.occurredAt - b.occurredAt);
  const out: { id: string; earnedAt: number; evidenceKey: string }[] = [];
  const ob = by("onboarding")[0];
  if (ob && ob.occurredAt < FOUNDING_CUTOFF) out.push({ id: "founding-agent-id", earnedAt: ob.occurredAt, evidenceKey: ob.idempotencyKey });
  const res = by("thesis_resolved");
  if (res[0]) out.push({ id: "thesis-pioneer", earnedAt: res[0].occurredAt, evidenceKey: res[0].idempotencyKey });
  const rev = by("review");
  if (rev.length >= 3) out.push({ id: "evidence-reviewer", earnedAt: rev[2]!.occurredAt, evidenceKey: rev[2]!.idempotencyKey });
  const weeks: number[] = [];
  for (const e of res) { const w = Math.floor(e.occurredAt / WEEK); if (!weeks.includes(w)) { weeks.push(w); if (weeks.length === 3) { out.push({ id: "weekly-challenger", earnedAt: e.occurredAt, evidenceKey: e.idempotencyKey }); break; } } }
  const sq = by("squad_milestone")[0];
  if (sq) out.push({ id: "squad-contributor", earnedAt: sq.occurredAt, evidenceKey: sq.idempotencyKey });
  return out;
}

export const ARENA_METHODOLOGY_TEXT = {
  analysts: `ATLAS Skill Score v2 (atlas-skill-v2, PROVISIONAL)
Inputs: on-chain committed theses evaluated with ATLAS-M1, near-duplicates removed (same author/asset/direction within 24h with terms within 0.5% or identical content).
score = 100 x (0.35 success + 0.25 expectancy + 0.20 calibration + 0.10 consistency + 0.10 evidence), every component bounded to [0,1]:
- success: 95% Wilson lower bound of wins / resolved.
- expectancy: 0.5 + tanh((avg return / max(50, downside deviation)) / 2) / 2, shrunk toward 0.5 by n/(n+5).
- calibration: 0.5 + 2 x (0.25 - Brier), clamped, shrunk toward 0.5 by n/(n+5).
- consistency: Wilson lower bound of net-positive active weeks / active weeks.
- evidence: resolved theses with stored ATLAS-M1 evidence or on-chain finality / (resolved + unresolved).
Tiers: Emerging 1-9 resolved; Ranked >= 10 with >= 60% evidence coverage; Established >= 30 across >= 4 active weeks; otherwise Unranked.
Thesis Return Drawdown = largest peak-to-trough drop of summed thesis returns. It is NOT a funded-portfolio drawdown.
Returns are reference-market outcomes, not realized P&L. Followers, likes and engagement never affect the score.
The weights are ATLAS product decisions, not a validated statistical model and not a Binance requirement.`,
  consistency: `ATLAS Consistency v1 (atlas-consistency-v1, PROVISIONAL)
score = 100 x (0.45 weekly consistency + 0.35 risk-adjusted expectancy + 0.20 x 1/(1 + Thesis Return Drawdown/1000 bps)).
Qualifies with >= 5 resolved theses across >= 2 active weeks and >= 60% evidence coverage. Coverage is shown on every row.`,
  rising: `ATLAS Rising Stars v1 (atlas-rising-v1, PROVISIONAL)
Emerging accounts only: at most 9 resolved theses all-time and first on-chain thesis within the last 120 days.
Ranked by Skill Score v2 on the selected window with at least 3 resolved theses in the window.`,
  contributors: `ATLAS Points v1 (atlas-points-v1)
Append-only ledger of qualifying events with idempotency keys; balances and levels are derived by summing the ledger, never incremented.
Likes, follows, comments, reposts, trading volume and transaction counts earn 0 XP.
ATLAS Points are non-transferable XP. They are not a token, not cash, not an airdrop.`,
  gainers: `Top Gainers (verified realized P&L) ships in Arena 2.0. It requires attributable acquisitions and disposals, known cost basis, and fees and gas accounted for.
Until then ATLAS shows "Top Thesis Moves": favourable reference-market outcomes of TargetHit theses. These are NOT money earned.`,
  squads: `Squad Championship ships in Arena 3.0: normalized research quality of members' on-chain theses, never pooled assets or wallet wealth.`,
} as const;
