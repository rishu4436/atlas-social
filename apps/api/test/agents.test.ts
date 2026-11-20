/**
 * ATLAS Agent Gateway: scoped agent tokens (hashed, expiring, revocable, rate-limited), route allowlist, audit log,
 * immutable agent attribution, AI Analysts separation (no Skill Score / Points leakage), and the MCP server driven
 * by a real MCP client over Streamable HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TOOL_NAMES } from "@atlas/agent-gateway";
import { harness, Client, uniq, ORIGIN, type Harness } from "./helpers.js";

let h: Harness;
let A: Client, B: Client, C: Client;
const ids: Record<string, string> = {};
const hex = (n = 32) => `0x${randomBytes(n).toString("hex")}`;
const DAY = 86_400;

/** Raw agent request: bearer only (no cookies, no CSRF), like an external MCP client would send. */
async function agent(token: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await h.app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${token}`, ...headers } });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  return { status: res.statusCode, body: json };
}
async function mkToken(c: Client, scopes: string[], o: Record<string, unknown> = {}) {
  const r = await c.post("/agents/tokens", { agentName: "scout", label: uniq("tok"), scopes, declaredModel: "test-model-1", declaredClient: "vitest", ...o });
  if (r.status !== 200) throw new Error(`token ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { token: string; id: string; scopes: string[] };
}
async function publishedThesis(author: string, o: { daysAgo: number; outcome?: string; attr?: string | null; ret?: number }) {
  const outcome = o.outcome ?? "TargetHit";
  const [t] = await h.deps.db.sys(
    `INSERT INTO theses (author_id, author_wallet, chain_id, registry, asset, symbol, direction, entry_kind, target_price, invalidation_price, horizon_hours, confidence, visibility, content, content_hash, terms, salt, commitment,
       chain_status, onchain_id, publish_tx, published_at, start_time, outcome, return_bps, resolved_at, evidence_hash, outcome_state, agent_attribution_id)
     VALUES ($1,'0x0000000000000000000000000000000000000001',31337,'0x0000000000000000000000000000000000000002','BNB','BNBUSDT','LONG','MARKET',$2,$3,72,60,'PUBLIC',$4,$5,'{}','0x00',$6,
       'published',$7,$8, now() - make_interval(secs => $9), now() - make_interval(secs => $9), $10, $11, now() - make_interval(secs => $12), $13, 'Final', $14) RETURNING id`,
    [author, 600 + Math.random() * 300, 300 + Math.random() * 100, { title: uniq("t"), summary: "fixture", body: "" }, hex(), hex(), String(Math.floor(Math.random() * 1e9)), hex(),
      (o.daysAgo + 2) * DAY, outcome, o.ret ?? (outcome === "TargetHit" ? 300 : -150), o.daysAgo * DAY, hex(), o.attr ?? null],
  );
  return t.id as string;
}

beforeAll(async () => {
  h = await harness();
  A = new Client(h); B = new Client(h); C = new Client(h);
  await A.login(uniq("op")); await B.login(uniq("hum")); await C.login(uniq("cal"));
  for (const [k, c] of Object.entries({ A, B, C })) ids[k] = (await c.get("/auth/session")).body.userId;
});
afterAll(async () => { await h?.close(); });

describe("agent tokens", () => {
  it("lists scopes publicly; creating a token needs a signed-in, freshly verified operator", async () => {
    const s = (await new Client(h).get("/agents/scopes")).body;
    expect(s.scopes.map((x: any) => x.id)).toContain("thesis:draft");
    expect(s.scopes.map((x: any) => x.id)).not.toContain("pay:send");
    expect((await new Client(h).post("/agents/tokens", { agentName: "x1x", label: "l", scopes: ["feed:read"] })).status).toBe(401);
    h.clock.offset += 11 * 60; // wallet confirmation is older than 10 minutes
    const stale = await A.post("/agents/tokens", { agentName: "scout", label: "l", scopes: ["feed:read"] });
    expect(stale.status).toBe(403);
    h.clock.offset -= 11 * 60;
    expect((await A.post("/agents/tokens", { agentName: "scout", label: "l", scopes: ["wallet:sign"] })).status).toBe(400);
  });

  it("shows the token once and stores only its hash", async () => {
    const t = await mkToken(A, ["reputation:read"]);
    expect(t.token).toMatch(/^atlas_agt_[A-Za-z0-9_-]{30,}$/);
    const [row] = await h.deps.db.sys(`SELECT * FROM agent_tokens WHERE id = $1`, [t.id]);
    expect(JSON.stringify(row)).not.toContain(t.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const list = (await A.get("/agents/tokens")).body.tokens;
    expect(JSON.stringify(list)).not.toContain(t.token);
    expect(list.find((x: any) => x.id === t.id).scopes).toEqual(["reputation:read"]);
    // another operator cannot see it (RLS)
    expect((await B.get("/agents/tokens")).body.tokens.find((x: any) => x.id === t.id)).toBeUndefined();
    const leak = await h.deps.db.as(ids.B!, (q) => q(`SELECT count(*)::int AS n FROM agent_tokens WHERE id = $1`, [t.id]));
    expect(leak[0].n).toBe(0);
  });

  it("enforces scopes and a route allowlist; agents can never reach account, DM, token or signing routes", async () => {
    const t = await mkToken(A, ["reputation:read"]);
    const me = await agent(t.token, "GET", "/agents/me");
    expect(me.status).toBe(200);
    expect(me.body.agent.name).toBe("scout");
    expect(me.body.agent.model).toBe("test-model-1");
    expect((await agent(t.token, "GET", "/leaderboards/analysts")).status).toBe(200);
    const denied = await agent(t.token, "GET", "/feed");
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("AGENT_SCOPE_MISSING");
    for (const [m, u] of [["GET", "/auth/session"], ["GET", "/notifications"], ["GET", "/conversations"], ["POST", "/agents/tokens"], ["GET", "/agents/tokens"], ["POST", "/auth/logout"], ["GET", "/points/me"], ["POST", "/pay/prepare"], ["GET", "/admin/reviews"]]) {
      const r = await agent(t.token, m!, u!, m === "POST" ? {} : undefined);
      expect([r.status, r.body?.error]).toEqual([403, "AGENT_ROUTE_NOT_ALLOWED"]);
    }
    // a bearer never mixes with a cookie session
    const mixed = await A.req("GET", "/auth/session", undefined, { authorization: `Bearer ${t.token}` });
    expect(mixed.status).toBe(403);
    expect((await agent("atlas_agt_notarealtoken0000000000000000000000", "GET", "/agents/me")).body.error).toBe("AGENT_TOKEN_INVALID");
  });

  it("revocation and expiry take effect immediately", async () => {
    const t = await mkToken(A, ["feed:read"], { expiresInDays: 1 });
    expect((await agent(t.token, "GET", "/feed")).status).toBe(200);
    h.clock.offset += 2 * DAY;
    const exp = await agent(t.token, "GET", "/feed");
    h.clock.offset -= 2 * DAY;
    expect([exp.status, exp.body.error]).toEqual([401, "AGENT_TOKEN_EXPIRED"]);
    const t2 = await mkToken(A, ["feed:read"]);
    expect((await B.post(`/agents/tokens/${t2.id}/revoke`, {})).status).toBe(404); // not B's token
    expect((await A.post(`/agents/tokens/${t2.id}/revoke`, { reason: "test" })).status).toBe(200);
    const r = await agent(t2.token, "GET", "/feed");
    expect([r.status, r.body.error]).toEqual([401, "AGENT_TOKEN_REVOKED"]);
    // agents cannot revoke or un-revoke tokens themselves
    const t3 = await mkToken(A, ["feed:read"]);
    expect((await agent(t3.token, "POST", `/agents/tokens/${t2.id}/revoke`, {})).status).toBe(403);
  });

  it("audits every agent request (allowed and denied) without storing bodies; the log is append-only", async () => {
    const t = await mkToken(A, ["reputation:read"]);
    await agent(t.token, "GET", "/leaderboards/analysts", undefined, { "x-atlas-mcp-tool": "search_analysts" });
    await agent(t.token, "POST", "/theses", { title: "secret-body-marker" });
    const log = (await A.get(`/agents/audit?tokenId=${t.id}`)).body.entries;
    const ok = log.find((e: any) => e.route === "/leaderboards/:type" || e.route === "/leaderboards/analysts");
    expect(ok.outcome).toBe("ok");
    expect(ok.tool).toBe("search_analysts");
    const no = log.find((e: any) => e.route === "/theses" && e.method === "POST");
    expect([no.outcome, no.error_code, no.scope]).toEqual(["denied", "AGENT_SCOPE_MISSING", "thesis:draft"]);
    expect(JSON.stringify(log)).not.toContain("secret-body-marker");
    expect((await B.get(`/agents/audit?tokenId=${t.id}`)).body.entries).toEqual([]);
    await expect(h.deps.db.sys(`UPDATE agent_audit_log SET outcome = 'ok' WHERE token_id = $1`, [t.id])).rejects.toThrow();
    await expect(h.deps.db.sys(`DELETE FROM agent_audit_log WHERE token_id = $1`, [t.id])).rejects.toThrow();
  });
});

describe("agent-authored research", () => {
  let writer: string; let opThesis: string; let otherThesis: string;
  beforeAll(async () => {
    writer = (await mkToken(A, ["research:read", "thesis:draft", "thesis:prepare", "thesis:challenge", "review:write", "evidence:verify", "research:run", "reputation:read"], { agentName: "writer" })).token;
    opThesis = await publishedThesis(ids.A!, { daysAgo: 1 });
    otherThesis = await publishedThesis(ids.C!, { daysAgo: 1 });
    // fixture rows carry no real terms; as a committed thesis its proofs are the (unreachable) on-chain read only
    await h.deps.db.sys(`UPDATE theses SET chain_status = 'committed' WHERE id = $1`, [otherThesis]);
  });

  it("drafts are saved unpublished and permanently labelled with the declared model and client", async () => {
    const r = await agent(writer, "POST", "/theses", { asset: "BNB", direction: "LONG", targetPrice: "999", invalidationPrice: "100", horizonHours: 48, title: "Agent draft", summary: "Agent drafted thesis for operator review" }, { "x-atlas-agent-model": "claude-x", "x-atlas-agent-client": "claude-desktop" });
    expect(r.status).toBe(200);
    expect(r.body.chainStatus ?? r.body.chain_status ?? r.body.thesis?.chainStatus).toBe("draft");
    const id = r.body.id ?? r.body.thesis?.id;
    const t = (await A.get(`/theses/${id}`)).body;
    expect(t.authorType).toBe("agent");
    expect(t.agent).toMatchObject({ agentName: "writer", model: "claude-x", client: "claude-desktop" });
    // nobody (not even the operator via SQL) can strip or swap the attribution
    await expect(h.deps.db.sys(`UPDATE theses SET agent_attribution_id = NULL WHERE id = $1`, [id])).rejects.toThrow();
    await expect(h.deps.db.sys(`UPDATE agent_attributions SET model = 'human' WHERE subject_id = $1`, [id])).rejects.toThrow();
    // research sharing (auto-posting) is off for agents
    expect((await agent(writer, "POST", "/research/analyze", { asset: "BNB", share: true })).body.error).toBe("AGENT_SHARE_DISABLED");
    // publication is only ever an UNSIGNED transaction + baw preview for the operator
    const prep = await agent(writer, "POST", `/theses/${id}/prepare`);
    expect(prep.status).toBe(200);
    expect(prep.body.transaction.data).toMatch(/^0x/);
    expect(prep.body.baw.preview).toMatch(/^baw contract-call preview/);
    expect(JSON.stringify(prep.body)).not.toMatch(/signature|txHash/i);
  });

  it("reviews, challenges and verifications are attributed; agents cannot act on their operator's own theses", async () => {
    expect((await agent(writer, "POST", `/theses/${opThesis}/reviews`, { stance: "ENDORSE", body: "self", onchain: false })).body.error).toBe("SELF_REVIEW");
    expect((await agent(writer, "POST", `/theses/${opThesis}/challenges`, { kind: "ThesisContent", reason: "self challenge text" })).status).toBe(403);
    expect((await agent(writer, "POST", `/theses/${opThesis}/verifications`, { note: "" })).status).toBe(403);
    const rv = await agent(writer, "POST", `/theses/${otherThesis}/reviews`, { stance: "DISPUTE", body: "Funding flipped negative; target needs a 40% move in 72h.", onchain: true });
    expect(rv.status).toBe(200);
    expect(rv.body.onchain).toBeNull(); // agent reviews never produce on-chain review txs
    // the human operator still has their own review slot
    expect((await A.post(`/theses/${otherThesis}/reviews`, { stance: "NEUTRAL", body: "Human view", onchain: false })).status).toBe(200);
    expect((await agent(writer, "POST", `/theses/${otherThesis}/reviews`, { stance: "DISPUTE", body: "again", onchain: false })).body.error).toBe("ALREADY_REVIEWED");
    expect((await agent(writer, "POST", `/theses/${otherThesis}/challenges`, { kind: "MarketData", reason: "Reference candle looks off by one interval" })).status).toBe(200);
    const v = await agent(writer, "POST", `/theses/${otherThesis}/verifications`, { note: "re-ran proofs" });
    expect(v.status).toBe(200);
    expect(["consistent", "inconsistent", "inconclusive"]).toContain(v.body.verdict);
    const th = (await new Client(h).get(`/theses/${otherThesis}/thread`)).body;
    expect(th.participants).toEqual({ humans: 2, agents: 3 });
    const agentItems = th.entries.filter((e: any) => e.authorType === "agent");
    expect(agentItems.map((e: any) => e.kind).sort()).toEqual(["challenge", "review", "verification"]);
    expect(agentItems.every((e: any) => e.agent.agentName === "writer" && e.agent.label)).toBe(true);
    await expect(h.deps.db.sys(`UPDATE evidence_verifications SET verdict = 'consistent' WHERE thesis_id = $1`, [otherThesis])).rejects.toThrow();
  });

  it("agent forecasts rank only on AI Analysts and never leak into human Skill Score or Points", async () => {
    const pointsBefore = (await A.get("/points/me")).body.xp;
    const [ag] = await h.deps.db.sys(`SELECT a.id, t.id AS token_id FROM agents a JOIN agent_tokens t ON t.agent_id = a.id WHERE a.operator_id = $1 AND a.name = 'writer' LIMIT 1`, [ids.A]);
    for (let i = 0; i < 12; i++) {
      const attr = (await h.deps.db.sys(`SELECT gen_random_uuid() AS id`))[0].id;
      const tid = await publishedThesis(ids.A!, { daysAgo: 3 + i * 7, outcome: i % 4 === 3 ? "InvalidationHit" : "TargetHit", attr });
      await h.deps.db.sys(`INSERT INTO agent_attributions (id, agent_id, token_id, operator_id, agent_name, model, client, subject_kind, subject_id) VALUES ($1,$2,$3,$4,'writer','m','c','thesis',$5)`, [attr, ag.id, ag.token_id, ids.A, tid]);
    }
    const human = (await A.get(`/users/${ids.A}/score-breakdown?window=all`)).body;
    expect(human.sample.resolved ?? human.sample.total ?? 0).toBeLessThanOrEqual(1); // only the single human fixture
    const board = (await A.get("/leaderboards/analysts?window=all")).body;
    expect([...board.entries, ...board.unranked].some((e: any) => e.profile?.userId === ids.A && e.resolved > 1)).toBe(false);
    const ai = (await A.get("/leaderboards/ai-analysts?window=all")).body;
    const mine = [...ai.entries, ...ai.unranked].find((e: any) => e.agent?.name === "writer");
    expect(mine).toBeTruthy();
    expect(mine.resolved).toBe(12);
    expect(ai.separation).toMatch(/never count toward the human/);
    const pointsAfter = (await A.get("/points/me")).body;
    expect(pointsAfter.xp).toBe(pointsBefore);
    expect(pointsAfter.byKind.map((k: any) => k.kind)).not.toContain("review");
    // published agent forecasts can never be deleted (losses included)
    const [loss] = await h.deps.db.sys(`SELECT t.id FROM theses t WHERE t.agent_attribution_id IS NOT NULL AND t.outcome = 'InvalidationHit' LIMIT 1`);
    await expect(h.deps.db.sys(`DELETE FROM theses WHERE id = $1`, [loss.id])).rejects.toThrow();
  });
});

describe("agent payments", () => {
  it("prepare_payment resolves one exact name and returns only unsigned steps (or the baw fallback); no directory", async () => {
    const t = await mkToken(A, ["pay:prepare"], { agentName: "payer" });
    const [rcpt] = await h.deps.db.sys(`SELECT agent_name FROM profiles WHERE user_id = $1`, [ids.C]);
    expect((await agent(t.token, "POST", "/pay/agent/prepare", { recipient: "nobody-here.ai", asset: "USDT", amount: "1" })).status).toBe(404);
    expect((await agent(t.token, "POST", "/pay/agent/prepare", { recipient: rcpt.agent_name.slice(0, 3), asset: "USDT", amount: "1" })).status).toBe(404); // no partial match
    expect((await agent(t.token, "GET", "/pay/recipient?q=a")).body.error).toBe("AGENT_ROUTE_NOT_ALLOWED");
    const r = await agent(t.token, "POST", "/pay/agent/prepare", { recipient: rcpt.agent_name, asset: "USDT", amount: "1", context: { kind: "dm", id: "00000000-0000-0000-0000-000000000000" } });
    expect(r.body.error).toBe("BAD_CONTEXT");
    const ok = await agent(t.token, "POST", "/pay/agent/prepare", { recipient: rcpt.agent_name, asset: "USDT", amount: "1" });
    expect(ok.status).toBe(200);
    expect(["prepared", "pending"]).toContain(ok.body.status);
    expect(ok.body.operatorAction).toMatch(/cannot sign|runs these baw commands/);
    expect(JSON.stringify(ok.body)).not.toMatch(/"txHash"|"signature"/);
  });
});

describe("MCP server (real MCP client over Streamable HTTP)", () => {
  let base: string;
  beforeAll(async () => {
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(h.app.server.address() as AddressInfo).port}`;
  });
  const connect = async (token?: string) => {
    const c = new McpClient({ name: "atlas-test-client", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), "x-atlas-agent-client": "mcp-test" } } }));
    return c;
  };

  it("rejects connections without an agent token", async () => {
    await expect(connect()).rejects.toThrow();
    const info = await fetch(`${base}/mcp/info`).then((r) => r.json());
    expect(info.tools).toEqual([...TOOL_NAMES]);
  });

  it("lists every tool with schemas and runs read and scoped write tools through the same API controls", async () => {
    const ro = await mkToken(A, ["reputation:read", "research:read"], { agentName: "mcpro" });
    const c = await connect(ro.token);
    const tools = (await c.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.find((t) => t.name === "draft_thesis")!.inputSchema.required).toEqual(expect.arrayContaining(["asset", "direction", "targetPrice", "invalidationPrice"]));
    const who = await c.callTool({ name: "whoami", arguments: {} });
    expect(JSON.parse((who.content as any)[0].text).agent.name).toBe("mcpro");
    const board = await c.callTool({ name: "search_analysts", arguments: { board: "ai-analysts", window: "all" } });
    expect(board.isError).toBeFalsy();
    expect(JSON.parse((board.content as any)[0].text).board).toBe("ai-analysts");
    const denied = await c.callTool({ name: "draft_thesis", arguments: { asset: "BNB", direction: "LONG", targetPrice: "999", invalidationPrice: "100", horizonHours: 24, title: "nope", summary: "should be denied by scope" } });
    expect(denied.isError).toBe(true);
    expect((denied.content as any)[0].text).toContain("AGENT_SCOPE_MISSING");
    await c.close();
    const log = (await A.get(`/agents/audit?tokenId=${ro.id}`)).body.entries;
    expect(log.some((e: any) => e.tool === "search_analysts" && e.outcome === "ok")).toBe(true);
    expect(log.some((e: any) => e.tool === "draft_thesis" && e.outcome === "denied")).toBe(true);
    // revoking the token cuts the MCP session off on the next call
    await A.post(`/agents/tokens/${ro.id}/revoke`, {});
    await expect(connect(ro.token)).rejects.toThrow();
  });
});

describe("per-token rate limit", () => {
  let h2: Harness;
  afterAll(async () => { await h2?.close(); h = undefined as any; });
  it("limits each token independently and records rate_limited in the audit log", async () => {
    await h.close();
    h2 = await harness({ AGENT_RATE_LIMIT_PER_MIN: "3" });
    h = h2;
    const op = new Client(h2); await op.login(uniq("rl"));
    const t1 = await mkToken(op, ["feed:read"]);
    const t2 = await mkToken(op, ["feed:read"], { agentName: "other" });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await agent(t1.token, "GET", "/feed")).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect((await agent(t2.token, "GET", "/feed")).status).toBe(200);
    const log = (await op.get(`/agents/audit?tokenId=${t1.id}`)).body.entries;
    expect(log.filter((e: any) => e.outcome === "rate_limited").length).toBe(2);
  });
});
