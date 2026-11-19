import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Creates the target database if it does not exist (fresh CI / compose servers). */
async function ensureDatabase(url: string, log: (m: string) => void) {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return;
  u.pathname = "/postgres";
  const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    const r = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!r.rowCount) { await c.query(`CREATE DATABASE "${name}"`); log(`created database ${name}`); }
  } catch { /* no permission or maintenance DB unavailable: assume the database exists */ } finally { await c.end().catch(() => {}); }
}

export async function migrate(url: string, opts: { reset?: boolean; appPassword?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  await ensureDatabase(url, log);
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
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
    // Arena: the app role can read but never write rankings or the XP ledger (the points engine runs in system context)
    await c.query(`DO $$ BEGIN IF to_regclass('public.point_events') IS NOT NULL THEN
      REVOKE INSERT, UPDATE, DELETE ON point_events, leaderboard_snapshots, leaderboard_entries, scoring_methodologies, user_levels, user_achievements, achievements, ranking_integrity_flags, leaderboard_seasons FROM atlas_app;
    END IF; END $$`);
    // Agent Gateway: provenance + audit are append-only and written only in system context; tokens are revoked, never deleted
    await c.query(`DO $$ BEGIN IF to_regclass('public.agent_audit_log') IS NOT NULL THEN
      REVOKE INSERT, UPDATE, DELETE ON agent_audit_log, agent_attributions, evidence_verifications FROM atlas_app;
      REVOKE UPDATE, DELETE ON agents FROM atlas_app;
      REVOKE DELETE ON agent_tokens FROM atlas_app;
    END IF; END $$`);
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
