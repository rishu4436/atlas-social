import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import type { Deps } from "./deps.js";
import { ApiError } from "./lib/errors.js";
import { loadSession } from "./lib/session.js";
import { bearerOf, loadAgent, enforceAgentAccess, auditAgentRequest, INTERNAL_HEADER, isInternalCall } from "./lib/agents.js";
import { agentRoutes } from "./routes/agents.js";
import { mcpRoutes } from "./routes/mcp.js";
import { authRoutes } from "./routes/auth.js";
import { connectRoutes } from "./routes/connect.js";
import { profileRoutes } from "./routes/profiles.js";
import { socialRoutes } from "./routes/social.js";
import { agentSocialRoutes } from "./routes/agent-social.js";
import { thesisRoutes } from "./routes/theses.js";
import { marketRoutes } from "./routes/markets.js";
import { payRoutes } from "./routes/pay.js";
import { researchRoutes } from "./routes/research.js";
import { communityRoutes } from "./routes/community.js";
import { adminRoutes } from "./routes/admin.js";
import { systemRoutes } from "./routes/system.js";
import { arenaRoutes } from "./routes/arena.js";
import { oauthRoutes } from "./routes/oauth.js";
import { wwwAuthenticate } from "./lib/oauth.js";

/**
 * Cookieless endpoints usable from any origin (browser-based MCP clients and inspectors): bearer/PKCE only, never a
 * cookie session, so CORS is open (no credentials) and the cross-origin write guard does not apply.
 */
const PUBLIC_CORS = /^\/(mcp(\/connect|\/info)?|oauth\/(token|register|revoke)|\.well-known\/(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/mcp)?|mcp\/\.well-known\/(oauth-protected-resource|oauth-authorization-server|openid-configuration))\/?$/;
export const isPublicCorsPath = (url: string) => PUBLIC_CORS.test(url.split("?")[0] ?? "");
const MCP_PROTECTED = /^\/mcp\/?$/;

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function buildApp(deps: Deps, opts: { logger?: boolean; /** in-process local demo seeding only (never set by the server entrypoint) */ disableRateLimit?: boolean } = {}): Promise<FastifyInstance> {
  // structured JSON logs (pino); request lines carry the path only (no query strings, no headers, no bodies)
  const logger = opts.logger ? { serializers: { req: (r: any) => ({ method: r.method, path: String(r.url ?? "").split("?")[0], reqId: r.id }) } } : false;
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintSafe));

  const origins = new Set([deps.cfg.PUBLIC_ORIGIN, ...deps.cfg.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)]);
  await app.register(cookie);
  await app.register(cors, () => (req: any, cb: any) => {
    if (isPublicCorsPath(req.url)) return cb(null, {
      origin: true, credentials: false, methods: ["GET", "POST", "DELETE", "OPTIONS"], maxAge: 86400,
      allowedHeaders: ["authorization", "content-type", "accept", "mcp-protocol-version", "mcp-session-id", "last-event-id", "x-atlas-agent-client", "x-atlas-agent-model"],
      exposedHeaders: ["www-authenticate", "mcp-session-id", "mcp-protocol-version"],
    });
    cb(null, { origin: (o: string | undefined, cb2: (e: Error | null, ok: boolean) => void) => cb2(null, !o || origins.has(o)), credentials: true, allowedHeaders: ["content-type", "x-atlas-csrf"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  if (!opts.disableRateLimit || deps.cfg.CHAIN_ID === 56) await app.register(rateLimit, { global: true, hook: "preHandler" /* after loadSession, so signed-in users are keyed by account rather than a shared proxy IP */, max: 300, timeWindow: "1 minute", keyGenerator: (req) => (req.agent ? `agent:${req.agent.tokenId}` : req.auth?.userId ?? req.ip), ...(deps.cfg.NODE_ENV === "test" ? { max: 100000 } : {}) });
  await app.register(swagger, {
    openapi: {
      info: { title: "ATLAS Social API", version: "1.0.0", description: "Agent ID-native social research network on BNB Smart Chain. The API prepares unsigned transactions and verifies results; it never signs or broadcasts for users." },
      components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "atlas_session" }, csrf: { type: "apiKey", in: "header", name: "x-atlas-csrf" } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorateRequest("auth", null);
  app.decorateRequest("agent", null);
  app.addHook("onRequest", async (req) => {
    const cookieless = isPublicCorsPath(req.url);
    // reject cross-site writes outright (defence in depth on top of SameSite cookies + CSRF token)
    if (!cookieless && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const o = req.headers.origin;
      if (o && !origins.has(o)) throw new ApiError(403, "BAD_ORIGIN", "Cross-origin write rejected");
    }
    if (cookieless && (!/^\/mcp/.test(req.url) || /\/\.well-known\//.test(req.url))) { req.auth = null; return; } // OAuth/discovery endpoints authenticate clients themselves
    const bearer = bearerOf(req);
    if (bearer !== null) {
      // Agent Gateway: bearer agent tokens never fall back to (or mix with) a cookie session
      (req as any).atlasInternal = isInternalCall(req);
      await loadAgent(deps, req, bearer);
      enforceAgentAccess(req, deps.cfg.AGENT_RATE_LIMIT_PER_MIN);
      return;
    }
    if (cookieless) { req.auth = null; return; } // never a cookie session on public bearer/OAuth endpoints
    await loadSession(deps, req);
  });
  // MCP authorization spec: every 401 from the protected MCP endpoint points clients at the resource metadata
  app.addHook("onSend", async (req, reply, payload) => {
    const path = req.url.split("?")[0] ?? "";
    if (isPublicCorsPath(path)) reply.header("cross-origin-resource-policy", "cross-origin");
    if (reply.statusCode === 401 && MCP_PROTECTED.test(path)) {
      const presented = req.headers.authorization !== undefined;
      reply.header("www-authenticate", wwwAuthenticate(deps, req, presented ? "invalid_token" : undefined, presented ? "The access token is invalid, expired or revoked" : undefined));
    }
    return payload;
  });
  app.addHook("onResponse", async (req, reply) => { await auditAgentRequest(deps, req, reply); });

  app.setErrorHandler((err: any, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) return reply.status(400).send({ error: "VALIDATION", message: "Invalid request", details: err.validation });
    if (err instanceof ApiError) { (reply as any).atlasErrorCode = err.code; return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details }); }
    if (err.statusCode === 429) {
      const ra = Number(reply.getHeader("retry-after") ?? 60) || 60;
      return reply.status(429).send({ error: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again.", details: { retryAfterSeconds: ra, action: "wait", fallback: false } });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? "BAD_REQUEST", message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong" });
  });

  for (const routes of [systemRoutes, authRoutes, connectRoutes, profileRoutes, socialRoutes, thesisRoutes, marketRoutes, researchRoutes, communityRoutes, adminRoutes, arenaRoutes, payRoutes, agentRoutes, agentSocialRoutes, mcpRoutes, oauthRoutes]) {
    await app.register(async (scope) => routes(scope, deps));
  }
  return app;
}
