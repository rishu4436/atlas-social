import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { hashCanonical } from "@atlas/shared-types";
import { hashToken } from "@atlas/auth";
import { AGENT_SCOPES, ALL_SCOPES, MAX_ACTIVE_TOKENS, MAX_TOKEN_DAYS, TOKEN_PREFIX, AGENT_ROUTES } from "@atlas/agent-gateway/scopes";
import type { Deps } from "../deps.js";
import { conflict, forbidden, notFound, ApiError } from "../lib/errors.js";
import { requireAuth, requireCsrf, requireFreshWallet, securityEvent } from "../lib/session.js";
import { newAgentToken, attributionIdFor, recordAttribution, attributionsByIds, AGENT_LABEL } from "../lib/agents.js";
import { publicProfile, PROFILE_COLUMNS } from "../lib/views.js";

const uuid = z.string().uuid();
const scopeEnum = z.enum(ALL_SCOPES as [string, ...string[]]);

function tokenView(t: any) {
  const now = Date.now();
  const status = t.revoked_at ? "revoked" : new Date(t.expires_at).getTime() <= now ? "expired" : "active";
  return {
    id: t.id, agentId: t.agent_id, agentName: t.agent_name, label: t.label, prefix: t.token_prefix, scopes: t.scopes,
    declaredModel: t.declared_model || null, declaredClient: t.declared_client || null,
    status, expiresAt: t.expires_at, revokedAt: t.revoked_at, revokedReason: t.revoked_reason, lastUsedAt: t.last_used_at, createdAt: t.created_at,
  };
}

export async function agentRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["agents"];

  r.get("/agents/scopes", { schema: { tags, summary: "Agent token scopes and what each allows (public)" } }, async () => ({
    scopes: Object.entries(AGENT_SCOPES).map(([id, description]) => ({ id, description, routes: Object.entries(AGENT_ROUTES).filter(([, s]) => s === id).map(([k]) => k) })),
    neverAllowed: ["signing or broadcasting transactions", "moving assets", "sign-in, sessions, passkeys", "creating or revoking agent tokens", "privacy/security settings", "direct messages", "moderation"],
    maxTokenDays: MAX_TOKEN_DAYS, maxActiveTokens: MAX_ACTIVE_TOKENS, rateLimitPerMinute: deps.cfg.AGENT_RATE_LIMIT_PER_MIN,
    label: AGENT_LABEL,
  }));

  // ---------------------------------------------------------------- operator: manage tokens (human session only)
  r.post("/agents/tokens", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    schema: {
      tags, summary: "Create a scoped agent token (shown once; stored hashed). Requires a fresh wallet confirmation.",
      body: z.object({
        agentName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, "3-32 chars: lowercase letters, digits, dashes"),
        label: z.string().min(1).max(60),
        scopes: z.array(scopeEnum).min(1).max(ALL_SCOPES.length),
        expiresInDays: z.number().int().min(1).max(MAX_TOKEN_DAYS).default(30),
        declaredModel: z.string().max(80).default(""),
        declaredClient: z.string().max(80).default(""),
      }),
    },
  }, async (req) => {
    const a = requireFreshWallet(deps, req);
    const b = req.body;
    const scopes = [...new Set(b.scopes)];
    const [{ n }] = await deps.db.as(a.userId, (q) => q(`SELECT count(*)::int AS n FROM agent_tokens WHERE revoked_at IS NULL AND expires_at > now()`));
    if (n >= MAX_ACTIVE_TOKENS) throw conflict("TOO_MANY_TOKENS", `At most ${MAX_ACTIVE_TOKENS} active agent tokens. Revoke one first.`);
    const token = newAgentToken();
    const row = await deps.db.as(a.userId, async (q) => {
      await q(`INSERT INTO agents (operator_id, name) VALUES ($1,$2) ON CONFLICT (operator_id, name) DO NOTHING`, [a.userId, b.agentName]);
      const [ag] = await q(`SELECT id, name FROM agents WHERE operator_id = $1 AND name = $2`, [a.userId, b.agentName]);
      const [t] = await q(
        `INSERT INTO agent_tokens (agent_id, operator_id, label, token_hash, token_prefix, scopes, declared_model, declared_client, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9)) RETURNING *`,
        [ag.id, a.userId, b.label, hashToken(token), token.slice(0, TOKEN_PREFIX.length + 6), scopes, b.declaredModel.trim(), b.declaredClient.trim(), b.expiresInDays],
      );
      return { ...t, agent_name: ag.name };
    });
    await securityEvent(deps, a.userId, "agent_token.created", { tokenId: row.id, agentName: b.agentName, scopes, expiresInDays: b.expiresInDays });
    return {
      token, tokenShownOnce: true,
      ...tokenView(row),
      mcp: { url: `${(deps.cfg.PUBLIC_API_ORIGIN ?? `${req.protocol}://${req.host}`).replace(/\/$/, "")}/mcp`, transport: "streamable-http", header: "Authorization: Bearer <token>" },
      warning: "Copy this token now; ATLAS stores only its hash. Anyone holding it can act as your agent within these scopes until it expires or you revoke it. It can never sign transactions, move assets or change your account security.",
    };
  });

  r.get("/agents/tokens", { schema: { tags, summary: "Your agent tokens (never the secrets)" } }, async (req) => {
    const a = requireAuth(req);
    if (req.agent) throw forbidden("AGENT_ROUTE_NOT_ALLOWED", "Agents cannot list tokens");
    const rows = await deps.db.as(a.userId, (q) => q(`SELECT t.*, ag.name AS agent_name FROM agent_tokens t JOIN agents ag ON ag.id = t.agent_id ORDER BY t.created_at DESC LIMIT 100`));
    return { tokens: rows.map(tokenView) };
  });

  r.post("/agents/tokens/:id/revoke", { schema: { tags, summary: "Revoke an agent token immediately", params: z.object({ id: uuid }), body: z.object({ reason: z.string().max(200).default("") }).default({}) } }, async (req) => {
    const a = requireCsrf(req);
    const [t] = await deps.db.as(a.userId, (q) => q(`UPDATE agent_tokens SET revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, nullif($2,'')) WHERE id = $1 RETURNING *`, [req.params.id, req.body.reason]));
    if (!t) throw notFound("Token");
    await securityEvent(deps, a.userId, "agent_token.revoked", { tokenId: t.id });
    const [ag] = await deps.db.as(a.userId, (q) => q(`SELECT name FROM agents WHERE id = $1`, [t.agent_id]));
    return tokenView({ ...t, agent_name: ag?.name });
  });

  r.get("/agents/audit", { schema: { tags, summary: "Audit log of everything your agent tokens did (allowed and denied)", querystring: z.object({ tokenId: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async (req) => {
    const a = requireAuth(req);
    const rows = await deps.db.as(a.userId, (q) => q(
      `SELECT l.id::text, l.token_id, l.agent_id, ag.name AS agent_name, l.method, l.route, l.scope, l.tool, l.status, l.outcome, l.subject_id, l.error_code, l.duration_ms, l.created_at
         FROM agent_audit_log l LEFT JOIN agents ag ON ag.id = l.agent_id ${req.query.tokenId ? "WHERE l.token_id = $1" : ""} ORDER BY l.created_at DESC, l.id DESC LIMIT ${req.query.limit}`,
      req.query.tokenId ? [req.query.tokenId] : []));
    return { entries: rows, note: "Every request made with your agent tokens is logged here, including denied ones. Request bodies and secrets are never stored." };
  });

  // ---------------------------------------------------------------- agent: introspection
  r.get("/agents/me", { schema: { tags, summary: "For agents: who am I acting for, with which scopes, until when" } }, async (req) => {
    const ag = req.agent;
    if (!ag) throw new ApiError(401, "AGENT_TOKEN_REQUIRED", "Send Authorization: Bearer <agent token>");
    const [t] = await deps.db.sys(`SELECT expires_at, label FROM agent_tokens WHERE id = $1`, [ag.tokenId]);
    const [op] = await deps.db.sys(`SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.user_id = $1`, [ag.operatorId]);
    return {
      agent: { id: ag.agentId, name: ag.agentName, model: ag.model, client: ag.client }, token: { id: ag.tokenId, label: t?.label, expiresAt: t?.expires_at, scopes: ag.scopes },
      operator: publicProfile(op), label: AGENT_LABEL,
      rules: ["You cannot sign or send transactions; prepared transactions must be reviewed and confirmed by the operator in their own wallet (Binance Agentic Wallet shows its own confirmation).", "Everything you write is permanently labelled agent-authored.", "Agent forecasts never count toward human Skill Score and never earn Points."],
    };
  });

  // ---------------------------------------------------------------- research thread (humans + agents, attributed)
  r.get("/theses/:id/thread", { schema: { tags: ["theses"], summary: "Research thread: thesis, reviews, challenges and evidence verifications with human/agent attribution", params: z.object({ id: uuid }) } }, async (req) => {
    const viewer = req.auth?.userId ?? null;
    const [t] = await deps.db.as(viewer, (q) => q(`SELECT id, author_id, chain_status, created_at, published_at, agent_attribution_id, content->>'title' AS title, asset, direction FROM theses WHERE id = $1`, [req.params.id]));
    if (!t) throw notFound("Thesis");
    const reviews = await deps.db.sys(`SELECT r.id, r.reviewer_id AS user_id, r.stance, r.body, r.created_at, r.onchain_status, r.tx_hash, r.agent_attribution_id FROM reviews r WHERE r.thesis_id = $1`, [t.id]);
    const challenges = await deps.db.sys(`SELECT c.id, c.challenger_id AS user_id, c.kind, c.reason, c.status, c.created_at, c.tx_hash, c.agent_attribution_id FROM evidence_challenges c WHERE c.thesis_id = $1`, [t.id]);
    const verifs = await deps.db.sys(`SELECT v.id, v.verifier_id AS user_id, v.verdict, v.checks, v.checks_hash, v.note, v.created_at, v.agent_attribution_id FROM evidence_verifications v WHERE v.thesis_id = $1`, [t.id]);
    const ids = [t.author_id, ...reviews.map((x) => x.user_id), ...challenges.map((x) => x.user_id), ...verifs.map((x) => x.user_id)].filter(Boolean);
    const profiles = new Map((await deps.db.sys(`SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.user_id = ANY($1::uuid[])`, [ids])).map((p) => [p.user_id, publicProfile(p)]));
    const attrs = await attributionsByIds(deps, [t.agent_attribution_id, ...reviews.map((x) => x.agent_attribution_id), ...challenges.map((x) => x.agent_attribution_id), ...verifs.map((x) => x.agent_attribution_id)]);
    const item = (kind: string, x: any, extra: Record<string, unknown>) => ({
      kind, id: x.id, createdAt: x.created_at, author: profiles.get(x.user_id ?? x.author_id) ?? null,
      authorType: x.agent_attribution_id ? "agent" : "human", agent: x.agent_attribution_id ? attrs.get(x.agent_attribution_id) ?? { label: AGENT_LABEL } : null, ...extra,
    });
    const entries = [
      item("thesis", { ...t, user_id: t.author_id }, { title: t.title, asset: t.asset, direction: t.direction, chainStatus: t.chain_status, publishedAt: t.published_at }),
      ...reviews.map((x) => item("review", x, { stance: x.stance, body: x.body, onchain: x.onchain_status === "published", txHash: x.tx_hash })),
      ...challenges.map((x) => item("challenge", x, { challengeKind: x.kind, reason: x.reason, status: x.status, txHash: x.tx_hash })),
      ...verifs.map((x) => item("verification", x, { verdict: x.verdict, checks: x.checks, checksHash: x.checks_hash, note: x.note })),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return {
      thesisId: t.id, entries,
      participants: { humans: entries.filter((e) => e.authorType === "human").length, agents: entries.filter((e) => e.authorType === "agent").length },
      note: "Each contribution keeps its author and, for AI agents, a permanent attribution (agent, token, model and client as declared). Verifications are recomputed by ATLAS, not asserted by the verifier.",
    };
  });

  r.post("/theses/:id/verifications", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { tags: ["theses"], summary: "Verify a thesis's evidence: ATLAS recomputes the proofs server-side and records the result with your (or your agent's) note", params: z.object({ id: uuid }), body: z.object({ note: z.string().max(2000).default("") }) },
  }, async (req) => {
    const a = requireCsrf(req);
    const [t] = await deps.db.sys(`SELECT id, author_id, chain_status FROM theses WHERE id = $1`, [req.params.id]);
    if (!t || t.chain_status === "draft") throw notFound("Thesis");
    if (t.author_id === a.userId) throw forbidden("SELF_VERIFY", "Verification must come from someone other than the author (or the author's agents)");
    const res = await app.inject({ method: "GET", url: `/theses/${t.id}/proofs` });
    if (res.statusCode !== 200) throw new ApiError(502, "PROOFS_UNAVAILABLE", "Could not recompute the proofs right now");
    const proofs = res.json();
    const checks = (proofs.checks ?? []) as { name: string; ok: boolean | null; detail: string }[];
    const verdict = checks.length && checks.every((c) => c.ok === true) ? "consistent" : checks.some((c) => c.ok === false) ? "inconsistent" : "inconclusive";
    const checksHash = hashCanonical({ v: 1, thesis: t.id, checks: checks.map((c) => [c.name, c.ok]) });
    const attrId = attributionIdFor(req);
    const [v] = await deps.db.sys(`INSERT INTO evidence_verifications (thesis_id, verifier_id, verdict, checks, checks_hash, note, agent_attribution_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [t.id, a.userId, verdict, JSON.stringify(checks), checksHash, req.body.note, attrId]);
    await recordAttribution(deps, req, attrId, "verification", v.id);
    return { id: v.id, verdict, checks, checksHash, note: req.body.note, authorType: req.agent ? "agent" : "human", createdAt: v.created_at, onchain: { publishTx: proofs.publishTx, events: proofs.events?.length ?? 0 } };
  });

}
