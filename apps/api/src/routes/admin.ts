import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { notFound, bad } from "../lib/errors.js";
import { requireModerator, securityEvent } from "../lib/session.js";

export async function adminRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/admin/reviews", { schema: { tags: ["moderation"], summary: "Moderator queue: open reports and appeals" } }, async (req) => {
    requireModerator(req);
    const reports = await deps.db.sys(`SELECT r.target_kind, r.target_id, array_agg(DISTINCT r.reason) AS reasons, count(*)::int AS reports, min(r.created_at) AS first_at,
        (SELECT json_build_object('body', left(p.body, 400), 'author', pr.agent_name, 'kind', p.kind, 'status', p.moderation_status, 'onchain', t.publish_tx IS NOT NULL) FROM posts p JOIN profiles pr ON pr.user_id = p.author_id LEFT JOIN theses t ON t.id = p.thesis_id WHERE r.target_kind = 'post' AND p.id::text = r.target_id) AS post
      FROM reports r WHERE r.status = 'open' GROUP BY r.target_kind, r.target_id ORDER BY reports DESC, first_at LIMIT 100`);
    const appeals = await deps.db.sys(`SELECT a.id, a.body, a.status, a.created_at, m.action, m.target_kind, m.target_id, m.reason, p.agent_name FROM appeals a JOIN moderation_actions m ON m.id = a.action_id JOIN profiles p ON p.user_id = a.user_id WHERE a.status = 'open' ORDER BY a.created_at`);
    const stats = (await deps.db.sys(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM agent_id_links WHERE revoked_at IS NULL) AS agent_ids,
      (SELECT count(*)::int FROM posts) AS posts, (SELECT count(*)::int FROM theses WHERE publish_tx IS NOT NULL) AS onchain_theses, (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports`))[0];
    return { reports, appeals, stats };
  });

  r.post("/admin/reviews/action", { schema: { tags: ["moderation"], body: z.object({ targetKind: z.enum(["post", "comment", "user"]), targetId: z.string(), action: z.enum(["remove", "limit", "restore", "dismiss", "suspend"]), reason: z.string().min(3).max(500) }) } }, async (req) => {
    const mod = requireModerator(req);
    const { targetKind, targetId, action, reason } = req.body;
    let targetUser: string | null = null;
    let note: string | undefined;
    await deps.db.sysTx(async (q) => {
      if (targetKind === "post") {
        const [p] = await q(`SELECT p.author_id, t.publish_tx FROM posts p LEFT JOIN theses t ON t.id = p.thesis_id WHERE p.id::text = $1`, [targetId]);
        if (!p) throw notFound("Post");
        targetUser = p.author_id;
        if (action !== "dismiss") await q(`UPDATE posts SET moderation_status = $2, moderation_note = $3 WHERE id::text = $1`, [targetId, action === "restore" ? "visible" : action === "limit" ? "limited" : "removed", reason]);
        if (p.publish_tx && action === "remove") note = "Post hidden on ATLAS. The on-chain thesis is immutable; it is not deleted and is labelled as hidden by moderation, never as removed from the blockchain.";
      } else if (targetKind === "comment") {
        const [c] = await q(`SELECT author_id FROM comments WHERE id::text = $1`, [targetId]);
        if (!c) throw notFound("Comment");
        targetUser = c.author_id;
        if (action !== "dismiss") await q(`UPDATE comments SET moderation_status = $2 WHERE id::text = $1`, [targetId, action === "restore" ? "visible" : "removed"]);
      } else {
        targetUser = targetId;
        if (action === "suspend") await q(`UPDATE users SET status = 'suspended' WHERE id::text = $1`, [targetId]);
        else if (action === "restore") await q(`UPDATE users SET status = 'active' WHERE id::text = $1`, [targetId]);
        else if (action !== "dismiss") throw bad("BAD_ACTION", "Use suspend/restore for users");
        if (action === "suspend") await q(`UPDATE sessions SET revoked_at = now() WHERE user_id::text = $1 AND revoked_at IS NULL`, [targetId]);
      }
      await q(`INSERT INTO moderation_actions (moderator_id, target_kind, target_id, target_user_id, action, reason) VALUES ($1,$2,$3,$4,$5,$6)`, [mod.userId, targetKind, targetId, targetUser, action, reason]);
      await q(`UPDATE reports SET status = $3 WHERE target_kind = $1 AND target_id = $2 AND status = 'open'`, [targetKind, targetId, action === "dismiss" ? "dismissed" : "actioned"]);
    });
    if (targetUser && action !== "dismiss") await deps.notify.enqueue({ kind: "system", recipientId: targetUser, subjectId: targetId, dedupeKey: `mod:${targetKind}:${targetId}:${action}:${Date.now()}`, data: { action, reason, appeal: "/settings#appeals" } });
    await securityEvent(deps, mod.userId, "moderation.action", { targetKind, targetId, action });
    return { ok: true, note };
  });

  r.post("/admin/appeals/:id", { schema: { tags: ["moderation"], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(["upheld", "reversed"]) }) } }, async (req) => {
    const mod = requireModerator(req);
    const [ap] = await deps.db.sys(`UPDATE appeals SET status = $2 WHERE id = $1 AND status = 'open' RETURNING action_id, user_id`, [req.params.id, req.body.decision]);
    if (!ap) throw notFound("Appeal");
    if (req.body.decision === "reversed") {
      const [act] = await deps.db.sys(`SELECT target_kind, target_id FROM moderation_actions WHERE id = $1`, [ap.action_id]);
      if (act.target_kind === "post") await deps.db.sys(`UPDATE posts SET moderation_status = 'visible' WHERE id::text = $1`, [act.target_id]);
      if (act.target_kind === "comment") await deps.db.sys(`UPDATE comments SET moderation_status = 'visible' WHERE id::text = $1`, [act.target_id]);
      if (act.target_kind === "user") await deps.db.sys(`UPDATE users SET status = 'active' WHERE id::text = $1`, [act.target_id]);
      await deps.db.sys(`INSERT INTO moderation_actions (moderator_id, target_kind, target_id, target_user_id, action, reason) VALUES ($1,$2,$3,$4,'restore','appeal reversed')`, [mod.userId, act.target_kind, act.target_id, ap.user_id]);
    }
    return { ok: true };
  });
}
