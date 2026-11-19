/**
 * ATLAS Agent Gateway — authentication, authorization, rate limiting, audit and attribution for agent tokens.
 *
 * An agent token is a bearer credential an operator (signed-in Agent ID holder) issues to an external AI agent.
 * It is NOT a session: it never satisfies the wallet step-up, so it can never sign, move assets, create tokens or
 * change security settings. Only routes in AGENT_ROUTES are reachable with it, each gated by a scope.
 */
import { randomUUID, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken } from "@atlas/auth";
import { AGENT_ROUTES, TOKEN_PREFIX, type AgentScope } from "@atlas/agent-gateway/scopes";
import type { Deps } from "../deps.js";
import { ApiError } from "./errors.js";

export interface AgentContext {
  tokenId: string;
  agentId: string;
  agentName: string;
  operatorId: string;
  scopes: AgentScope[];
  model: string;
  client: string;
}

declare module "fastify" {
  interface FastifyRequest {
    agent?: AgentContext | null;
    /** set when an Authorization: Bearer header was presented (valid or not) */
    agentAttempt?: { error?: string; tokenId?: string; operatorId?: string; agentId?: string; scope?: string | null };
    agentStart?: number;
  }
}

/** Per-process secret marking the gateway's own in-process calls (app.inject) so they are not double-counted. */
export const INTERNAL_HEADER = "x-atlas-internal";
const INTERNAL_SECRET = randomBytes(24).toString("hex");
export const internalHeaders = () => ({ [INTERNAL_HEADER]: INTERNAL_SECRET });
export const isInternalCall = (req: FastifyRequest) => req.headers[INTERNAL_HEADER] === INTERNAL_SECRET;

export const newAgentToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const clean = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/[^\x20-\x7e]/g, "").trim().slice(0, max) : "");

export function bearerOf(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : "";
}

/** Loads the agent context from a bearer token. Cookies are ignored for bearer requests. */
export async function loadAgent(deps: Deps, req: FastifyRequest, token: string) {
  req.agent = null;
  req.agentAttempt = {};
  req.agentStart = Date.now();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 40) { req.agentAttempt.error = "AGENT_TOKEN_INVALID"; return; }
  const [t] = await deps.db.sys(
    `SELECT t.*, a.name AS agent_name, u.status AS operator_status,
            EXISTS (SELECT 1 FROM agent_id_links l WHERE l.user_id = t.operator_id AND l.revoked_at IS NULL) AS operator_linked
       FROM agent_tokens t JOIN agents a ON a.id = t.agent_id JOIN users u ON u.id = t.operator_id WHERE t.token_hash = $1`,
    [hashToken(token)],
  );
  if (!t) { req.agentAttempt.error = "AGENT_TOKEN_INVALID"; return; }
  Object.assign(req.agentAttempt, { tokenId: t.id, operatorId: t.operator_id, agentId: t.agent_id });
  if (t.revoked_at) { req.agentAttempt.error = "AGENT_TOKEN_REVOKED"; return; }
  if (new Date(t.expires_at).getTime() <= deps.now() * 1000) { req.agentAttempt.error = "AGENT_TOKEN_EXPIRED"; return; }
  if (t.operator_status !== "active" || !t.operator_linked) { req.agentAttempt.error = "AGENT_OPERATOR_INACTIVE"; return; }
  // declared by the agent per request (MCP clientInfo / headers), else what the operator declared at creation
  const model = clean(req.headers["x-atlas-agent-model"]) || t.declared_model || "undeclared";
  const client = clean(req.headers["x-atlas-agent-client"]) || t.declared_client || "undeclared";
  req.agent = { tokenId: t.id, agentId: t.agent_id, agentName: t.agent_name, operatorId: t.operator_id, scopes: t.scopes, model, client };
  // the operator acts through the agent, with no session powers: no CSRF cookie, no wallet step-up, no roles
  req.auth = { userId: t.operator_id, sessionId: `agent:${t.id}`, method: "agent", walletVerifiedAt: null, csrfHash: "", status: "active", roles: [] };
  if (!t.last_used_at || deps.now() - Math.floor(new Date(t.last_used_at).getTime() / 1000) > 60) {
    await deps.db.sys(`UPDATE agent_tokens SET last_used_at = now() WHERE id = $1`, [t.id]);
  }
}

const AGENT_ERRORS: Record<string, string> = {
  AGENT_TOKEN_INVALID: "Invalid agent token.",
  AGENT_TOKEN_REVOKED: "This agent token was revoked by its operator.",
  AGENT_TOKEN_EXPIRED: "This agent token has expired. Ask the operator for a new one.",
  AGENT_OPERATOR_INACTIVE: "The operator account behind this token is not active or no longer holds a linked Agent ID.",
};

/** Fixed one-minute window per agent token (in-process; the API runs as one instance on the free plan). */
const windows = new Map<string, { start: number; n: number }>();
export function agentRateLimit(tokenId: string, limit: number, nowMs = Date.now()) {
  const w = windows.get(tokenId);
  if (!w || nowMs - w.start >= 60_000) { windows.set(tokenId, { start: nowMs, n: 1 }); return { ok: true, retryAfter: 0 }; }
  w.n++;
  if (windows.size > 10_000) for (const [k, v] of windows) if (nowMs - v.start >= 60_000) windows.delete(k);
  return w.n <= limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((w.start + 60_000 - nowMs) / 1000) };
}

/** Route allowlist + scope check + per-token rate limit. Runs after routing, before handlers. */
export function enforceAgentAccess(req: FastifyRequest, limitPerMin: number) {
  if (!req.agentAttempt) return;
  const err = req.agentAttempt.error;
  if (err) throw new ApiError(401, err, AGENT_ERRORS[err] ?? "Agent authentication failed");
  const key = `${req.method} ${req.routeOptions?.url ?? ""}`;
  const need = AGENT_ROUTES[key];
  req.agentAttempt.scope = need ?? null;
  if (!need) throw new ApiError(403, "AGENT_ROUTE_NOT_ALLOWED", "Agent tokens cannot call this endpoint. Signing, asset movement, sign-in, tokens, settings and messages are human-only.");
  if (need !== "any" && !req.agent!.scopes.includes(need)) throw new ApiError(403, "AGENT_SCOPE_MISSING", `This agent token lacks the "${need}" scope.`, { required: need, granted: req.agent!.scopes });
  // MCP tool calls re-enter the API in-process; only the outer request counts against the token's budget
  if ((req as any).atlasInternal) return;
  const rl = agentRateLimit(req.agent!.tokenId, limitPerMin);
  if (!rl.ok) throw new ApiError(429, "AGENT_RATE_LIMITED", `Agent token rate limit (${limitPerMin}/min) reached. Wait and retry.`, { retryAfterSeconds: rl.retryAfter, action: "wait" });
}

/** One audit row per agent request (allowed, denied, rate-limited or failed). Never stores bodies or secrets. */
export async function auditAgentRequest(deps: Deps, req: FastifyRequest, reply: FastifyReply) {
  const at = req.agentAttempt;
  if (!at) return;
  const status = reply.statusCode;
  const outcome = status === 429 ? "rate_limited" : status === 401 || status === 403 ? "denied" : status >= 400 ? "error" : "ok";
  const params = (req.params ?? {}) as Record<string, string>;
  const tool = clean(req.headers["x-atlas-mcp-tool"], 60) || null;
  await deps.db.sys(
    `INSERT INTO agent_audit_log (token_id, agent_id, operator_id, method, route, scope, tool, status, outcome, subject_id, error_code, duration_ms, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [at.tokenId ?? null, at.agentId ?? null, at.operatorId ?? null, req.method, (req.routeOptions?.url ?? req.url.split("?")[0] ?? "").slice(0, 120), at.scope ?? null, tool, status, outcome,
      (params.id ?? null)?.slice(0, 80) ?? null, (reply as any).atlasErrorCode ?? at.error ?? null, req.agentStart ? Date.now() - req.agentStart : null, hashToken(req.ip)],
  ).catch((e) => req.log.error({ err: e }, "agent audit write failed"));
}

// ------------------------------------------------------------------ attribution
export type AttributionKind = "thesis" | "review" | "challenge" | "verification";

/** Pre-allocates an attribution id to store ON the content row in the same insert (content is never unlabelled). */
export const attributionIdFor = (req: FastifyRequest) => (req.agent ? randomUUID() : null);

export async function recordAttribution(deps: Deps, req: FastifyRequest, id: string | null, kind: AttributionKind, subjectId: string) {
  const a = req.agent;
  if (!a || !id) return null;
  await deps.db.sys(
    `INSERT INTO agent_attributions (id, agent_id, token_id, operator_id, agent_name, model, client, subject_kind, subject_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, a.agentId, a.tokenId, a.operatorId, a.agentName, a.model, a.client, kind, subjectId],
  );
  return id;
}

export const AGENT_LABEL = "Agent-authored: written by an AI agent acting for this Agent ID holder. Attribution is permanent; agent forecasts are ranked only on the AI Analysts board and never count toward human Skill Score or Points.";

export function attributionView(r: any) {
  if (!r) return null;
  return {
    id: r.id, agentId: r.agent_id, agentName: r.agent_name, model: r.model, client: r.client, tokenId: r.token_id,
    operatorId: r.operator_id, operatorAgentName: r.operator_agent_name ?? null, createdAt: r.created_at,
    declared: true, label: AGENT_LABEL,
  };
}

/** Loads attributions by id (public provenance). */
export async function attributionsByIds(deps: Deps, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, ReturnType<typeof attributionView>>();
  const rows = await deps.db.sys(`SELECT a.*, p.agent_name AS operator_agent_name FROM agent_attributions a LEFT JOIN profiles p ON p.user_id = a.operator_id WHERE a.id = ANY($1::uuid[])`, [list]);
  return new Map(rows.map((r) => [r.id as string, attributionView(r)]));
}
