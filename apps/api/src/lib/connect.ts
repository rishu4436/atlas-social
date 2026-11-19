/**
 * ATLAS Connect intents (see packages/auth/src/connect.ts for the protocol and docs/security/atlas-connect.md).
 * All reads/writes run in system context: the app role has no access to connect_intents.
 */
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CONNECT_COOKIE, CONNECT_INTENT_TTL_SECONDS, encodeConnectCode, normalizeConnectCode, handoffTexts, hashToken, safeEqual,
  type ConnectIntentView, type ConnectPurpose,
} from "@atlas/auth";
import { getAddress } from "viem";
import type { Deps } from "../deps.js";
import { ApiError } from "./errors.js";

export const PAY_INTENT_TTL_SECONDS = 1800; // a payment handoff may wait for app confirmation + broadcast
export const DEFAULT_PUBLIC_API = "https://atlas-social-api.onrender.com";

export const cookieName = (purpose: ConnectPurpose) => `${CONNECT_COOKIE}_${purpose.replace("-", "_")}`;

export function connectErr(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return new ApiError(status, code, message, details);
}

export function publicApiUrl(deps: Deps) {
  return (deps.cfg.PUBLIC_API_ORIGIN ?? (deps.cfg.NODE_ENV === "production" ? DEFAULT_PUBLIC_API : `${deps.cfg.PUBLIC_ORIGIN.replace(/\/$/, "")}/api`)).replace(/\/$/, "");
}

/** Creates an intent and binds it to THIS browser via an httpOnly SameSite=Strict cookie holding the verifier. */
export async function createIntent(deps: Deps, req: FastifyRequest, reply: FastifyReply, args: { purpose: ConnectPurpose; userId?: string | null; sessionId?: string | null; payload?: Record<string, unknown> }) {
  const code = encodeConnectCode(randomBytes(16));
  const verifier = randomBytes(32).toString("base64url");
  const ttl = args.purpose === "pay" ? PAY_INTENT_TTL_SECONDS : CONNECT_INTENT_TTL_SECONDS;
  const now = deps.now();
  const expiresAt = now + ttl;
  const [row] = await deps.db.sys(
    `INSERT INTO connect_intents (code_hash, browser_hash, purpose, user_id, session_id, payload, ip_hash, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),to_timestamp($9)) RETURNING id`,
    [hashToken(code), hashToken(verifier), args.purpose, args.userId ?? null, args.sessionId ?? null, args.payload ?? {}, hashToken(req.ip), now, expiresAt],
  );
  const secure = deps.cfg.COOKIE_SECURE ?? deps.cfg.NODE_ENV === "production";
  reply.setCookie(cookieName(args.purpose), `${row.id}.${verifier}`, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: ttl });
  const apiUrl = publicApiUrl(deps);
  return {
    intentId: row.id as string, code, purpose: args.purpose, expiresAt, serverNow: now, ttlSeconds: ttl,
    handoff: handoffTexts({ code, purpose: args.purpose, apiUrl, expiresAt, defaultApiUrl: DEFAULT_PUBLIC_API }),
  };
}

const secs = (d: Date | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : null);

/** Lazily expires; returns the row with an effective status. */
async function withExpiry(deps: Deps, row: any) {
  if (!row) return row;
  if (["pending", "challenge_issued", "approved"].includes(row.status) && secs(row.expires_at)! <= deps.now()) {
    await deps.db.sys(`UPDATE connect_intents SET status = 'expired' WHERE id = $1 AND status = $2`, [row.id, row.status]);
    row.status = "expired";
  }
  return row;
}

/**
 * Browser-side access: the cookie for this purpose must carry this intent id AND the verifier whose hash
 * was stored at creation. Anything else (another browser, a handoff holding only the code) is WRONG_BROWSER.
 */
export async function intentForBrowser(deps: Deps, req: FastifyRequest, intentId: string, purpose?: ConnectPurpose) {
  const [row] = await deps.db.sys(`SELECT * FROM connect_intents WHERE id = $1`, [intentId]);
  if (!row || (purpose && row.purpose !== purpose)) throw connectErr(404, "CONNECT_NOT_FOUND", "This connection request does not exist.");
  const raw = req.cookies?.[cookieName(row.purpose)] ?? "";
  const [cid, verifier] = raw.split(".");
  if (!verifier || cid !== row.id || !safeEqual(hashToken(verifier), row.browser_hash)) {
    throw connectErr(403, "CONNECT_WRONG_BROWSER", "This connection request belongs to a different browser. Start Continue with Agentic Wallet again in this browser.");
  }
  if (row.session_id && req.auth?.sessionId !== row.session_id) throw connectErr(403, "CONNECT_WRONG_SESSION", "This request was created by a different session. Sign in again and retry.");
  return withExpiry(deps, row);
}

/** Handoff-side access by the public code only. Never returns browser-binding material. */
export async function intentByCode(deps: Deps, rawCode: string) {
  const code = normalizeConnectCode(rawCode);
  if (!code) throw connectErr(400, "CONNECT_BAD_CODE", "That is not an ATLAS connection code (ATC-…).");
  const [row] = await deps.db.sys(`SELECT * FROM connect_intents WHERE code_hash = $1`, [hashToken(code)]);
  if (!row) throw connectErr(404, "CONNECT_NOT_FOUND", "Unknown connection code. Start again from the ATLAS website.");
  return withExpiry(deps, row);
}

export function assertOpen(row: any, allowed: string[]) {
  if (row.status === "expired") throw connectErr(410, "CONNECT_EXPIRED", "This connection code expired. Start again from the ATLAS website.");
  if (row.status === "redeemed") throw connectErr(409, "CONNECT_ALREADY_USED", "This connection was already used. Each code works once.");
  if (row.status === "cancelled") throw connectErr(409, "CONNECT_CANCELLED", "This connection was cancelled in the browser.");
  if (row.status === "failed") throw connectErr(409, "CONNECT_FAILED", "This connection failed too many times. Start again from the ATLAS website.");
  if (!allowed.includes(row.status)) throw connectErr(409, "CONNECT_WRONG_STATE", `This connection is ${row.status}.`, { status: row.status });
}

export function viewIntent(deps: Deps, row: any): ConnectIntentView {
  return {
    intentId: row.id, purpose: row.purpose, status: row.status, stage: row.stage ?? null, stageDetail: row.stage_detail ?? null,
    agentName: row.agent_name ?? row.payload?.claimed?.agentName ?? null,
    wallet: row.wallet || row.payload?.claimed?.wallet ? getAddress(row.wallet ?? row.payload.claimed.wallet) : null,
    expiresAt: secs(row.expires_at)!, serverNow: deps.now(),
    result: row.result ?? null,
  };
}
