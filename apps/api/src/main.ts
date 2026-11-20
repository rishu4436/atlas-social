import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { createIndexer } from "./workers/indexer.js";
import { evaluateOpenTheses, runOutcomeProposals } from "./workers/outcomes.js";
import { recordRun, logAlert } from "./workers/runs.js";
import { runArenaSnapshots } from "./lib/arena.js";

const cfg = loadConfig();
console.log(`[atlas] starting api: env=${cfg.NODE_ENV} chain=${cfg.CHAIN_ID} port=${cfg.PORT}`);
await migrate(cfg.DATABASE_URL, { log: (m) => console.log(m), appPassword: process.env.APP_DB_PASSWORD });
console.log("[atlas] migrations ok");
const deps = await createDeps(cfg);
const app = await buildApp(deps, { logger: true });
await app.listen({ host: cfg.HOST, port: cfg.PORT });

if (cfg.RUN_WORKERS) {
  const ac = new AbortController();
  if (deps.contracts.atlasDeployed || deps.contracts.payDeployed) {
    void createIndexer(deps).run({ signal: ac.signal, pollMs: 3000, log: (m) => app.log.warn(m) });
  }
  // Outcome evaluation + durable proposal outbox (audit 2026-11-20 F1/F5). The outbox lives in Postgres, so a restart
  // or a sleeping free-tier instance loses nothing: the first pass after boot reconciles every in-flight tx by receipt.
  const warn = (m: string) => app.log.warn(m);
  const proposals = () => void recordRun(deps, "outcome-proposals", () => runOutcomeProposals(deps, { log: warn, alert: logAlert, rebroadcastAfterS: 90 }), { detail: (r) => ({ ...r }) }).catch((e) => warn(`outcome proposals failed: ${(e as Error).message}`));
  const evaluate = () => void recordRun(deps, "outcome-evaluator", () => evaluateOpenTheses(deps, { log: warn }), { detail: (r) => ({ ...r }) }).then(proposals).catch((e) => warn(`outcome evaluation failed: ${(e as Error).message}`));
  setTimeout(proposals, 10_000).unref(); // startup reconciliation
  setTimeout(evaluate, 30_000).unref();
  setInterval(evaluate, 5 * 60_000).unref();
  setInterval(proposals, 2 * 60_000).unref();
  // Arena: idempotent, versioned snapshot job (a new snapshot is stored only when a board's result changes)
  const arena = () => void runArenaSnapshots(deps).catch((e) => app.log.warn(`arena snapshots failed: ${(e as Error).message}`));
  setTimeout(arena, 15_000).unref();
  setInterval(arena, 10 * 60_000).unref();
  process.on("SIGTERM", () => { ac.abort(); void app.close().then(() => deps.db.close()); });
}
