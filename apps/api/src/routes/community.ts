import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { computePerformance, METHODOLOGY_TEXT, type ThesisRecord } from "@atlas/reputation-engine";
import { METHODOLOGY_M1, METHODOLOGY_M1_HASH, METHODOLOGY_CURRENT, METHODOLOGY_CURRENT_HASH, marketByAsset } from "@atlas/shared-types";
import { NOTIFICATION_KINDS } from "@atlas/notification-worker";
import type { Deps } from "../deps.js";
import { bad, conflict, forbidden, notFound, ApiError } from "../lib/errors.js";
import { requireAuth, requireCsrf } from "../lib/session.js";
import { publicProfile, PROFILE_COLUMNS } from "../lib/views.js";
import { loadPosts } from "../lib/posts.js";
import { resolveUserId } from "./profiles.js";
import { extractLinks, scanLinks } from "../lib/links.js";

const uuid = z.string().uuid();

export async function performanceFor(deps: Deps, userId: string) {
  // audit 2026-11-20 F2: verified stats count only outcomes Final on-chain (or on-chain cancels/forfeits); others stay open
  const rows = await deps.db.sys(`SELECT CASE WHEN outcome IN ('Open','Cancelled','Forfeited') OR outcome_state = 'Final' THEN outcome ELSE 'Open' END AS outcome,
      CASE WHEN outcome_state = 'Final' THEN return_bps ELSE NULL END AS return_bps, confidence, chain_status,
      CASE WHEN outcome IN ('Cancelled','Forfeited') OR outcome_state = 'Final' THEN resolved_at ELSE NULL END AS resolved_at, cancelled_after_start FROM theses WHERE author_id = $1 AND chain_status IN ('published','committed','cancelled') AND publish_tx IS NOT NULL AND agent_attribution_id IS NULL`, [userId]);
  const recs: ThesisRecord[] = rows.map((r) => ({
    outcome: r.outcome, returnBps: r.return_bps, confidence: r.confidence, onchain: true,
    resolvedAt: r.resolved_at ? Math.floor(new Date(r.resolved_at).getTime() / 1000) : null, cancelledAfterStart: r.cancelled_after_start,
  }));
  return computePerformance(recs);
}

async function squadBySlugOrId(deps: Deps, key: string) {
  const [s] = await deps.db.sys(`SELECT * FROM squads WHERE ${/^[0-9a-f-]{36}$/i.test(key) ? "id = $1" : "slug = $1"}`, [key]);
  if (!s) throw notFound("Squad");
  return s;
}

export async function communityRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------- squads
  r.get("/squads", { schema: { tags: ["squads"] } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    return deps.db.sys(`SELECT s.id, s.slug, s.name, s.description, s.topics, s.created_at, (SELECT count(*)::int FROM squad_members m WHERE m.squad_id = s.id) AS members,
      EXISTS (SELECT 1 FROM squad_members m WHERE m.squad_id = s.id AND m.user_id = $1::uuid) AS joined FROM squads s ORDER BY members DESC, s.created_at LIMIT 100`, [viewer]);
  });

  r.post("/squads", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } }, schema: { tags: ["squads"], body: z.object({ slug: z.string().regex(/^[a-z0-9-]{3,40}$/), name: z.string().min(3).max(60), description: z.string().max(500).default(""), topics: z.array(z.string().max(30)).max(8).default([]) }) } }, async (req) => {
    const a = requireCsrf(req);
    try {
      return await deps.db.sysTx(async (q) => {
        const [s] = await q(`INSERT INTO squads (slug, name, description, owner_id, topics) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.body.slug, req.body.name, req.body.description, a.userId, req.body.topics]);
        await q(`INSERT INTO squad_members (squad_id, user_id, role) VALUES ($1,$2,'owner')`, [s.id, a.userId]);
        return s;
      });
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("SLUG_TAKEN", "That squad URL is taken");
      throw e;
    }
  });

  r.get("/squads/:id", { schema: { tags: ["squads"], params: z.object({ id: z.string() }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const s = await squadBySlugOrId(deps, req.params.id);
    const posts = await deps.db.as(viewer, (q) => loadPosts(q, viewer, `p.squad_id = $1 AND p.moderation_status <> 'removed' AND p.reply_to IS NULL`, [s.id]));
    const watchlist = await deps.db.sys(`SELECT asset, added_at FROM squad_watchlist WHERE squad_id = $1 ORDER BY added_at`, [s.id]);
    const [me] = viewer ? await deps.db.sys(`SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2`, [s.id, viewer]) : [];
    // competition: members' on-chain theses created in the last 30 days, compared by the published methodology
    const comp = await deps.db.sys(`SELECT t.author_id, p.agent_name, count(*)::int AS theses, count(*) FILTER (WHERE t.outcome = 'TargetHit')::int AS hits,
        count(*) FILTER (WHERE t.outcome IN ('InvalidationHit','Forfeited'))::int AS misses, coalesce(avg(t.return_bps) FILTER (WHERE t.return_bps IS NOT NULL), 0)::int AS avg_bps
      FROM theses t JOIN squad_members m ON m.user_id = t.author_id AND m.squad_id = $1 JOIN profiles p ON p.user_id = t.author_id
      WHERE t.chain_status = 'published' AND t.created_at > now() - interval '30 days' GROUP BY t.author_id, p.agent_name ORDER BY hits DESC, theses DESC LIMIT 20`, [s.id]);
    return { ...s, role: me?.role ?? null, posts, watchlist, competition: { rules: "Documented on-chain predictions only, scored by ATLAS-M1. No deposits, no pooled funds.", standings: comp } };
  });

  r.get("/squads/:id/members", { schema: { tags: ["squads"], params: z.object({ id: z.string() }) } }, async (req) => {
    const s = await squadBySlugOrId(deps, req.params.id);
    const rows = await deps.db.sys(`SELECT m.role, m.joined_at, ${PROFILE_COLUMNS} FROM squad_members m JOIN profiles p ON p.user_id = m.user_id WHERE m.squad_id = $1 ORDER BY m.role, m.joined_at`, [s.id]);
    return rows.map((x) => ({ role: x.role, joinedAt: x.joined_at, profile: publicProfile(x) }));
  });

  r.post("/squads/:id/members", { schema: { tags: ["squads"], summary: "Join a squad (no funds are pooled)", params: z.object({ id: z.string() }) } }, async (req) => {
    const a = requireCsrf(req);
    const s = await squadBySlugOrId(deps, req.params.id);
    await deps.db.sys(`INSERT INTO squad_members (squad_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [s.id, a.userId]);
    return { ok: true };
  });

  r.delete("/squads/:id/members/:userId", { schema: { tags: ["squads"], params: z.object({ id: z.string(), userId: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const s = await squadBySlugOrId(deps, req.params.id);
    const [me] = await deps.db.sys(`SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2`, [s.id, a.userId]);
    const self = req.params.userId === a.userId;
    if (!self && !(me && (me.role === "owner" || me.role === "moderator"))) throw forbidden("SQUAD_MOD_ONLY", "Only squad moderators can remove members");
    if (req.params.userId === s.owner_id) throw bad("OWNER", "The owner cannot be removed");
    await deps.db.sys(`DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2`, [s.id, req.params.userId]);
    return { ok: true };
  });

  r.patch("/squads/:id/members/:userId", { schema: { tags: ["squads"], params: z.object({ id: z.string(), userId: uuid }), body: z.object({ role: z.enum(["moderator", "member"]) }) } }, async (req) => {
    const a = requireCsrf(req);
    const s = await squadBySlugOrId(deps, req.params.id);
    if (s.owner_id !== a.userId) throw forbidden("OWNER_ONLY", "Only the owner appoints moderators");
    await deps.db.sys(`UPDATE squad_members SET role = $3 WHERE squad_id = $1 AND user_id = $2 AND role <> 'owner'`, [s.id, req.params.userId, req.body.role]);
    return { ok: true };
  });

  r.put("/squads/:id/watchlist/:asset", { schema: { tags: ["squads"], params: z.object({ id: z.string(), asset: z.string() }) } }, async (req) => {
    const a = requireCsrf(req);
    const s = await squadBySlugOrId(deps, req.params.id);
    const [me] = await deps.db.sys(`SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2`, [s.id, a.userId]);
    if (!me) throw forbidden("NOT_SQUAD_MEMBER", "Members only");
    if (!marketByAsset(req.params.asset)) throw bad("UNSUPPORTED_ASSET", "Unsupported market");
    await deps.db.sys(`INSERT INTO squad_watchlist (squad_id, asset, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [s.id, req.params.asset.toUpperCase(), a.userId]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- performance
  r.get("/performance/methodology", { schema: { tags: ["performance"] } }, async () => ({ reputation: METHODOLOGY_TEXT, outcomes: METHODOLOGY_CURRENT, outcomesHash: METHODOLOGY_CURRENT_HASH, legacyOutcomes: [{ methodology: METHODOLOGY_M1, hash: METHODOLOGY_M1_HASH }] }));

  r.get("/performance/leaderboard", { schema: { tags: ["performance"], querystring: z.object({ minScored: z.coerce.number().int().min(0).default(3) }) } }, async (req) => {
    const authors = await deps.db.sys(`SELECT DISTINCT t.author_id, ${PROFILE_COLUMNS} FROM theses t JOIN profiles p ON p.user_id = t.author_id WHERE t.publish_tx IS NOT NULL AND t.agent_attribution_id IS NULL`);
    const rows = await Promise.all(authors.map(async (a) => ({ profile: publicProfile(a), stats: await performanceFor(deps, a.author_id) })));
    return {
      note: "Ranked by evidence-weighted reputation (shrunk hit rate, calibration and sample size), not by profit or followers. Small samples are flagged.",
      items: rows.filter((x) => x.stats.scored >= req.query.minScored).sort((a, b) => b.stats.reputation - a.stats.reputation),
      emerging: rows.filter((x) => x.stats.scored < req.query.minScored).map((x) => ({ ...x, stats: { ...x.stats } })),
    };
  });

  r.get("/performance/:userId", { schema: { tags: ["performance"], params: z.object({ userId: z.string() }) } }, async (req) => {
    const userId = await resolveUserId(deps, req.params.userId);
    const stats = await performanceFor(deps, userId);
    const history = await deps.db.sys(`SELECT id, asset, direction, outcome, return_bps, confidence, chain_status, published_at, resolved_at, publish_tx FROM theses WHERE author_id = $1 AND publish_tx IS NOT NULL AND agent_attribution_id IS NULL ORDER BY coalesce(published_at, created_at) DESC LIMIT 200`, [userId]);
    const [trades] = await deps.db.sys(`SELECT count(*)::int AS verified FROM trade_proofs WHERE user_id = $1 AND status = 'VERIFIED'`, [userId]);
    return { userId, stats, history, verifiedTrades: trades.verified, disclosure: "Outcomes measure whether published conditions were met, not realized profit. Fees, slippage and position sizes are not included. Unresolved, void and open theses are shown separately." };
  });

  // ---------------------------------------------------------------- notifications
  r.get("/notifications", { schema: { tags: ["notifications"], querystring: z.object({ unread: z.coerce.boolean().default(false) }) } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT n.id, n.kind, n.subject_id, n.data, n.read_at, n.created_at, p.agent_name AS actor_name, p.avatar_url AS actor_avatar
      FROM notifications n LEFT JOIN profiles p ON p.user_id = n.actor_id ${req.query.unread ? "WHERE n.read_at IS NULL" : ""} ORDER BY n.created_at DESC LIMIT 100`));
  });
  r.post("/notifications/read", { schema: { tags: ["notifications"], body: z.object({ ids: z.array(uuid).max(200).optional() }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => req.body.ids ? q(`UPDATE notifications SET read_at = now() WHERE id = ANY($1::uuid[]) AND read_at IS NULL`, [req.body.ids]) : q(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`));
    return { ok: true };
  });
  r.get("/notifications/preferences", { schema: { tags: ["notifications"] } }, async (req) => {
    const a = requireAuth(req);
    const [p] = await deps.db.as(a.userId, (q) => q(`SELECT muted_kinds FROM notification_prefs`));
    return { kinds: NOTIFICATION_KINDS, muted: p?.muted_kinds ?? [] };
  });
  r.put("/notifications/preferences", { schema: { tags: ["notifications"], body: z.object({ muted: z.array(z.enum(NOTIFICATION_KINDS)).max(20) }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`INSERT INTO notification_prefs (user_id, muted_kinds) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET muted_kinds = EXCLUDED.muted_kinds, updated_at = now()`, [a.userId, req.body.muted]));
    return { ok: true };
  });

  // ---------------------------------------------------------------- direct messages (encrypted at rest, opt-in)
  r.get("/messages", { schema: { tags: ["messages"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT c.id, (SELECT json_agg(json_build_object('userId', p.user_id, 'agentName', p.agent_name, 'avatarUrl', p.avatar_url)) FROM conversation_members m2 JOIN profiles p ON p.user_id = m2.user_id WHERE m2.conversation_id = c.id AND m2.user_id <> $1) AS others,
        (SELECT max(created_at) FROM messages x WHERE x.conversation_id = c.id) AS last_at, m.last_read_at
      FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1 ORDER BY last_at DESC NULLS LAST`, [a.userId]));
  });

  r.post("/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["messages"], summary: "Send a direct message (encrypted at rest; not end-to-end encrypted)", body: z.object({ to: uuid.optional(), conversationId: uuid.optional(), body: z.string().min(1).max(4000) }) } }, async (req) => {
    const a = requireCsrf(req);
    let convId = req.body.conversationId;
    if (!convId) {
      const to = req.body.to;
      if (!to || to === a.userId) throw bad("RECIPIENT_REQUIRED", "Recipient required");
      const [ps] = await deps.db.sys(`SELECT dm_policy FROM privacy_settings WHERE user_id = $1`, [to]);
      if (!ps) throw notFound("Recipient");
      const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)`, [to, a.userId]);
      if (blocked.length) throw forbidden("BLOCKED", "You cannot message this account");
      if (ps.dm_policy === "nobody") throw forbidden("DMS_CLOSED", "This account does not accept messages");
      if (ps.dm_policy === "following") {
        const f = await deps.db.sys(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [to, a.userId]);
        if (!f.length) throw forbidden("DMS_FOLLOWING_ONLY", "This account only accepts messages from accounts it follows");
      }
      const [existing] = await deps.db.sys(`SELECT m1.conversation_id FROM conversation_members m1 JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id AND m2.user_id = $2 WHERE m1.user_id = $1 AND (SELECT count(*) FROM conversation_members m3 WHERE m3.conversation_id = m1.conversation_id) = 2 LIMIT 1`, [a.userId, to]);
      convId = existing?.conversation_id;
      if (!convId) {
        convId = await deps.db.sysTx(async (q) => {
          const [c] = await q(`INSERT INTO conversations DEFAULT VALUES RETURNING id`);
          await q(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`, [c.id, a.userId, to]);
          return c.id as string;
        });
      }
    }
    const warnings = scanLinks(extractLinks(req.body.body), deps.cfg.PUBLIC_ORIGIN);
    const enc = deps.cipher.encrypt(req.body.body, convId!);
    const [m] = await deps.db.as(a.userId, (q) => q(`INSERT INTO messages (conversation_id, sender_id, ciphertext, iv, tag, link_warnings) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`, [convId, a.userId, enc.ciphertext, enc.iv, enc.tag, warnings]))
      .catch((e) => { if (e?.code === "42501") throw forbidden("NOT_MEMBER", "Not a member of this conversation"); throw e; });
    const others = await deps.db.sys(`SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`, [convId, a.userId]);
    for (const o of others) await deps.notify.enqueue({ kind: "message.new", recipientId: o.user_id, actorId: a.userId, subjectId: convId, dedupeKey: `msg:${m.id}`, data: {} });
    return { id: m.id, conversationId: convId, createdAt: m.created_at, linkWarnings: warnings };
  });

  r.get("/messages/:conversationId", { schema: { tags: ["messages"], params: z.object({ conversationId: uuid }) } }, async (req) => {
    const a = requireAuth(req);
    const rows = await deps.db.as(a.userId, async (q) => {
      const ms = await q(`SELECT id, sender_id, ciphertext, iv, tag, link_warnings, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 500`, [req.params.conversationId]);
      if (!ms.length) { const mem = await q(`SELECT 1 FROM conversation_members WHERE conversation_id = $1`, [req.params.conversationId]); if (!mem.length) throw notFound("Conversation"); }
      await q(`UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [req.params.conversationId, a.userId]);
      return ms;
    });
    return rows.map((m) => ({ id: m.id, senderId: m.sender_id, mine: m.sender_id === a.userId, body: deps.cipher.decrypt(m, req.params.conversationId), linkWarnings: m.link_warnings, createdAt: m.created_at }));
  });

  // ---------------------------------------------------------------- moderation
  r.post("/reports", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } }, schema: { tags: ["moderation"], body: z.object({ targetKind: z.enum(["post", "comment", "user", "message", "squad"]), targetId: z.string().max(80), reason: z.enum(["spam", "scam", "impersonation", "harassment", "manipulation", "illegal", "other"]), details: z.string().max(2000).default("") }) } }, async (req) => {
    const a = requireCsrf(req);
    try {
      const [rep] = await deps.db.as(a.userId, (q) => q(`INSERT INTO reports (reporter_id, target_kind, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [a.userId, req.body.targetKind, req.body.targetId, req.body.reason, req.body.details]));
      return { id: rep.id, status: "open" };
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("ALREADY_REPORTED", "You already reported this");
      throw e;
    }
  });
  r.get("/reports", { schema: { tags: ["moderation"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT id, target_kind, target_id, reason, status, created_at FROM reports ORDER BY created_at DESC`));
  });

  r.get("/appeals", { schema: { tags: ["moderation"] } }, async (req) => {
    const a = requireAuth(req);
    const actions = await deps.db.sys(`SELECT id, target_kind, target_id, action, reason, created_at FROM moderation_actions WHERE target_user_id = $1 AND action IN ('remove','limit','suspend') ORDER BY created_at DESC`, [a.userId]);
    const appeals = await deps.db.as(a.userId, (q) => q(`SELECT id, action_id, body, status, created_at FROM appeals ORDER BY created_at DESC`));
    return { actions, appeals };
  });
  r.post("/appeals", { schema: { tags: ["moderation"], body: z.object({ actionId: uuid, body: z.string().min(10).max(3000) }) } }, async (req) => {
    const a = requireCsrf(req);
    const [act] = await deps.db.sys(`SELECT id FROM moderation_actions WHERE id = $1 AND target_user_id = $2`, [req.body.actionId, a.userId]);
    if (!act) throw forbidden("NOT_YOUR_ACTION", "You can only appeal actions taken on your own content");
    try {
      const [ap] = await deps.db.as(a.userId, (q) => q(`INSERT INTO appeals (user_id, action_id, body) VALUES ($1,$2,$3) RETURNING id`, [a.userId, req.body.actionId, req.body.body]));
      return { id: ap.id, status: "open" };
    } catch (e: any) {
      if (e?.code === "23505") throw conflict("ALREADY_APPEALED", "Already appealed");
      throw e;
    }
  });

  void ApiError;
}
