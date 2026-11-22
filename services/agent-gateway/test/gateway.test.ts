import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAtlasMcpServer, TOOL_NAMES, AGENT_ROUTES, ALL_SCOPES, READ_ONLY_SCOPES, isScope, type AtlasApiCall } from "../src/index.js";
import { httpCaller } from "../src/stdio.js";

async function connect(call: AtlasApiCall) {
  const server = createAtlasMcpServer(call);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unit", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const text = (r: any) => r.content[0].text as string;

describe("scopes and route allowlist", () => {
  it("has no scope or route that signs, sends or touches account security", () => {
    expect(ALL_SCOPES.some((s) => /sign|send|wallet|admin|dm|message|settings/.test(s))).toBe(false);
    for (const [route, scope] of Object.entries(AGENT_ROUTES)) {
      expect(route).not.toMatch(/\/auth|\/admin|\/conversations|\/agents\/tokens|\/pay\/(prepare|confirm|recipient|requests)|\/settings|\/confirm|\/points\/me/);
      expect(scope === "any" || isScope(scope)).toBe(true);
    }
    for (const s of READ_ONLY_SCOPES) for (const [route, scope] of Object.entries(AGENT_ROUTES)) if (scope === s) expect(route.startsWith("GET ") || /\/evaluate$/.test(route)).toBe(true);
  });
});

describe("MCP tools", () => {
  it("lists every tool with a description and an input schema", async () => {
    const c = await connect(async () => ({ status: 200, body: {} }));
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) { expect(t.description!.length).toBeGreaterThan(40); expect(t.inputSchema.type).toBe("object"); }
    expect(tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name).sort()).toEqual(["discard_draft", "draft_post", "draft_thesis", "post_challenge", "post_review", "prepare_payment", "prepare_thesis_publication", "publish_post", "react_to_post", "verify_evidence"]);
  });

  it("maps tools onto the API routes and validates arguments before calling", async () => {
    const calls: any[] = [];
    const c = await connect(async (r) => { calls.push(r); return { status: 200, body: { board: "analysts", entries: [{ rank: 1, profile: { agentName: "alice.ai", displayName: "Alice" }, score: 71, resolved: 14 }, { rank: 2, profile: { agentName: "bob.ai" }, score: 60, resolved: 12 }], unranked: [] } }; });
    const r = await c.callTool({ name: "search_analysts", arguments: { query: "ALI", asset: "BNB" } });
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: "/leaderboards/analysts?window=90d&asset=BNB", tool: "search_analysts" });
    expect(JSON.parse(text(r)).ranked.map((e: any) => e.analyst)).toEqual(["alice.ai"]);
    await c.callTool({ name: "compare_traders", arguments: { analysts: ["alice.ai", "bob.ai"] } });
    expect(calls.at(-1).path).toBe("/traders/compare?ids=alice.ai%2Cbob.ai&window=90d");
    await c.callTool({ name: "prepare_payment", arguments: { recipient: "bob.ai", asset: "USDT", amount: "2", tipFor: { kind: "thesis", id: "11111111-1111-4111-8111-111111111111" } } });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/pay/agent/prepare", body: { kind: "tip", context: { kind: "thesis" } } });
    await c.callTool({ name: "post_review", arguments: { thesisId: "11111111-1111-4111-8111-111111111111", stance: "DISPUTE", body: "x" } });
    expect(calls.at(-1).body.onchain).toBe(false);
    const n = calls.length;
    const bad = await c.callTool({ name: "draft_thesis", arguments: { asset: "BNB", direction: "SIDEWAYS" } });
    expect(bad.isError).toBe(true);
    expect(calls.length).toBe(n);
  });

  it("turns API errors into actionable tool errors", async () => {
    const c = await connect(async () => ({ status: 403, body: { error: "AGENT_SCOPE_MISSING", message: "This token lacks thesis:draft" } }));
    const r = await c.callTool({ name: "draft_thesis", arguments: { asset: "BNB", direction: "LONG", targetPrice: "700", invalidationPrice: "500", horizonHours: 24, title: "test", summary: "a long enough summary" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/AGENT_SCOPE_MISSING: This token lacks thesis:draft.*Settings → Agents/);
  });
});

describe("stdio HTTP caller", () => {
  it("sends the bearer and declared client/model only to the configured API", async () => {
    const seen: any[] = [];
    const f = (async (url: string, init: any) => { seen.push({ url, init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as any;
    const call = httpCaller({ apiUrl: "https://api.example/", token: "atlas_agt_x", client: "claude-desktop", model: "m1", fetchImpl: f });
    const r = await call({ method: "POST", path: "/theses", body: { a: 1 }, tool: "draft_thesis" });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(seen[0].url).toBe("https://api.example/theses");
    expect(seen[0].init.headers).toMatchObject({ authorization: "Bearer atlas_agt_x", "x-atlas-mcp-tool": "draft_thesis", "x-atlas-agent-client": "claude-desktop", "x-atlas-agent-model": "m1", "content-type": "application/json" });
  });
});
