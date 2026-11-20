import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ARENA_METHODOLOGY_TEXT, POINTS_RULES_V1, ACHIEVEMENTS, levelFor } from "@atlas/reputation-engine";
import { METHODOLOGY_M1, METHODOLOGY_M1_HASH } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import { requireAuth, requireModerator, securityEvent } from "../lib/session.js";
import { bad, notFound, conflict } from "../lib/errors.js";
import { resolveUserId } from "./profiles.js";
import {
  skillBoardResponse, gainersResponse, squadsResponse, contributorsResponse, pointsSummary, scoreBreakdown, boardHistory, compareTraders, traderPerformanceEvidence,
  syncPoints, finalizedBlock, aiAnalystsResponse, METHODOLOGIES, methodologyHash, ensureArenaDefinitions, ARENA_RELEASE, type SkillBoard,
} from "../lib/arena.js";
import { METHODOLOGY_TEXT } from "@atlas/reputation-engine";

const windowQ = z.enum(["24h", "7d", "30d", "90d", "all"]).default("90d");
const basisQ = z.enum(["verified", "provisional"]).default("verified");
const boardQ = z.object({ window: windowQ, asset: z.string().regex(/^[A-Z0-9]{2,12}$/).optional(), minSample: z.coerce.number().int().min(0).max(1000).default(0), basis: basisQ });
const TYPES = ["analysts", "gainers", "consistency", "rising", "contributors", "squads"] as const;
const typeP = z.object({ type: z.enum(TYPES) });
const tags = ["arena"];

export async function arenaRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/leaderboards", { schema: { tags, summary: "Arena boards, their status and supported windows" } }, async () => {
    await ensureArenaDefinitions(deps);
    return {
      release: ARENA_RELEASE, windows: ["24h", "7d", "30d", "90d", "all"], defaultWindow: "90d", calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
      boards: [
        { type: "analysts", title: "Top Analysts", status: "live", methodology: METHODOLOGIES.analysts.id, primaryMetric: "ATLAS Skill Score v2 (provisional)" },
        { type: "gainers", title: "Top Gainers", status: "coming_in_arena_2", methodology: null, primaryMetric: "Verified realized P&L (Arena 2.0). Top Thesis Moves shown meanwhile, not money earned." },
        { type: "consistency", title: "Consistent", status: "live", methodology: METHODOLOGIES.consistency.id, primaryMetric: "Risk-adjusted consistency with evidence coverage" },
        { type: "rising", title: "Rising Stars", status: "live", methodology: METHODOLOGIES.rising.id, primaryMetric: "Recent Skill Score v2 for Emerging accounts" },
        { type: "ai-analysts", title: "AI Analysts", status: "live", methodology: METHODOLOGIES.analysts.id, primaryMetric: "Skill Score v2 over AI-agent-authored theses only (separate population, no Points)" },
        { type: "contributors", title: "ATLAS Points", status: "live", methodology: METHODOLOGIES.contributors.id, primaryMetric: "Quality-weighted XP (not a token)" },
        { type: "squads", title: "Squad Championship", status: "coming_in_arena_3", methodology: null, primaryMetric: "Normalized research quality (Arena 3.0)" },
      ],
      note: "Each board measures a different thing. ATLAS never merges them into one 'best trader' score.",
      bases: { default: "verified", verified: "Only outcomes Final on-chain (after the public dispute window) count.", provisional: "Add ?basis=provisional for off-chain evaluations awaiting finality. Separately labelled; never affects verified ranks, Skill Score or Points." },
    };
  });

  for (const board of ["analysts", "consistency", "rising"] as SkillBoard[]) {
    r.get(`/leaderboards/${board}`, { schema: { tags, querystring: boardQ } }, async (req) => skillBoardResponse(deps, board, { window: req.query.window, asset: req.query.asset, minSample: req.query.minSample, basis: req.query.basis }));
  }
  r.get("/leaderboards/gainers", { schema: { tags, querystring: boardQ } }, async (req) => gainersResponse(deps, { window: req.query.window, asset: req.query.asset, basis: req.query.basis }));
  r.get("/leaderboards/contributors", { schema: { tags, querystring: z.object({ window: windowQ }) } }, async (req) => contributorsResponse(deps, { window: req.query.window }));
  r.get("/leaderboards/squads", { schema: { tags } }, async () => squadsResponse(deps));
  r.get("/leaderboards/ai-analysts", { schema: { tags, summary: "AI Analysts: Skill Score v2 over AI-agent-authored theses only (separate from human boards; earns no Points)", querystring: boardQ } }, async (req) => aiAnalystsResponse(deps, { window: req.query.window, asset: req.query.asset, minSample: req.query.minSample, basis: req.query.basis }));

  r.get("/leaderboards/me", { schema: { tags, querystring: z.object({ window: windowQ }) } }, async (req) => {
    const a = requireAuth(req);
    const boards: Record<string, unknown> = {};
    for (const b of ["analysts", "consistency", "rising"] as SkillBoard[]) {
      const res = await skillBoardResponse(deps, b, { window: req.query.window, snapshot: false });
      const e = [...res.entries, ...res.unranked].find((x) => x.profile?.userId === a.userId);
      boards[b] = e ? { rank: e.rank, tier: e.tier, tierReason: e.tierReason, score: e.score, resolved: e.resolved } : { rank: null, tier: "Unranked", tierReason: "No qualifying resolved on-chain theses in this window.", score: null, resolved: 0 };
    }
    const points = await pointsSummary(deps, a.userId);
    return { userId: a.userId, window: req.query.window, boards, points: { xp: points.xp, level: points.level }, methodology: { id: METHODOLOGIES.analysts.id, version: 2, status: "provisional" }, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps) };
  });

  r.get("/leaderboards/:type/methodology", { schema: { tags, params: typeP } }, async (req) => {
    await ensureArenaDefinitions(deps);
    const t = req.params.type;
    const m = (METHODOLOGIES as any)[t];
    const stored = m ? (await deps.db.sys(`SELECT id, version, status, hash, created_at FROM scoring_methodologies WHERE board = $1 ORDER BY version`, [t])) : [];
    return {
      type: t, text: (ARENA_METHODOLOGY_TEXT as any)[t], current: m ? { id: m.id, version: m.version, status: m.status, hash: methodologyHash(m), definition: m.definition } : null, versions: stored,
      // the original Performance methodology view is preserved here
      reputationV1: METHODOLOGY_TEXT, outcomes: METHODOLOGY_M1, outcomesHash: METHODOLOGY_M1_HASH,
      calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps),
    };
  });

  r.get("/leaderboards/:type/history", { schema: { tags, params: typeP, querystring: z.object({ window: windowQ, userId: z.string().optional() }) } }, async (req) => {
    const t = req.params.type;
    if (t === "gainers" || t === "squads") return { board: t, window: req.query.window, snapshots: [], note: "This board has no ranking history yet." };
    const userId = req.query.userId ? await resolveUserId(deps, req.query.userId) : undefined;
    return { ...(await boardHistory(deps, t, req.query.window, userId)), methodology: { id: (METHODOLOGIES as any)[t].id }, calculatedAt: new Date().toISOString(), finalizedBlock: await finalizedBlock(deps) };
  });

  r.get("/users/:id/score-breakdown", { schema: { tags, params: z.object({ id: z.string() }), querystring: z.object({ window: windowQ }) } }, async (req) =>
    scoreBreakdown(deps, await resolveUserId(deps, req.params.id), req.query.window));

  r.get("/users/:id/arena", { schema: { tags, summary: "Public Arena summary for a profile: level, XP, achievements", params: z.object({ id: z.string() }) } }, async (req) => {
    const userId = await resolveUserId(deps, req.params.id);
    await syncPoints(deps, userId);
    const [lv] = await deps.db.sys(`SELECT xp FROM user_levels WHERE user_id = $1`, [userId]);
    const earned = await deps.db.sys(`SELECT achievement_id, earned_at FROM user_achievements WHERE user_id = $1 ORDER BY earned_at`, [userId]);
    return { userId, xp: lv?.xp ?? 0, level: levelFor(lv?.xp ?? 0), achievements: earned.map((e) => ({ ...ACHIEVEMENTS.find((a) => a.id === e.achievement_id)!, earnedAt: e.earned_at })),
      disclaimer: POINTS_RULES_V1.disclaimer, methodology: { id: POINTS_RULES_V1.id, version: POINTS_RULES_V1.version }, calculatedAt: new Date().toISOString() };
  });

  r.get("/points/me", { schema: { tags } }, async (req) => pointsSummary(deps, requireAuth(req).userId));
  r.get("/points/me/history", { schema: { tags, querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }) } }, async (req) => {
    const a = requireAuth(req);
    await syncPoints(deps, a.userId);
    // RLS: the ledger is read as the app role bound to this user; other users' events are invisible at the database layer
    const events = await deps.db.as(a.userId, (q) => q(`SELECT id, kind, xp, idempotency_key, source_id, rules_version, occurred_at, created_at FROM point_events ORDER BY occurred_at DESC, id LIMIT $1`, [req.query.limit]));
    return { userId: a.userId, events, rulesVersion: POINTS_RULES_V1.id, disclaimer: POINTS_RULES_V1.disclaimer, methodology: { id: POINTS_RULES_V1.id, version: 1 }, calculatedAt: new Date().toISOString() };
  });
  r.get("/achievements/me", { schema: { tags } }, async (req) => {
    const s = await pointsSummary(deps, requireAuth(req).userId);
    return { userId: s.userId, achievements: s.achievements, note: "Achievements are non-transferable recognition derived from the XP ledger. They do not imply profitable trading.", methodology: s.methodology, calculatedAt: s.calculatedAt };
  });

  r.get("/seasons", { schema: { tags } }, async () => ({ seasons: await deps.db.sys(`SELECT id, slug, name, starts_at, ends_at, status FROM leaderboard_seasons ORDER BY starts_at DESC`), note: "Seasonal leagues arrive in Arena 3.0." }));

  r.get("/traders/compare", { schema: { tags, querystring: z.object({ ids: z.string(), window: windowQ }) } }, async (req) => {
    const raw = [...new Set(req.query.ids.split(",").map((s) => s.trim()).filter(Boolean))];
    if (raw.length < 2 || raw.length > 3) throw bad("COMPARE_RANGE", "Compare 2 or 3 traders");
    const ids = await Promise.all(raw.map((x) => resolveUserId(deps, x)));
    return compareTraders(deps, ids, req.query.window);
  });
  r.get("/traders/:id/performance-evidence", { schema: { tags, params: z.object({ id: z.string() }) } }, async (req) => traderPerformanceEvidence(deps, await resolveUserId(deps, req.params.id)));

  // moderator adjudication of evidence challenges ("independently upheld" -> +25 XP to the first challenger of that finding)
  r.post("/admin/challenges/:id/adjudicate", { schema: { tags: ["moderation"], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(["upheld", "rejected"]), note: z.string().min(3).max(1000) }) } }, async (req) => {
    const mod = requireModerator(req);
    const [c] = await deps.db.sys(`SELECT * FROM evidence_challenges WHERE id = $1`, [req.params.id]);
    if (!c) throw notFound("Challenge");
    if (c.challenger_id === mod.userId) throw conflict("SELF_ADJUDICATION", "You cannot adjudicate your own challenge");
    const [u] = await deps.db.sys(`UPDATE evidence_challenges SET status = $2, adjudicated_by = $3, adjudicated_at = now(), adjudication_note = $4 WHERE id = $1 AND status = 'open' RETURNING id, status`, [c.id, req.body.decision, mod.userId, req.body.note]);
    if (!u) throw conflict("ALREADY_ADJUDICATED", "This challenge was already adjudicated");
    await securityEvent(deps, mod.userId, "challenge.adjudicated", { challengeId: c.id, decision: req.body.decision });
    if (c.challenger_id) await syncPoints(deps, c.challenger_id);
    return { ok: true, status: u.status };
  });
}
