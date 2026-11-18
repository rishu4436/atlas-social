import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { forbidden, notFound, bad } from "../lib/errors.js";
import { requireAuth, requireCsrf } from "../lib/session.js";
import { publicProfile, PROFILE_COLUMNS, walletOf } from "../lib/views.js";
import { loadPosts } from "../lib/posts.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveUserId(deps: Deps, idOrName: string): Promise<string> {
  const rows = UUID_RE.test(idOrName)
    ? await deps.db.sys(`SELECT user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 AND u.status <> 'deleted'`, [idOrName])
    : await deps.db.sys(`SELECT user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.agent_name = $1 AND u.status <> 'deleted'`, [idOrName.toLowerCase().endsWith(".ai") ? idOrName.toLowerCase() : `${idOrName.toLowerCase()}.ai`]);
  if (!rows.length) throw notFound("Profile");
  return rows[0].user_id;
}

const profilePatch = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  topics: z.array(z.string().regex(/^[a-z0-9_]{1,30}$/)).max(12).optional(),
  isAiAgent: z.boolean().optional(),
  aiOperator: z.string().max(120).nullable().optional(),
});

const privacyPatch = z.object({
  showWallet: z.boolean().optional(),
  dmPolicy: z.enum(["everyone", "following", "nobody"]).optional(),
  showFollows: z.boolean().optional(),
  personalizedFeed: z.boolean().optional(),
});

export async function profileRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/profiles/me", { schema: { tags: ["profiles"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, async (q) => {
      const [p] = await q(`SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.user_id = $1`, [a.userId]);
      const [ps] = await q(`SELECT * FROM privacy_settings WHERE user_id = $1`, [a.userId]);
      const wallet = await walletOf(q, a.userId);
      return { ...publicProfile(p, { wallet }), privacy: ps && { showWallet: ps.show_wallet, dmPolicy: ps.dm_policy, showFollows: ps.show_follows, personalizedFeed: ps.personalized_feed }, roles: a.roles, onchainPrivacyWarning: "Publishing on-chain reveals your wallet address on public block explorers, even if ATLAS hides it." };
    });
  });

  r.patch("/profiles/me", { schema: { tags: ["profiles"], body: profilePatch } }, async (req) => {
    const a = requireCsrf(req);
    const b = req.body;
    if (b.isAiAgent && !b.aiOperator) {
      const [cur] = await deps.db.sys(`SELECT ai_operator FROM profiles WHERE user_id = $1`, [a.userId]);
      if (!cur?.ai_operator) throw bad("AI_OPERATOR_REQUIRED", "AI Agent profiles must disclose their operator");
    }
    await deps.db.as(a.userId, (q) => q(
      `UPDATE profiles SET display_name = coalesce($2, display_name), bio = coalesce($3, bio), avatar_url = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END,
         topics = coalesce($6, topics), is_ai_agent = coalesce($7, is_ai_agent), ai_operator = CASE WHEN $8::boolean THEN $9 ELSE ai_operator END, updated_at = now()
       WHERE user_id = $1`,
      [a.userId, b.displayName ?? null, b.bio ?? null, b.avatarUrl !== undefined, b.avatarUrl ?? null, b.topics ?? null, b.isAiAgent ?? null, b.aiOperator !== undefined, b.aiOperator ?? null],
    ));
    if (b.isAiAgent !== undefined) await deps.db.sys(`UPDATE users SET kind = $2 WHERE id = $1`, [a.userId, b.isAiAgent ? "ai_agent" : "human"]);
    return { ok: true };
  });

  r.get("/profiles/:id", { schema: { tags: ["profiles"], params: z.object({ id: z.string().min(1).max(80) }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const userId = await resolveUserId(deps, req.params.id);
    const [p] = await deps.db.sys(`SELECT ${PROFILE_COLUMNS}, ps.show_wallet, ps.show_follows, l.wallet_address, l.chain_id FROM profiles p JOIN privacy_settings ps ON ps.user_id = p.user_id LEFT JOIN agent_id_links l ON l.user_id = p.user_id AND l.revoked_at IS NULL WHERE p.user_id = $1`, [userId]);
    const [counts] = await deps.db.sys(
      `SELECT (SELECT count(*)::int FROM follows WHERE followee_id = $1) AS followers, (SELECT count(*)::int FROM follows WHERE follower_id = $1) AS following,
              (SELECT count(*)::int FROM posts WHERE author_id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed') AS posts,
              (SELECT count(*)::int FROM theses WHERE author_id = $1 AND chain_status <> 'draft') AS theses`, [userId]);
    const viewerState = viewer ? await deps.db.as(viewer, async (q) => ({
      following: (await q(`SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2`, [viewer, userId])).length > 0,
      muted: (await q(`SELECT 1 FROM mutes WHERE muted_id = $1`, [userId])).length > 0,
      blocked: (await q(`SELECT 1 FROM blocks WHERE blocked_id = $1`, [userId])).length > 0,
      isSelf: viewer === userId,
    })) : null;
    return {
      ...publicProfile(p, { wallet: p.show_wallet || viewer === userId ? p.wallet_address : null }),
      counts: { ...counts, followers: p.show_follows || viewer === userId ? counts.followers : null, following: p.show_follows || viewer === userId ? counts.following : null },
      viewer: viewerState,
    };
  });

  r.get("/profiles/:id/posts", { schema: { tags: ["profiles"], params: z.object({ id: z.string() }), querystring: z.object({ kind: z.enum(["all", "thesis", "post"]).default("all") }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const userId = await resolveUserId(deps, req.params.id);
    const kindCond = req.query.kind === "thesis" ? "AND p.kind = 'thesis'" : req.query.kind === "post" ? "AND p.kind <> 'thesis'" : "";
    return deps.db.as(viewer, (q) => loadPosts(q, viewer, `p.author_id = $1 AND p.moderation_status <> 'removed' AND p.reply_to IS NULL ${kindCond}`, [userId]));
  });

  r.get("/profiles/:id/privacy", { schema: { tags: ["profiles"], params: z.object({ id: z.string() }) } }, async (req) => {
    const a = requireAuth(req);
    const userId = req.params.id === "me" ? a.userId : await resolveUserId(deps, req.params.id);
    if (userId !== a.userId) throw forbidden("NOT_OWNER", "Privacy settings are private to their owner");
    const [ps] = await deps.db.as(a.userId, (q) => q(`SELECT * FROM privacy_settings`));
    return { showWallet: ps.show_wallet, dmPolicy: ps.dm_policy, showFollows: ps.show_follows, personalizedFeed: ps.personalized_feed };
  });

  r.patch("/profiles/:id/privacy", { schema: { tags: ["profiles"], params: z.object({ id: z.string() }), body: privacyPatch } }, async (req) => {
    const a = requireCsrf(req);
    const userId = req.params.id === "me" ? a.userId : await resolveUserId(deps, req.params.id);
    if (userId !== a.userId) throw forbidden("NOT_OWNER", "Privacy settings are private to their owner");
    const b = req.body;
    await deps.db.as(a.userId, (q) => q(
      `UPDATE privacy_settings SET show_wallet = coalesce($2, show_wallet), dm_policy = coalesce($3, dm_policy), show_follows = coalesce($4, show_follows), personalized_feed = coalesce($5, personalized_feed), updated_at = now() WHERE user_id = $1`,
      [a.userId, b.showWallet ?? null, b.dmPolicy ?? null, b.showFollows ?? null, b.personalizedFeed ?? null]));
    return { ok: true };
  });

  // ---------------------------------------------------------------- private collections (RLS-scoped)
  r.get("/profiles/:id/bookmarks", { schema: { tags: ["profiles"], params: z.object({ id: z.string() }) } }, async (req) => {
    const a = requireAuth(req);
    const userId = req.params.id === "me" ? a.userId : await resolveUserId(deps, req.params.id);
    if (userId !== a.userId) throw forbidden("NOT_OWNER", "Bookmarks are private");
    return deps.db.as(a.userId, (q) => loadPosts(q, a.userId, `p.id IN (SELECT post_id FROM bookmarks WHERE user_id = $1)`, [a.userId]));
  });

  r.get("/profiles/me/notes", { schema: { tags: ["profiles"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT id, subject, body, created_at FROM notes ORDER BY created_at DESC`));
  });
  r.post("/profiles/me/notes", { schema: { tags: ["profiles"], body: z.object({ subject: z.string().min(1).max(120), body: z.string().max(10000) }) } }, async (req) => {
    const a = requireCsrf(req);
    const [n] = await deps.db.as(a.userId, (q) => q(`INSERT INTO notes (user_id, subject, body) VALUES ($1,$2,$3) RETURNING id`, [a.userId, req.body.subject, req.body.body]));
    return n;
  });
  r.get("/profiles/me/watchlist", { schema: { tags: ["profiles"] } }, async (req) => {
    const a = requireAuth(req);
    return deps.db.as(a.userId, (q) => q(`SELECT asset, added_at FROM watchlists ORDER BY added_at`));
  });
  r.put("/profiles/me/watchlist/:asset", { schema: { tags: ["profiles"], params: z.object({ asset: z.string().max(10) }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`INSERT INTO watchlists (user_id, asset) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.userId, req.params.asset.toUpperCase()]));
    return { ok: true };
  });
  r.delete("/profiles/me/watchlist/:asset", { schema: { tags: ["profiles"], params: z.object({ asset: z.string().max(10) }) } }, async (req) => {
    const a = requireCsrf(req);
    await deps.db.as(a.userId, (q) => q(`DELETE FROM watchlists WHERE asset = $1`, [req.params.asset.toUpperCase()]));
    return { ok: true };
  });

  for (const [path, table, col] of [["mute", "mutes", "muted_id"], ["block", "blocks", "blocked_id"]] as const) {
    r.post(`/profiles/:id/${path}`, { schema: { tags: ["profiles"], params: z.object({ id: z.string() }) } }, async (req) => {
      const a = requireCsrf(req);
      const target = await resolveUserId(deps, req.params.id);
      if (target === a.userId) throw bad("SELF", `You cannot ${path} yourself`);
      await deps.db.as(a.userId, async (q) => {
        await q(`INSERT INTO ${table} (user_id, ${col}) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.userId, target]);
        if (path === "block") await q(`DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2)`, [a.userId, target]);
      });
      if (path === "block") await deps.db.sys(`DELETE FROM follows WHERE follower_id = $2 AND followee_id = $1`, [a.userId, target]);
      return { ok: true };
    });
    r.delete(`/profiles/:id/${path}`, { schema: { tags: ["profiles"], params: z.object({ id: z.string() }) } }, async (req) => {
      const a = requireCsrf(req);
      const target = await resolveUserId(deps, req.params.id);
      await deps.db.as(a.userId, (q) => q(`DELETE FROM ${table} WHERE ${col} = $1`, [target]));
      return { ok: true };
    });
  }
}
