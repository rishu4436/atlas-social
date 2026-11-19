// Smoke test + screenshots for a deployed (or production-config) ATLAS stack. Read-only: no sign-in, no transactions.
// Usage: BASE_URL=https://<web> API_URL=https://<api> OUT=../../docs/evidence/live node live-smoke.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const API = process.env.API_URL ?? `${BASE}/api`;
const OUT = process.env.OUT ?? "../../docs/evidence/live";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = async (name, fn) => { try { const d = await fn(); results.push({ name, ok: true, d }); } catch (e) { results.push({ name, ok: false, d: e.message.slice(0, 200) }); } };
const j = async (p, init) => { const r = await fetch(`${API}${p}`, init); const b = await r.json(); return { status: r.status, b }; };

await check("api /health", async () => { const { status, b } = await j("/health"); if (status !== 200 || !b.ok || b.chainId !== 56) throw new Error(JSON.stringify(b)); return `db=${b.db} chain=${b.chainId} market=${b.marketData}`; });
await check("api /config (official Agent ID, contracts pending honest)", async () => { const { b } = await j("/config"); if (b.contracts.agentId !== "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F" || b.agentIdIsMock) throw new Error("wrong registry"); return `contractsDeployed=${b.contractsDeployed} simulated=${b.marketData.simulated}`; });
await check("api /markets (live)", async () => { const { b } = await j("/markets"); if (b.simulated || !b.items?.length) throw new Error("no live data"); return b.items.map((i) => `${i.asset}=${i.ticker?.lastPrice}`).join(" "); });
await check("api /trade/quotes (PancakeSwap read-only)", async () => { const { status, b } = await j("/trade/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenIn: "BNB", tokenOut: "USDT", amountIn: "0.1", slippageBps: 50 }) }); if (status !== 200 || !b.quotedOnly) throw new Error(JSON.stringify(b).slice(0, 200)); return `0.1 BNB -> ${b.amountOut ?? b.expectedOut ?? JSON.stringify(b).match(/"amountOut[^,]*/)?.[0]}`; });
await check("api non-holder is refused", async () => { const { status, b } = await j("/auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: "0x000000000000000000000000000000000000dEaD" }) }); if (status !== 403 || b.error !== "NOT_AGENT_ID_HOLDER" || b.details?.action !== "claim") throw new Error(`${status} ${JSON.stringify(b).slice(0, 160)}`); return `${b.error} action=${b.details.action}`; });
await check("api /auth/errors (onboarding error catalog)", async () => { const { status, b } = await j("/auth/errors"); const need = ["EXPIRED", "SIGNER_MISMATCH", "NOT_AGENT_ID_HOLDER", "SIGNATURE_TRUNCATED", "CHAIN_MISMATCH", "BAW_953004", "ERC1271_REJECTED", "RATE_LIMITED"]; if (status !== 200 || need.some((k) => !b.codes?.[k])) throw new Error(JSON.stringify(b).slice(0, 160)); return `${Object.keys(b.codes).length} codes, ttl=${b.challengeTtlSeconds}s, 953004->fallback=${b.codes.BAW_953004.fallback}`; });

// ATLAS Pay (read-only): honest pending state until AtlasPay is deployed; resolve is not an open lookup; no fake requests
await check("api /pay/config (honest status + baw fallback)", async () => { const { status, b } = await j("/pay/config"); if (status !== 200 || b.chainId !== 56 || !["pending", "deployed"].includes(b.status) || !b.fallback?.available) throw new Error(JSON.stringify(b).slice(0, 200)); const usdt = b.assets?.find((a) => a.symbol === "USDT"); if (usdt?.address !== "0x55d398326f99059fF775485246999027B3197955" || usdt.isMock) throw new Error("USDT must be BSC USDT, not a mock"); if (b.status === "pending" && b.contract) throw new Error("pending but has contract"); return `status=${b.status} contract=${b.contract ?? "none"} assets=${b.assets.map((a) => a.symbol).join("+")}`; });
await check("api /pay/recipient refuses anonymous callers (no address lookup)", async () => { const { status, b } = await j("/pay/recipient", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientUserId: "00000000-0000-4000-8000-000000000000" }) }); if (status !== 401 && status !== 403) throw new Error(`${status} ${JSON.stringify(b).slice(0, 120)}`); return `${status} ${b.error}`; });
await check("api /pay/prepare refuses anonymous callers", async () => { const { status, b } = await j("/pay/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientUserId: "00000000-0000-4000-8000-000000000000", expectedRecipient: "0x000000000000000000000000000000000000dEaD", asset: "BNB", amount: "0.01", kind: "direct", context: { kind: "profile" } }) }); if (status !== 401 && status !== 403) throw new Error(`${status} ${JSON.stringify(b).slice(0, 120)}`); return `${status} ${b.error}`; });
await check("api /pay/requests/<unknown> is 404", async () => { const { status } = await j(`/pay/requests/${crypto.randomUUID()}`); if (status !== 404) throw new Error(`HTTP ${status}`); return "404"; });
await check("api /pay/receipts needs a session", async () => { const { status } = await j("/pay/receipts"); if (status !== 401) throw new Error(`HTTP ${status}`); return "401"; });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
for (const [vp, size] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 412, height: 915 }]]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: vp === "mobile" ? 2 : 1 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const pages = vp === "desktop" ? [["welcome", "/welcome"], ["onboarding", "/onboarding"], ["onboarding-guide", "/onboarding/guide"], ["home", "/home"], ["markets", "/markets"], ["market-bnb", "/markets/BNB"], ["trade-bnb", "/trade/BNB"], ["explore", "/explore"], ["performance", "/performance"], ["pay", "/pay"], ["pay-request-missing", `/pay/r/${"00000000-0000-4000-8000-000000000000"}`]] : [["welcome", "/welcome"], ["onboarding", "/onboarding"], ["home", "/home"], ["trade-bnb", "/trade/BNB"], ["pay", "/pay"]];
  for (const [name, path] of pages) {
    await check(`web ${vp} ${path}`, async () => {
      const r = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 90_000 });
      if (!r || r.status() >= 400) throw new Error(`HTTP ${r?.status()}`);
      await page.waitForTimeout(3500);
      const body = await page.locator("body").innerText();
      if (/Application error|Internal Server Error/.test(body)) throw new Error("error page");
      const flags = [];
      if (!/^\/(welcome|onboarding)/.test(path) && /pending deployment/i.test(body)) flags.push("beta-banner");
      if (/^\/pay\/r\//.test(path) && !/unavailable|not found/i.test(body)) throw new Error("missing request should say so");
      if (/^\/pay\/r\//.test(path) && /0x[0-9a-fA-F]{40}/.test(body)) throw new Error("request page exposes an address");
      if (/risk|not financial advice/i.test(body)) flags.push("risk-text");
      await page.screenshot({ path: `${OUT}/${vp}-${name}.png` });
      return `${r.status()} ${flags.join(",")}`;
    });
  }
  if (vp === "desktop") {
    // read-only wizard check: a wallet without an Agent ID is refused with a clear message (no account, no record of success)
    await check("web /onboarding wizard refuses a non-holder with a mapped error", async () => {
      await page.goto(`${BASE}/onboarding`, { waitUntil: "load", timeout: 90_000 });
      await page.getByRole("button", { name: /i'm ready/i }).click();
      await page.getByLabel("Agent ID wallet address").fill("0x000000000000000000000000000000000000dEaD");
      await page.getByRole("button", { name: /generate my commands/i }).click();
      const e = page.locator('[data-testid="auth-error"][data-code="NOT_AGENT_ID_HOLDER"]');
      await e.waitFor({ timeout: 90_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/desktop-onboarding-non-holder.png` });
      return (await e.innerText()).split("\n")[0];
    });
  }
  if (errors.length) results.push({ name: `${vp} page errors`, ok: false, d: errors.slice(0, 3).join(" | ") });
  await page.close();
}
await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.d ?? ""}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
