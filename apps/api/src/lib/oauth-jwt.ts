/**
 * RFC 7523 private_key_jwt client authentication (RS256 / ES256) for CIMD clients.
 * Assertions are verified against the client's jwks / jwks_uri; jti values cannot be reused.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { Deps } from "../deps.js";

export class ClientAssertionError extends Error {
  readonly error = "invalid_client" as const;
  readonly status = 401 as const;
  constructor(description: string) { super(description); }
}
const fail = (d: string): never => { throw new ClientAssertionError(d); };

export const PRIVATE_KEY_JWT_ALGS = ["RS256", "ES256"] as const;
export type PrivateKeyJwtAlg = (typeof PRIVATE_KEY_JWT_ALGS)[number];
export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const SKEW_S = 60;
const MAX_TTL_S = 5 * 60;
const MAX_JWT_LEN = 8192;
const MAX_JTI_LEN = 200;

export type Jwk = Record<string, unknown> & { kty?: string; kid?: string; use?: string; alg?: string; crv?: string };

function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** JWT ES256 signatures are raw R||S (64 bytes); Node's crypto.verify expects a DER SEQUENCE. */
export function ecdsaJoseToDer(sig: Buffer) {
  if (sig.length !== 64) throw new Error("ES256 signature must be 64 bytes");
  const enc = (buf: Buffer) => {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    const v = buf.subarray(i);
    return (v[0]! & 0x80) ? Buffer.concat([Buffer.from([0]), v]) : v;
  };
  const r = enc(sig.subarray(0, 32));
  const s = enc(sig.subarray(32));
  const seq = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq]);
}

function verifySig(alg: PrivateKeyJwtAlg, data: Buffer, sig: Buffer, jwk: Jwk): boolean {
  try {
    if (alg === "RS256") {
      if (jwk.kty !== "RSA") return false;
      const key = createPublicKey({ key: jwk as any, format: "jwk" });
      return cryptoVerify("sha256", data, key, sig);
    }
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || sig.length !== 64) return false;
    const key = createPublicKey({ key: jwk as any, format: "jwk" });
    return cryptoVerify("sha256", data, key, ecdsaJoseToDer(sig));
  } catch {
    return false;
  }
}

function pickKey(keys: Jwk[], header: { kid?: string; alg: string }): Jwk | undefined {
  const usable = keys.filter((k) => k && typeof k === "object" && (!k.use || k.use === "sig") && (!k.alg || k.alg === header.alg));
  if (header.kid) return usable.find((k) => k.kid === header.kid) ?? keys.find((k) => k.kid === header.kid);
  return usable.length === 1 ? usable[0] : undefined;
}

export function peekJwtSub(token: unknown): string | undefined {
  if (typeof token !== "string") return undefined;
  try {
    const payload = b64urlJson(token.split(".")[1] ?? "");
    return typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

export function verifyClientJwt(token: string, keys: Jwk[], opts: { clientId: string; audiences: string[]; now?: number }) {
  if (token.length > MAX_JWT_LEN || token.split(".").length !== 3) fail("Invalid client_assertion");
  const [h, p, s] = token.split(".") as [string, string, string];
  let header: any;
  let payload: any;
  try { header = b64urlJson(h); payload = b64urlJson(p); } catch {
    fail("Invalid client_assertion");
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") fail("Invalid client_assertion");
  if (header.typ != null && header.typ !== "JWT") fail("client_assertion typ must be JWT");
  if (header.alg === "none" || header.alg === "HS256" || !PRIVATE_KEY_JWT_ALGS.includes(header.alg)) {
    fail("client_assertion must be signed with RS256 or ES256");
  }
  const key = pickKey(keys, header);
  if (!key || !verifySig(header.alg, Buffer.from(`${h}.${p}`), Buffer.from(s, "base64url"), key)) {
    fail("client_assertion signature is invalid");
  }
  if (payload.iss !== opts.clientId || payload.sub !== opts.clientId) {
    fail("client_assertion iss and sub must equal client_id");
  }
  const aud = payload.aud;
  const auds = Array.isArray(aud) ? aud : [aud];
  const allowed = new Set(opts.audiences.map((a) => a.replace(/\/$/, "")));
  if (!auds.some((a) => typeof a === "string" && allowed.has(a.replace(/\/$/, "")))) {
    fail("client_assertion aud is not this authorization server");
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number") fail("client_assertion must include exp");
  if (payload.exp < now - SKEW_S) fail("client_assertion has expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + SKEW_S) fail("client_assertion is not yet valid");
  if (typeof payload.iat === "number" && payload.iat > now + SKEW_S) fail("client_assertion iat is in the future");
  const start = typeof payload.iat === "number" ? payload.iat : now;
  if (payload.exp - start > MAX_TTL_S + SKEW_S) fail("client_assertion lifetime is too long");
  if (typeof payload.jti !== "string" || !payload.jti || payload.jti.length > MAX_JTI_LEN) {
    fail("client_assertion must include a unique jti");
  }
  return { jti: payload.jti as string, exp: payload.exp as number };
}

/** Record a jti so the same assertion cannot be presented again. */
export async function consumeAssertionJti(deps: Deps, clientId: string, jti: string, exp: number) {
  await deps.db.sys(`DELETE FROM oauth_assertion_jti WHERE expires_at < now()`);
  try {
    await deps.db.sys(
      `INSERT INTO oauth_assertion_jti (client_id, jti, expires_at) VALUES ($1,$2, to_timestamp($3))`,
      [clientId, jti, exp],
    );
  } catch (e: any) {
    if (e?.code === "23505") fail("client_assertion jti already used");
    throw e;
  }
}
