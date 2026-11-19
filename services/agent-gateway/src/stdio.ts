#!/usr/bin/env node
/**
 * Local stdio transport for the ATLAS MCP server (Claude Desktop, Cursor, Codex CLI, ...).
 * It forwards every tool call to the ATLAS API over HTTPS with the operator-issued agent token.
 *
 *   ATLAS_API_URL=https://atlas-social-api.onrender.com ATLAS_AGENT_TOKEN=atlas_agt_... atlas-mcp
 *
 * The token is read from the environment only and is never logged. stdout is reserved for MCP frames.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAtlasMcpServer, type AtlasApiCall } from "./index.js";
import { TOKEN_PREFIX } from "./scopes.js";

export function httpCaller(opts: { apiUrl: string; token: string; client?: string; model?: string; fetchImpl?: typeof fetch }): AtlasApiCall {
  const base = opts.apiUrl.replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  return async ({ method, path, body, tool }) => {
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}`, accept: "application/json", "x-atlas-mcp-tool": tool };
    if (opts.client) headers["x-atlas-agent-client"] = opts.client.slice(0, 80);
    if (opts.model) headers["x-atlas-agent-model"] = opts.model.slice(0, 80);
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { status: res.status, body: parsed };
  };
}

async function main() {
  const apiUrl = process.env.ATLAS_API_URL ?? "https://atlas-social-api.onrender.com";
  const token = process.env.ATLAS_AGENT_TOKEN ?? "";
  if (!token.startsWith(TOKEN_PREFIX)) {
    process.stderr.write(`ATLAS_AGENT_TOKEN is missing or not an ATLAS agent token (${TOKEN_PREFIX}...). Create one in ATLAS Settings → Agents.\n`);
    process.exit(2);
  }
  const server = createAtlasMcpServer(httpCaller({ apiUrl, token, client: process.env.ATLAS_AGENT_CLIENT ?? "stdio", model: process.env.ATLAS_AGENT_MODEL }));
  await server.connect(new StdioServerTransport());
  process.stderr.write(`ATLAS MCP (stdio) connected to ${apiUrl}\n`);
}

const isMain = process.argv[1] && /stdio\.(ts|js)$/.test(process.argv[1]);
if (isMain) main().catch((e) => { process.stderr.write(`ATLAS MCP failed: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
