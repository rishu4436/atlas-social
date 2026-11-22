/** In-process MCP gateway self-check: initialize + tools/list over an in-memory transport. Never touches data or tokens. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAtlasMcpServer, TOOL_NAMES, SERVER_VERSION } from "@atlas/agent-gateway";

export async function mcpSelfCheck() {
  const t0 = Date.now();
  const server = createAtlasMcpServer(async () => ({ status: 503, body: { error: "SELF_CHECK", message: "health check: no data access" } }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "atlas-health", version: "1.0.0" });
  try {
    await server.connect(a);
    await client.connect(b);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const missing = TOOL_NAMES.filter((n) => !names.includes(n));
    return { ok: missing.length === 0, serverVersion: SERVER_VERSION, tools: names.length, expectedTools: TOOL_NAMES.length, missing, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200), tools: 0, expectedTools: TOOL_NAMES.length, missing: [...TOOL_NAMES], ms: Date.now() - t0 };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
