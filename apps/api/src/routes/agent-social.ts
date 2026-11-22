/**
 * Agent social actions for MCP / OAuth clients (off-chain only):
 * - private post/reply drafts (post:draft) → explicit, operator-approved publication (post:publish)
 * - likes (social:react), never on the operator's own posts, no reposts
 * - draft listing across post and thesis drafts
 * - wallet handoff guidance for clients without a local Binance Agentic Wallet (no signing endpoint exists)
 * Everything an agent publishes carries an immutable agent attribution on the content row.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { bad, forbidden, notFound, ApiError } from "../lib/errors.js";
import { requireCsrf } from "../lib/session.js";
import { attributionIdFor, recordAttribution, attributionsByIds, AGENT_LABEL, type AgentContext } from "../lib/agents.js";
import { createPost } from "./social.js";
import { extractLinks, scanLinks } from "../lib/links.js";
import { publicApiUrl } from "../lib/connect.js";

const uuid = z.string().uuid();
export const AGENT_PUBLISH_PER_HOUR = 10;
export const AGENT_LIKES_PER_HOUR = 60;

/** Claims an agent may not make in a post: ATLAS verification it did not get, guaranteed returns, fake on-chain proof. */
const MISLEADING = [
  /\b(verified|certified|proven|approved|audited|endorsed)\s+(by|on)\s+atlas\b/i,
  /\batlas[-\s](verified|certified|approved|endorsed)\b/i,
  /\bguaranteed\s+(profit|profits|returns?|gains?|win)\b/i,
  /\b(risk[-\s]free|can'?t\s+lose|cannot\s+lose)\b/i,
  /\b(on[-\s]chain|blockchain)[-\s]proven\b/i,
];
export function misleadingClaim(body: string): string | null {
  const m = MISLEADING.find((re) => re.test(body));
  return m ? (body.match(m)?.[0] ?? "claim") : null;
}

function agentOnly(req: FastifyRequest): AgentContext {
  if (!req.agent) throw forbidden("AGENT_ONLY", "This route is for AI agents acting under an operator token. Use the normal composer instead.");
  return req.agent;
}
const has = (a: AgentContext, s: string) => (a.scopes as string[]).includes(s);

function draftView(d: any, agent: unknown) {
  return {
    id: d.id, type: d.kind === "reply" ? "reply_draft" : "post_draft", status: d.status, body: d.body, topics: d.topics, replyTo: d.reply_to,
    published: d.published_id ? { kind: d.published_kind, id: d.published_id } : null,
    createdAt: d.created_at, decidedAt: d.decided_at, agent,
  };
}

export async function agentSocialRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["agents", "social"];
  const site = deps.cfg.PUBLIC_ORIGIN.replace(/\/$/, "");

  r.post("/agents/drafts", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      tags, summary: "Agent: save a private post or reply draft (never public until the operator approves publication)",
      body: z.object({
        body: z.string().trim().min(1).max(5000),
        topics: z.array(z.string().regex(/^[a-z0-9_]{1,30}$/i)).max(5).default([]),
        replyTo: uuid.optional().describe("Post id to reply to (published as a reply comment, max 2000 chars)"),
      }),
    },
  }, async (req) => {
    const a = agentOnly(req); const auth = requireCsrf(req);
    const claim = misleadingClaim(req.body.body);
    if (claim) throw bad("MISLEADING_CLAIM", `Agent posts cannot claim ATLAS verification, guaranteed returns or proofs they do not have ("${claim}"). Rephrase as your own analysis.`);
    if (req.body.replyTo && req.body.body.length > 2000) throw bad("REPLY_TOO_LONG", "Replies are at most 2000 characters");
    const links = extractLinks(req.body.body);
    if (links.length > 5) throw bad("TOO_MANY_LINKS", "Posts may contain at most 5 links");
    if (req.body.replyTo) {
      const [p] = await deps.db.as(auth.userId, (q) => q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed'`, [req.body.replyTo]));
      if (!p) throw notFound("Post");
    }
    const [d] = await deps.db.as(auth.userId, (q) => q(
      `INSERT INTO agent_post_drafts (operator_id, agent_id, token_id, kind, body, topics, reply_to, model, client) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [auth.userId, a.agentId, a.tokenId, req.body.replyTo ? "reply" : "post", req.body.body, req.body.topics.map((t) => t.toLowerCase()), req.body.replyTo ?? null, a.model, a.client]));
    return {
      draft: draftView(d, { agentName: a.agentName, model: a.model, client: a.client, declared: true, label: AGENT_LABEL }),
      linkWarnings: scanLinks(links, deps.cfg.PUBLIC_ORIGIN),
      preview: { visibleAs: "Agent-authored post under your Agent ID", text: d.body },
      next: "Private draft only. Show the operator this exact text. Publish only after they explicitly approve it (publish_post with userApproved=true; needs the post:publish scope).",
    };
  });

  r.get("/agents/drafts", {
    schema: {
      tags, summary: "Agent: list the operator's drafts (post/reply drafts with post:draft, thesis drafts with thesis:draft)",
      querystring: z.object({ type: z.enum(["all", "post", "thesis"]).default("all"), status: z.enum(["draft", "published", "discarded", "all"]).default("draft"), limit: z.coerce.number().int().min(1).max(50).default(20) }),
    },
  }, async (req) => {
    const a = agentOnly(req); const auth = requireCsrf(req);
    const canPost = has(a, "post:draft"), canThesis = has(a, "thesis:draft") || has(a, "thesis:prepare");
    if (!canPost && !canThesis) throw new ApiError(403, "AGENT_SCOPE_MISSING", "Listing drafts needs the post:draft or thesis:draft scope", { required: ["post:draft", "thesis:draft"] });
    const { type, status, limit } = req.query;
    const out: { posts: unknown[]; theses: unknown[] } = { posts: [], theses: [] };
    if (canPost && type !== "thesis") {
      const rows = await deps.db.as(auth.userId, (q) => q(
        `SELECT d.*, ag.name AS agent_name FROM agent_post_drafts d JOIN agents ag ON ag.id = d.agent_id
          WHERE d.operator_id = $1 AND ($2 = 'all' OR d.status = $2) ORDER BY d.created_at DESC LIMIT $3`, [auth.userId, status, limit]));
      out.posts = rows.map((d) => draftView(d, { agentName: d.agent_name, model: d.model, client: d.client, declared: true, label: AGENT_LABEL }));
    }
    if (canThesis && type !== "post") {
      const rows = await deps.db.as(auth.userId, (q) => q(
        `SELECT t.id, t.symbol, t.direction, t.target_price, t.invalidation_price, t.horizon_hours, t.confidence, t.chain_status, t.content, t.created_at, t.agent_attribution_id
           FROM theses t WHERE t.author_id = $1 AND t.agent_attribution_id IS NOT NULL AND ($2 = 'all' OR ($2 = 'draft' AND t.chain_status = 'draft') OR ($2 = 'published' AND t.chain_status <> 'draft'))
          ORDER BY t.created_at DESC LIMIT $3`, [auth.userId, status === "discarded" ? "none" : status, limit]));
      const attrs = await attributionsByIds(deps, rows.map((t) => t.agent_attribution_id));
      out.theses = rows.map((t) => ({
        id: t.id, type: "thesis_draft", chainStatus: t.chain_status, symbol: t.symbol, direction: t.direction, targetPrice: t.target_price, invalidationPrice: t.invalidation_price,
        horizonHours: t.horizon_hours, confidence: t.confidence, title: t.content?.title ?? null, createdAt: t.created_at, agent: attrs.get(t.agent_attribution_id) ?? null,
        publish: t.chain_status === "draft" ? "prepare_thesis_publication → operator signs in their own wallet" : null,
      }));
    }
    return { ...out, scopes: { postDrafts: canPost, thesisDrafts: canThesis } };
  });

  r.get("/agents/drafts/:id", { schema: { tags, summary: "Agent: one of the operator's drafts (post/reply or thesis)", params: z.object({ id: uuid }) } }, async (req) => {
    const a = agentOnly(req); const auth = requireCsrf(req);
    if (has(a, "post:draft")) {
      const [d] = await deps.db.as(auth.userId, (q) => q(`SELECT d.*, ag.name AS agent_name FROM agent_post_drafts d JOIN agents ag ON ag.id = d.agent_id WHERE d.id = $1 AND d.operator_id = $2`, [req.params.id, auth.userId]));
      if (d) return { draft: draftView(d, { agentName: d.agent_name, model: d.model, client: d.client, declared: true, label: AGENT_LABEL }) };
    }
    if (has(a, "thesis:draft") || has(a, "thesis:prepare")) {
      const [t] = await deps.db.as(auth.userId, (q) => q(`SELECT id, symbol, direction, entry_kind, entry_price, target_price, invalidation_price, horizon_hours, confidence, chain_status, content, created_at, agent_attribution_id FROM theses WHERE id = $1 AND author_id = $2 AND agent_attribution_id IS NOT NULL`, [req.params.id, auth.userId]));
      if (t) {
        const attr = (await attributionsByIds(deps, [t.agent_attribution_id])).get(t.agent_attribution_id) ?? null;
        return { draft: { id: t.id, type: "thesis_draft", chainStatus: t.chain_status, symbol: t.symbol, direction: t.direction, entryKind: t.entry_kind, entryPrice: t.entry_price, targetPrice: t.target_price, invalidationPrice: t.invalidation_price, horizonHours: t.horizon_hours, confidence: t.confidence, content: t.content, createdAt: t.created_at, agent: attr } };
      }
    }
    if (!has(a, "post:draft") && !has(a, "thesis:draft") && !has(a, "thesis:prepare")) throw new ApiError(403, "AGENT_SCOPE_MISSING", "Reading drafts needs the post:draft or thesis:draft scope", { required: ["post:draft", "thesis:draft"] });
    throw notFound("Draft");
  });

  r.post("/agents/drafts/:id/discard", { schema: { tags, summary: "Agent: discard a post/reply draft", params: z.object({ id: uuid }) } }, async (req) => {
    agentOnly(req); const auth = requireCsrf(req);
    const rows = await deps.db.as(auth.userId, (q) => q(`UPDATE agent_post_drafts SET status = 'discarded', decided_at = now() WHERE id = $1 AND operator_id = $2 AND status = 'draft' RETURNING id`, [req.params.id, auth.userId]));
    if (!rows.length) throw notFound("Draft");
    return { ok: true, status: "discarded" };
  });

  r.post("/agents/drafts/:id/publish", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags, summary: "Agent: publish a draft as an agent-labelled post/reply after the operator approved the exact text (off-chain)",
      params: z.object({ id: uuid }),
      body: z.object({ userApproved: z.literal(true).describe("Set only after the operator saw the exact draft text and said yes") }),
    },
  }, async (req) => {
    const a = agentOnly(req); const auth = requireCsrf(req);
    const [d] = await deps.db.as(auth.userId, (q) => q(`SELECT * FROM agent_post_drafts WHERE id = $1 AND operator_id = $2`, [req.params.id, auth.userId]));
    if (!d) throw notFound("Draft");
    if (d.status !== "draft") throw new ApiError(409, "DRAFT_NOT_OPEN", `This draft is already ${d.status}.`, { status: d.status, published: d.published_id ? { kind: d.published_kind, id: d.published_id } : null });
    const claim = misleadingClaim(d.body);
    if (claim) throw bad("MISLEADING_CLAIM", `Agent posts cannot claim ATLAS verification or guaranteed returns ("${claim}").`);
    const [{ n }] = await deps.db.sys(`SELECT count(*)::int AS n FROM agent_post_drafts WHERE operator_id = $1 AND status = 'published' AND decided_at > now() - interval '1 hour'`, [auth.userId]);
    if (n >= AGENT_PUBLISH_PER_HOUR) throw new ApiError(429, "AGENT_PUBLISH_RATE", `Agents may publish at most ${AGENT_PUBLISH_PER_HOUR} posts per hour for one operator.`, { action: "wait" });
    // claim the draft first (single publication even under concurrent calls)
    const claimed = await deps.db.as(auth.userId, (q) => q(`UPDATE agent_post_drafts SET status = 'published', decided_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [d.id]));
    if (!claimed.length) throw new ApiError(409, "DRAFT_NOT_OPEN", "This draft was just published or discarded.");
    const attrId = attributionIdFor(req)!;
    try {
      let kind: "post" | "comment"; let id: string;
      if (d.kind === "reply") {
        id = await deps.db.as(auth.userId, async (q) => {
          const [p] = await q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed'`, [d.reply_to]);
          if (!p) throw notFound("Post");
          const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE user_id = $1 AND blocked_id = $2`, [p.author_id, auth.userId]);
          if (blocked.length) throw forbidden("BLOCKED", "You cannot reply to this account");
          const [c] = await q(`INSERT INTO comments (post_id, author_id, body, agent_attribution_id) VALUES ($1,$2,$3,$4) RETURNING id`, [d.reply_to, auth.userId, d.body, attrId]);
          if (p.author_id !== auth.userId) await deps.notify.enqueue({ kind: "comment.new", recipientId: p.author_id, actorId: auth.userId, subjectId: d.reply_to, dedupeKey: `comment:${c.id}`, data: { agent: true } });
          return c.id as string;
        });
        kind = "comment";
      } else {
        id = await createPost(deps, auth.userId, { body: d.body, topics: d.topics ?? [], mediaIds: [], kind: "post", agentAttributionId: attrId } as any);
        kind = "post";
      }
      await recordAttribution(deps, req, attrId, kind, id);
      await deps.db.as(auth.userId, (q) => q(`UPDATE agent_post_drafts SET published_kind = $2, published_id = $3 WHERE id = $1`, [d.id, kind, id]));
      const agent = (await attributionsByIds(deps, [attrId])).get(attrId) ?? null;
      const url = agent?.operatorAgentName ? `${site}/u/${agent.operatorAgentName}` : `${site}/home`;
      return { ok: true, published: { kind, id, replyTo: d.reply_to ?? undefined, url }, agent, note: "Published off-chain, labelled agent-authored under the operator's Agent ID. It is not an on-chain thesis." };
    } catch (e) {
      await deps.db.as(auth.userId, (q) => q(`UPDATE agent_post_drafts SET status = 'draft', decided_at = NULL WHERE id = $1 AND published_id IS NULL`, [d.id]));
      throw e;
    }
  });

  r.post("/agents/reactions", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { tags, summary: "Agent: like or unlike a post (agent-labelled; never the operator's own posts; no reposts)", body: z.object({ postId: uuid, action: z.enum(["like", "unlike"]) }) },
  }, async (req) => {
    const a = agentOnly(req); const auth = requireCsrf(req);
    return deps.db.as(auth.userId, async (q) => {
      const [p] = await q(`SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_status <> 'removed'`, [req.body.postId]);
      if (!p) throw notFound("Post");
      if (p.author_id === auth.userId) throw forbidden("SELF_REACTION", "An agent cannot like its own operator's posts");
      if (req.body.action === "unlike") {
        // only undo likes this agent made; a like the human left stays
        const del = await q(`DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 AND kind = 'like' AND agent_id = $3 RETURNING post_id`, [req.body.postId, auth.userId, a.agentId]);
        return { ok: true, liked: !del.length ? null : false, note: del.length ? "Like removed" : "No agent like to remove (likes made by the operator are left alone)" };
      }
      const blocked = await deps.db.sys(`SELECT 1 FROM blocks WHERE user_id = $1 AND blocked_id = $2`, [p.author_id, auth.userId]);
      if (blocked.length) throw forbidden("BLOCKED", "You cannot react to this account");
      const [{ n }] = await deps.db.sys(`SELECT count(*)::int AS n FROM reactions WHERE user_id = $1 AND agent_id IS NOT NULL AND created_at > now() - interval '1 hour'`, [auth.userId]);
      if (n >= AGENT_LIKES_PER_HOUR) throw new ApiError(429, "AGENT_REACTION_RATE", `Agents may like at most ${AGENT_LIKES_PER_HOUR} posts per hour for one operator.`, { action: "wait" });
      const ins = await q(`INSERT INTO reactions (post_id, user_id, kind, agent_id) VALUES ($1,$2,'like',$3) ON CONFLICT DO NOTHING RETURNING post_id`, [req.body.postId, auth.userId, a.agentId]);
      if (ins.length) await deps.notify.enqueue({ kind: "reaction.new", recipientId: p.author_id, actorId: auth.userId, subjectId: req.body.postId, dedupeKey: `like:${req.body.postId}:${auth.userId}`, data: { reaction: "like", agent: true } });
      return { ok: true, liked: true, alreadyLiked: !ins.length };
    });
  });

  r.get("/agents/handoff", {
    schema: {
      tags, summary: "Agent: how the operator completes a wallet step (sign in, publish a thesis, pay) when this AI client has no local wallet. ATLAS has no signing endpoint.",
      querystring: z.object({ action: z.enum(["login", "publish_thesis", "pay"]).default("publish_thesis"), thesisId: uuid.optional() }),
    },
  }, async (req) => {
    agentOnly(req);
    const api = publicApiUrl(deps);
    const thesisUrl = req.query.thesisId ? `${site}/thesis/${req.query.thesisId}` : `${site}/compose`;
    const common = {
      signingEndpoint: null,
      rule: "This AI client cannot sign, and ATLAS exposes no endpoint that signs for it. Every wallet step is done by the operator in their own wallet after seeing a preview.",
      companion: { package: "atlas-social-connect", macLinux: `curl -fsSL ${site}/connect.sh | sh -s <ATC-code>`, windows: `iex "& { $(irm ${site}/connect.ps1) } <ATC-code>"`, note: "Runs on the operator's own computer, shows the baw preview and asks y/N before anything is signed." },
      connectMcp: { url: `${api}/mcp/connect`, note: "For AI agents that run on the operator's computer with the baw CLI. Needs a connect code (ATC-…) that the website shows." },
    };
    if (req.query.action === "login") {
      return {
        ...common, action: "login",
        steps: [
          `The operator opens ${site}/welcome in their browser and chooses Continue with Agentic Wallet.`,
          "The page shows a one-time connect code (ATC-…) and a one-line command, bound to that browser tab.",
          `On their own computer with the Binance Agentic Wallet CLI signed in, they run the one-liner the page shows, e.g. curl -fsSL ${site}/connect.sh | sh -s ATC-… (Windows PowerShell: iex "& { $(irm ${site}/connect.ps1) } ATC-…").`,
          "The companion shows the AtlasLogin preview (site, wallet, login id, expiry). The operator types y only if it matches.",
          "They confirm the Agent ID back in the same browser tab. The code cannot sign anyone in anywhere else.",
        ],
        commandTemplate: `curl -fsSL ${site}/connect.sh | sh -s <ATC-code shown on the website>`,
      };
    }
    if (req.query.action === "pay") {
      return { ...common, action: "pay", steps: ["Call prepare_payment to get the unsigned steps and show them to the operator.", `The operator opens ${site}/pay, reviews the full address, network, token and amount, and confirms in their own wallet (or runs the one-liner the page shows: curl -fsSL ${site}/connect.sh | sh -s -- pay ATC-…).`, "Report it paid only when ATLAS shows the payment finalized."] };
    }
    return {
      ...common, action: "publish_thesis", url: thesisUrl,
      steps: [
        "Call prepare_thesis_publication and show the operator the summary, the target contract, chain and the baw preview command. Ask them to approve.",
        `Without a local wallet: the operator opens ${thesisUrl}, presses Publish on-chain and confirms in their own wallet.`,
        "With baw on their computer: they run the baw contract-call preview first, check it, and only then execute it themselves.",
        "ATLAS marks the thesis published only after it reads the real transaction receipt and the ThesisPublished event. Never claim it is published before that.",
      ],
    };
  });
}
