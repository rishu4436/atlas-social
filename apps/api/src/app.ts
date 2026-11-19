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
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profiles.js";
import { socialRoutes } from "./routes/social.js";
import { thesisRoutes } from "./routes/theses.js";
import { marketRoutes } from "./routes/markets.js";
import { payRoutes } from "./routes/pay.js";
import { researchRoutes } from "./routes/research.js";
import { communityRoutes } from "./routes/community.js";
import { adminRoutes } from "./routes/admin.js";
import { systemRoutes } from "./routes/system.js";
import { arenaRoutes } from "./routes/arena.js";

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function buildApp(deps: Deps, opts: { logger?: boolean; /** in-process local demo seeding only (never set by the server entrypoint) */ disableRateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintSafe));

  const origins = new Set([deps.cfg.PUBLIC_ORIGIN, ...deps.cfg.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)]);
  await app.register(cookie);
  await app.register(cors, { origin: (o, cb) => cb(null, !o || origins.has(o)), credentials: true, allowedHeaders: ["content-type", "x-atlas-csrf"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  if (!opts.disableRateLimit || deps.cfg.CHAIN_ID === 56) await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", keyGenerator: (req) => req.auth?.userId ?? req.ip, ...(deps.cfg.NODE_ENV === "test" ? { max: 100000 } : {}) });
  await app.register(swagger, {
    openapi: {
      info: { title: "ATLAS Social API", version: "1.0.0", description: "Agent ID-native social research network on BNB Smart Chain. The API prepares unsigned transactions and verifies results; it never signs or broadcasts for users." },
      components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "atlas_session" }, csrf: { type: "apiKey", in: "header", name: "x-atlas-csrf" } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    // reject cross-site writes outright (defence in depth on top of SameSite cookies + CSRF token)
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const o = req.headers.origin;
      if (o && !origins.has(o)) throw new ApiError(403, "BAD_ORIGIN", "Cross-origin write rejected");
    }
    await loadSession(deps, req);
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) return reply.status(400).send({ error: "VALIDATION", message: "Invalid request", details: err.validation });
    if (err instanceof ApiError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.statusCode === 429) {
      const ra = Number(reply.getHeader("retry-after") ?? 60) || 60;
      return reply.status(429).send({ error: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again.", details: { retryAfterSeconds: ra, action: "wait", fallback: false } });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? "BAD_REQUEST", message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong" });
  });

  for (const routes of [systemRoutes, authRoutes, profileRoutes, socialRoutes, thesisRoutes, marketRoutes, researchRoutes, communityRoutes, adminRoutes, arenaRoutes, payRoutes]) {
    await app.register(async (scope) => routes(scope, deps));
  }
  return app;
}
