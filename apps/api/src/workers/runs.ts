/**
 * Worker bookkeeping (audit 2026-11-20 F5): DB-backed single-runner leases and run heartbeats.
 * Leases make a duplicate run (second instance, overlapping interval, manual trigger) a no-op, which is what keeps
 * the evaluator signer to one in-flight transaction at a time (nonce safety).
 */
import { randomUUID } from "node:crypto";
import type { Deps } from "../deps.js";

export async function acquireLease(deps: Deps, name: string, ttlSeconds: number, owner = randomUUID()): Promise<string | null> {
  const rows = await deps.db.sys(
    `INSERT INTO worker_leases (name, owner, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at WHERE worker_leases.expires_at < now()
     RETURNING owner`, [name, owner, ttlSeconds]);
  return rows.length ? owner : null;
}

export async function releaseLease(deps: Deps, name: string, owner: string) {
  await deps.db.sys(`DELETE FROM worker_leases WHERE name = $1 AND owner = $2`, [name, owner]);
}

export type AlertFn = (msg: string, detail?: Record<string, unknown>) => void;
/** Structured alert line (Render log stream). Grep for `[atlas-alert]`. */
export const logAlert: AlertFn = (msg, detail) => console.error(`[atlas-alert] ${msg}${detail ? " " + JSON.stringify(detail) : ""}`);

/** Records a worker run (start/finish/ok/error, consecutive failures) for /health/workers; alerts after 3 straight failures. */
export async function recordRun<T>(deps: Deps, name: string, fn: () => Promise<T>, opts: { alert?: AlertFn; detail?: (r: T) => Record<string, unknown> } = {}): Promise<T> {
  await deps.db.sys(`INSERT INTO worker_runs (name, last_started_at, runs) VALUES ($1, now(), 1)
    ON CONFLICT (name) DO UPDATE SET last_started_at = now(), runs = worker_runs.runs + 1`, [name]).catch(() => {});
  try {
    const r = await fn();
    await deps.db.sys(`UPDATE worker_runs SET last_finished_at = now(), last_ok_at = now(), consecutive_failures = 0, detail = $2 WHERE name = $1`, [name, JSON.stringify(opts.detail ? opts.detail(r) : {})]).catch(() => {});
    return r;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const [row] = await deps.db.sys(`UPDATE worker_runs SET last_finished_at = now(), last_error = $2, last_error_at = now(), consecutive_failures = consecutive_failures + 1 WHERE name = $1 RETURNING consecutive_failures`, [name, msg]).catch(() => [] as any[]);
    if ((row?.consecutive_failures ?? 0) >= 3) (opts.alert ?? logAlert)(`worker ${name} failed ${row.consecutive_failures} times in a row`, { error: msg });
    throw e;
  }
}
