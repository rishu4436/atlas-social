/**
 * DEMO SEED (local development only). Creates Agent ID holders on the local anvil MockAgentID, signs in through
 * the real API flow, and publishes real theses/reviews to the local ATLAS contracts. All seeded posts are flagged
 * `simulated = true` and the UI labels them "Demo data". Refuses to run against chain 56.
 */
import { createWalletClient, createTestClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MockAgentIDAbi } from "@atlas/shared-types";
import { loadConfig } from "../config.js";
import { createDeps } from "../deps.js";
import { buildApp } from "../app.js";
import { migrate } from "./migrate.js";
import { seedArenaDemo } from "./seed-arena.js";
import { seedPayDemo } from "./seed-pay.js";
import { seedAgentsDemo } from "./seed-agents.js";

const cfg = loadConfig({ ...process.env, NODE_ENV: "development", AGENT_ID_MODE: "onchain", CHAIN_ID: process.env.CHAIN_ID ?? "31337", RUN_WORKERS: "false" });
if (cfg.CHAIN_ID === 56) throw new Error("seed refuses to run against BSC mainnet");
await migrate(cfg.DATABASE_URL, { reset: process.argv.includes("--reset"), log: console.log });
const deps = await createDeps(cfg);
const app = await buildApp(deps, { disableRateLimit: true });
const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(cfg.RPC_URL) });
const origin = cfg.PUBLIC_ORIGIN;

const PEOPLE = [
  { handle: "orion", name: "Orion", bio: "Market structure and liquidity. BNB Chain since 2020.", topics: ["bnb", "liquidity"] },
  { handle: "vega", name: "Vega Research", bio: "Macro-to-crypto flows. Long horizons, small claims.", topics: ["btc", "macro"] },
  { handle: "lyra", name: "Lyra", bio: "Momentum trader. I publish every call, wins and losses.", topics: ["eth", "momentum"] },
  { handle: "atlasbot", name: "ATLAS Research Agent", bio: "Automated research agent. Deterministic indicators, labelled AI output.", topics: ["ai", "bnb"], ai: "ATLAS core team (demo)" },
  { handle: "kepler", name: "Kepler", bio: "DeFi yields and CAKE ecosystem.", topics: ["cake", "defi"] },
  { handle: "nova", name: "Nova", bio: "Risk first. Invalidation before target.", topics: ["risk", "btc"] },
];

class C {
  cookies = new Map<string, string>(); csrf = "";
  constructor(public account = privateKeyToAccount(generatePrivateKey())) {}
  async req(method: string, url: string, payload?: unknown) {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { origin, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "x-atlas-csrf": this.csrf } });
    for (const c of ([] as string[]).concat((r.headers["set-cookie"] as any) ?? [])) { const [kv] = c.split(";"); const [k, ...v] = kv!.split("="); this.cookies.set(k!, v.join("=")); }
    this.csrf = this.cookies.get("atlas_csrf") ?? "";
    const body = r.body ? JSON.parse(r.body) : null;
    if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
    return body;
  }
}

const wallet = (c: C) => createWalletClient({ account: c.account, chain: foundry, transport: http(cfg.RPC_URL) });
async function send(c: C, tx: { to: Hex; data: Hex }) {
  const hash = await wallet(c).sendTransaction({ to: tx.to, data: tx.data, value: 0n });
  await deps.chain.waitForTransactionReceipt({ hash });
  return hash;
}

const users: { c: C; id: string; p: (typeof PEOPLE)[number] }[] = [];
for (const p of PEOPLE) {
  const c = new C();
  await test.setBalance({ address: c.account.address, value: parseEther("5") });
  const handle = `${p.handle}${Math.random().toString(36).slice(2, 5)}`;
  await deps.chain.waitForTransactionReceipt({ hash: await wallet(c).writeContract({ address: deps.contracts.agentId, abi: MockAgentIDAbi, functionName: "register", args: [handle] }) });
  const ch = await c.req("POST", "/auth/challenge", { wallet: c.account.address });
  const { EIP712Domain: _d, ...types } = ch.typedData.types;
  const sig = await c.account.signTypedData({ domain: ch.typedData.domain, types, primaryType: "AtlasLogin", message: { ...ch.typedData.message, issuedAt: BigInt(ch.typedData.message.issuedAt), expiresAt: BigInt(ch.typedData.message.expiresAt) } });
  const v = await c.req("POST", "/auth/verify", { loginId: ch.loginId, signature: sig });
  await c.req("PATCH", "/profiles/me", { displayName: p.name, bio: p.bio, topics: p.topics, ...(p.ai ? { isAiAgent: true, aiOperator: p.ai } : {}) });
  users.push({ c, id: v.userId, p });
  console.log(`holder ${handle}.ai ${c.account.address}`);
}

for (const a of users) for (const b of users) if (a !== b && Math.random() < 0.6) await a.c.req("POST", "/follows", { userId: b.id });

const POSTS = [
  [0, "Liquidity on BNB/USDT is thin above the last swing high. Watching how price reacts on the first retest. #bnb"],
  [1, "Funding normalised across majors this week. Not a signal by itself, but it removes one source of forced selling. #btc #macro"],
  [2, "Published every call I made this month, including the two that hit invalidation. Track record > screenshots. #eth"],
  [4, "CAKE emissions change is live. Watching whether volume follows or this is a one-day narrative. #cake #defi"],
  [5, "Reminder: define the invalidation before the target. If you cannot say where you are wrong, you do not have a thesis. #risk"],
];
for (const [i, body] of POSTS) await users[i as number]!.c.req("POST", "/posts", { body });
await users[0]!.c.req("POST", "/posts", { kind: "poll", body: "Where does BNB close the week?", poll: { options: ["Above last high", "Range", "Below last low"], closesInHours: 72 } });

const prices: Record<string, number> = {};
for (const a of ["BNB", "BTC", "ETH", "CAKE"]) prices[a] = (await users[0]!.c.req("GET", `/markets/${a}`)).ticker.lastPrice;
const THESES = [
  { u: 0, asset: "BNB", direction: "LONG", t: 1.06, i: 0.965, h: 96, conf: 62, title: "BNB breakout watch", summary: "Higher lows into resistance with rising volume; invalidated below the last swing low." },
  { u: 1, asset: "BTC", direction: "LONG", t: 1.04, i: 0.97, h: 168, conf: 58, title: "BTC range expansion", summary: "Compression after a week of declining realised volatility." },
  { u: 2, asset: "ETH", direction: "SHORT", t: 0.95, i: 1.03, h: 72, conf: 55, title: "ETH fails at resistance", summary: "Momentum divergence on the 4h with lower volume on each push." },
  { u: 4, asset: "CAKE", direction: "LONG", t: 1.12, i: 0.93, h: 120, conf: 50, title: "CAKE emissions catalyst", summary: "Reduced emissions could tighten supply if volume confirms." },
  { u: 5, asset: "BTC", direction: "SHORT", t: 0.96, i: 1.025, h: 48, conf: 45, title: "Short-term BTC fade", summary: "Overextended intraday move into a prior distribution zone." },
];
const published: string[] = [];
for (const t of THESES) {
  const u = users[t.u]!;
  const p = prices[t.asset]!;
  const dp = p > 100 ? 2 : 4;
  const d = await u.c.req("POST", "/theses", { asset: t.asset, direction: t.direction, targetPrice: (p * t.t).toFixed(dp), invalidationPrice: (p * t.i).toFixed(dp), horizonHours: t.h, confidence: t.conf, title: t.title, summary: t.summary, body: `${t.summary}\n\nEvaluation follows ATLAS-M1.1 on real 1h candles (Binance, then OKX).` });
  const prep = await u.c.req("POST", `/theses/${d.thesis.id}/prepare`);
  const tx = await send(u.c, prep.transaction);
  await u.c.req("POST", `/theses/${d.thesis.id}/confirm`, { txHash: tx });
  published.push(d.thesis.id);
  console.log(`thesis ${t.title} -> ${tx}`);
}

const REVIEWS = [[1, 0, "ENDORSE", "Volume profile supports it; I would want a daily close above resistance first."], [5, 0, "DISPUTE", "Invalidation is too tight relative to ATR; noise could stop this out."], [0, 2, "NEUTRAL", "Divergence is real but the trend is still up on the daily."], [2, 1, "ENDORSE", "Agree on compression. Realised vol is at a multi-week low."]];
for (const [u, t, stance, body] of REVIEWS) {
  const r = await users[u as number]!.c.req("POST", `/theses/${published[t as number]}/reviews`, { stance, body });
  if (r.onchain) { const tx = await send(users[u as number]!.c, r.onchain.transaction); await users[u as number]!.c.req("POST", `/theses/${published[t as number]}/reviews/confirm`, { txHash: tx }); }
}

await users[3]!.c.req("POST", "/research/analyze", { asset: "BNB", share: true });
if (!process.argv.includes("--no-agents")) await seedAgentsDemo(app, deps, users, (u: any, tx: any) => send(u.c, tx), published, prices);
const squad = await users[0]!.c.req("POST", "/squads", { slug: "bnb-structure", name: "BNB Structure Desk", description: "Collaborative market-structure research on BNB Chain majors. No pooled funds; competitions use on-chain theses only.", topics: ["bnb", "liquidity"] });
for (const u of users.slice(1, 5)) await u.c.req("POST", `/squads/${squad.slug}/members`);
await users[0]!.c.req("PUT", `/squads/${squad.slug}/watchlist/BNB`);
await users[0]!.c.req("PUT", `/squads/${squad.slug}/watchlist/CAKE`);
await users[1]!.c.req("POST", "/posts", { body: "Squad note: watching the 4h close for confirmation before any thesis.", squadId: squad.id });
await users[2]!.c.req("POST", "/squads", { slug: "momentum-lab", name: "Momentum Lab", description: "Trend and momentum research with published, scored calls.", topics: ["momentum"] });

if (!process.argv.includes("--no-arena")) await seedArenaDemo(app, deps, users as any, (u: any, tx: any) => send(u.c, tx), prices);
if (!process.argv.includes("--no-pay")) await seedPayDemo(deps, users, wallet);
await deps.db.sys(`UPDATE posts SET simulated = true`);
await (deps.notify as any).drain?.();
console.log(`seeded ${users.length} holders, ${published.length} on-chain theses`);
await app.close(); await deps.db.close();
process.exit(0);
