import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { createIndexer } from "./workers/indexer.js";
import { evaluateOpenTheses } from "./workers/outcomes.js";

const cfg = loadConfig();
console.log(`[atlas] starting api: env=${cfg.NODE_ENV} chain=${cfg.CHAIN_ID} port=${cfg.PORT}`);
await migrate(cfg.DATABASE_URL, { log: (m) => console.log(m), appPassword: process.env.APP_DB_PASSWORD });
console.log("[atlas] migrations ok");
const deps = await createDeps(cfg);
const app = await buildApp(deps, { logger: true });
await app.listen({ host: cfg.HOST, port: cfg.PORT });

if (cfg.RUN_WORKERS) {
  const ac = new AbortController();
  if (deps.contracts.atlasDeployed) {
    void createIndexer(deps).run({ signal: ac.signal, pollMs: 3000, log: (m) => app.log.warn(m) });
  }
  setInterval(() => void evaluateOpenTheses(deps, { log: (m) => app.log.warn(m) }), 5 * 60_000).unref();
  process.on("SIGTERM", () => { ac.abort(); void app.close().then(() => deps.db.close()); });
}
