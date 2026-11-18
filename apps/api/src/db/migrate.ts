import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

export async function migrate(url: string, opts: { reset?: boolean; appPassword?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    if (opts.reset) {
      await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(f)) continue;
      await c.query("BEGIN");
      try {
        await c.query(readFileSync(join(DIR, f), "utf8"));
        await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await c.query("COMMIT");
        log(`applied ${f}`);
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await c.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app");
    await c.query("REVOKE DELETE ON theses, thesis_corrections, chain_events, moderation_actions, security_events, trade_proofs FROM atlas_app");
    await c.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app");
    if (opts.appPassword) await c.query(`ALTER ROLE atlas_app PASSWORD '${opts.appPassword.replace(/'/g, "''")}'`);
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate(process.env.DATABASE_URL ?? "postgres://atlas@127.0.0.1:5433/atlas", { reset: process.argv.includes("--reset"), appPassword: process.env.APP_DB_PASSWORD })
    .then(() => console.log("migrations complete"))
    .catch((e) => { console.error(e); process.exit(1); });
}
