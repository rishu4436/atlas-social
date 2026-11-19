import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { foundry } from "viem/chains";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { newHolder, loginViaUi } from "./helpers";

// Agent Gateway on the local stack: tokens are created in the real Settings UI, a real MCP client connects to the
// real /mcp endpoint with that token, and the operator publishes with their own (local) wallet. Nothing is faked.
const OUT = `${process.env.SHOTS_DIR ?? "../../docs/evidence/screenshots"}/agents`;
mkdirSync(OUT, { recursive: true });
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";

async function call(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ([p, b]) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("atlas_csrf="))?.split("=")[1] ?? "";
    const r = await fetch(`/api${p}`, { method: b ? "POST" : "GET", headers: { "content-type": "application/json", "x-atlas-csrf": csrf }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [path, body] as const);
}
async function signedIn(browser: Browser, prefix: string, viewport?: { width: number; height: number }) {
  const h = await newHolder(prefix);
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await loginViaUi(page, h);
  return { h, page, ctx, userId: (await call(page, "/auth/session")).userId as string };
}
async function send(h: { account: any }, tx: { to: Hex; data: Hex }) {
  const w = createWalletClient({ account: h.account, chain: foundry, transport: http(RPC) });
  const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
  expect((await createPublicClient({ chain: foundry, transport: http(RPC) }).waitForTransactionReceipt({ hash })).status).toBe("success");
  return hash;
}
async function mcp(token: string) {
  const c = new Client({ name: "e2e-mcp-client", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, "x-atlas-agent-client": "e2e-mcp-client", "x-atlas-agent-model": "e2e-test-model" } } }));
  const tool = async (name: string, args: Record<string, unknown> = {}) => { const r: any = await c.callTool({ name, arguments: args }); return { error: !!r.isError, text: r.content[0].text as string, json: r.isError ? null : JSON.parse(r.content[0].text) }; };
  return { c, tool };
}
async function createTokenInUi(page: Page, agentName: string, preset: RegExp) {
  await page.goto("/settings?tab=agents");
  await expect(page.getByTestId("agents-settings")).toBeVisible();
  await page.getByLabel("Agent name").fill(agentName);
  await page.getByLabel("Model (declared, optional)").fill("e2e-test-model");
  await page.getByRole("button", { name: preset }).click();
  await page.getByTestId("create-agent-token").click();
  const modal = page.getByTestId("token-created");
  await expect(modal).toBeVisible();
  const token = (await modal.locator("pre, code").first().innerText()).trim();
  expect(token).toMatch(/^atlas_agt_/);
  return token;
}

test("operator creates a scoped token in Settings, a real MCP client uses it, the audit log shows it, revoke cuts it off", async ({ browser }) => {
  const op = await signedIn(browser, "agentop");
  const page = op.page;
  const token = await createTokenInUi(page, "e2e-scout", /research analyst/i);
  await expect(page.getByTestId("token-created")).toContainText("shown once");
  await page.getByRole("tab", { name: "Cursor" }).click().catch(() => page.getByText("Cursor", { exact: true }).click());
  await page.waitForTimeout(500);
  // the token is a throwaway on the local stack, but never put a token in a committed image: mask it
  await page.screenshot({ path: `${OUT}/01-token-created.png`, mask: [page.getByTestId("token-created").locator("pre")], maskColor: "#1b1f2a" });
  await page.getByRole("button", { name: /stored it safely/i }).click();
  await expect(page.getByTestId("agent-token-row").first()).toContainText("e2e-scout");

  const { c, tool } = await mcp(token);
  const names = (await c.listTools()).tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["search_analysts", "draft_thesis", "prepare_thesis_publication", "verify_evidence"]));
  expect((await tool("whoami")).json.agent.name).toBe("e2e-scout");
  expect((await tool("search_analysts", { board: "analysts", window: "all" })).error).toBe(false);
  const denied = await tool("prepare_payment", { recipient: "x.ai", asset: "USDT", amount: "1" });
  expect(denied.error).toBe(true);
  expect(denied.text).toContain("AGENT_SCOPE_MISSING");
  await c.close();

  await page.reload();
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await expect(page.getByTestId("agent-audit")).toContainText("search_analysts");
  await expect(page.getByTestId("agent-audit")).toContainText("AGENT_SCOPE_MISSING");
  await page.getByTestId("agent-audit").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-tokens-and-audit-log.png`, fullPage: true });

  await page.getByTestId("revoke-token").first().click();
  await page.getByTestId("confirm-revoke").click();
  await expect(page.getByTestId("agent-token-row").first()).toContainText("revoked");
  const r = await fetch(`${API}/agents/me`, { headers: { authorization: `Bearer ${token}` } });
  expect(r.status).toBe(401);
  expect((await r.json()).error).toBe("AGENT_TOKEN_REVOKED");
  await op.ctx.close();
});

test("agent badges + research thread: an agent drafts, the operator publishes with their own wallet, another agent reviews and verifies", async ({ browser }) => {
  const a = await signedIn(browser, "agauthor");
  const b = await signedIn(browser, "agreviewer");
  const tokA = await createTokenInUi(a.page, "draft-bot", /research analyst/i);
  const tokB = await createTokenInUi(b.page, "verify-bot", /research analyst/i);

  // agent A drafts; ATLAS returns only an unsigned tx + baw preview; the operator signs locally
  const A = await mcp(tokA);
  const price = (await A.tool("get_market", { asset: "BNB" })).json.ticker.lastPrice as number;
  const d = await A.tool("draft_thesis", { asset: "BNB", direction: "LONG", targetPrice: (price * 1.05).toFixed(2), invalidationPrice: (price * 0.97).toFixed(2), horizonHours: 72, confidence: 57, title: "Agent-drafted BNB continuation", summary: "Higher lows with expanding volume; invalidated below the last swing low (e2e)." });
  expect(d.error).toBe(false);
  const id = d.json.thesis.id as string;
  await a.page.goto(`/thesis/${id}`);
  await expect(a.page.getByTestId("agent-badge").first()).toBeVisible();
  await expect(a.page.getByTestId("agent-draft-notice")).toBeVisible();
  await a.page.screenshot({ path: `${OUT}/03-agent-draft-operator-review.png` });
  const prep = await A.tool("prepare_thesis_publication", { thesisId: id });
  expect(prep.error, prep.text).toBe(false);
  expect(prep.json.baw.preview).toMatch(/^baw contract-call preview/);
  const tx = await send(a.h, prep.json.transaction);
  expect((await call(a.page, `/theses/${id}/confirm`, { txHash: tx })).ok ?? true).toBeTruthy();
  await A.c.close();

  // agent B (another operator) reviews and verifies; agent B cannot act on its own operator's work
  const B = await mcp(tokB);
  expect((await B.tool("post_review", { thesisId: id, stance: "DISPUTE", body: "Invalidation sits inside one daily ATR on the reference candles; a 5% target in 72h needs a volume expansion that has not shown up yet." })).error).toBe(false);
  const v = await B.tool("verify_evidence", { thesisId: id, note: "re-ran ATLAS proof checks" });
  expect(["consistent", "inconsistent", "inconclusive"]).toContain(v.json.verdict);
  await B.c.close();
  // a human also weighs in
  await call(b.page, `/theses/${id}/reviews`, { stance: "NEUTRAL", body: "Human take: fair setup, but I'd wait for the daily close." }).catch(() => {});

  const p = a.page;
  await p.goto(`/thesis/${id}`);
  await expect(p.getByTestId("agent-badge").first()).toBeVisible();
  await p.getByTestId("agent-badge").first().hover();
  await expect(p.getByTestId("agent-badge-detail")).toContainText("e2e-test-model");
  await p.screenshot({ path: `${OUT}/04-agent-badge-on-thesis.png` });
  await p.getByRole("tab", { name: /research thread/i }).click().catch(() => p.getByText("Research thread", { exact: true }).click());
  const thread = p.getByTestId("research-thread");
  await expect(thread).toBeVisible();
  await expect(thread.getByTestId("thread-verification")).toBeVisible();
  await expect(thread.getByTestId("thread-review").first()).toBeVisible();
  await expect(thread).toContainText("verify-bot");
  await thread.scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/05-research-thread.png`, fullPage: true });

  // feed card carries the badge
  await p.goto("/home");
  await p.getByRole("button", { name: "Chronological feed" }).click();
  await expect(p.getByTestId("agent-badge").first()).toBeVisible({ timeout: 15_000 });
  await p.screenshot({ path: `${OUT}/06-feed-agent-badge.png` });

  // AI Analysts board is separate and honest (the new thesis is open, so it is not scored yet)
  await p.goto("/arena?tab=ai-analysts&window=all");
  await expect(p.getByTestId("ai-board-separation")).toContainText("never count toward the human");
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/07-arena-ai-analysts.png` });
  await a.ctx.close(); await b.ctx.close();
});

test("landing: The Social Intelligence Network for Humans and AI Agents", async ({ page }) => {
  await page.goto("/welcome");
  const s = page.getByTestId("landing-agents");
  await s.scrollIntoViewIfNeeded();
  await expect(s.getByRole("heading", { name: /social intelligence network for humans and ai agents/i })).toBeVisible();
  await page.waitForTimeout(1600);
  await s.screenshot({ path: `${OUT}/08-landing-agents.png` });
});

test("@mobile agents settings + landing on a phone", async ({ browser }) => {
  const op = await signedIn(browser, "agmob", { width: 412, height: 915 });
  await op.page.goto("/settings?tab=agents");
  await expect(op.page.getByTestId("agents-settings")).toBeVisible();
  await op.page.waitForTimeout(500);
  await op.page.screenshot({ path: `${OUT}/09-mobile-agents-settings.png` });
  await op.page.goto("/welcome");
  await op.page.getByTestId("landing-agents").scrollIntoViewIfNeeded();
  await op.page.waitForTimeout(1500);
  await op.page.screenshot({ path: `${OUT}/10-mobile-landing-agents.png` });
  await op.ctx.close();
});
