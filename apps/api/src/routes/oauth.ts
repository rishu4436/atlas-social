/**
 * OAuth 2.1 endpoints for remote MCP clients. Discovery (RFC 9728 + RFC 8414), registration (CIMD + RFC 7591),
 * authorize → consent on the ATLAS website (existing ATLAS session; safe code login only) → token, refresh, revoke.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parse as parseQs } from "node:querystring";
import { hashToken, safeEqual } from "@atlas/auth";
import { AGENT_SCOPES, ALL_SCOPES, type AgentScope } from "@atlas/agent-gateway/scopes";
import type { Deps } from "../deps.js";
import { ApiError, notFound, forbidden, conflict } from "../lib/errors.js";
import { requireCsrf, securityEvent } from "../lib/session.js";
import {
  ACCESS_PREFIX, ACCESS_TTL_S, CODE_PREFIX, CODE_TTL_S, DEFAULT_OAUTH_SCOPES, GRANT_TTL_DAYS, MAX_OAUTH_GRANTS, MAX_OAUTH_STATE_LEN, OAUTH_SCOPES_SUPPORTED, REFRESH_PREFIX, REFRESH_TTL_S, REQUEST_TTL_S,
  CHALLENGE_RE, OAuthError, TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED, TOKEN_ENDPOINT_AUTH_SIGNING_ALGS, agentNameForClient, apiBase, canonicalResource, loadClientJwks, mcpResource, newSecret, parseScopes, redirectMatches, registerClient, resolveClient, verifyPkce,
  type OAuthClient,
} from "../lib/oauth.js";
import { CLIENT_ASSERTION_TYPE, ClientAssertionError, consumeAssertionJti, peekJwtSub, verifyClientJwt } from "../lib/oauth-jwt.js";

const SCOPE_RISK: Record<AgentScope, "read" | "run" | "write" | "publish" | "prepare"> = {
  "feed:read": "read", "research:read": "read", "reputation:read": "read", "market:read": "read",
  "research:run": "run", "thesis:draft": "write", "review:write": "write", "thesis:challenge": "write", "evidence:verify": "write",
  "post:draft": "write", "social:react": "write", "post:publish": "publish",
  "thesis:prepare": "prepare", "pay:prepare": "prepare",
};
const SCOPE_TITLE: Record<AgentScope, string> = {
  "feed:read": "Read the public feed and profiles", "research:read": "Read theses, proofs and research threads", "reputation:read": "Read Arena rankings and Skill Score evidence",
  "market:read": "Read market data", "research:run": "Run ATLAS AI research and the thesis challenger", "thesis:draft": "Save private, agent-labelled thesis drafts",
  "review:write": "Post agent-labelled reviews", "thesis:challenge": "Open agent-labelled evidence challenges", "evidence:verify": "Record evidence verifications",
  "thesis:prepare": "Prepare UNSIGNED thesis publications for your wallet", "pay:prepare": "Prepare UNSIGNED payments for your wallet",
  "post:draft": "Save private, agent-labelled post and reply drafts", "social:react": "Like posts (agent-labelled, never your own)",
  "post:publish": "Publish posts and replies you approved, labelled agent-authored",
};

function oauthError(reply: FastifyReply, e: OAuthError) {
  reply.header("cache-control", "no-store");
  // monitoring: one structured line per OAuth failure (never tokens, codes or secrets)
  reply.request.log.warn({ event: "oauth.error", route: reply.request.routeOptions?.url, error: e.error, status: e.status }, "oauth failure");
  if (e.status === 401) reply.header("www-authenticate", 'Basic realm="atlas-oauth"');
  return reply.code(e.status).send({ error: e.error, error_description: e.description });
}

/** client_id + optional secret from the body or HTTP Basic (RFC 6749 §2.3.1), or a private_key_jwt assertion (RFC 7523). */
async function authenticateClient(deps: Deps, req: FastifyRequest, body: Record<string, any>, endpoint: "token" | "revoke"): Promise<OAuthClient> {
  let id = typeof body.client_id === "string" ? body.client_id : undefined;
  let secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
  const h = req.headers.authorization;
  let basic = false;
  if (h && /^Basic\s+/i.test(h)) {
    const raw = Buffer.from(h.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
    const i = raw.indexOf(":");
    if (i > 0) { id = decodeURIComponent(raw.slice(0, i)); secret = decodeURIComponent(raw.slice(i + 1)); basic = true; }
  }
  if (!id) id = peekJwtSub(body.client_assertion);
  const client = await resolveClient(deps, id);
  if (client.token_endpoint_auth_method === "private_key_jwt") {
    if (body.client_assertion_type !== CLIENT_ASSERTION_TYPE || typeof body.client_assertion !== "string") {
      throw new OAuthError("invalid_client", "This client must authenticate with a private_key_jwt client_assertion", 401);
    }
    const issuer = apiBase(deps, req);
    const audiences = [issuer, `${issuer}/oauth/token`];
    if (endpoint === "revoke") audiences.push(`${issuer}/oauth/revoke`);
    const loadKeys = (bypass?: boolean) => loadClientJwks(client, { bypassCache: bypass });
    let keys = await loadKeys(false);
    const verify = (jwks: { keys: any[] }) => verifyClientJwt(body.client_assertion, jwks.keys, { clientId: client.client_id, audiences });
    let claims: { jti: string; exp: number };
    try {
      try { claims = verify(keys); }
      catch (e) {
        if (!(e instanceof ClientAssertionError) || e.message !== "client_assertion signature is invalid") throw e;
        keys = await loadKeys(true);
        claims = verify(keys);
      }
    } catch (e) {
      if (e instanceof ClientAssertionError) throw new OAuthError(e.error, e.message, e.status);
      throw e;
    }
    await consumeAssertionJti(deps, client.client_id, claims.jti, claims.exp).catch((e) => {
      if (e instanceof ClientAssertionError) throw new OAuthError(e.error, e.message, e.status);
      throw e;
    });
    return client;
  }
  if (client.secret_hash) {
    if (!secret || !safeEqual(hashToken(secret), client.secret_hash)) throw new OAuthError("invalid_client", "Client authentication failed", 401);
    if (client.token_endpoint_auth_method === "client_secret_basic" && !basic && body.client_secret === undefined) throw new OAuthError("invalid_client", "Client authentication failed", 401);
  }
  return client;
}

export const AS_METADATA_PATHS = [
  "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp",
  "/.well-known/openid-configuration", "/.well-known/openid-configuration/mcp",
  "/mcp/.well-known/oauth-authorization-server", "/mcp/.well-known/openid-configuration",
];

export async function oauthRoutes(app: FastifyInstance, deps: Deps) {
  // token/revoke/register accept application/x-www-form-urlencoded (RFC 6749) as well as JSON
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) => {
    try { done(null, parseQs(body as string)); } catch (e) { done(e as Error, undefined); }
  });
  const flat = (b: unknown): Record<string, any> => {
    const o: Record<string, any> = {};
    if (b && typeof b === "object") for (const [k, v] of Object.entries(b)) o[k] = Array.isArray(v) ? v[0] : v;
    return o;
  };
  const hide = { hide: true } as const;

  // ---------------------------------------------------------------- discovery
  const prm = (req: FastifyRequest) => ({
    resource: mcpResource(deps, req),
    authorization_servers: [apiBase(deps, req)],
    scopes_supported: OAUTH_SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_name: "ATLAS Social",
    resource_documentation: `${deps.cfg.PUBLIC_ORIGIN.replace(/\/$/, "")}/ai`,
  });
  app.get("/.well-known/oauth-protected-resource", { schema: hide }, async (req) => prm(req));
  app.get("/.well-known/oauth-protected-resource/mcp", { schema: hide }, async (req) => prm(req));
  app.get("/mcp/.well-known/oauth-protected-resource", { schema: hide }, async (req) => prm(req));

  const asm = (req: FastifyRequest) => {
    const b = apiBase(deps, req);
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      scopes_supported: OAUTH_SCOPES_SUPPORTED,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED],
      revocation_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED],
      token_endpoint_auth_signing_alg_values_supported: [...TOKEN_ENDPOINT_AUTH_SIGNING_ALGS],
      revocation_endpoint_auth_signing_alg_values_supported: [...TOKEN_ENDPOINT_AUTH_SIGNING_ALGS],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${deps.cfg.PUBLIC_ORIGIN.replace(/\/$/, "")}/ai`,
    };
  };
  // Every discovery path MCP clients probe (RFC 8414 path insertion, OIDC fallbacks, path-appended variants), one issuer.
  // ATLAS is not an OpenID provider (no id_token); the OIDC paths serve the same OAuth metadata.
  for (const path of AS_METADATA_PATHS) app.get(path, { schema: hide }, async (req, reply) => { reply.header("cache-control", "public, max-age=300"); return asm(req); });

  // ---------------------------------------------------------------- registration (RFC 7591)
  app.post("/oauth/register", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } }, schema: hide }, async (req, reply) => {
    try { return reply.code(201).header("cache-control", "no-store").send(await registerClient(deps, req.body)); }
    catch (e) { if (e instanceof OAuthError) return oauthError(reply, e); throw e; }
  });

  // ---------------------------------------------------------------- authorize → consent page
  app.get("/oauth/authorize", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: hide }, async (req, reply) => {
    const q = flat(req.query);
    const site = deps.cfg.PUBLIC_ORIGIN.replace(/\/$/, "");
    const fail = (error: string, description: string) => {
      req.log.warn({ event: "oauth.error", route: "/oauth/authorize", error, client: typeof q.client_id === "string" ? q.client_id.slice(0, 500) : undefined }, "oauth failure");
      return reply.redirect(`${site}/oauth/consent?${new URLSearchParams({ error, error_description: description })}`, 302);
    };
    let client: OAuthClient;
    try { client = await resolveClient(deps, q.client_id); } catch (e) { if (e instanceof OAuthError) return fail(e.error, e.description); throw e; }
    if (typeof q.redirect_uri !== "string" || !redirectMatches(client.redirect_uris, q.redirect_uri)) {
      return fail("invalid_request", "redirect_uri is missing or not registered for this client");
    }
    const back = (error: string, description: string) => {
      const u = new URL(q.redirect_uri);
      u.searchParams.set("error", error); u.searchParams.set("error_description", description);
      if (typeof q.state === "string") u.searchParams.set("state", q.state);
      u.searchParams.set("iss", apiBase(deps, req));
      return reply.redirect(u.toString(), 302);
    };
    if (q.response_type !== "code") return back("unsupported_response_type", "response_type must be code");
    if (q.code_challenge_method !== "S256" || typeof q.code_challenge !== "string" || !CHALLENGE_RE.test(q.code_challenge)) return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
    const resource = canonicalResource(deps, req, q.resource);
    if (!resource) return back("invalid_target", `resource must be ${mcpResource(deps, req)}`);
    if (typeof q.state === "string" && q.state.length > MAX_OAUTH_STATE_LEN) return back("invalid_request", "state is too long");
    const scopes = parseScopes(q.scope);
    const [r] = await deps.db.sys(
      `INSERT INTO oauth_auth_requests (client_id, redirect_uri, scopes, state, code_challenge, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7)) RETURNING id`,
      [client.client_id, q.redirect_uri, scopes, typeof q.state === "string" ? q.state : null, q.code_challenge, resource, REQUEST_TTL_S],
    );
    return reply.redirect(`${site}/oauth/consent?request=${r.id}`, 302);
  });

  const loadPending = async (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Authorization request");
    const [r] = await deps.db.sys(`SELECT r.*, (r.expires_at < now()) AS expired FROM oauth_auth_requests r WHERE r.id = $1`, [id]);
    if (!r) throw notFound("Authorization request");
    if (r.status !== "pending") throw new ApiError(409, "REQUEST_DONE", "This authorization request was already answered. Start the connection again from your AI app.");
    if (r.expired) throw new ApiError(410, "REQUEST_EXPIRED", "This authorization request expired. Start the connection again from your AI app.");
    return r;
  };
  const finalUrl = (req: FastifyRequest, r: any, params: Record<string, string>) => {
    const u = new URL(r.redirect_uri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (r.state != null) u.searchParams.set("state", r.state);
    u.searchParams.set("iss", apiBase(deps, req));
    return u.toString();
  };

  // what the consent page shows (no secrets; the request id itself is the capability)
  app.get<{ Params: { id: string } }>("/oauth/requests/:id", { schema: hide }, async (req) => {
    const r = await loadPending(req.params.id);
    const [c] = await deps.db.sys(`SELECT * FROM oauth_clients WHERE client_id = $1`, [r.client_id]);
    let profile: any = null;
    if (req.auth && !req.agent) [profile] = await deps.db.sys(`SELECT agent_name, display_name, avatar_url FROM profiles WHERE user_id = $1`, [req.auth.userId]).catch(() => []);
    let redirectHost = r.redirect_uri;
    try { const u = new URL(r.redirect_uri); redirectHost = u.protocol.startsWith("http") ? u.host : `${u.protocol}//${u.host}`; } catch { /* keep raw */ }
    return {
      id: r.id, expiresAt: r.expires_at, resource: r.resource,
      client: { name: c.client_name, uri: c.client_uri, logo: c.logo_uri, kind: c.kind, clientId: c.kind === "cimd" ? c.client_id : null, redirectHost, verified: false },
      // every supported scope is shown; recommended ones start on, everything else is an off toggle the user may turn on
      scopes: ALL_SCOPES.map((id) => ({ id, title: SCOPE_TITLE[id], description: AGENT_SCOPES[id], risk: SCOPE_RISK[id], recommended: DEFAULT_OAUTH_SCOPES.includes(id), requested: (r.scopes as string[]).includes(id) })),
      signedIn: !!(req.auth && !req.agent), account: profile ? { agentName: profile.agent_name, displayName: profile.display_name, avatarUrl: profile.avatar_url } : null,
      never: ["sign or send transactions", "publish anything you did not approve", "move assets or approve tokens", "sign you in or change account security", "read your direct messages"],
    };
  });

  app.post<{ Params: { id: string }; Body: { scopes?: string[] } }>("/oauth/requests/:id/approve", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: hide }, async (req) => {
    if (req.agent) throw forbidden("AGENT_ROUTE_NOT_ALLOWED", "Agents cannot authorize OAuth clients");
    const a = requireCsrf(req);
    const r = await loadPending(req.params.id);
    const requested = r.scopes as string[];
    // The user may grant any supported scope shown on the consent page (the token response reports the granted set).
    // No explicit choice → only the recommended (read/research/draft-thesis) scopes; writes are opt-in.
    const chosen = [...new Set((Array.isArray(req.body?.scopes) ? req.body!.scopes : requested.filter((s) => (DEFAULT_OAUTH_SCOPES as string[]).includes(s))).filter((s) => (ALL_SCOPES as string[]).includes(s)))];
    if (!chosen.length) throw new ApiError(400, "NO_SCOPES", "Choose at least one permission, or deny the request.");
    const [linked] = await deps.db.sys(`SELECT 1 FROM agent_id_links WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1`, [a.userId]);
    if (!linked) throw forbidden("AGENT_ID_REQUIRED", "Your account needs a linked Agent ID before it can connect AI apps.");
    const code = newSecret(CODE_PREFIX);
    const [u] = await deps.db.sys(
      `UPDATE oauth_auth_requests SET status = 'approved', user_id = $2, granted_scopes = $3, code_hash = $4, decided_at = now(), expires_at = now() + make_interval(secs => $5)
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [r.id, a.userId, chosen, hashToken(code), CODE_TTL_S],
    );
    if (!u) throw conflict("REQUEST_DONE", "This authorization request was already answered.");
    await securityEvent(deps, a.userId, "oauth.consent.approved", { clientId: r.client_id, scopes: chosen });
    return { redirect: finalUrl(req, r, { code }) };
  });

  app.post<{ Params: { id: string } }>("/oauth/requests/:id/deny", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: hide }, async (req) => {
    const r = await loadPending(req.params.id);
    await deps.db.sys(`UPDATE oauth_auth_requests SET status = 'denied', decided_at = now(), user_id = $2 WHERE id = $1 AND status = 'pending'`, [r.id, req.auth && !req.agent ? req.auth.userId : null]);
    return { redirect: finalUrl(req, r, { error: "access_denied", error_description: "The ATLAS account holder denied the request" }) };
  });

  // ---------------------------------------------------------------- token endpoint
  async function issue(q: (s: string, p?: unknown[]) => Promise<any[]>, grantId: string, resource: string, scopes: string[], parentId: string | null) {
    const access = newSecret(ACCESS_PREFIX);
    const refresh = newSecret(REFRESH_PREFIX);
    await q(`INSERT INTO oauth_tokens (grant_id, kind, token_hash, resource, scopes, expires_at) VALUES ($1,'access',$2,$3,$4, now() + make_interval(secs => $5))`, [grantId, hashToken(access), resource, scopes, ACCESS_TTL_S]);
    await q(`INSERT INTO oauth_tokens (grant_id, kind, token_hash, resource, scopes, parent_id, expires_at)
             SELECT $1,'refresh',$2,$3,$4,$5, least(now() + make_interval(secs => $6), t.expires_at) FROM agent_tokens t WHERE t.id = $1`, [grantId, hashToken(refresh), resource, scopes, parentId, REFRESH_TTL_S]);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(" ") };
  }
  const revokeGrant = (q: (s: string, p?: unknown[]) => Promise<any[]>, grantId: string, reason: string) => Promise.all([
    q(`UPDATE agent_tokens SET revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, $2) WHERE id = $1`, [grantId, reason]),
    q(`UPDATE oauth_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE grant_id = $1`, [grantId]),
  ]);

  app.post("/oauth/token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: hide }, async (req, reply) => {
    const b = flat(req.body);
    reply.header("cache-control", "no-store").header("pragma", "no-cache");
    try {
      const client = await authenticateClient(deps, req, b, "token");
      if (b.grant_type === "authorization_code") {
        if (typeof b.code !== "string" || !b.code.startsWith(CODE_PREFIX)) throw new OAuthError("invalid_grant", "Invalid authorization code");
        const [r] = await deps.db.sys(`SELECT r.*, (r.expires_at < now()) AS expired FROM oauth_auth_requests r WHERE r.code_hash = $1`, [hashToken(b.code)]);
        if (!r || r.client_id !== client.client_id) throw new OAuthError("invalid_grant", "Invalid authorization code");
        if (r.status === "redeemed") {
          if (r.grant_id) await revokeGrant(deps.db.sys, r.grant_id, "authorization code replayed");
          throw new OAuthError("invalid_grant", "Authorization code already used; the tokens issued with it were revoked");
        }
        if (r.status !== "approved" || r.expired) throw new OAuthError("invalid_grant", "Authorization code expired");
        if (b.redirect_uri !== r.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
        if (!verifyPkce(b.code_verifier, r.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
        if (b.resource !== undefined && canonicalResource(deps, req, b.resource) !== r.resource) throw new OAuthError("invalid_target", "resource does not match the authorization request");
        const out = await deps.db.sysTx(async (q) => {
          const [claimed] = await q(`UPDATE oauth_auth_requests SET status = 'redeemed', redeemed_at = now() WHERE id = $1 AND status = 'approved' RETURNING id`, [r.id]);
          if (!claimed) throw new OAuthError("invalid_grant", "Authorization code already used");
          const [usr] = await q(`SELECT status FROM users WHERE id = $1`, [r.user_id]);
          if (usr?.status !== "active") throw new OAuthError("invalid_grant", "The ATLAS account is not active");
          // one live grant per (account, client): a new authorization replaces the previous one
          const prev = await q(`SELECT id FROM agent_tokens WHERE operator_id = $1 AND oauth_client_id = $2 AND revoked_at IS NULL`, [r.user_id, client.client_id]);
          for (const p of prev) await revokeGrant(q, p.id, "replaced by a new authorization");
          const [{ n }] = await q(`SELECT count(*)::int AS n FROM agent_tokens WHERE operator_id = $1 AND oauth_client_id IS NOT NULL AND revoked_at IS NULL AND expires_at > now()`, [r.user_id]);
          if (n >= MAX_OAUTH_GRANTS) throw new OAuthError("access_denied", `At most ${MAX_OAUTH_GRANTS} connected AI apps; disconnect one in ATLAS Settings → Agents.`);
          const name = agentNameForClient(client.client_name);
          await q(`INSERT INTO agents (operator_id, name) VALUES ($1,$2) ON CONFLICT (operator_id, name) DO NOTHING`, [r.user_id, name]);
          const [ag] = await q(`SELECT id FROM agents WHERE operator_id = $1 AND name = $2`, [r.user_id, name]);
          const [g] = await q(
            `INSERT INTO agent_tokens (agent_id, operator_id, label, token_hash, token_prefix, scopes, declared_client, expires_at, oauth_client_id)
             VALUES ($1,$2,$3,$4,'oauth',$5,$6, now() + make_interval(days => $7), $8) RETURNING id`,
            [ag.id, r.user_id, `OAuth · ${client.client_name}`.slice(0, 60), hashToken(newSecret("unused_")), r.granted_scopes, client.client_name.slice(0, 80), GRANT_TTL_DAYS, client.client_id],
          );
          await q(`UPDATE oauth_auth_requests SET grant_id = $2 WHERE id = $1`, [r.id, g.id]);
          return { grantId: g.id as string, tokens: await issue(q, g.id, r.resource, r.granted_scopes, null) };
        });
        await securityEvent(deps, r.user_id, "oauth.grant.created", { clientId: client.client_id, grantId: out.grantId, scopes: r.granted_scopes });
        return out.tokens;
      }
      if (b.grant_type === "refresh_token") {
        if (typeof b.refresh_token !== "string" || !b.refresh_token.startsWith(REFRESH_PREFIX)) throw new OAuthError("invalid_grant", "Invalid refresh token");
        const [t] = await deps.db.sys(
          `SELECT o.*, (o.expires_at < now()) AS expired, g.oauth_client_id, g.revoked_at AS grant_revoked, (g.expires_at < now()) AS grant_expired, g.scopes AS grant_scopes, g.operator_id
             FROM oauth_tokens o JOIN agent_tokens g ON g.id = o.grant_id WHERE o.token_hash = $1 AND o.kind = 'refresh'`, [hashToken(b.refresh_token)]);
        if (!t || t.oauth_client_id !== client.client_id) throw new OAuthError("invalid_grant", "Invalid refresh token");
        if (t.used_at) {
          await revokeGrant(deps.db.sys, t.grant_id, "refresh token reused");
          await securityEvent(deps, t.operator_id, "oauth.refresh.reuse_detected", { grantId: t.grant_id, clientId: client.client_id });
          throw new OAuthError("invalid_grant", "Refresh token already used; this connection was revoked for safety. Reconnect the app.");
        }
        if (t.revoked_at || t.grant_revoked || t.expired || t.grant_expired) throw new OAuthError("invalid_grant", "Refresh token revoked or expired. Reconnect the app.");
        if (b.resource !== undefined && canonicalResource(deps, req, b.resource) !== t.resource) throw new OAuthError("invalid_target", "resource does not match the grant");
        let scopes = (t.scopes as string[]).filter((s) => (t.grant_scopes as string[]).includes(s));
        if (typeof b.scope === "string" && b.scope.trim()) {
          const want = b.scope.split(/\s+/);
          if (want.some((s: string) => !scopes.includes(s))) throw new OAuthError("invalid_scope", "Requested scope exceeds the original grant");
          scopes = [...new Set(want)];
        }
        return await deps.db.sysTx(async (q) => {
          const [used] = await q(`UPDATE oauth_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [t.id]);
          if (!used) throw new OAuthError("invalid_grant", "Refresh token already used");
          return issue(q, t.grant_id, t.resource, scopes, t.id);
        });
      }
      throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
    } catch (e) {
      if (e instanceof OAuthError) return oauthError(reply, e);
      throw e;
    }
  });

  // ---------------------------------------------------------------- revocation (RFC 7009)
  app.post("/oauth/revoke", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: hide }, async (req, reply) => {
    const b = flat(req.body);
    reply.header("cache-control", "no-store");
    try {
      const client = await authenticateClient(deps, req, b, "revoke");
      if (typeof b.token !== "string" || !b.token) throw new OAuthError("invalid_request", "token is required");
      const [t] = await deps.db.sys(`SELECT o.id, o.kind, o.grant_id, g.oauth_client_id, g.operator_id FROM oauth_tokens o JOIN agent_tokens g ON g.id = o.grant_id WHERE o.token_hash = $1`, [hashToken(b.token)]);
      if (t && t.oauth_client_id === client.client_id) {
        if (t.kind === "refresh") {
          await revokeGrant(deps.db.sys, t.grant_id, "revoked by the client");
          await securityEvent(deps, t.operator_id, "oauth.grant.revoked", { grantId: t.grant_id, by: "client" });
        } else {
          await deps.db.sys(`UPDATE oauth_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1`, [t.id]);
        }
      }
      return reply.code(200).send({});
    } catch (e) {
      if (e instanceof OAuthError) return oauthError(reply, e);
      throw e;
    }
  });
}
