/**
 * ATLAS Arena 1.0 service layer: loads on-chain thesis evidence, runs the pure scoring in
 * @atlas/reputation-engine, persists immutable versioned snapshots and keeps the XP ledger in sync.
 */
import { createHash } from "node:crypto";
import {
  analystsBoard, consistencyBoard, risingBoard, thesisMoves, detectNearDuplicates, skillScoreV2, planPointEvents, levelFor, achievementsFrom,
  inWindow, isScored, SKILL_V2, CONSISTENCY_V1, RISING_V1, POINTS_RULES_V1, ACHIEVEMENTS, ARENA_METHODOLOGY_TEXT, WINDOWS,
  type ArenaThesis, type ArenaWindow, type BoardEntry, type BoardResult, type PointFacts,
} from "@atlas/reputation-engine";
import { explorerTx } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import type { Q } from "../db/index.js";
import { publicProfile, PROFILE_COLUMNS } from "./views.js";

export type SkillBoard = "analysts" | "consistency" | "rising";
export type SnapshotBoard = SkillBoard | "contributors";
export const SNAPSHOT_WINDOWS: ArenaWindow[] = ["7d", "30d", "90d", "all"];
export const ARENA_RELEASE = "1.0";

export const METHODOLOGIES = {
  analysts: { id: SKILL_V2.id, board: "analysts", version: SKILL_V2.version, status: SKILL_V2.status, definition: { weights: SKILL_V2.weights, eligibility: SKILL_V2.eligibility, downsideFloorBps: SKILL_V2.downsideFloorBps }, description: ARENA_METHODOLOGY_TEXT.analysts },
  consistency: { id: CONSISTENCY_V1.id, board: "consistency", version: 1, status: CONSISTENCY_V1.status, definition: CONSISTENCY_V1, description: ARENA_METHODOLOGY_TEXT.consistency },
  rising: { id: RISING_V1.id, board: "rising", version: 1, status: RISING_V1.status, definition: RISING_V1, description: ARENA_METHODOLOGY_TEXT.rising },
  contributors: { id: POINTS_RULES_V1.id, board: "contributors", version: 1, status: "active" as const, definition: POINTS_RULES_V1, description: ARENA_METHODOLOGY_TEXT.contributors },
} as const;
export const methodologyHash = (m: { definition: unknown; description: string }) => `0x${createHash("sha256").update(JSON.stringify(m.definition) + "\n" + m.description).digest("hex")}`;

const sec = (d: Date | string | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : null);
const iso = (s: number) => new Date(s * 1000).toISOString();

const ensured = new WeakSet<object>();
/** Registers methodologies + achievement definitions. A changed rule under an existing id is refused: publish a new version id. */
export async function ensureArenaDefinitions(deps: Deps) {
  if (ensured.has(deps.db)) return;
  for (const m of Object.values(METHODOLOGIES)) {
    const hash = methodologyHash(m);
    await deps.db.sys(`INSERT INTO scoring_methodologies (id, board, version, status, definition, description, hash) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`, [m.id, m.board, m.version, m.status, JSON.stringify(m.definition), m.description, hash]);
    const [row] = await deps.db.sys(`SELECT hash FROM scoring_methodologies WHERE id = $1`, [m.id]);
    if (row.hash !== hash) throw new Error(`Methodology ${m.id} changed without a new version id; publish it under a new id instead of rewriting history`);
  }
  for (const a of ACHIEVEMENTS) await deps.db.sys(`INSERT INTO achievements (id, name, description, icon) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [a.id, a.name, a.description, a.icon]);
  ensured.add(deps.db);
}

// ------------------------------------------------------------------------------------------ evidence
export async function loadArenaTheses(deps: Deps, authorId?: string): Promise<ArenaThesis[]> {
  const rows = await deps.db.sys(
    `SELECT t.id, t.author_id, t.asset, t.direction, t.outcome, t.return_bps, t.confidence, coalesce(t.published_at, t.created_at) AS published_at, t.resolved_at,
            t.cancelled_after_start, t.evidence_hash, t.outcome_state, t.target_price, t.invalidation_price, t.horizon_hours, t.content_hash, t.content->>'title' AS title, t.simulated
       FROM theses t JOIN users u ON u.id = t.author_id
      WHERE t.publish_tx IS NOT NULL AND t.chain_status IN ('published','committed','cancelled') AND u.status = 'active'
        ${deps.contracts.chainId === 56 ? "AND t.simulated = false" : ""} ${authorId ? "AND t.author_id = $1" : ""}`,
    authorId ? [authorId] : [],
  );
  return rows.map((r) => ({
    id: r.id, authorId: r.author_id, asset: r.asset, direction: r.direction, outcome: r.outcome, returnBps: r.return_bps, confidence: r.confidence,
    publishedAt: sec(r.published_at)!, resolvedAt: sec(r.resolved_at), cancelledAfterStart: r.cancelled_after_start, evidenceHash: r.evidence_hash, outcomeState: r.outcome_state,
    targetPrice: r.target_price === null ? null : Number(r.target_price), invalidationPrice: r.invalidation_price === null ? null : Number(r.invalidation_price),
    horizonHours: r.horizon_hours, contentHash: r.content_hash, title: r.title, demo: r.simulated,
  }));
}

export async function excludedAuthors(deps: Deps) {
  const rows = await deps.db.sys(`SELECT DISTINCT user_id FROM ranking_integrity_flags WHERE severity = 'exclude' AND status IN ('open','upheld')`);
  return new Set<string>(rows.map((r) => r.user_id));
}

export async function finalizedBlock(deps: Deps): Promise<number | null> {
  const [r] = await deps.db.sys(`SELECT coalesce((SELECT max(block_number) FROM chain_events WHERE chain_id = $1 AND status = 'final'), (SELECT block FROM chain_cursor WHERE chain_id = $1)) AS b`, [deps.contracts.chainId]);
  return r?.b == null ? null : Number(r.b);
}

/** Records near-duplicate findings as integrity flags (info severity: excluded from credit, not from the board). */
export async function syncDuplicateFlags(deps: Deps, theses: ArenaThesis[]) {
  for (const d of detectNearDuplicates(theses).values()) {
    const t = theses.find((x) => x.id === d.thesisId)!;
    await deps.db.sys(`INSERT INTO ranking_integrity_flags (user_id, thesis_id, kind, severity, status, detail, idempotency_key) VALUES ($1,$2,'near_duplicate','info','upheld',$3,$4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [t.authorId, t.id, { duplicateOf: d.duplicateOf, reason: d.reason, automated: true }, `near_duplicate:${t.id}`]);
  }
}

async function profilesFor(deps: Deps, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const rows = await deps.db.sys(`SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.user_id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r) => [r.user_id as string, publicProfile(r)]));
}

export function entryView(e: BoardEntry, profile: any) {
  const r = e.result;
  return {
    rank: e.rank, tier: e.tier, tierReason: r.tierReason, score: e.score, profile, demo: e.demo,
    resolved: r.sample.resolved, wins: r.sample.wins, losses: r.sample.losses, open: r.sample.open, excludedDuplicates: r.sample.excludedDuplicates,
    hitRate: r.hitRate, wilsonLower: r.wilsonLower, avgReturnBps: r.avgReturnBps, brier: r.brier, thesisReturnDrawdownBps: r.thesisReturnDrawdownBps,
    evidenceCoverage: r.evidenceCoverage, activeWeeks: r.activeWeeks, skillScore: r.score,
    components: r.components.map((c) => ({ key: c.key, label: c.label, weight: c.weight, normalized: c.normalized, contribution: c.contribution })),
    ...(e.extra ? { extra: e.extra } : {}),
  };
}

// ------------------------------------------------------------------------------------------ boards
export interface BoardQuery { window: ArenaWindow; asset?: string; minSample?: number; asOf?: number }

export async function computeSkillBoard(deps: Deps, board: SkillBoard, q: BoardQuery, theses?: ArenaThesis[]) {
  const all = theses ?? (await loadArenaTheses(deps));
  const firstSeen = new Map<string, number>();
  for (const r of await deps.db.sys(`SELECT user_id, min(verified_at) AS at FROM agent_id_links GROUP BY user_id`)) firstSeen.set(r.user_id, sec(r.at)!);
  const opts = { window: q.window, now: deps.now(), asOf: q.asOf, asset: q.asset, minSample: q.minSample, flaggedAuthors: await excludedAuthors(deps), firstSeen };
  const res: BoardResult = board === "analysts" ? analystsBoard(all, opts) : board === "consistency" ? consistencyBoard(all, opts) : risingBoard(all, opts);
  return { res, all };
}

const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/**
 * Persists an immutable snapshot when the computed result differs from the latest one (idempotent:
 * identical inputs map to the same idempotency key, and concurrent writers collapse onto one row).
 */
async function persistSnapshot(deps: Deps, args: { board: SnapshotBoard; window: ArenaWindow; methodologyId: string; asOf: number; coverage: number; sampleSize: number; demo: boolean; backfill?: boolean;
  entries: { userId: string; rank: number | null; tier: string; score: number; components: unknown; sample: unknown }[] }) {
  const content = hashOf({ m: args.methodologyId, w: args.window, e: args.entries.map((e) => [e.userId, e.rank, e.tier, e.score]) });
  const [prev] = await deps.db.sys(`SELECT id, input_hash, computed_at FROM leaderboard_snapshots WHERE board = $1 AND time_window = $2 AND methodology_id = $3 AND backfill = $4 ORDER BY as_of DESC, computed_at DESC LIMIT 1`, [args.board, args.window, args.methodologyId, !!args.backfill]);
  if (!args.backfill && prev?.input_hash === content) return { id: prev.id as string, computedAt: prev.computed_at as Date, created: false };
  const key = args.backfill ? `${args.board}:${args.window}:${args.methodologyId}:asof:${Math.floor(args.asOf / 86_400)}` : `${args.board}:${args.window}:${args.methodologyId}:${content}:after:${prev?.id ?? "genesis"}`;
  const block = await finalizedBlock(deps);
  return deps.db.sysTx(async (q) => {
    const ins = await q(`INSERT INTO leaderboard_snapshots (board, time_window, methodology_id, as_of, finalized_block, evidence_coverage, sample_size, entry_count, input_hash, idempotency_key, backfill, demo)
      VALUES ($1,$2,$3,to_timestamp($4),$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, computed_at`,
      [args.board, args.window, args.methodologyId, args.asOf, block, args.coverage, args.sampleSize, args.entries.length, content, key, !!args.backfill, args.demo]);
    if (!ins.length) {
      const [ex] = await q(`SELECT id, computed_at FROM leaderboard_snapshots WHERE idempotency_key = $1`, [key]);
      return { id: ex.id as string, computedAt: ex.computed_at as Date, created: false };
    }
    for (const e of args.entries) {
      await q(`INSERT INTO leaderboard_entries (snapshot_id, user_id, rank, tier, score, components, sample) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ins[0].id, e.userId, e.rank, e.tier, e.score, JSON.stringify(e.components), JSON.stringify(e.sample)]);
    }
    return { id: ins[0].id as string, computedAt: ins[0].computed_at as Date, created: true };
  });
}

export async function skillBoardResponse(deps: Deps, board: SkillBoard, q: BoardQuery & { snapshot?: boolean }) {
  await ensureArenaDefinitions(deps);
  const { res, all } = await computeSkillBoard(deps, board, q);
  const m = METHODOLOGIES[board];
  const filtered = !!q.asset || (q.minSample ?? 0) > 0;
  const now = q.asOf ?? deps.now();
  let snap: { id: string; computedAt: Date } | null = null;
  if (!filtered && q.window !== "24h" && q.snapshot !== false) {
    await syncDuplicateFlags(deps, all);
    snap = await persistSnapshot(deps, {
      board, window: q.window, methodologyId: m.id, asOf: now, coverage: res.evidenceCoverage, sampleSize: res.sampleSize, demo: [...res.entries, ...res.unranked].some((e) => e.demo),
      entries: [...res.entries, ...res.unranked].map((e) => ({ userId: e.authorId, rank: e.rank, tier: e.tier, score: e.score, components: e.result.components, sample: { ...e.result.sample, coverage: e.result.evidenceCoverage, activeWeeks: e.result.activeWeeks } })),
    });
  }
  const profiles = await profilesFor(deps, [...res.entries, ...res.unranked].map((e) => e.authorId));
  const assets = [...new Set(all.map((t) => t.asset))].sort();
  return {
    board, window: q.window, release: ARENA_RELEASE,
    methodology: { id: m.id, version: m.version, status: m.status, hash: methodologyHash(m) },
    evidenceCoverage: res.evidenceCoverage, sampleSize: res.sampleSize, calculatedAt: (snap?.computedAt ?? new Date()).toISOString(), asOf: iso(now),
    finalizedBlock: await finalizedBlock(deps), snapshotId: snap?.id ?? null, filters: { asset: q.asset ?? null, minSample: q.minSample ?? 0, assets },
    thresholds: res.thresholds, insufficientEvidence: res.insufficientEvidence,
    warning: q.window === "24h" ? "24h windows rarely contain enough resolved theses for a meaningful skill ranking. Treat as recent activity only." : null,
    demo: [...res.entries, ...res.unranked].some((e) => e.demo),
    entries: res.entries.map((e) => entryView(e, profiles.get(e.authorId))),
    unranked: res.unranked.map((e) => entryView(e, profiles.get(e.authorId))),
    emptyState: res.entries.length ? null : "Verified rankings will appear here once Agent ID holders have enough resolved on-chain theses in this window. No fictional users or figures are shown.",
    disclaimer: "Rankings measure published on-chain theses against later reference-market outcomes (ATLAS-M1). They are not realized P&L and not financial advice.",
  };
}

export async function gainersResponse(deps: Deps, q: BoardQuery) {
  const all = await loadArenaTheses(deps);
  const moves = thesisMoves(all, { window: q.window, now: deps.now(), asset: q.asset });
  const profiles = await profilesFor(deps, moves.map((t) => t.authorId));
  return {
    board: "gainers", window: q.window, release: ARENA_RELEASE, status: "coming_in_arena_2",
    methodology: { id: "top-thesis-moves-v1", version: 1, status: "provisional" }, evidenceCoverage: null, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
    realizedPnl: { available: false, message: "Verified realized P&L is coming in Arena 2.0. It needs attributable buys and sells, known cost basis, and fees and gas accounted for. ATLAS will not show profit figures it cannot verify." },
    thesisMoves: {
      label: "Top Thesis Moves: reference-market outcomes, not money earned",
      note: "Largest favourable moves of theses that hit their target under ATLAS-M1 (max 2 per author, near-duplicates excluded). Position size, fees and slippage are unknown, so these are NOT profits.",
      items: moves.map((t) => ({ thesisId: t.id, asset: t.asset, direction: t.direction, returnBps: t.returnBps, resolvedAt: t.resolvedAt ? iso(t.resolvedAt) : null, profile: profiles.get(t.authorId), demo: !!t.demo, title: t.title })),
    },
    demo: moves.some((t) => t.demo),
  };
}

export async function squadsResponse(deps: Deps) {
  const [c] = await deps.db.sys(`SELECT count(*)::int AS squads FROM squads`);
  return {
    board: "squads", release: ARENA_RELEASE, status: "coming_in_arena_3", methodology: { id: "squad-championship", version: 0, status: "planned" }, evidenceCoverage: null, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
    message: "Squad Championship ships in Arena 3.0. It will rank squads by normalized research quality of members' on-chain theses, never by pooled assets or wallet wealth.", squads: c.squads,
  };
}

// ------------------------------------------------------------------------------------------ points
async function pointFacts(deps: Deps, userId: string): Promise<PointFacts> {
  const [link] = await deps.db.sys(`SELECT chain_id, agent_contract, token_id, verified_at FROM agent_id_links WHERE user_id = $1 ORDER BY verified_at LIMIT 1`, [userId]);
  const theses = await loadArenaTheses(deps, userId);
  const dups = detectNearDuplicates(theses);
  const distinct = new Set<string>((await deps.db.sys(`SELECT t.id FROM theses t WHERE t.author_id = $1 AND t.outcome_state = 'Final' AND t.evidence_hash IS NOT NULL
      AND EXISTS (SELECT 1 FROM reviews r WHERE r.thesis_id = t.id AND r.reviewer_id <> t.author_id)
      AND NOT EXISTS (SELECT 1 FROM evidence_challenges c WHERE c.thesis_id = t.id AND c.status = 'upheld')`, [userId])).map((r) => r.id));
  const reviews = await deps.db.sys(`SELECT r.id, r.body, r.created_at, t.author_id FROM reviews r JOIN theses t ON t.id = r.thesis_id WHERE r.reviewer_id = $1 AND t.publish_tx IS NOT NULL`, [userId]);
  const challenges = await deps.db.sys(`SELECT c.id, c.thesis_id, c.evidence_hash, c.status, coalesce(c.adjudicated_at, c.created_at) AS at,
      c.id = (SELECT c2.id FROM evidence_challenges c2 WHERE c2.thesis_id = c.thesis_id AND c2.evidence_hash = c.evidence_hash AND c2.status = 'upheld' ORDER BY c2.created_at, c2.id LIMIT 1) AS first
      FROM evidence_challenges c WHERE c.challenger_id = $1`, [userId]);
  const squadRows = await deps.db.sys(`SELECT t.squad_id, t.author_id, t.resolved_at FROM theses t JOIN squad_members m ON m.squad_id = t.squad_id AND m.user_id = $1
      WHERE t.publish_tx IS NOT NULL AND t.outcome IN ('TargetHit','InvalidationHit','Expired') AND t.resolved_at IS NOT NULL ORDER BY t.squad_id, t.resolved_at, t.id`, [userId]);
  const squadMilestones: PointFacts["squadMilestones"] = [];
  const bySquad = new Map<string, any[]>();
  for (const r of squadRows) bySquad.set(r.squad_id, [...(bySquad.get(r.squad_id) ?? []), r]);
  for (const [squadId, rs] of bySquad) for (const m of POINTS_RULES_V1.actions.squad_milestone.milestones) {
    if (rs.length < m) break;
    if (rs.slice(0, m).some((r) => r.author_id === userId)) squadMilestones.push({ squadId, milestone: m, at: sec(rs[m - 1].resolved_at)! });
  }
  return {
    userId,
    onboarding: link ? { identityKey: `${link.chain_id}:${link.agent_contract}:${link.token_id}`, at: sec(link.verified_at)! } : null,
    theses: theses.map((t) => ({ id: t.id, publishedAt: t.publishedAt, resolvedAt: t.resolvedAt, outcome: t.outcome, duplicate: dups.has(t.id), distinction: distinct.has(t.id) })),
    reviews: reviews.map((r) => ({ id: r.id, thesisAuthorId: r.author_id, body: r.body, createdAt: sec(r.created_at)! })),
    challenges: challenges.map((c) => ({ id: c.id, findingKey: `${c.thesis_id}:${c.evidence_hash}`, upheld: c.status === "upheld", firstForFinding: !!c.first, at: sec(c.at)! })),
    squadMilestones,
  };
}

/** Appends any newly qualifying events (idempotent), then re-derives level and achievements from the ledger. */
export async function syncPoints(deps: Deps, userId: string) {
  await ensureArenaDefinitions(deps);
  const planned = planPointEvents(await pointFacts(deps, userId));
  let added = 0;
  await deps.db.sysTx(async (q) => {
    for (const e of planned) {
      const r = await q(`INSERT INTO point_events (user_id, kind, xp, idempotency_key, source_id, rules_version, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7)) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [e.userId, e.kind, e.xp, e.idempotencyKey, e.sourceId, e.rulesVersion, e.occurredAt]);
      added += r.length;
    }
    await deriveLevel(q, userId);
  });
  return { added };
}

async function deriveLevel(q: Q, userId: string) {
  const [{ xp }] = await q(`SELECT coalesce(sum(xp), 0)::int AS xp FROM point_events WHERE user_id = $1`, [userId]);
  await q(`INSERT INTO user_levels (user_id, xp, level, rules_version, computed_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, rules_version = EXCLUDED.rules_version, computed_at = now()`,
    [userId, xp, levelFor(xp).level, POINTS_RULES_V1.id]);
  const evs = await q(`SELECT kind, idempotency_key, extract(epoch FROM occurred_at)::bigint AS at FROM point_events WHERE user_id = $1`, [userId]);
  for (const a of achievementsFrom(evs.map((e) => ({ kind: e.kind, idempotencyKey: e.idempotency_key, occurredAt: Number(e.at) })))) {
    await q(`INSERT INTO user_achievements (user_id, achievement_id, earned_at, evidence_key) VALUES ($1,$2,to_timestamp($3),$4) ON CONFLICT DO NOTHING`, [userId, a.id, a.earnedAt, a.evidenceKey]);
  }
}

const lastGlobalSync = new WeakMap<object, number>();
export async function syncAllPoints(deps: Deps, force = false) {
  if (!force && Date.now() - (lastGlobalSync.get(deps.db) ?? 0) < 60_000) return;
  lastGlobalSync.set(deps.db, Date.now());
  for (const u of await deps.db.sys(`SELECT u.id FROM users u JOIN agent_id_links l ON l.user_id = u.id AND l.revoked_at IS NULL WHERE u.status = 'active'`)) await syncPoints(deps, u.id);
}

export async function contributorsResponse(deps: Deps, q: BoardQuery & { snapshot?: boolean }) {
  await ensureArenaDefinitions(deps);
  await syncAllPoints(deps);
  const span = WINDOWS[q.window];
  const end = q.asOf ?? deps.now();
  const rows = await deps.db.sys(`SELECT e.user_id, sum(e.xp)::int AS xp, count(*)::int AS events, (SELECT xp FROM user_levels l WHERE l.user_id = e.user_id) AS total_xp,
      bool_or(EXISTS (SELECT 1 FROM theses t WHERE t.author_id = e.user_id AND t.simulated)) AS demo
      FROM point_events e JOIN users u ON u.id = e.user_id AND u.status = 'active'
      WHERE e.occurred_at <= to_timestamp($1) ${span ? "AND e.occurred_at > to_timestamp($1 - $2)" : ""}
      GROUP BY e.user_id HAVING sum(e.xp) > 0 ORDER BY xp DESC, e.user_id LIMIT 100`, span ? [end, span] : [end]);
  const profiles = await profilesFor(deps, rows.map((r) => r.user_id));
  const ach = rows.length ? await deps.db.sys(`SELECT user_id, array_agg(achievement_id ORDER BY earned_at) AS ids FROM user_achievements WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`, [rows.map((r) => r.user_id)]) : [];
  const achBy = new Map(ach.map((a) => [a.user_id, a.ids]));
  const entries = rows.map((r, i) => ({ rank: i + 1, profile: profiles.get(r.user_id), xp: r.xp, events: r.events, level: levelFor(r.total_xp ?? r.xp), achievements: achBy.get(r.user_id) ?? [], demo: !!r.demo }));
  let snap: { id: string; computedAt: Date } | null = null;
  if (q.window !== "24h" && q.snapshot !== false) {
    snap = await persistSnapshot(deps, { board: "contributors", window: q.window, methodologyId: POINTS_RULES_V1.id, asOf: end, coverage: 1, sampleSize: rows.reduce((s, r) => s + r.events, 0), demo: entries.some((e) => e.demo),
      entries: rows.map((r, i) => ({ userId: r.user_id, rank: i + 1, tier: "Ranked", score: r.xp, components: { xp: r.xp }, sample: { events: r.events } })) });
  }
  return {
    board: "contributors", window: q.window, release: ARENA_RELEASE, methodology: { id: POINTS_RULES_V1.id, version: POINTS_RULES_V1.version, status: "active", hash: methodologyHash(METHODOLOGIES.contributors) },
    evidenceCoverage: 1, calculatedAt: (snap?.computedAt ?? new Date()).toISOString(), asOf: iso(end), finalizedBlock: await finalizedBlock(deps), snapshotId: snap?.id ?? null,
    rules: POINTS_RULES_V1.actions, disclaimer: POINTS_RULES_V1.disclaimer, demo: entries.some((e) => e.demo), entries,
    emptyState: entries.length ? null : "Contributor rankings will appear here once Agent ID holders earn ATLAS Points for verified research. No fictional users or figures are shown.",
  };
}

export async function pointsSummary(deps: Deps, userId: string) {
  await syncPoints(deps, userId);
  // read the private ledger through the RLS-restricted app role: a user can only ever sum their own events
  const [{ xp, events }] = await deps.db.as(userId, (q) => q(`SELECT coalesce(sum(xp), 0)::int AS xp, count(*)::int AS events FROM point_events`));
  const byKind = await deps.db.as(userId, (q) => q(`SELECT kind, sum(xp)::int AS xp, count(*)::int AS n FROM point_events GROUP BY kind ORDER BY kind`));
  const earned = await deps.db.sys(`SELECT achievement_id, earned_at FROM user_achievements WHERE user_id = $1`, [userId]);
  return {
    userId, xp, events, level: levelFor(xp), byKind, rulesVersion: POINTS_RULES_V1.id, rules: POINTS_RULES_V1.actions, disclaimer: POINTS_RULES_V1.disclaimer,
    achievements: ACHIEVEMENTS.map((a) => { const e = earned.find((x) => x.achievement_id === a.id); return { ...a, earned: !!e, earnedAt: e?.earned_at ?? null }; }),
    calculatedAt: new Date().toISOString(), methodology: { id: POINTS_RULES_V1.id, version: POINTS_RULES_V1.version }, evidenceCoverage: 1, finalizedBlock: await finalizedBlock(deps),
  };
}

// ------------------------------------------------------------------------------------------ explain
export async function scoreBreakdown(deps: Deps, userId: string, window: ArenaWindow) {
  await ensureArenaDefinitions(deps);
  const all = await loadArenaTheses(deps);
  const mine = all.filter((t) => t.authorId === userId);
  const dups = detectNearDuplicates(all);
  const flagged = await excludedAuthors(deps);
  const now = deps.now();
  const credited = mine.filter((t) => !dups.has(t.id) && inWindow(t, window, now));
  const result = skillScoreV2(credited, { excludedDuplicates: mine.filter((t) => dups.has(t.id) && inWindow(t, window, now)).length, flagged: flagged.has(userId) });
  const ranks: Record<string, number | null> = {};
  for (const b of ["analysts", "consistency", "rising"] as SkillBoard[]) {
    const { res } = await computeSkillBoard(deps, b, { window }, all);
    ranks[b] = res.entries.find((e) => e.authorId === userId)?.rank ?? null;
  }
  const flags = await deps.db.sys(`SELECT id, thesis_id, kind, severity, status, detail, created_at FROM ranking_integrity_flags WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]);
  const txs = new Map((await deps.db.sys(`SELECT id, publish_tx, chain_id FROM theses WHERE author_id = $1`, [userId])).map((r) => [r.id, r]));
  const [profile] = [...(await profilesFor(deps, [userId])).values()];
  return {
    userId, profile, window, ranks, methodology: { id: SKILL_V2.id, version: SKILL_V2.version, status: SKILL_V2.status, weights: SKILL_V2.weights, eligibility: SKILL_V2.eligibility, text: ARENA_METHODOLOGY_TEXT.analysts },
    score: result.score, tier: result.tier, tierReason: result.tierReason, components: result.components, sample: result.sample,
    stats: { hitRate: result.hitRate, wilsonLower: result.wilsonLower, avgReturnBps: result.avgReturnBps, downsideDeviationBps: result.downsideDeviationBps, brier: result.brier, thesisReturnDrawdownBps: result.thesisReturnDrawdownBps, activeWeeks: result.activeWeeks },
    period: { from: result.period.from ? iso(result.period.from) : null, to: result.period.to ? iso(result.period.to) : null },
    limitations: result.limitations, evidenceCoverage: result.evidenceCoverage, demo: mine.some((t) => t.demo),
    theses: mine.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 60).map((t) => {
      const tx = txs.get(t.id);
      const status = dups.has(t.id) ? "excluded_duplicate" : !inWindow(t, window, now) ? "outside_window" : isScored(t) ? "credited" : t.outcome === "Open" ? "open" : "disclosed_not_scored";
      return { id: t.id, asset: t.asset, direction: t.direction, outcome: t.outcome, returnBps: t.returnBps, confidence: t.confidence, publishedAt: iso(t.publishedAt), resolvedAt: t.resolvedAt ? iso(t.resolvedAt) : null,
        evidenceHash: t.evidenceHash, outcomeState: t.outcomeState, status, duplicateOf: dups.get(t.id)?.duplicateOf ?? null, publishTx: tx?.publish_tx ?? null, publishTxUrl: tx?.publish_tx ? explorerTx(Number(tx.chain_id), tx.publish_tx) : null, demo: !!t.demo, title: t.title };
    }),
    integrityFlags: flags,
    calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
  };
}

export async function boardHistory(deps: Deps, board: SnapshotBoard, window: ArenaWindow, userId?: string) {
  const snaps = await deps.db.sys(`SELECT s.id, s.methodology_id, s.as_of, s.computed_at, s.finalized_block, s.evidence_coverage, s.sample_size, s.entry_count, s.backfill, s.demo,
      e.rank, e.tier, e.score FROM leaderboard_snapshots s LEFT JOIN leaderboard_entries e ON e.snapshot_id = s.id AND e.user_id = $3::uuid
      WHERE s.board = $1 AND s.time_window = $2 ORDER BY s.as_of DESC, s.computed_at DESC LIMIT 120`, [board, window, userId ?? null]);
  return {
    board, window, userId: userId ?? null,
    note: "Snapshots are immutable. Each keeps the methodology version it was computed with; history is never recomputed under new rules. Backfilled points were computed later with evidence available at that date.",
    snapshots: snaps.reverse().map((s) => ({ id: s.id, methodologyId: s.methodology_id, asOf: s.as_of, calculatedAt: s.computed_at, finalizedBlock: s.finalized_block == null ? null : Number(s.finalized_block),
      evidenceCoverage: Number(s.evidence_coverage), sampleSize: s.sample_size, entryCount: s.entry_count, backfill: s.backfill, demo: s.demo,
      ...(userId ? { entry: s.tier ? { rank: s.rank, tier: s.tier, score: Number(s.score) } : null } : {}) })),
  };
}

/** Snapshot job: every board x window. Idempotent; safe to run on any schedule or concurrently. */
export async function runArenaSnapshots(deps: Deps, opts: { asOf?: number; backfill?: boolean } = {}) {
  await ensureArenaDefinitions(deps);
  const out: { board: string; window: string; snapshotId: string | null }[] = [];
  const persist = async (board: SnapshotBoard, window: ArenaWindow) => {
    if (opts.backfill) {
      const { res } = await computeSkillBoardOrNull(deps, board, { window, asOf: opts.asOf });
      if (!res) return null;
      return (await persistSnapshot(deps, { board, window, methodologyId: METHODOLOGIES[board].id, asOf: opts.asOf!, coverage: res.evidenceCoverage, sampleSize: res.sampleSize, backfill: true, demo: [...res.entries, ...res.unranked].some((e) => e.demo),
        entries: [...res.entries, ...res.unranked].map((e) => ({ userId: e.authorId, rank: e.rank, tier: e.tier, score: e.score, components: e.result.components, sample: { ...e.result.sample, coverage: e.result.evidenceCoverage } })) })).id;
    }
    const r = board === "contributors" ? await contributorsResponse(deps, { window }) : await skillBoardResponse(deps, board, { window });
    return r.snapshotId;
  };
  for (const board of ["analysts", "consistency", "rising", "contributors"] as SnapshotBoard[]) for (const window of SNAPSHOT_WINDOWS) out.push({ board, window, snapshotId: await persist(board, window) });
  return out;
}
async function computeSkillBoardOrNull(deps: Deps, board: SnapshotBoard, q: BoardQuery) {
  if (board === "contributors") return { res: null };
  return computeSkillBoard(deps, board, q);
}

export async function traderPerformanceEvidence(deps: Deps, userId: string) {
  const theses = await deps.db.sys(`SELECT id, asset, direction, outcome, return_bps, confidence, chain_status, outcome_state, evidence_hash, published_at, resolved_at, publish_tx, chain_id, content->>'title' AS title, simulated
      FROM theses WHERE author_id = $1 AND publish_tx IS NOT NULL ORDER BY coalesce(published_at, created_at) DESC LIMIT 50`, [userId]);
  const trades = await deps.db.sys(`SELECT id, tx_hash, chain_id, verified_at, thesis_id FROM trade_proofs WHERE user_id = $1 AND status = 'VERIFIED' ORDER BY verified_at DESC LIMIT 50`, [userId]);
  const [profile] = [...(await profilesFor(deps, [userId])).values()];
  return {
    userId, profile, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps), methodology: { id: SKILL_V2.id, version: SKILL_V2.version, status: SKILL_V2.status },
    theses: theses.map((t) => ({ id: t.id, title: t.title, asset: t.asset, direction: t.direction, outcome: t.outcome, returnBps: t.return_bps, confidence: t.confidence, chainStatus: t.chain_status, outcomeState: t.outcome_state,
      evidenceHash: t.evidence_hash, publishedAt: t.published_at, resolvedAt: t.resolved_at, publishTx: t.publish_tx, publishTxUrl: explorerTx(Number(t.chain_id), t.publish_tx), demo: t.simulated })),
    verifiedTrades: trades.map((p) => ({ id: p.id, txHash: p.tx_hash, txUrl: explorerTx(Number(p.chain_id), p.tx_hash), verifiedAt: p.verified_at, thesisId: p.thesis_id })),
    evidenceCoverage: theses.length ? theses.filter((t) => t.evidence_hash || t.outcome === "Open").length / theses.length : null,
    disclosure: "Thesis outcomes are reference-market evaluations under ATLAS-M1, not realized profit. Verified trades prove a swap happened; they do not establish cost basis or P&L.",
  };
}

export async function compareTraders(deps: Deps, ids: string[], window: ArenaWindow) {
  const all = await loadArenaTheses(deps);
  const dups = detectNearDuplicates(all);
  const flagged = await excludedAuthors(deps);
  const { res } = await computeSkillBoard(deps, "analysts", { window }, all);
  const profiles = await profilesFor(deps, ids);
  const now = deps.now();
  const trades = new Map((await deps.db.sys(`SELECT user_id, count(*)::int AS n FROM trade_proofs WHERE status = 'VERIFIED' AND user_id = ANY($1::uuid[]) GROUP BY user_id`, [ids])).map((r) => [r.user_id, r.n]));
  return {
    window, methodology: { id: SKILL_V2.id, version: SKILL_V2.version, status: SKILL_V2.status }, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
    traders: ids.map((id) => {
      const mine = all.filter((t) => t.authorId === id);
      const r = skillScoreV2(mine.filter((t) => !dups.has(t.id) && inWindow(t, window, now)), { flagged: flagged.has(id) });
      return { userId: id, profile: profiles.get(id) ?? null, rank: res.entries.find((e) => e.authorId === id)?.rank ?? null, tier: r.tier, skillScore: r.score, resolved: r.sample.resolved, hitRate: r.hitRate,
        calibrationBrier: r.brier, thesisReturnDrawdownBps: r.thesisReturnDrawdownBps, evidenceCoverage: r.evidenceCoverage, activeWeeks: r.activeWeeks, verifiedTrades: trades.get(id) ?? 0,
        components: r.components.map((c) => ({ key: c.key, label: c.label, normalized: c.normalized })), demo: mine.some((t) => t.demo),
        realizedPnl: { available: false, note: "Verified realized P&L arrives in Arena 2.0." } };
    }),
  };
}
