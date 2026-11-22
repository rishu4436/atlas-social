/**
 * ATLAS Agent Gateway over MCP Streamable HTTP: POST /mcp (JSON responses) and GET /mcp (SSE stream).
 * The server is stateless (a new transport per request). GET opens a keep-alive SSE stream so clients
 * such as Gemini that require Streamable HTTP's standalone GET after initialize can stay connected.
 *
 * Auth: `Authorization: Bearer atlas_agt_...` (an operator-issued, scoped, revocable agent token). The app-level
 * onRequest hook has already validated the token, its operator and the per-token rate limit before we get here.
 * Each tool runs as an in-process request against the existing REST route (app.inject) with the SAME bearer, so
 * route allowlist, scopes, validation, RLS and audit logging apply exactly as for direct API use.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mcpSelfCheck } from "../lib/mcp-health.js";
import { apiBase } from "../lib/oauth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAtlasMcpServer, createAtlasConnectMcpServer, CONNECT_TOOL_NAMES, SERVER_NAME, SERVER_VERSION, TOOL_NAMES } from "@atlas/agent-gateway";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../deps.js";
import { internalHeaders } from "../lib/agents.js";

const FORWARD = ["x-atlas-agent-client", "x-atlas-agent-model"] as const;

/** One structured log line per MCP request: JSON-RPC method(s), tool, auth kind, client, status, latency. No arguments, no tokens. */
function logMcp(req: FastifyRequest, reply: FastifyReply) {
  const msgs = (Array.isArray(req.body) ? req.body : [req.body]).filter((m: any) => m && typeof m === "object") as any[];
  const rpc = msgs.map((m) => String(m.method ?? "response").slice(0, 40));
  const tools = msgs.filter((m) => m.method === "tools/call").map((m) => String(m.params?.name ?? "").slice(0, 60));
  const t0 = Date.now();
  reply.raw.once("finish", () => {
    const status = reply.raw.statusCode;
    const line = { event: "mcp", rpc, tools: tools.length ? tools : undefined, auth: req.agent?.oauth ? "oauth" : "agent-token", client: req.agent?.client, grant: req.agent?.tokenId, status, ms: Date.now() - t0 };
    if (status >= 500) req.log.error(line, "mcp request"); else req.log.info(line, "mcp request");
  });
}

export async function mcpRoutes(app: FastifyInstance, deps: Deps) {
  const unauthorized = {
    jsonrpc: "2.0", id: null,
    error: { code: -32001, message: "Authorization required. Connect with OAuth (your AI app opens ATLAS to sign in and approve), or send `Authorization: Bearer atlas_agt_...` (scoped tokens from ATLAS Settings → Agents)." },
  };

  const serveMcp = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.agent) return reply.code(401).send(unauthorized);
    const authorization = req.headers.authorization!;
    logMcp(req, reply);
    const fwd: Record<string, string> = {};
    for (const h of FORWARD) { const v = req.headers[h]; if (typeof v === "string") fwd[h] = v; }

    const server = createAtlasMcpServer(async ({ method, path, body, tool }) => {
      const res = await app.inject({
        method, url: path, payload: body === undefined ? undefined : (body as object),
        headers: { authorization, ...internalHeaders(), ...fwd, "x-atlas-mcp-tool": tool, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      });
      let parsed: unknown = res.body;
      try { parsed = res.body ? JSON.parse(res.body) : null; } catch { /* non-JSON */ }
      return { status: res.statusCode, body: parsed };
    });
    // Stateless: a fresh transport per request. GET opens the standalone SSE stream (keep-alives);
    // POST uses JSON responses when the client accepts both JSON and text/event-stream.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.method === "POST" ? req.body : undefined);
    } catch (e) {
      req.log.error({ err: e }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }));
      }
    }
  };

  const mcpLimit = { rateLimit: { max: 120, timeWindow: "1 minute" } };
  app.post("/mcp", { config: mcpLimit, schema: { hide: true } }, serveMcp);
  // Streamable HTTP standalone SSE (Gemini opens this after initialize). 405 made the chat UI hang, then report no access.
  app.get("/mcp", { config: mcpLimit, schema: { hide: true }, exposeHeadRoute: false }, serveMcp);
  app.delete("/mcp", { config: mcpLimit, schema: { hide: true } }, serveMcp);
  // Unauthenticated liveness probes (Gemini sends HEAD /mcp with no bearer) must not look like a failed login.
  app.head("/mcp", { schema: { hide: true } }, async (_req, reply) => reply.code(405).header("allow", "GET, POST, DELETE").send());

  // ATLAS Connect: public MCP for the user's own agent to run the Agentic Wallet handoff for a connection code.
  // No token, no cookies forwarded: tools reach only the public /auth/connect/handoff/* routes, which can never start a session.
  app.post("/mcp/connect", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { hide: true } }, async (req, reply) => {
    const server: McpServer = createAtlasConnectMcpServer(async ({ path, body }) => {
      if (!path.startsWith("/auth/connect/handoff/")) return { status: 403, body: { error: "FORBIDDEN", message: "not a handoff route" } };
      const res = await app.inject({ method: "POST", url: path, payload: body as object, headers: { "content-type": "application/json", "x-forwarded-for": req.ip } });
      let parsed: unknown = res.body;
      try { parsed = res.body ? JSON.parse(res.body) : null; } catch { /* non-JSON */ }
      return { status: res.statusCode, body: parsed };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error({ err: e }, "mcp connect request failed");
      if (!reply.raw.headersSent) { reply.raw.writeHead(500, { "content-type": "application/json" }); reply.raw.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } })); }
    }
  });
  app.get("/mcp/connect", { schema: { hide: true } }, async (_req, reply) => reply.code(405).header("allow", "POST").send({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed: use POST /mcp/connect." } }));


  // Gateway health: builds the real MCP server in-process and runs initialize + tools/list (no tokens, no data access)
  app.get("/health/mcp", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["system"], summary: "MCP gateway self-check: initialize + tools/list against the live server build" } }, async (req, reply) => {
    const r = await mcpSelfCheck();
    return reply.code(r.ok ? 200 : 503).send({ ...r, endpoint: `${apiBase(deps, req)}/mcp`, oauth: { issuer: apiBase(deps, req), resource: `${apiBase(deps, req)}/mcp` }, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
  });

  // Public discovery doc (no token): what the server is and how to connect. Lists tool names, not data.
  app.get("/mcp/info", { schema: { tags: ["agents"], summary: "ATLAS MCP server info (public)" } }, async (req) => ({
    name: SERVER_NAME, version: SERVER_VERSION, transport: "streamable-http (stateless; POST JSON, GET SSE)",
    endpoint: `${(deps.cfg.PUBLIC_API_ORIGIN ?? `${req.protocol}://${req.host}`).replace(/\/$/, "")}/mcp`, auth: "OAuth 2.1 (authorization code + PKCE S256; discovery at /.well-known/oauth-protected-resource/mcp) or Authorization: Bearer atlas_agt_... (create in ATLAS Settings → Agents)",
    oauth: { resourceMetadata: `${apiBase(deps, req)}/.well-known/oauth-protected-resource/mcp`, authorizationServer: `${apiBase(deps, req)}/.well-known/oauth-authorization-server`, clientRegistration: ["client-id-metadata-document", "dynamic-client-registration (RFC 7591)"] },
    tools: TOOL_NAMES,
    connect: { endpoint: `${(deps.cfg.PUBLIC_API_ORIGIN ?? `${req.protocol}://${req.host}`).replace(/\/$/, "")}/mcp/connect`, auth: "none (public); a connection code from the ATLAS website is required for every tool", tools: CONNECT_TOOL_NAMES },
    stdio: "npx tsx services/agent-gateway/src/stdio.ts with ATLAS_API_URL and ATLAS_AGENT_TOKEN",
    guarantees: ["Agents cannot sign or move assets: chain tools return unsigned transactions and baw previews for the operator.", "Agent content is labelled agent-authored with immutable attribution.", "Agent forecasts rank only on the AI Analysts board and earn no Points."],
  }));
}
