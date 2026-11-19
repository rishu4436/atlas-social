/**
 * ATLAS Agent Gateway over MCP Streamable HTTP: POST /mcp (stateless, JSON responses).
 *
 * Auth: `Authorization: Bearer atlas_agt_...` (an operator-issued, scoped, revocable agent token). The app-level
 * onRequest hook has already validated the token, its operator and the per-token rate limit before we get here.
 * Each tool runs as an in-process request against the existing REST route (app.inject) with the SAME bearer, so
 * route allowlist, scopes, validation, RLS and audit logging apply exactly as for direct API use.
 */
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAtlasMcpServer, createAtlasConnectMcpServer, CONNECT_TOOL_NAMES, SERVER_NAME, SERVER_VERSION, TOOL_NAMES } from "@atlas/agent-gateway";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../deps.js";
import { internalHeaders } from "../lib/agents.js";

const FORWARD = ["x-atlas-agent-client", "x-atlas-agent-model"] as const;

export async function mcpRoutes(app: FastifyInstance, deps: Deps) {
  const unauthorized = {
    jsonrpc: "2.0", id: null,
    error: { code: -32001, message: "ATLAS agent token required: send `Authorization: Bearer atlas_agt_...`. Operators create scoped tokens in ATLAS Settings → Agents." },
  };

  app.post("/mcp", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { hide: true } }, async (req, reply) => {
    if (!req.agent) return reply.code(401).header("www-authenticate", 'Bearer realm="atlas-mcp"').send(unauthorized);
    const authorization = req.headers.authorization!;
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
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error({ err: e }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }));
      }
    }
  });

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

  // Stateless server: no standalone SSE stream and no sessions to delete.
  const notAllowed = { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed: ATLAS MCP is stateless; use POST /mcp." } };
  app.get("/mcp", { schema: { hide: true } }, async (req, reply) => {
    if (!req.agent) return reply.code(401).header("www-authenticate", 'Bearer realm="atlas-mcp"').send(unauthorized);
    return reply.code(405).header("allow", "POST").send(notAllowed);
  });
  app.delete("/mcp", { schema: { hide: true } }, async (req, reply) => {
    if (!req.agent) return reply.code(401).header("www-authenticate", 'Bearer realm="atlas-mcp"').send(unauthorized);
    return reply.code(405).header("allow", "POST").send(notAllowed);
  });

  // Public discovery doc (no token): what the server is and how to connect. Lists tool names, not data.
  app.get("/mcp/info", { schema: { tags: ["agents"], summary: "ATLAS MCP server info (public)" } }, async (req) => ({
    name: SERVER_NAME, version: SERVER_VERSION, transport: "streamable-http (stateless, JSON responses)",
    endpoint: `${(deps.cfg.PUBLIC_API_ORIGIN ?? `${req.protocol}://${req.host}`).replace(/\/$/, "")}/mcp`, auth: "Authorization: Bearer atlas_agt_... (create in ATLAS Settings → Agents)",
    tools: TOOL_NAMES,
    connect: { endpoint: `${(deps.cfg.PUBLIC_API_ORIGIN ?? `${req.protocol}://${req.host}`).replace(/\/$/, "")}/mcp/connect`, auth: "none (public); a connection code from the ATLAS website is required for every tool", tools: CONNECT_TOOL_NAMES },
    stdio: "npx tsx services/agent-gateway/src/stdio.ts with ATLAS_API_URL and ATLAS_AGENT_TOKEN",
    guarantees: ["Agents cannot sign or move assets: chain tools return unsigned transactions and baw previews for the operator.", "Agent content is labelled agent-authored with immutable attribution.", "Agent forecasts rank only on the AI Analysts board and earn no Points."],
  }));
}
