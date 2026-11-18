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
await check("api non-holder is refused", async () => { const { status, b } = await j("/auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: "0x000000000000000000000000000000000000dEaD" }) }); if (status !== 403) throw new Error(`${status}`); return b.error; });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
for (const [vp, size] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 412, height: 915 }]]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: vp === "mobile" ? 2 : 1 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const pages = vp === "desktop" ? [["welcome", "/welcome"], ["home", "/home"], ["markets", "/markets"], ["market-bnb", "/markets/BNB"], ["trade-bnb", "/trade/BNB"], ["explore", "/explore"], ["performance", "/performance"]] : [["welcome", "/welcome"], ["home", "/home"], ["trade-bnb", "/trade/BNB"]];
  for (const [name, path] of pages) {
    await check(`web ${vp} ${path}`, async () => {
      const r = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 90_000 });
      if (!r || r.status() >= 400) throw new Error(`HTTP ${r?.status()}`);
      await page.waitForTimeout(3500);
      const body = await page.locator("body").innerText();
      if (/Application error|Internal Server Error/.test(body)) throw new Error("error page");
      const flags = [];
      if (path !== "/welcome" && /pending deployment/i.test(body)) flags.push("beta-banner");
      if (/risk|not financial advice/i.test(body)) flags.push("risk-text");
      await page.screenshot({ path: `${OUT}/${vp}-${name}.png` });
      return `${r.status()} ${flags.join(",")}`;
    });
  }
  if (errors.length) results.push({ name: `${vp} page errors`, ok: false, d: errors.slice(0, 3).join(" | ") });
  await page.close();
}
await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.d ?? ""}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
