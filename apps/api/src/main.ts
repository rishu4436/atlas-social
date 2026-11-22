import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { createIndexer } from "./workers/indexer.js";
import { evaluateOpenTheses, runOutcomeProposals } from "./workers/outcomes.js";
import { recordRun, logAlert } from "./workers/runs.js";
import { runArenaSnapshots } from "./lib/arena.js";
import { reconcilePayTxs } from "./lib/paytx.js";
import { alertOnProblems } from "./lib/workers-health.js";
import { evaluatorAccount } from "./workers/outcomes.js";
import { mcpSelfCheck } from "./lib/mcp-health.js";

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
  const arena = () => void recordRun(deps, "arena-snapshots", async () => { await runArenaSnapshots(deps); return {}; }).catch((e) => app.log.warn(`arena snapshots failed: ${(e as Error).message}`));
  setTimeout(arena, 15_000).unref();
  setInterval(arena, 10 * 60_000).unref();
  // Reported payment txs (audit F3/F4): re-derive stages from the chain and release request locks of failed txs
  const payReconcile = () => void recordRun(deps, "pay-reconcile", () => reconcilePayTxs(deps), { detail: (r) => ({ ...r }) }).catch((e) => warn(`pay reconcile failed: ${(e as Error).message}`));
  setTimeout(payReconcile, 12_000).unref(); // startup reconciliation
  setInterval(payReconcile, 2 * 60_000).unref();
  // Watchdog (audit F5): one [atlas-alert] log line per problem (lag, failing/late workers, stuck proposals, evaluator balance/revocation)
  const evaluator = evaluatorAccount()?.address ?? null;
  const watch = () => void alertOnProblems(deps, { evaluator }).catch((e) => warn(`health watchdog failed: ${(e as Error).message}`));
  setTimeout(watch, 90_000).unref();
  setInterval(watch, 5 * 60_000).unref();
  // MCP gateway self-check (initialize + tools/list in-process): one [atlas-alert] line if the tool surface breaks
  const mcpCheck = () => void mcpSelfCheck().then((r) => { if (!r.ok) app.log.error({ event: "mcp-health", ...r }, "[atlas-alert] MCP gateway self-check failed"); else app.log.info({ event: "mcp-health", tools: r.tools, ms: r.ms }, "mcp self-check ok"); });
  setTimeout(mcpCheck, 20_000).unref();
  setInterval(mcpCheck, 10 * 60_000).unref();
  process.on("SIGTERM", () => { ac.abort(); void app.close().then(() => deps.db.close()); });
}
