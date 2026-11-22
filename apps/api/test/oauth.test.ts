/**
 * OAuth 2.1 for remote MCP clients: discovery, DCR + CIMD, PKCE (S256 only), consent bound to the ATLAS session,
 * audience-bound short-lived access tokens, rotating single-use refresh tokens with reuse detection, revocation,
 * per-account isolation, and the official MCP SDK OAuth client completing the whole flow against the real server.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { TOOL_NAMES } from "@atlas/agent-gateway";
import { harness, Client, uniq, ORIGIN, type Harness } from "./helpers.js";
import { s256, verifyPkce, parseScopes, validRedirectUri, redirectMatches, isPrivateAddress, cimdFetcher, agentNameForClient, DEFAULT_OAUTH_SCOPES, apiBase, DEFAULT_PRODUCTION_ISSUER, MAX_OAUTH_STATE_LEN } from "../src/lib/oauth.js";
import { AS_METADATA_PATHS } from "../src/routes/oauth.js";
import { ALL_SCOPES } from "@atlas/agent-gateway/scopes";

const PORT = 4700 + Math.floor(Math.random() * 200);
const API = `http://127.0.0.1:${PORT}`;
const MCP = `${API}/mcp`;
const REDIRECT = "https://client.example/callback";

let h: Harness;
let A: Client, B: Client;

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
async function raw(method: string, url: string, opts: { body?: string | object; headers?: Record<string, string> } = {}) {
  const isForm = typeof opts.body === "string";
  const res = await h.app.inject({ method: method as any, url, payload: opts.body as any, headers: { ...(opts.body !== undefined ? { "content-type": isForm ? "application/x-www-form-urlencoded" : "application/json" } : {}), ...opts.headers } });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  return { status: res.statusCode, body: json, headers: res.headers };
}
const verifier = () => randomBytes(48).toString("base64url");

async function register(name = "ChatGPT", extra: Record<string, unknown> = {}) {
  const r = await raw("POST", "/oauth/register", { body: { client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...extra } });
  expect(r.status).toBe(201);
  return r.body;
}
async function authorize(clientId: string, v: string, o: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: s256(v), code_challenge_method: "S256", state: "st-1", resource: MCP, scope: "feed:read research:read reputation:read market:read thesis:draft pay:prepare", ...o });
  return raw("GET", `/oauth/authorize?${q}`);
}
const requestIdOf = (location: string) => new URL(location).searchParams.get("request")!;
async function approve(user: Client, reqId: string, scopes?: string[]) {
  const r = await user.post(`/oauth/requests/${reqId}/approve`, scopes ? { scopes } : {});
  return r;
}
async function fullFlow(user: Client, clientId: string, scopes?: string[]) {
  const v = verifier();
  const a = await authorize(clientId, v);
  expect(a.status).toBe(302);
  const ok = await approve(user, requestIdOf(a.headers.location as string), scopes);
  expect(ok.status).toBe(200);
  const code = new URL(ok.body.redirect).searchParams.get("code")!;
  const t = await raw("POST", "/oauth/token", { body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: v, resource: MCP }) });
  expect(t.status).toBe(200);
  return { ...t.body, code, verifier: v };
}
async function mcp(token: string | null, body: object) {
  return raw("POST", "/mcp", { body, headers: { accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}
const call = (token: string, name: string, args: object = {}) => mcp(token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });

beforeAll(async () => {
  h = await harness({ PUBLIC_API_ORIGIN: API });
  A = new Client(h); await A.login(uniq("oa"));
  B = new Client(h); await B.login(uniq("ob"));
});
afterAll(async () => { await h?.close(); });

describe("unit: PKCE, scopes, redirect URIs, SSRF guard", () => {
  it("verifies S256 PKCE and rejects malformed verifiers", () => {
    const v = verifier();
    expect(verifyPkce(v, s256(v))).toBe(true);
    expect(verifyPkce(`${v}x`, s256(v))).toBe(false);
    expect(verifyPkce("short", s256("short"))).toBe(false);
    expect(verifyPkce(undefined, s256(v))).toBe(false);
  });
  it("keeps only known scopes; a client that asks for none is shown every scope (only the safe set is pre-selected)", () => {
    expect(parseScopes("openid feed:read offline_access pay:prepare")).toEqual(["feed:read", "pay:prepare"]);
    expect(parseScopes(undefined)).toEqual(ALL_SCOPES);
    expect(parseScopes("openid")).toEqual(ALL_SCOPES);
    expect(DEFAULT_OAUTH_SCOPES.some((s) => ["post:publish", "post:draft", "social:react", "pay:prepare", "thesis:prepare", "review:write"].includes(s))).toBe(false);
  });
  it("validates and matches redirect URIs", () => {
    expect(validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(validRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(validRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("https://a.example/cb#frag")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1:3000/cb"], "http://127.0.0.1:51234/cb")).toBe(true);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb2")).toBe(false);
  });
  it("refuses private and loopback addresses for client metadata fetches", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "172.20.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["104.18.1.1", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
  it("derives agent names from client names", () => {
    expect(agentNameForClient("ChatGPT")).toBe("chatgpt");
    expect(agentNameForClient("Claude")).toBe("claude");
    expect(agentNameForClient("@@")).toMatch(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/);
  });
});

describe("discovery and the 401 challenge", () => {
  it("publishes RFC 9728 protected-resource and RFC 8414 authorization-server metadata", async () => {
    const prm = await raw("GET", "/.well-known/oauth-protected-resource/mcp");
    expect(prm.body).toMatchObject({ resource: MCP, authorization_servers: [API] });
    expect((await raw("GET", "/.well-known/oauth-protected-resource")).body.resource).toBe(MCP);
    const as = await raw("GET", "/.well-known/oauth-authorization-server");
    expect(as.body).toMatchObject({ issuer: API, code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true, registration_endpoint: `${API}/oauth/register` });
  });
  it("answers unauthenticated MCP requests with WWW-Authenticate resource_metadata", async () => {
    const r = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toContain(`resource_metadata="${API}/.well-known/oauth-protected-resource/mcp"`);
    const bad = await mcp("atlas_oat_notarealtoken_notarealtoken_notarealtoken_x", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(bad.status).toBe(401);
    expect(bad.headers["www-authenticate"]).toContain('error="invalid_token"');
  });
  it("allows browser-based clients cross-origin (CORS, no credentials) on public OAuth/MCP endpoints only", async () => {
    const pre = await raw("OPTIONS", "/mcp", { headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,mcp-protocol-version" } });
    expect(pre.headers["access-control-allow-origin"]).toBe("https://claude.ai");
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    const reg = await raw("POST", "/oauth/register", { body: { client_name: "Inspector", redirect_uris: ["http://localhost:6274/oauth/callback"] }, headers: { origin: "http://localhost:6274" } });
    expect(reg.status).toBe(201);
    expect(reg.headers["access-control-allow-origin"]).toBe("http://localhost:6274");
    // cookie routes still refuse foreign origins
    const feed = await raw("GET", "/feed", { headers: { origin: "https://evil.example" } });
    expect(feed.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("authorization code + PKCE", () => {
  let clientId: string;
  beforeAll(async () => { clientId = (await register()).client_id; });

  it("refuses plain PKCE, unknown redirect URIs and foreign resources", async () => {
    const v = verifier();
    const plain = await authorize(clientId, v, { code_challenge_method: "plain", code_challenge: v.slice(0, 43) });
    expect(new URL(plain.headers.location as string).searchParams.get("error")).toBe("invalid_request");
    const wrongRedirect = await authorize(clientId, v, { redirect_uri: "https://evil.example/cb" });
    expect(wrongRedirect.headers.location).toMatch(new RegExp(`^${ORIGIN}/oauth/consent\\?error=invalid_request`));
    const wrongResource = await authorize(clientId, v, { resource: "https://other.example/mcp" });
    expect(new URL(wrongResource.headers.location as string).searchParams.get("error")).toBe("invalid_target");
  });

  it("requires a signed-in human session (with CSRF) to approve, and shows each requested permission", async () => {
    const v = verifier();
    const a = await authorize(clientId, v);
    expect(a.headers.location).toMatch(new RegExp(`^${ORIGIN}/oauth/consent\\?request=`));
    const id = requestIdOf(a.headers.location as string);
    const anon = new Client(h);
    const view = await anon.get(`/oauth/requests/${id}`);
    expect(view.body.signedIn).toBe(false);
    expect(view.body.client.name).toBe("ChatGPT");
    expect(view.body.scopes.map((s: any) => s.id)).toEqual([...ALL_SCOPES]); // every supported scope is shown
    expect(view.body.scopes.filter((s: any) => s.requested).map((s: any) => s.id)).toEqual(["feed:read", "research:read", "reputation:read", "market:read", "thesis:draft", "pay:prepare"]);
    expect(view.body.scopes.find((s: any) => s.id === "pay:prepare").recommended).toBe(false);
    expect((await anon.post(`/oauth/requests/${id}/approve`, {})).status).toBe(401);
    const noCsrf = await h.app.inject({ method: "POST", url: `/oauth/requests/${id}/approve`, payload: {}, headers: { origin: ORIGIN, cookie: [...A.cookies].map(([k, v2]) => `${k}=${v2}`).join("; ") } });
    expect(noCsrf.statusCode).toBe(403);
    expect((await A.get(`/oauth/requests/${id}`)).body.signedIn).toBe(true);
  });

  it("issues audience-bound tokens with only the approved scopes; wrong verifier, client or replay fail", async () => {
    const v = verifier();
    const a = await authorize(clientId, v);
    const ok = await approve(A, requestIdOf(a.headers.location as string), ["feed:read", "reputation:read", "research:read"]);
    const redirect = new URL(ok.body.redirect);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("st-1");
    expect(redirect.searchParams.get("iss")).toBe(API);
    const code = redirect.searchParams.get("code")!;
    const base = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, resource: MCP };
    expect((await raw("POST", "/oauth/token", { body: form({ ...base, code_verifier: verifier() }) })).body.error).toBe("invalid_grant");
    const other = (await register("Other app")).client_id;
    expect((await raw("POST", "/oauth/token", { body: form({ ...base, client_id: other, code_verifier: v }) })).body.error).toBe("invalid_grant");
    const t = await raw("POST", "/oauth/token", { body: form({ ...base, code_verifier: v }) });
    expect(t.status).toBe(200);
    expect(t.headers["cache-control"]).toBe("no-store");
    expect(t.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "feed:read reputation:read research:read" });
    expect(t.body.access_token).toMatch(/^atlas_oat_/);
    expect(t.body.refresh_token).toMatch(/^atlas_ort_/);
    // tokens are stored only as hashes
    const stored = await h.deps.db.sys(`SELECT token_hash FROM oauth_tokens`);
    expect(stored.some((r) => r.token_hash === t.body.access_token || r.token_hash === t.body.refresh_token)).toBe(false);
    // MCP works with the token; scopes are enforced per tool
    const who = await call(t.body.access_token, "whoami");
    const me = JSON.parse(who.body.result.content[0].text);
    expect(me.agent.name).toBe("chatgpt");
    expect(me.token.scopes).toEqual(["feed:read", "reputation:read", "research:read"]);
    const draft = await call(t.body.access_token, "draft_thesis", { asset: "BNB", direction: "LONG", targetPrice: "999", invalidationPrice: "100", horizonHours: 24, title: "nope", summary: "should be denied by scope" });
    expect(draft.body.result.isError).toBe(true);
    expect(draft.body.result.content[0].text).toContain("AGENT_SCOPE_MISSING");
    // audience: the token is not a general API credential
    const rest = await raw("GET", "/feed", { headers: { authorization: `Bearer ${t.body.access_token}` } });
    expect(rest.status).toBe(403);
    expect(rest.body.error).toBe("OAUTH_TOKEN_WRONG_ENDPOINT");
    // never a signing or token-minting credential
    expect((await raw("POST", "/agents/tokens", { body: {}, headers: { authorization: `Bearer ${t.body.access_token}` } })).status).toBe(403);
    // code replay: refused AND the grant it produced is revoked
    const replay = await raw("POST", "/oauth/token", { body: form({ ...base, code_verifier: v }) });
    expect(replay.body.error).toBe("invalid_grant");
    expect((await call(t.body.access_token, "whoami")).status).toBe(401);
  });

  it("lists every tool to OAuth clients and runs read tools", async () => {
    const t = await fullFlow(A, clientId);
    const list = await mcp(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.body.result.tools.map((x: any) => x.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const [name, args] of [["get_feed", {}], ["list_theses", {}], ["get_methodology", {}], ["search_analysts", { board: "analysts" }]] as const) {
      const r = await call(t.access_token, name, args);
      expect(r.body.result.isError, `${name}: ${JSON.stringify(r.body.result.content)}`).toBeFalsy();
    }
  });
});

describe("refresh rotation, reuse detection and revocation", () => {
  let clientId: string;
  beforeAll(async () => { clientId = (await register("Claude")).client_id; });

  it("rotates refresh tokens and revokes the grant when an old one is replayed", async () => {
    const t = await fullFlow(A, clientId);
    const r1 = await raw("POST", "/oauth/token", { body: form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId }) });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(t.refresh_token);
    expect((await call(r1.body.access_token, "whoami")).status).toBe(200);
    const wider = await raw("POST", "/oauth/token", { body: form({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: clientId, scope: "pay:prepare review:write" }) });
    expect(wider.body.error).toBe("invalid_scope");
    const reuse = await raw("POST", "/oauth/token", { body: form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId }) });
    expect(reuse.body.error).toBe("invalid_grant");
    expect((await call(r1.body.access_token, "whoami")).status).toBe(401);
    expect((await raw("POST", "/oauth/token", { body: form({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: clientId }) })).body.error).toBe("invalid_grant");
  });

  it("expires access tokens after an hour", async () => {
    const t = await fullFlow(A, clientId);
    h.clock.offset += 3601;
    try { expect((await call(t.access_token, "whoami")).status).toBe(401); } finally { h.clock.offset -= 3601; }
  });

  it("revokes through RFC 7009 and through ATLAS Settings → Agents", async () => {
    const t = await fullFlow(A, clientId);
    expect((await raw("POST", "/oauth/revoke", { body: form({ token: t.refresh_token, client_id: clientId }) })).status).toBe(200);
    expect((await call(t.access_token, "whoami")).status).toBe(401);
    const t2 = await fullFlow(A, clientId);
    const grant = (await A.get("/agents/tokens")).body.tokens.find((x: any) => x.kind === "oauth" && x.status === "active");
    expect(grant.oauthClient.name).toBe("Claude");
    expect((await A.post(`/agents/tokens/${grant.id}/revoke`, {})).status).toBe(200);
    expect((await call(t2.access_token, "whoami")).status).toBe(401);
    expect((await raw("POST", "/oauth/token", { body: form({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: clientId }) })).body.error).toBe("invalid_grant");
  });

  it("keeps a new authorization from the same app as the only live grant", async () => {
    const t1 = await fullFlow(A, clientId);
    const t2 = await fullFlow(A, clientId);
    expect((await call(t1.access_token, "whoami")).status).toBe(401);
    expect((await call(t2.access_token, "whoami")).status).toBe(200);
  });
});

describe("per-account isolation", () => {
  it("keeps each account's grants, tokens and consent separate", async () => {
    const clientId = (await register("Grok")).client_id;
    const ta = await fullFlow(A, clientId);
    const tb = await fullFlow(B, clientId);
    const whoA = JSON.parse((await call(ta.access_token, "whoami")).body.result.content[0].text);
    const whoB = JSON.parse((await call(tb.access_token, "whoami")).body.result.content[0].text);
    expect(whoA.operator.agentName).not.toBe(whoB.operator.agentName);
    const grantA = (await A.get("/agents/tokens")).body.tokens.find((x: any) => x.kind === "oauth" && x.status === "active" && x.oauthClient.clientId === clientId);
    expect((await B.get("/agents/tokens")).body.tokens.some((x: any) => x.id === grantA.id)).toBe(false);
    expect((await B.post(`/agents/tokens/${grantA.id}/revoke`, {})).status).toBe(404);
    expect((await call(ta.access_token, "whoami")).status).toBe(200);
    // B cannot answer a request A already approved, nor revoke A's token through the client endpoint as another client
    const v = verifier();
    const a = await authorize(clientId, v);
    const id = requestIdOf(a.headers.location as string);
    expect((await approve(A, id)).status).toBe(200);
    expect((await approve(B, id)).status).toBe(409);
    const other = (await register("Mallory")).client_id;
    await raw("POST", "/oauth/revoke", { body: form({ token: ta.refresh_token, client_id: other }) });
    expect((await call(ta.access_token, "whoami")).status).toBe(200);
  });

  it("keeps existing scoped agent tokens working alongside OAuth", async () => {
    const t = await A.post("/agents/tokens", { agentName: "cli", label: "cli", scopes: ["feed:read"] });
    expect(t.status).toBe(200);
    expect((await call(t.body.token, "whoami")).status).toBe(200);
    expect((await raw("GET", "/feed", { headers: { authorization: `Bearer ${t.body.token}` } })).status).toBe(200);
  });
});

describe("Client ID Metadata Documents", () => {
  const CIMD = "https://app.example/oauth/client.json";
  let original: typeof cimdFetcher.fetch;
  beforeAll(() => { original = cimdFetcher.fetch; });
  afterAll(() => { cimdFetcher.fetch = original; });

  it("accepts an https client_id whose document names itself and lists the redirect URI", async () => {
    cimdFetcher.fetch = async (url) => ({ client_id: url, client_name: "Example MCP App", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const t = await fullFlow(A, CIMD);
    expect((await call(t.access_token, "whoami")).status).toBe(200);
  });
  it("rejects documents whose client_id does not match their URL", async () => {
    cimdFetcher.fetch = async () => ({ client_id: "https://other.example/c.json", client_name: "x", redirect_uris: [REDIRECT] });
    await h.deps.db.sys(`DELETE FROM oauth_auth_requests WHERE client_id = $1`, ["https://bad.example/c.json"]);
    const r = await authorize("https://bad.example/c.json", verifier());
    expect(r.headers.location).toMatch(/oauth\/consent\?error=invalid_client/);
  });
});

describe("official MCP SDK OAuth client (discovery → DCR → PKCE → consent → tokens)", () => {
  beforeAll(async () => { await h.app.listen({ port: PORT, host: "127.0.0.1" }); });

  it("connects end to end and lists tools", async () => {
    const store: { client?: any; tokens?: any; verifier?: string; authUrl?: URL } = {};
    const provider: OAuthClientProvider = {
      get redirectUrl() { return REDIRECT; },
      get clientMetadata() { return { client_name: "SDK Test Client", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
      clientInformation: () => store.client, saveClientInformation: (c) => { store.client = c; },
      tokens: () => store.tokens, saveTokens: (t) => { store.tokens = t; },
      redirectToAuthorization: (u) => { store.authUrl = u; },
      saveCodeVerifier: (v) => { store.verifier = v; }, codeVerifier: () => store.verifier!,
    };
    const transport = new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider });
    const c = new McpClient({ name: "sdk-oauth-test", version: "1.0.0" });
    await expect(c.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(store.client.client_id).toMatch(/^atlas_dcr_/);
    expect(store.authUrl!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(store.authUrl!.searchParams.get("resource")).toBe(MCP);
    const a = await fetch(store.authUrl!, { redirect: "manual" });
    const ok = await approve(A, requestIdOf(a.headers.get("location")!));
    const code = new URL(ok.body.redirect).searchParams.get("code")!;
    await transport.finishAuth(code);
    expect(store.tokens.access_token).toMatch(/^atlas_oat_/);
    const c2 = new McpClient({ name: "sdk-oauth-test", version: "1.0.0" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider }));
    const tools = (await c2.listTools()).tools.map((t) => t.name);
    expect(tools.sort()).toEqual([...TOOL_NAMES].sort());
    const who = await c2.callTool({ name: "whoami", arguments: {} });
    expect(JSON.parse((who.content as any)[0].text).agent.name).toBe("sdk-test-client");
    await c2.close();
  });
});

describe("gateway health", () => {
  it("self-checks initialize + tools/list", async () => {
    const r = await raw("GET", "/health/mcp");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, tools: TOOL_NAMES.length, missing: [] });
  });
});

describe("phase 3 scopes over OAuth (remote MCP clients)", () => {
  it("consent lists social write scopes off by default; a draft-only grant can draft but not publish; revocation is immediate", async () => {
    const c = await register("Claude");
    const v = verifier();
    const a = await authorize(c.client_id, v, { scope: "" });
    const id = requestIdOf(a.headers.location as string);
    const view = (await A.get(`/oauth/requests/${id}`)).body;
    const byId = Object.fromEntries(view.scopes.map((s: any) => [s.id, s]));
    expect(byId["post:publish"]).toMatchObject({ risk: "publish", recommended: false });
    expect(byId["post:draft"]).toMatchObject({ risk: "write", recommended: false });
    expect(byId["social:react"]).toMatchObject({ risk: "write", recommended: false });
    expect(view.never).toContain("publish anything you did not approve");
    // approving with no explicit choice grants only the recommended scopes
    const plain = await approve(A, id);
    const plainCode = new URL(plain.body.redirect).searchParams.get("code")!;
    const pt = await raw("POST", "/oauth/token", { body: form({ grant_type: "authorization_code", code: plainCode, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: v, resource: MCP }) });
    expect(pt.body.scope.split(" ").sort()).toEqual([...DEFAULT_OAUTH_SCOPES].sort());
    const v2 = verifier();
    const a2 = await authorize(c.client_id, v2, { scope: "" });
    const ok2 = await approve(A, requestIdOf(a2.headers.location as string), ["feed:read", "post:draft"]);
    const code2 = new URL(ok2.body.redirect).searchParams.get("code")!;
    const t = (await raw("POST", "/oauth/token", { body: form({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: v2, resource: MCP }) })).body;
    expect(t.scope).toBe("feed:read post:draft");
    const d = await call(t.access_token, "draft_post", { body: "Spot volumes look thin today; I'd wait for the US open." });
    expect(d.body.result.isError ?? false).toBe(false);
    const draftId = JSON.parse(d.body.result.content[0].text).draft.id;
    const p = await call(t.access_token, "publish_post", { draftId, userApproved: true });
    expect(p.body.result.content[0].text).toContain("AGENT_SCOPE_MISSING");
    expect((await raw("POST", "/oauth/revoke", { body: form({ token: t.refresh_token, client_id: c.client_id }) })).status).toBe(200);
    expect((await call(t.access_token, "list_drafts")).status).toBe(401);
  });
});


describe("RFC 9207: redirect iss equals the metadata issuer byte-for-byte", () => {
  // what the web consent page does: calls go through the atlascalls.xyz proxy with forwarded headers
  const viaProxy = { "x-forwarded-host": "atlascalls.xyz", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" };
  it("every metadata path serves the same issuer", async () => {
    const issuers = new Set<string>();
    for (const path of AS_METADATA_PATHS) {
      for (const headers of [{}, viaProxy]) {
        const r = await raw("GET", path, { headers });
        expect(r.status, path).toBe(200);
        issuers.add(r.body.issuer);
        expect(r.body.authorization_response_iss_parameter_supported).toBe(true);
      }
    }
    expect([...issuers]).toEqual([API]);
    const prm = await raw("GET", "/mcp/.well-known/oauth-protected-resource", { headers: viaProxy });
    expect(prm.body.authorization_servers).toEqual([API]);
  });

  it("approve, deny and authorize-error redirects carry exactly that iss, even through the web proxy", async () => {
    const issuer = (await raw("GET", "/.well-known/oauth-authorization-server")).body.issuer as string;
    const c = await register("Claude", { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    const go = async () => {
      const v = verifier();
      const q = new URLSearchParams({ response_type: "code", client_id: c.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: s256(v), code_challenge_method: "S256", state: "s+/= x", resource: MCP });
      const a = await raw("GET", `/oauth/authorize?${q}`, { headers: viaProxy });
      return requestIdOf(a.headers.location as string);
    };
    const proxied = (method: string, url: string, body: object) => h.app.inject({ method: method as any, url, payload: body, headers: { ...viaProxy, origin: ORIGIN, "x-atlas-csrf": A.csrf!, cookie: [...A.cookies].map(([k, v2]) => `${k}=${v2}`).join("; ") } });
    const okRes = await proxied("POST", `/oauth/requests/${await go()}/approve`, { scopes: ["feed:read", "post:draft"] });
    expect(okRes.statusCode, okRes.body).toBe(200);
    const ok = JSON.parse(okRes.body);
    const deny = JSON.parse((await proxied("POST", `/oauth/requests/${await go()}/deny`, {})).body);
    const bad = await raw("GET", `/oauth/authorize?${new URLSearchParams({ response_type: "token", client_id: c.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "z" })}`, { headers: viaProxy });
    for (const loc of [ok.redirect, deny.redirect, bad.headers.location as string]) {
      const u = new URL(loc);
      expect(u.searchParams.get("iss"), loc).toBe(issuer); // decoded value, byte-for-byte
      expect(loc).toContain(`iss=${encodeURIComponent(issuer)}`);
    }
    expect(new URL(ok.redirect).searchParams.get("state")).toBe("s+/= x");
    expect(new URL(ok.redirect).searchParams.get("code")).toMatch(/^atlas_oac_/);
  });

  it("in production without PUBLIC_API_ORIGIN the issuer is fixed, never taken from forwarded headers", () => {
    const req: any = { protocol: "https", host: "atlascalls.xyz" };
    expect(apiBase({ cfg: { NODE_ENV: "production" } } as any, req)).toBe(DEFAULT_PRODUCTION_ISSUER);
    expect(apiBase({ cfg: { NODE_ENV: "production", PUBLIC_API_ORIGIN: "https://api.example/" } } as any, req)).toBe("https://api.example");
  });

  it("consent lets the user turn on optional scopes the client did not request", async () => {
    const cid = (await register("Claude")).client_id;
    const clientIdForScopes = () => cid;
    const v = verifier();
    const a = await authorize(clientIdForScopes(), v, { scope: "feed:read research:read" });
    const id = requestIdOf(a.headers.location as string);
    const view = (await A.get(`/oauth/requests/${id}`)).body;
    expect(view.scopes.find((s: any) => s.id === "post:publish")).toMatchObject({ recommended: false, requested: false });
    const ok = await approve(A, id, ["feed:read", "post:draft", "social:react"]);
    const code = new URL(ok.body.redirect).searchParams.get("code")!;
    const t = await raw("POST", "/oauth/token", { body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientIdForScopes(), code_verifier: v, resource: MCP }) });
    expect(t.body.scope).toBe("feed:read post:draft social:react");
  });
});

describe("OAuth state and redirect_uri are returned byte-for-byte", () => {
  it("preserves a long Google-style state and a long-path redirect_uri through authorize → approve", async () => {
    // ~1.6 KB ciphertext-like blob: base64 alphabet plus +, /, =, -, _ and octets that arrive percent-encoded.
    const chunk = "Ab+Cd/Ef=Gh-Ij_K.~" + Buffer.from("🙂/+=").toString("base64");
    let state = "gk-v1.";
    while (state.length < 1600) state += chunk;
    state = state.slice(0, 1600);
    expect(state.length).toBe(1600);
    expect(state).toMatch(/[+/=\-_]/);
    const path = `/r/user_bound_custom-mcp-${"x".repeat(180)}`;
    const redirectUri = `https://oauth-redirect.googleusercontent.com${path}`;
    const c = await register("Gemini", { redirect_uris: [redirectUri] });
    const v = verifier();
    const q = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: redirectUri,
      code_challenge: s256(v), code_challenge_method: "S256", state, resource: MCP,
    });
    // Mix raw percent-encoding in the authorize query (%2B / %2F / %3D / %20) and confirm it is not double-encoded later.
    const rawQuery = q.toString().replace(/state=[^&]+/, `state=${encodeURIComponent(state)}`);
    const a = await raw("GET", `/oauth/authorize?${rawQuery}`);
    expect(a.status).toBe(302);
    const loc = a.headers.location as string;
    expect(loc).toContain("/oauth/consent?request=");
    const id = requestIdOf(loc);
    const stored = await h.deps.db.sys(`SELECT state, redirect_uri FROM oauth_auth_requests WHERE id = $1`, [id]);
    expect(stored[0].state).toBe(state);
    expect(stored[0].state.length).toBe(1600);
    expect(stored[0].redirect_uri).toBe(redirectUri);

    const ok = await approve(A, id, ["feed:read"]);
    expect(ok.status).toBe(200);
    const redirect = new URL(ok.body.redirect);
    expect(redirect.origin + redirect.pathname).toBe(redirectUri);
    expect(redirect.pathname).toBe(path);
    expect(redirect.searchParams.get("state")).toBe(state);
    expect(redirect.searchParams.get("state")!.length).toBe(1600);
    expect(redirect.searchParams.get("code")).toMatch(/^atlas_oac_/);
    // Raw query value, after a single form-urlencoded decode, must equal the original state (no truncation, no +/space swap, no double encoding).
    const rawState = (ok.body.redirect as string).match(/[?&]state=([^&]*)/)![1];
    expect(decodeURIComponent(rawState.replace(/\+/g, " "))).toBe(state);
    expect(decodeURIComponent(rawState.replace(/\+/g, " ")).length).toBe(1600);

    const denied = await (async () => {
      const v2 = verifier();
      const q2 = new URLSearchParams({
        response_type: "code", client_id: c.client_id, redirect_uri: redirectUri,
        code_challenge: s256(v2), code_challenge_method: "S256", state, resource: MCP,
      });
      const a2 = await raw("GET", `/oauth/authorize?${q2}`);
      const d = await A.post(`/oauth/requests/${requestIdOf(a2.headers.location as string)}/deny`, {});
      return new URL(d.body.redirect);
    })();
    expect(denied.origin + denied.pathname).toBe(redirectUri);
    expect(denied.searchParams.get("state")).toBe(state);
    expect(denied.searchParams.get("error")).toBe("access_denied");
  });

  it("rejects an oversized state instead of truncating it, and echoes the full state on the error redirect", async () => {
    const c = await register("GeminiOversize");
    const tooLong = `s+/=-_x${"A".repeat(MAX_OAUTH_STATE_LEN)}`;
    expect(tooLong.length).toBeGreaterThan(MAX_OAUTH_STATE_LEN);
    const v = verifier();
    const q = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: REDIRECT,
      code_challenge: s256(v), code_challenge_method: "S256", state: tooLong, resource: MCP,
    });
    const a = await raw("GET", `/oauth/authorize?${q}`);
    expect(a.status).toBe(302);
    const loc = new URL(a.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe("invalid_request");
    expect(loc.searchParams.get("state")).toBe(tooLong);
    expect(loc.searchParams.get("state")!.length).toBe(tooLong.length);
    const n = await h.deps.db.sys(`SELECT count(*)::int AS n FROM oauth_auth_requests WHERE client_id = $1`, [c.client_id]);
    expect(n[0].n).toBe(0);
  });
});
