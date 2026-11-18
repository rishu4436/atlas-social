import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "atlas_session";
export const CSRF_COOKIE = "atlas_csrf";
export const CSRF_HEADER = "x-atlas-csrf";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const SESSION_IDLE_SECONDS = 24 * 3600;
/** Freshly wallet-authorized state for protected writes (blueprint §5 state 3). */
export const STEP_UP_TTL_SECONDS = 10 * 60;

export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cookieOptions(secure: boolean, maxAge = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

export type AuthLevel = "guest" | "session" | "fresh-wallet";

export interface SessionView {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  walletVerifiedAt: number | null;
  method: "wallet-signature" | "onchain-proof" | "passkey";
}

export function authLevel(s: SessionView | null, now = Math.floor(Date.now() / 1000)): AuthLevel {
  if (!s || now > s.expiresAt || now - s.lastSeenAt > SESSION_IDLE_SECONDS) return "guest";
  if (s.walletVerifiedAt && now - s.walletVerifiedAt <= STEP_UP_TTL_SECONDS) return "fresh-wallet";
  return "session";
}
