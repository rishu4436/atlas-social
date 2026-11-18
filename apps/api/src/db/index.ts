import pg from "pg";

// numeric -> string (exact), int8 -> string; timestamps stay Date
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(20, (v) => v);

export type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  /** System context (table owner / BYPASSRLS): auth bootstrap, indexer, workers, moderation. */
  sys: Q;
  /** Runs fn in a transaction as the RLS-restricted app role with app.user_id bound to `uid` (or anonymous). */
  as<T>(uid: string | null, fn: (q: Q) => Promise<T>): Promise<T>;
  /** System transaction. */
  sysTx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDb(systemUrl: string, appUrl: string): Db {
  const sysPool = new pg.Pool({ connectionString: systemUrl, max: 10 });
  const appPool = new pg.Pool({ connectionString: appUrl, max: 20 });
  const wrap = (c: pg.PoolClient | pg.Pool): Q => async (sql, params) => (await c.query(sql, params as unknown[])).rows;
  return {
    sys: wrap(sysPool),
    async as(uid, fn) {
      const c = await appPool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.user_id', $1, true)", [uid ?? ""]);
        const r = await fn(wrap(c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async sysTx(fn) {
      const c = await sysPool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(wrap(c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await Promise.all([sysPool.end(), appPool.end()]);
    },
  };
}
