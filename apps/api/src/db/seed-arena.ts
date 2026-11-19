/**
 * ARENA DEMO SEED (local development only). Publishes extra theses for the demo holders through the real API on the
 * LOCAL anvil chain, then back-dates them and assigns DEMO outcomes so the Arena has something to render.
 * Every thesis touched here is flagged `simulated = true` and its evidence says "demo"; the API and UI label these
 * rows "Demo data". Refuses chain 56. Never run against a shared or production database.
 */
import type { FastifyInstance } from "fastify";
import { hashCanonical } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import { runArenaSnapshots } from "../lib/arena.js";

interface DemoUser { c: { req(method: string, url: string, payload?: unknown): Promise<any> }; id: string; p: { handle: string } }

// deterministic PRNG so the demo looks the same on every machine
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

const PLAN: Record<string, { n: number; winP: number; win: [number, number]; loss: [number, number]; spreadDays: number; conf: [number, number]; assets: string[] }> = {
  orion: { n: 32, winP: 0.64, win: [220, 620], loss: [-260, -110], spreadDays: 120, conf: [55, 72], assets: ["BNB", "CAKE", "BTC"] },
  vega: { n: 14, winP: 0.57, win: [180, 480], loss: [-220, -90], spreadDays: 85, conf: [50, 65], assets: ["BTC", "ETH"] },
  lyra: { n: 13, winP: 0.5, win: [300, 950], loss: [-520, -200], spreadDays: 70, conf: [60, 85], assets: ["ETH", "BNB"] },
  kepler: { n: 6, winP: 0.72, win: [250, 700], loss: [-180, -90], spreadDays: 24, conf: [52, 66], assets: ["CAKE", "BNB"] },
  nova: { n: 5, winP: 0.68, win: [160, 420], loss: [-150, -80], spreadDays: 18, conf: [45, 60], assets: ["BTC"] },
};
const REVIEW = "Checked the committed levels against the 4h structure: the invalidation sits below the last higher low and the target is the prior range high, so the risk is defined before entry and the horizon fits the setup.";

export async function seedArenaDemo(app: FastifyInstance, deps: Deps, users: DemoUser[], send: (u: DemoUser, tx: any) => Promise<string>, prices: Record<string, number>) {
  if (deps.contracts.chainId === 56 || deps.cfg.NODE_ENV === "production") throw new Error("arena demo seed refuses BSC mainnet / production");
  const r = rng(20261119);
  const between = ([a, b]: [number, number]) => a + (b - a) * r();
  const now = Math.floor(Date.now() / 1000);
  const [squad] = await deps.db.sys(`SELECT id FROM squads WHERE slug = 'bnb-structure'`);
  let count = 0;
  for (const u of users) {
    const key = Object.keys(PLAN).find((k) => u.p.handle === k);
    if (!key) continue;
    const plan = PLAN[key]!;
    for (let i = 0; i < plan.n; i++) {
      const asset = plan.assets[i % plan.assets.length]!;
      const p = prices[asset]!;
      const dp = p > 100 ? 2 : 4;
      const long = r() < 0.7;
      const t = 1 + (0.03 + r() * 0.08) * (long ? 1 : -1);
      const inv = 1 - (0.015 + r() * 0.04) * (long ? 1 : -1);
      const d = await u.c.req("POST", "/theses", {
        asset, direction: long ? "LONG" : "SHORT", targetPrice: (p * t).toFixed(dp), invalidationPrice: (p * inv).toFixed(dp), horizonHours: [48, 72, 96, 168][i % 4], confidence: Math.round(between(plan.conf)),
        title: `[Demo] ${asset} ${long ? "long" : "short"} setup #${i + 1}`, summary: "Local demo thesis for the Arena preview. Outcome is simulated, not evaluated from market data.", body: "Demo data (local development only).",
        ...(squad && (key === "orion" || key === "kepler") && i % 2 === 0 ? { squadId: squad.id } : {}),
      });
      const prep = await u.c.req("POST", `/theses/${d.thesis.id}/prepare`);
      const tx = await send(u, prep.transaction);
      await u.c.req("POST", `/theses/${d.thesis.id}/confirm`, { txHash: tx });
      // back-date and assign a DEMO outcome (clearly labelled; never evaluated from real prices)
      const resolvedAgo = Math.floor(((plan.n - i) / plan.n) * plan.spreadDays * 86_400 - r() * 86_400) + 3600;
      const publishedAgo = resolvedAgo + 2 * 86_400 + Math.floor(r() * 86_400);
      const win = r() < plan.winP;
      const unresolved = !win && r() < 0.04;
      const outcome = unresolved ? "Unresolved" : win ? "TargetHit" : r() < 0.85 ? "InvalidationHit" : "Expired";
      const ret = outcome === "Unresolved" ? null : Math.round(win ? between(plan.win) : between(plan.loss));
      const evidence = { demo: true, note: "Local demo seed outcome. Not evaluated from market data. Never shown outside local development.", thesisId: d.thesis.id, outcome, returnBps: ret };
      await deps.db.sys(`UPDATE theses SET simulated = true, published_at = to_timestamp($2), start_time = to_timestamp($2), created_at = to_timestamp($2),
          outcome = $3, return_bps = $4, resolved_at = ${outcome === "Unresolved" ? "to_timestamp($5)" : "to_timestamp($5)"}, evidence = $6, evidence_hash = $7, outcome_state = $8 WHERE id = $1`,
        [d.thesis.id, now - publishedAgo, outcome, ret, now - resolvedAgo, outcome === "Unresolved" ? null : evidence, outcome === "Unresolved" ? null : hashCanonical(evidence), i % 3 === 0 ? "Final" : "Evaluated"]);
      await deps.db.sys(`UPDATE posts SET created_at = to_timestamp($2) WHERE thesis_id = $1`, [d.thesis.id, now - publishedAgo]);
      count++;
    }
  }
  // substantive reviews on a few resolved theses (earn XP under the caps; one per thesis per reviewer)
  const resolved = await deps.db.sys(`SELECT id, author_id FROM theses WHERE simulated AND outcome <> 'Open' ORDER BY resolved_at DESC LIMIT 12`);
  for (const [i, t] of resolved.entries()) {
    const reviewer = users.filter((u) => u.id !== t.author_id)[i % (users.length - 1)]!;
    await reviewer.c.req("POST", `/theses/${t.id}/reviews`, { stance: i % 3 ? "ENDORSE" : "NEUTRAL", body: `${REVIEW} (${i + 1})` }).catch(() => {});
  }
  await deps.db.sys(`UPDATE theses SET simulated = true WHERE author_id = ANY($1::uuid[])`, [users.map((u) => u.id)]);
  // weekly backfilled snapshots so the Rank Journey has history (each labelled backfill + demo)
  for (let w = 10; w >= 1; w--) await runArenaSnapshots(deps, { asOf: now - w * 7 * 86_400, backfill: true });
  await runArenaSnapshots(deps);
  console.log(`arena demo: ${count} demo theses published on local chain ${deps.contracts.chainId}`);
}
