/**
 * OAuth 2.1 authorization server for the ATLAS MCP gateway (MCP authorization spec 2025-06-18 / 2025-11-25).
 *
 * - Authorization code + PKCE (S256 only), public clients by default; confidential DCR clients get a hashed secret.
 * - Client registration: Client ID Metadata Documents (https client_id URLs, fetched with an SSRF guard) and RFC 7591.
 * - Tokens are opaque, stored as SHA-256 hashes, bound to ONE resource (the MCP URL, RFC 8707): access 1 h,
 *   refresh 30 d single-use with rotation and reuse detection (reuse revokes the whole grant).
 * - A grant is an agent_tokens row, so scopes, route allowlist, attribution, audit and Settings → Agents revocation
 *   are exactly the agent-token rules. OAuth tokens can never sign, move assets or change account security.
 */
import { createHash, randomBytes } from "node:crypto";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { FastifyRequest } from "fastify";
import { hashToken } from "@atlas/auth";
import { AGENT_SCOPES, ALL_SCOPES, READ_ONLY_SCOPES, isScope, type AgentScope } from "@atlas/agent-gateway/scopes";
import type { Deps } from "../deps.js";

export const ACCESS_PREFIX = "atlas_oat_";
export const REFRESH_PREFIX = "atlas_ort_";
export const CODE_PREFIX = "atlas_oac_";
export const DCR_PREFIX = "atlas_dcr_";
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86400;
export const GRANT_TTL_DAYS = 90;
export const REQUEST_TTL_S = 15 * 60; // time to sign in and consent
export const CODE_TTL_S = 120;
export const MAX_OAUTH_GRANTS = 20;
export const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = ["none", "private_key_jwt", "client_secret_post", "client_secret_basic"] as const;
export const TOKEN_ENDPOINT_AUTH_SIGNING_ALGS = ["RS256", "ES256"] as const;
export const CIMD_AUTH_METHODS = ["none", "private_key_jwt"] as const;
export const DCR_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;

/**
 * Upper bound on the OAuth `state` we will store. Google custom MCP connectors send a 1–2 KB encrypted
 * Keymaster blob (base64 with +, /, =, and percent-encoded octets). Silently truncating it makes the
 * callback fail with "KeymasterException: Ciphertext HMAC does not verify".
 */
export const MAX_OAUTH_STATE_LEN = 4096;

/** Pre-checked on the consent screen; everything else is opt-in. */
export const DEFAULT_OAUTH_SCOPES: AgentScope[] = [...READ_ONLY_SCOPES, "research:run", "thesis:draft"];
export const OAUTH_SCOPES_SUPPORTED = Object.keys(AGENT_SCOPES) as AgentScope[];

export const newSecret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
export const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function verifyPkce(verifier: unknown, challenge: string) {
  return typeof verifier === "string" && VERIFIER_RE.test(verifier) && s256(verifier) === challenge;
}

/** Requested scope string → known ATLAS scopes (unknown values such as openid/offline_access are ignored). */
/**
 * Scopes a client asks for. Clients that ask for nothing (most remote MCP clients) get every scope SHOWN on the consent
 * page; only DEFAULT_OAUTH_SCOPES are pre-selected, writes and publishing stay off until the user turns them on.
 */
export function parseScopes(scope: unknown): AgentScope[] {
  if (typeof scope !== "string" || !scope.trim()) return [...ALL_SCOPES];
  const s = [...new Set(scope.split(/\s+/).filter(isScope))] as AgentScope[];
  return s.length ? s : [...ALL_SCOPES];
}

// ------------------------------------------------------------------ issuer / resource
export const DEFAULT_PRODUCTION_ISSUER = "https://atlas-social-api.onrender.com";
/**
 * The ONE issuer / API base. Never derived from forwarded headers: requests relayed by the web proxy
 * (atlascalls.xyz/api/*) carry x-forwarded-host atlascalls.xyz, and RFC 9207 clients (Claude) reject an `iss`
 * that differs from the metadata issuer. Order: PUBLIC_API_ORIGIN → production default → request (dev only).
 */
export function apiBase(deps: Deps, req: FastifyRequest) {
  const fixed = deps.cfg.PUBLIC_API_ORIGIN ?? (deps.cfg.NODE_ENV === "production" ? DEFAULT_PRODUCTION_ISSUER : null);
  return (fixed ?? `${req.protocol}://${req.host}`).replace(/\/+$/, "");
}
export const mcpResource = (deps: Deps, req: FastifyRequest) => `${apiBase(deps, req)}/mcp`;
export const resourceMetadataUrl = (deps: Deps, req: FastifyRequest) => `${apiBase(deps, req)}/.well-known/oauth-protected-resource/mcp`;

/** Accepts the MCP URL (with or without a trailing slash) or the bare API origin; returns the canonical MCP resource or null. */
export function canonicalResource(deps: Deps, req: FastifyRequest, resource: unknown): string | null {
  const canon = mcpResource(deps, req);
  if (resource === undefined || resource === null || resource === "") return canon;
  if (typeof resource !== "string") return null;
  const r = resource.replace(/\/+$/, "");
  return r === canon || r === apiBase(deps, req) ? canon : null;
}

export function wwwAuthenticate(deps: Deps, req: FastifyRequest, error?: "invalid_token" | "insufficient_scope", description?: string) {
  const parts = [`resource_metadata="${resourceMetadataUrl(deps, req)}"`, `scope="${DEFAULT_OAUTH_SCOPES.join(" ")}"`];
  if (error) parts.unshift(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/["\\]/g, "")}"`);
  return `Bearer ${parts.join(", ")}`;
}

// ------------------------------------------------------------------ redirect URIs
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BANNED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

export function validRedirectUri(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 2000) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return !BANNED_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol); // native app schemes (cursor://, vscode://)
}

/** Exact match, except loopback http redirects may use any port (RFC 8252 §7.3, OAuth 2.1). */
export function redirectMatches(registered: string[], candidate: string) {
  if (registered.includes(candidate)) return true;
  let c: URL;
  try { c = new URL(candidate); } catch { return false; }
  if (c.protocol !== "http:" || !LOOPBACK.has(c.hostname)) return false;
  return registered.some((r) => {
    try { const x = new URL(r); return x.protocol === "http:" && x.hostname === c.hostname && x.pathname === c.pathname && x.search === c.search; } catch { return false; }
  });
}

// ------------------------------------------------------------------ Client ID Metadata Documents
export function isCimdClientId(id: unknown): id is string {
  if (typeof id !== "string" || id.length > 500) return false;
  try { const u = new URL(id); return u.protocol === "https:" && u.pathname.length > 1 && !u.hash && !u.username && !u.password; } catch { return false; }
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

const guardedLookup: any = (host: string, opts: any, cb: any) => {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return cb(Object.assign(new Error("client metadata host resolves to a private address"), { code: "EPRIVATE" }));
    if (opts?.all) return cb(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
};

/** GET a small JSON document over https without following redirects and refusing private addresses. Replaceable in tests. */
export const httpsJsonFetcher = {
  fetch: (url: string, label = "document"): Promise<unknown> => new Promise((resolve, reject) => {
    const req = https.get(url, { lookup: guardedLookup, timeout: 5000, headers: { accept: "application/json", "user-agent": "atlas-social-oauth/1.0" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${label} HTTP ${res.statusCode}`)); }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => { size += c.length; if (size > 64 * 1024) { req.destroy(new Error(`${label} too large`)); return; } chunks.push(c); });
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error(`${label} is not JSON`)); } });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`${label} timeout`)));
    req.on("error", reject);
  }),
};
export const cimdFetcher = {
  fetch: (url: string): Promise<unknown> => httpsJsonFetcher.fetch(url, "client metadata"),
};
const jwksMem = new Map<string, { exp: number; keys: any[] }>();
export const jwksFetcher = {
  fetch: async (url: string, opts?: { bypassCache?: boolean }): Promise<{ keys: any[] }> => {
    const hit = jwksMem.get(url);
    if (!opts?.bypassCache && hit && hit.exp > Date.now()) return { keys: hit.keys };
    const doc = await httpsJsonFetcher.fetch(url, "jwks");
    const keys = doc && typeof doc === "object" && Array.isArray((doc as any).keys) ? (doc as any).keys : null;
    if (!keys) throw new Error("jwks document must contain a keys array");
    jwksMem.set(url, { exp: Date.now() + 10 * 60_000, keys });
    return { keys };
  },
  clear() { jwksMem.clear(); },
};

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const httpsUrl = (v: unknown) => { const s = str(v, 500); if (!s) return null; try { return new URL(s).protocol === "https:" ? s : null; } catch { return null; } };

export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED)[number];
export interface OAuthClient {
  client_id: string; kind: "dcr" | "cimd"; client_name: string; client_uri: string | null; logo_uri: string | null;
  redirect_uris: string[]; token_endpoint_auth_method: TokenEndpointAuthMethod; secret_hash: string | null; scope: string | null;
  jwks_uri: string | null; jwks: { keys: any[] } | null; auth_methods: string[];
}
function metaOf(row: any): Record<string, any> {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
}
function asClient(row: any): OAuthClient {
  const md = metaOf(row);
  const jwks = md.jwks && typeof md.jwks === "object" && Array.isArray(md.jwks.keys) ? md.jwks : null;
  const auth_methods = Array.isArray(md.auth_methods)
    ? md.auth_methods.filter((m: unknown) => typeof m === "string")
    : [row.token_endpoint_auth_method];
  return {
    client_id: row.client_id, kind: row.kind, client_name: row.client_name, client_uri: row.client_uri, logo_uri: row.logo_uri,
    redirect_uris: row.redirect_uris, token_endpoint_auth_method: row.token_endpoint_auth_method, secret_hash: row.secret_hash, scope: row.scope,
    jwks_uri: typeof md.jwks_uri === "string" ? md.jwks_uri : null, jwks, auth_methods,
  };
}
function cimdAuthMethods(doc: any, method: string): string[] {
  const listed = Array.isArray(doc?.token_endpoint_auth_methods_supported)
    ? doc.token_endpoint_auth_methods_supported.filter((m: unknown) => typeof m === "string")
    : [];
  return [...new Set([method, ...listed])].slice(0, 10);
}

export class OAuthError extends Error {
  constructor(public error: string, public description: string, public status = 400) { super(description); }
}

/** Loads a client: DCR from the table, CIMD from a cache refreshed every 24 h. */
export async function resolveClient(deps: Deps, clientId: unknown): Promise<OAuthClient> {
  if (typeof clientId !== "string" || !clientId) throw new OAuthError("invalid_client", "client_id is required", 401);
  const [row] = await deps.db.sys(`SELECT *, extract(epoch FROM now() - fetched_at) AS age FROM oauth_clients WHERE client_id = $1`, [clientId]);
  const cimdFresh = row && row.kind === "cimd" && Number(row.age) < 86400 && Array.isArray(metaOf(row).auth_methods);
  if (row && (row.kind === "dcr" || cimdFresh)) return asClient(row);
  if (!isCimdClientId(clientId)) throw new OAuthError("invalid_client", "Unknown client_id. Register with POST /oauth/register or use an https Client ID Metadata Document URL.", 401);
  let doc: any;
  try { doc = await cimdFetcher.fetch(clientId); } catch (e) {
    if (row) return asClient(row); // serve the stale copy if the client's host is briefly down
    throw new OAuthError("invalid_client", `Could not fetch the client metadata document: ${(e as Error).message}`, 401);
  }
  if (!doc || typeof doc !== "object" || doc.client_id !== clientId) throw new OAuthError("invalid_client", "Client metadata document must contain client_id equal to its URL", 401);
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(validRedirectUri).slice(0, 20) : [];
  if (!uris.length) throw new OAuthError("invalid_client", "Client metadata document has no valid redirect_uris", 401);
  const method = doc.token_endpoint_auth_method ?? "none";
  if (typeof method === "string" && method.startsWith("client_secret_")) {
    throw new OAuthError("invalid_client", "Client metadata documents cannot use a shared client secret (token_endpoint_auth_method client_secret_*). Use none (public client with PKCE) or private_key_jwt.", 401);
  }
  if (!CIMD_AUTH_METHODS.includes(method as any)) {
    throw new OAuthError("invalid_client", "Client metadata documents must use token_endpoint_auth_method \"none\" (public client with PKCE) or \"private_key_jwt\"", 401);
  }
  const jwksUri = method === "private_key_jwt" ? httpsUrl(doc.jwks_uri) : null;
  const jwks = method === "private_key_jwt" && doc.jwks && typeof doc.jwks === "object" && Array.isArray(doc.jwks.keys) ? doc.jwks : null;
  if (method === "private_key_jwt" && !jwksUri && !jwks) {
    throw new OAuthError("invalid_client", "Client metadata documents that use private_key_jwt must include a jwks_uri or jwks", 401);
  }
  const name = str(doc.client_name, 100) ?? new URL(clientId).hostname;
  const auth_methods = cimdAuthMethods(doc, method);
  const metadata = { software_id: str(doc.software_id), software_version: str(doc.software_version), auth_methods, ...(jwksUri ? { jwks_uri: jwksUri } : {}), ...(jwks ? { jwks } : {}) };
  const [saved] = await deps.db.sys(
    `INSERT INTO oauth_clients (client_id, kind, client_name, client_uri, logo_uri, redirect_uris, token_endpoint_auth_method, scope, metadata, fetched_at)
     VALUES ($1,'cimd',$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (client_id) DO UPDATE SET client_name = EXCLUDED.client_name, client_uri = EXCLUDED.client_uri, logo_uri = EXCLUDED.logo_uri,
       redirect_uris = EXCLUDED.redirect_uris, token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method, scope = EXCLUDED.scope, metadata = EXCLUDED.metadata, fetched_at = now()
     RETURNING *`,
    [clientId, name, httpsUrl(doc.client_uri), httpsUrl(doc.logo_uri), uris, method, str(doc.scope, 500), JSON.stringify(metadata)],
  );
  return asClient(saved);
}

/** Load the public keys for a private_key_jwt client (jwks_uri, with a one-time refresh if kid is missing). */
export async function loadClientJwks(client: OAuthClient, opts?: { bypassCache?: boolean }): Promise<{ keys: any[] }> {
  if (client.jwks_uri) {
    try { return await jwksFetcher.fetch(client.jwks_uri, opts); }
    catch (e) { throw new OAuthError("invalid_client", `Could not fetch the client's JWKS: ${(e as Error).message}`, 401); }
  }
  if (client.jwks?.keys?.length) return client.jwks;
  throw new OAuthError("invalid_client", "Client has no jwks_uri or jwks", 401);
}

/** RFC 7591 registration request → stored client (+ a one-time secret for confidential clients). */
export async function registerClient(deps: Deps, body: any) {
  if (!body || typeof body !== "object") throw new OAuthError("invalid_client_metadata", "JSON body required");
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 20 || !uris.every(validRedirectUri)) throw new OAuthError("invalid_redirect_uri", "redirect_uris must be 1-20 https URLs, http loopback URLs, or native app scheme URLs (no fragments)");
  const method = body.token_endpoint_auth_method ?? "none";
  if (!(DCR_AUTH_METHODS as readonly string[]).includes(method)) throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic");
  const grants: string[] = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (!grants.includes("authorization_code") || grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) throw new OAuthError("invalid_client_metadata", "grant_types must be authorization_code (+ refresh_token)");
  const responseTypes: string[] = Array.isArray(body.response_types) ? body.response_types : ["code"];
  if (responseTypes.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "response_types must be [\"code\"]");
  const clientId = newSecret(DCR_PREFIX).slice(0, DCR_PREFIX.length + 32);
  const secret = method === "none" ? null : newSecret("atlas_ocs_");
  const name = str(body.client_name, 100) ?? "MCP client";
  const [row] = await deps.db.sys(
    `INSERT INTO oauth_clients (client_id, kind, client_name, client_uri, logo_uri, redirect_uris, token_endpoint_auth_method, secret_hash, scope, metadata)
     VALUES ($1,'dcr',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *, extract(epoch FROM created_at)::bigint AS issued_at`,
    [clientId, name, httpsUrl(body.client_uri), httpsUrl(body.logo_uri), uris, method, secret ? hashToken(secret) : null, str(body.scope, 500),
      JSON.stringify({ software_id: str(body.software_id), software_version: str(body.software_version) })],
  );
  return {
    client_id: clientId, client_id_issued_at: Number(row.issued_at), ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: method,
    ...(row.client_uri ? { client_uri: row.client_uri } : {}), ...(row.logo_uri ? { logo_uri: row.logo_uri } : {}), ...(row.scope ? { scope: row.scope } : {}),
  };
}

/** Agent identity name for a client: "chatgpt", "claude", "grok", … (agents.name rules). */
export function agentNameForClient(name: string) {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28).replace(/-+$/g, "");
  if (s.length < 3) s = `${s || "mcp"}-client`.replace(/^-/, "");
  return s;
}
