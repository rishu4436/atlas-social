import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { marketByAsset } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import { bad, conflict, forbidden, notFound, ApiError } from "../lib/errors.js";
import { requireAuth, requireCsrf } from "../lib/session.js";
import { extractLinks, scanLinks } from "../lib/links.js";
import { loadPosts, rankForYou } from "../lib/posts.js";

const uuid = z.string().uuid();
const VISIBLE = `p.moderation_status <> 'removed' AND p.reply_to IS NULL`;
const NOT_HIDDEN = (vi: number) => `NOT EXISTS (SELECT 1 FROM mutes m WHERE m.user_id = $${vi}::uuid AND m.muted_id = p.author_id)
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.user_id = $${vi}::uuid AND b.blocked_id = p.author_id)
  AND NOT EXISTS (SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $${vi}::uuid AND r.kind = 'not_interested')`;

export const postInput = z.object({
  kind: z.enum(["post", "chart", "poll"]).default("post"),
  body: z.string().max(5000).default(""),
  topics: z.array(z.string().regex(/^[a-z0-9_]{1,30}$/i)).max(10).default([]),
  chart: z.object({ asset: z.string(), interval: z.enum(["15m", "1h", "4h", "1d"]), from: z.number().int(), to: z.number().int(), annotations: z.array(z.object({ t: z.number(), price: z.number(), label: z.string().max(80) })).max(20).default([]) }).optional(),
  poll: z.object({ options: z.array(z.string().min(1).max(80)).min(2).max(4), closesInHours: z.number().int().min(1).max(168).default(24) }).optional(),
  squadId: uuid.optional(),
  replyTo: uuid.optional(),
  mediaIds: z.array(uuid).max(4).default([]),
});

export async function createPost(deps: Deps, userId: string, input: Omit<z.infer<typeof postInput>, "kind" | "body" | "topics" | "mediaIds"> & { body: string; topics: string[]; mediaIds: string[]; kind: string; thesisId?: string; tradeProofId?: string; aiReport?: unknown }) {
  if (!input.body.trim() && input.kind === "post" && !input.mediaIds.length) throw bad("EMPTY_POST", "Post body is empty");
  if (input.kind === "chart" && (!input.chart || !marketByAsset(input.chart.asset))) throw bad("BAD_CHART", "Chart posts need a supported asset");
  if (input.kind === "poll" && !input.poll) throw bad("BAD_POLL", "Poll options required");
  const links = extractLinks(input.body);
  if (links.length > 5) throw bad("TOO_MANY_LINKS", "Posts may contain at most 5 links");
  const linkWarnings = scanLinks(links);
  const tags = [...new Set([...input.topics, ...[...input.body.matchAll(/#([a-z0-9_]{1,30})/gi)].map((m) => m[1]!)].map((t) => t.toLowerCase()))].slice(0, 10);
  const mentionNames = [...new Set([...input.body.matchAll(/@([a-z0-9-_]{1,64}\.ai)\b/gi)].map((m) => m[1]!.toLowerCase()))].slice(0, 10);
  return deps.db.as(userId, async (q) => {
    // spam: identical body within 10 minutes, or > 30 posts in 10 minutes
    const [recent] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE body = $2 AND body <> '')::int AS dup FROM posts WHERE author_id = $1 AND created_at > now() - interval '10 minutes'`, [userId, input.body]);
    if (recent.dup > 0) throw new ApiError(429, "DUPLICATE_POST", "You just posted the same text");
    if (recent.n >= 30) throw new ApiError(429, "POST_RATE", "Posting too fast");
    if (input.squadId) {
      const [m] = await q(`SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2`, [input.squadId, userId]);
      if (!m) throw forbidden("NOT_SQUAD_MEMBER", "Join the squad to post in it");
    }
    if (input.replyTo) {
      const [parent] = await q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL`, [input.replyTo]);
      if (!parent) throw notFound("Parent post");
    }
    const mentions = mentionNames.length ? (await q(`SELECT user_id FROM profiles WHERE agent_name = ANY($1)`, [mentionNames])).map((r) => r.user_id) : [];
    const media = input.mediaIds.length ? await q(`SELECT id, storage_key, content_type FROM media_objects WHERE id = ANY($1::uuid[]) AND owner_id = $2`, [input.mediaIds, userId]) : [];
    const [p] = await q(
      `INSERT INTO posts (author_id, kind, body, topics, mentions, links, link_warnings, chart, poll, ai_report, media, thesis_id, trade_proof_id, squad_id, reply_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [userId, input.squadId && input.kind === "post" ? "squad" : input.kind, input.body, tags, mentions, links, linkWarnings, input.chart ?? null,
        input.poll ? { options: input.poll.options, closesAt: new Date(Date.now() + input.poll.closesInHours * 3.6e6).toISOString() } : null,
        input.aiReport ?? null, JSON.stringify(media.map((m) => ({ id: m.id, url: `/media/${m.storage_key}`, contentType: m.content_type }))),
        input.thesisId ?? null, input.tradeProofId ?? null, input.squadId ?? null, input.replyTo ?? null],
    );
    for (const m of mentions) await deps.notify.enqueue({ kind: "mention", recipientId: m, actorId: userId, subjectId: p.id, dedupeKey: `mention:${p.id}:${m}`, data: {} });
    return p.id as string;
  });
}

export async function socialRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/feed", {
    schema: { tags: ["social"], summary: "Feed: following | foryou | verified | chronological", querystring: z.object({ tab: z.enum(["following", "foryou", "verified", "chronological"]).default("foryou"), before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(50).default(25), topic: z.string().optional() }) },
  }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const { tab, before, limit, topic } = req.query;
    let tabEff = tab;
    if (tab === "foryou" && viewer) {
      const [ps] = await deps.db.as(viewer, (q) => q(`SELECT personalized_feed FROM privacy_settings WHERE user_id = $1`, [viewer]));
      if (ps && !ps.personalized_feed) tabEff = "chronological";
    }
    if (tab === "following" && !viewer) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to see who you follow");
    return deps.db.as(viewer, async (q) => {
      const params: unknown[] = [];
      const conds = [VISIBLE, "p.squad_id IS NULL OR p.kind <> 'squad'"];
      if (before) { params.push(before); conds.push(`p.created_at < $${params.length}`); }
      if (topic) { params.push(topic.toLowerCase()); conds.push(`$${params.length} = ANY(p.topics)`); }
      params.push(viewer); const vi = params.length;
      conds.push(NOT_HIDDEN(vi));
      if (tabEff === "following") conds.push(`(p.author_id = $${vi}::uuid OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $${vi}::uuid))`);
      if (tabEff === "verified") conds.push(`(p.kind = 'ai_research' OR (p.kind = 'thesis' AND EXISTS (SELECT 1 FROM theses t2 WHERE t2.id = p.thesis_id AND t2.chain_status IN ('published','committed'))) OR (p.kind = 'trade' AND EXISTS (SELECT 1 FROM trade_proofs x WHERE x.id = p.trade_proof_id AND x.status = 'VERIFIED')))`);
      const where = conds.map((c) => `(${c})`).join(" AND ");
      if (tabEff !== "foryou") {
        const items = await loadPosts(q, viewer, where, params, `ORDER BY p.created_at DESC LIMIT ${limit}`);
        return { tab: tabEff, items, nextBefore: items.length === limit ? items[items.length - 1]!.createdAt : null };
      }
      const candidates = await loadPosts(q, viewer, `${where} AND p.created_at > now() - interval '21 days'`, params, `ORDER BY p.created_at DESC LIMIT 300`);
      const following = new Set<string>(viewer ? (await q(`SELECT followee_id FROM follows WHERE follower_id = $1`, [viewer])).map((x) => x.followee_id) : []);
      const interests = new Set<string>(viewer ? ((await q(`SELECT topics FROM profiles WHERE user_id = $1`, [viewer]))[0]?.topics ?? []) : []);
      const reports = new Map<string, number>(
        (await deps.db.sys(`SELECT target_id, count(*)::int AS n FROM reports WHERE target_kind = 'post' AND status = 'open' AND target_id = ANY($1) GROUP BY target_id`, [candidates.map((c) => c.id)])).map((x) => [x.target_id, x.n]),
      );
      const ranked = rankForYou(candidates, { following, interests, reports, now: Date.now() });
      return { tab: "foryou", items: ranked.slice(0, limit), nextBefore: null, algorithm: "ATLAS For You v1: evidence, freshness, relationships, topics, engagement quality; penalises reports, risky links and repeated authors. Not ranked by profit or follower count." };
    });
  });

  r.post("/posts", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["social"], body: postInput } }, async (req) => {
    const a = requireCsrf(req);
    const id = await createPost(deps, a.userId, req.body);
    const [post] = await deps.db.as(a.userId, (q) => loadPosts(q, a.userId, `p.id = $1`, [id]));
    return post;
  });

  r.get("/posts/:id", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const [post] = await deps.db.as(viewer, (q) => loadPosts(q, viewer, `p.id = $1`, [req.params.id]));
    if (!post) throw notFound("Post");
    const replies = await deps.db.as(viewer, (q) => loadPosts(q, viewer, `p.reply_to = $1 AND p.moderation_status <> 'removed'`, [req.params.id], `ORDER BY p.created_at ASC LIMIT 100`));
    return { ...post, replies };
  });

  r.delete("/posts/:id", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const rows = await deps.db.as(a.userId, (q) => q(`UPDATE posts SET deleted_at = now() WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING thesis_id`, [req.params.id, a.userId]));
    if (!rows.length) throw notFound("Post");
    return { ok: true, note: rows[0].thesis_id ? "The post is hidden on ATLAS. Any on-chain thesis remains permanently on the blockchain and in your performance record." : undefined };
  });

  r.post("/posts/:id/vote", { schema: { tags: ["social"], params: z.object({ id: uuid }), body: z.object({ option: z.number().int().min(0).max(3) }) } }, async (req) => {
    const a = requireCsrf(req);
    return deps.db.as(a.userId, async (q) => {
      const [p] = await q(`SELECT poll FROM posts WHERE id = $1 AND kind = 'poll' AND deleted_at IS NULL`, [req.params.id]);
      if (!p) throw notFound("Poll");
      if (new Date(p.poll.closesAt).getTime() < Date.now()) throw bad("POLL_CLOSED", "Poll closed");
      if (req.body.option >= p.poll.options.length) throw bad("BAD_OPTION", "No such option");
      await q(`INSERT INTO poll_votes (post_id, user_id, option) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET option = EXCLUDED.option`, [req.params.id, a.userId, req.body.option]);
      return { ok: true };
    });
  });

  r.post("/posts/:id/bookmark", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`INSERT INTO bookmarks (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.userId, req.params.id]));
    return { ok: true };
  });
  r.delete("/posts/:id/bookmark", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`DELETE FROM bookmarks WHERE post_id = $1`, [req.params.id]));
    return { ok: true };
  });

  // ---------------------------------------------------------------- comments
  r.get("/posts/:id/comments", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    return deps.db.as(viewer, (q) => q(
      `SELECT c.id, c.body, c.created_at, c.author_id, p.agent_name, p.display_name, p.avatar_url, p.is_ai_agent FROM comments c JOIN profiles p ON p.user_id = c.author_id
       WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.moderation_status = 'visible'
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.user_id = $2::uuid AND b.blocked_id = c.author_id)
       ORDER BY c.created_at ASC LIMIT 200`, [req.params.id, viewer]));
  });

  r.post("/comments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["social"], body: z.object({ postId: uuid, body: z.string().min(1).max(2000) }) } }, async (req) => {
    const a = requireCsrf(req);
    return deps.db.as(a.userId, async (q) => {
      const [p] = await q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed'`, [req.body.postId]);
      if (!p) throw notFound("Post");
      const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE user_id = $1 AND blocked_id = $2`, [p.author_id, a.userId]);
      if (blocked.length) throw forbidden("BLOCKED", "You cannot reply to this account");
      const [c] = await q(`INSERT INTO comments (post_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`, [req.body.postId, a.userId, req.body.body]);
      await deps.notify.enqueue({ kind: "comment.new", recipientId: p.author_id, actorId: a.userId, subjectId: req.body.postId, dedupeKey: `comment:${c.id}`, data: {} });
      return { id: c.id, createdAt: c.created_at, linkWarnings: scanLinks(extractLinks(req.body.body)) };
    });
  });

  r.delete("/comments/:id", { schema: { tags: ["social"], params: z.object({ id: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    const rows = await deps.db.as(a.userId, (q) => q(`UPDATE comments SET deleted_at = now() WHERE id = $1 AND author_id = $2 RETURNING id`, [req.params.id, a.userId]));
    if (!rows.length) throw notFound("Comment");
    return { ok: true };
  });

  // ---------------------------------------------------------------- reactions
  const reactionBody = z.object({ postId: uuid, kind: z.enum(["like", "repost", "not_interested"]) });
  r.post("/reactions", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { tags: ["social"], body: reactionBody } }, async (req) => {
    const a = requireCsrf(req);
    return deps.db.as(a.userId, async (q) => {
      const [p] = await q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL`, [req.body.postId]);
      if (!p) throw notFound("Post");
      const ins = await q(`INSERT INTO reactions (post_id, user_id, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING post_id`, [req.body.postId, a.userId, req.body.kind]);
      if (ins.length && req.body.kind !== "not_interested") await deps.notify.enqueue({ kind: "reaction.new", recipientId: p.author_id, actorId: a.userId, subjectId: req.body.postId, dedupeKey: `${req.body.kind}:${req.body.postId}:${a.userId}`, data: { reaction: req.body.kind } });
      return { ok: true };
    });
  });
  r.delete("/reactions", { schema: { tags: ["social"], body: reactionBody } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 AND kind = $3`, [req.body.postId, a.userId, req.body.kind]));
    return { ok: true };
  });

  // ---------------------------------------------------------------- follows
  r.post("/follows", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { tags: ["social"], body: z.object({ userId: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    if (req.body.userId === a.userId) throw bad("SELF_FOLLOW", "You cannot follow yourself");
    const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE user_id = $1 AND blocked_id = $2`, [req.body.userId, a.userId]);
    if (blocked.length) throw forbidden("BLOCKED", "You cannot follow this account");
    try {
      const ins = await deps.db.as(a.userId, (q) => q(`INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING followee_id`, [a.userId, req.body.userId]));
      if (ins.length) await deps.notify.enqueue({ kind: "follow.new", recipientId: req.body.userId, actorId: a.userId, dedupeKey: `follow:${a.userId}:${req.body.userId}`, data: {} });
    } catch (e: any) {
      if (e?.code === "23503") throw notFound("User");
      throw e;
    }
    return { ok: true };
  });
  r.delete("/follows/:userId", { schema: { tags: ["social"], params: z.object({ userId: uuid }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [a.userId, req.params.userId]));
    return { ok: true };
  });
  r.get("/follows", { schema: { tags: ["social"], querystring: z.object({ userId: uuid, type: z.enum(["followers", "following"]).default("followers") }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const [ps] = await deps.db.sys(`SELECT show_follows FROM privacy_settings WHERE user_id = $1`, [req.query.userId]);
    if (ps && !ps.show_follows && viewer !== req.query.userId) throw forbidden("PRIVATE", "This account keeps its follow lists private");
    const col = req.query.type === "followers" ? ["follower_id", "followee_id"] : ["followee_id", "follower_id"];
    return deps.db.as(viewer, (q) => q(`SELECT p.user_id, p.agent_name, p.display_name, p.avatar_url, p.is_ai_agent FROM follows f JOIN profiles p ON p.user_id = f.${col[0]} WHERE f.${col[1]} = $1 ORDER BY f.created_at DESC LIMIT 500`, [req.query.userId]));
  });

  r.get("/explore", { schema: { tags: ["social"], querystring: z.object({ q: z.string().max(64).default("") }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const term = req.query.q.trim().toLowerCase().replace(/^@/, "");
    const like = `%${term.replace(/[%_]/g, "")}%`;
    return deps.db.as(viewer, async (q) => ({
      // creators are searched by ATLAS profile name/handle only; wallets are never returned or searchable
      creators: (await q(`SELECT user_id, agent_name, display_name, avatar_url, is_ai_agent, bio FROM profiles WHERE $1 = '%%' OR agent_name ILIKE $1 OR display_name ILIKE $1 ORDER BY created_at LIMIT 20`, [like]))
        .map((c) => ({ userId: c.user_id, agentName: c.agent_name, displayName: c.display_name, avatarUrl: c.avatar_url, classification: c.is_ai_agent ? "AI Agent" : "Agent ID holder", bio: c.bio })),
      topics: await q(`SELECT t AS topic, count(*)::int AS posts FROM posts, unnest(topics) t WHERE deleted_at IS NULL AND moderation_status = 'visible' AND created_at > now() - interval '30 days' AND ($1 = '%%' OR t ILIKE $1) GROUP BY t ORDER BY posts DESC LIMIT 20`, [like]),
      squads: await q(`SELECT s.id, s.slug, s.name, s.description, (SELECT count(*)::int FROM squad_members m WHERE m.squad_id = s.id) AS members FROM squads s WHERE $1 = '%%' OR s.name ILIKE $1 OR s.slug ILIKE $1 ORDER BY members DESC LIMIT 20`, [like]),
    }));
  });

  void conflict;
  void requireAuth;
}
