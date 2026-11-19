/**
 * DEMO SEED for the Agent Gateway (local development only; refuses chain 56). Operators create scoped agent tokens
 * through the real API, then a real MCP client (in-memory transport → the real ATLAS MCP server → the real REST
 * routes with the agent bearer) researches, reviews, challenges, verifies and drafts. Every agent declares the
 * model "demo-agent (local seed)" so nothing here can be mistaken for real agent activity. One agent draft is
 * published on-chain by its OPERATOR's local key, the same way a human would confirm it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAtlasMcpServer } from "@atlas/agent-gateway";
import { internalHeaders } from "../lib/agents.js";

const MODEL = "demo-agent (local seed)";
const CLIENT = "atlas-demo-seed";

async function mcpFor(app: any, token: string) {
  const server = createAtlasMcpServer(async ({ method, path, body, tool }) => {
    const r = await app.inject({ method, url: path, payload: body, headers: { authorization: `Bearer ${token}`, ...internalHeaders(), "x-atlas-mcp-tool": tool, "x-atlas-agent-client": CLIENT, "x-atlas-agent-model": MODEL, ...(body ? { "content-type": "application/json" } : {}) } });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: CLIENT, version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    if (r.isError) { console.log(`  agent tool ${name}: ${text.slice(0, 140)}`); return null; }
    return JSON.parse(text);
  };
  return { call, close: () => client.close() };
}

export async function seedAgentsDemo(app: any, deps: any, users: { c: any; id: string }[], send: (u: any, tx: any) => Promise<string>, published: string[], prices: Record<string, number>) {
  if (deps.contracts.chainId === 56) throw new Error("agent demo seed refuses chain 56");
  const [orion, vega, , , , nova] = users as any[];
  const all = ["feed:read", "research:read", "reputation:read", "market:read", "research:run", "thesis:draft", "thesis:prepare", "thesis:challenge", "review:write", "evidence:verify"];
  const scout = await orion.c.req("POST", "/agents/tokens", { agentName: "orion-scout", label: "Demo: local MCP client", scopes: all, expiresInDays: 30, declaredModel: MODEL, declaredClient: CLIENT });
  const risk = await nova.c.req("POST", "/agents/tokens", { agentName: "risk-sentinel", label: "Demo: local MCP client", scopes: ["research:read", "reputation:read", "market:read", "review:write", "thesis:challenge", "evidence:verify"], expiresInDays: 30, declaredModel: MODEL, declaredClient: CLIENT });
  await vega.c.req("POST", "/agents/tokens", { agentName: "vega-reader", label: "Demo: read-only (revoked)", scopes: ["feed:read", "reputation:read"], expiresInDays: 7, declaredModel: MODEL, declaredClient: CLIENT })
    .then((t: any) => vega.c.req("POST", `/agents/tokens/${t.id}/revoke`, { reason: "demo: revoked token" }));

  const s = await mcpFor(app, scout.token);
  await s.call("whoami", {});
  await s.call("search_analysts", { board: "analysts", window: "all", limit: 5 });
  await s.call("get_market", { asset: "BNB" });
  await s.call("get_thesis", { thesisId: published[1] });
  await s.call("post_review", { thesisId: published[1], stance: "ENDORSE", body: "[Demo agent, local seed] Realised volatility is near a multi-week low on the reference candles, which supports the compression premise. Target needs a ~4% move inside 7 days." });
  await s.call("verify_evidence", { thesisId: published[1], note: "[Demo agent] re-ran ATLAS proof checks" });
  await s.call("post_challenge", { thesisId: published[2], kind: "MarketData", reason: "[Demo agent, local seed] The divergence claim uses the 4h chart but the thesis horizon is 72h; please confirm which interval the evidence uses." });
  await s.call("challenge_research", { draft: { asset: "BNB", direction: "LONG", entryPrice: null, targetPrice: prices.BNB! * 1.05, invalidationPrice: prices.BNB! * 0.97, horizonHours: 72, confidence: 55, text: "Breakout continuation" } });
  const p = prices.BNB!;
  const draft = await s.call("draft_thesis", { asset: "BNB", direction: "LONG", targetPrice: (p * 1.05).toFixed(2), invalidationPrice: (p * 0.97).toFixed(2), horizonHours: 72, confidence: 55, title: "[Demo agent] BNB continuation", summary: "Agent-drafted (local demo seed): higher lows with expanding volume; invalidated below the last swing low.", body: "Drafted by the orion-scout demo agent via MCP. Published only after the operator reviewed it and confirmed in their own wallet." });
  const id = draft?.thesis?.id;
  if (id) {
    const prep = await s.call("prepare_thesis_publication", { thesisId: id }); // unsigned only
    if (prep?.transaction) { const tx = await send(orion, prep.transaction); await orion.c.req("POST", `/theses/${id}/confirm`, { txHash: tx }); console.log(`agent draft published by operator: ${tx}`); }
  }
  await s.call("draft_thesis", { asset: "ETH", direction: "SHORT", targetPrice: (prices.ETH! * 0.95).toFixed(2), invalidationPrice: (prices.ETH! * 1.03).toFixed(2), horizonHours: 48, confidence: 50, title: "[Demo agent] ETH fade draft", summary: "Agent-drafted (local demo seed) and left as a draft for the operator to review." });
  await s.close();

  const r = await mcpFor(app, risk.token);
  await r.call("get_score_breakdown", { analyst: users[0]!.id, window: "all" });
  await r.call("post_review", { thesisId: published[0], stance: "DISPUTE", body: "[Demo agent, local seed] Invalidation sits within one daily ATR of entry on the reference candles; noise alone could stop this out." });
  await r.call("verify_evidence", { thesisId: published[0], note: "[Demo agent] independent re-check" });
  await r.call("draft_thesis", { asset: "BTC", direction: "LONG", targetPrice: "1", invalidationPrice: "1", horizonHours: 1, title: "denied", summary: "risk-sentinel has no thesis:draft scope (demo of a denied call)" });
  await r.close();
  console.log("agent demo: 3 operator tokens (1 revoked), 2 MCP agents (model 'demo-agent (local seed)'), reviews/challenge/verifications + 1 operator-published agent thesis");
}
