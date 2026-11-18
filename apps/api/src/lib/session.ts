import type { FastifyReply, FastifyRequest } from "fastify";
import {
  SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, SESSION_TTL_SECONDS, SESSION_IDLE_SECONDS, STEP_UP_TTL_SECONDS,
  newToken, hashToken, safeEqual,
} from "@atlas/auth";
import type { Deps } from "../deps.js";
import { ApiError, unauthorized, forbidden } from "./errors.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  method: "wallet" | "passkey";
  walletVerifiedAt: number | null;
  csrfHash: string;
  status: string;
  roles: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    authError?: "SESSION_EXPIRED" | "SESSION_INVALID";
  }
}

const secs = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);

export async function loadSession(deps: Deps, req: FastifyRequest): Promise<void> {
  req.auth = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const [s] = await deps.db.sys(
    `SELECT s.*, u.status, coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN user_roles r ON r.user_id = s.user_id
      WHERE s.token_hash = $1 GROUP BY s.id, u.status`,
    [hashToken(token)],
  );
  const now = deps.now();
  if (!s || s.revoked_at) { req.authError = "SESSION_INVALID"; return; }
  if (secs(s.expires_at)! < now || now - secs(s.last_seen_at)! > SESSION_IDLE_SECONDS || s.status !== "active") {
    req.authError = "SESSION_EXPIRED";
    return;
  }
  if (now - secs(s.last_seen_at)! > 60) await deps.db.sys(`UPDATE sessions SET last_seen_at = to_timestamp($2) WHERE id = $1`, [s.id, now]);
  req.auth = {
    userId: s.user_id, sessionId: s.id, method: s.auth_method, walletVerifiedAt: secs(s.wallet_verified_at), csrfHash: s.csrf_hash,
    status: s.status, roles: s.roles,
  };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) {
    if (req.authError === "SESSION_EXPIRED") throw new ApiError(401, "SESSION_EXPIRED", "Your session expired. Sign in again to continue.");
    throw unauthorized();
  }
  return req.auth;
}

/** Double-submit CSRF: header must match the session's CSRF token (hash stored server-side). */
export function requireCsrf(req: FastifyRequest) {
  const a = requireAuth(req);
  const h = req.headers[CSRF_HEADER];
  if (typeof h !== "string" || !safeEqual(hashToken(h), a.csrfHash)) throw forbidden("CSRF", "Missing or invalid CSRF token");
  return a;
}

/** Financial / high-risk actions need a wallet proof from the last 10 minutes; passkeys never count. */
export function requireFreshWallet(deps: Deps, req: FastifyRequest) {
  const a = requireCsrf(req);
  if (!a.walletVerifiedAt || deps.now() - a.walletVerifiedAt > STEP_UP_TTL_SECONDS) {
    throw new ApiError(403, "STEP_UP_REQUIRED", "Confirm with your Agent ID wallet to continue.");
  }
  return a;
}

export function requireModerator(req: FastifyRequest) {
  const a = requireCsrfOrRead(req);
  if (!a.roles.includes("moderator") && !a.roles.includes("admin")) throw forbidden("MODERATOR_ONLY", "Moderator role required");
  return a;
}

function requireCsrfOrRead(req: FastifyRequest) {
  return req.method === "GET" ? requireAuth(req) : requireCsrf(req);
}

export async function startSession(deps: Deps, req: FastifyRequest, reply: FastifyReply, args: { userId: string; method: "wallet" | "passkey"; walletVerified: boolean }) {
  // rotation: any session cookie presented with this login is revoked
  const old = req.cookies?.[SESSION_COOKIE];
  if (old) await deps.db.sys(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(old)]);
  const token = newToken();
  const csrf = newToken(24);
  const now = deps.now();
  const [s] = await deps.db.sys(
    `INSERT INTO sessions (user_id, token_hash, csrf_hash, auth_method, wallet_verified_at, expires_at, last_seen_at, created_at, user_agent, ip_hash)
     VALUES ($1,$2,$3,$4, ${args.walletVerified ? "to_timestamp($5)" : "NULL"}, to_timestamp($5 + ${SESSION_TTL_SECONDS}), to_timestamp($5), to_timestamp($5), $6, $7) RETURNING id`,
    [args.userId, hashToken(token), hashToken(csrf), args.method, now, String(req.headers["user-agent"] ?? "").slice(0, 300), hashToken(req.ip)],
  );
  const secure = deps.cfg.COOKIE_SECURE ?? deps.cfg.NODE_ENV === "production";
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  reply.setCookie(CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  await securityEvent(deps, args.userId, "session.created", { method: args.method, sessionId: s.id });
  return { sessionId: s.id as string, csrfToken: csrf };
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
}

export async function securityEvent(deps: Deps, userId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  await deps.db.sys(`INSERT INTO security_events (user_id, kind, detail) VALUES ($1,$2,$3)`, [userId, kind, detail]);
}
