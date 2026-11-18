import { ChainIndexer, viemSource, type IndexerStore, type IndexedEvent, type BlockHeader, type EventStatus } from "@atlas/chain-indexer";
import { notificationsForChainEvent } from "@atlas/notification-worker";
import type { Hex } from "viem";
import type { Deps } from "../deps.js";
import { applyChainEvent } from "../lib/theses.js";

const j = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const revive = (args: any) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : v]));

/** Postgres-backed store for the reorg-aware indexer. */
export class PgIndexerStore implements IndexerStore {
  constructor(private deps: Deps) {}
  private get chain() { return this.deps.contracts.chainId; }
  async cursor() { const [r] = await this.deps.db.sys(`SELECT block FROM chain_cursor WHERE chain_id = $1`, [this.chain]); return r ? BigInt(r.block) : null; }
  async hashAt(n: bigint) { const [r] = await this.deps.db.sys(`SELECT hash FROM chain_blocks WHERE chain_id = $1 AND number = $2`, [this.chain, n.toString()]); return (r?.hash ?? null) as Hex | null; }
  async saveHeaders(h: BlockHeader[], cursor: bigint) {
    await this.deps.db.sysTx(async (q) => {
      for (const b of h) await q(`INSERT INTO chain_blocks (chain_id, number, hash) VALUES ($1,$2,$3) ON CONFLICT (chain_id, number) DO UPDATE SET hash = EXCLUDED.hash`, [this.chain, b.number.toString(), b.hash]);
      await q(`INSERT INTO chain_cursor (chain_id, block) VALUES ($1,$2) ON CONFLICT (chain_id) DO UPDATE SET block = EXCLUDED.block, updated_at = now()`, [this.chain, cursor.toString()]);
      await q(`DELETE FROM chain_blocks WHERE chain_id = $1 AND number < $2`, [this.chain, (cursor - 2000n).toString()]);
    });
  }
  async upsertEvents(evs: IndexedEvent[], status: EventStatus) {
    await this.deps.db.sysTx(async (q) => {
      for (const e of evs) {
        const ins = await q(`INSERT INTO chain_events (id, chain_id, contract, name, args, address, block_number, block_hash, block_time, log_index, tx_hash, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9),$10,$11,$12) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [e.id, this.chain, e.contract, e.name, j(e.args), e.address.toLowerCase(), e.blockNumber.toString(), e.blockHash, e.blockTime.toString(), e.logIndex, e.txHash, status]);
        if (ins.length) await applyChainEvent(q, this.deps, e);
      }
    });
  }
  async finalizeUpTo(n: bigint) {
    const rows = await this.deps.db.sys(`UPDATE chain_events SET status = 'final' WHERE chain_id = $1 AND status = 'provisional' AND block_number <= $2 RETURNING *`, [this.chain, n.toString()]);
    return rows.map(rowToEvent);
  }
  async rollbackAfter(n: bigint) {
    return this.deps.db.sysTx(async (q) => {
      const final = await q(`SELECT id FROM chain_events WHERE chain_id = $1 AND block_number > $2 AND status = 'final' LIMIT 1`, [this.chain, n.toString()]);
      if (final.length) throw new Error("refusing to roll back finalized events");
      const rows = await q(`DELETE FROM chain_events WHERE chain_id = $1 AND block_number > $2 RETURNING *`, [this.chain, n.toString()]);
      const evs = rows.map(rowToEvent).reverse();
      for (const e of evs) await applyChainEvent(q, this.deps, e, true);
      await q(`DELETE FROM chain_blocks WHERE chain_id = $1 AND number > $2`, [this.chain, n.toString()]);
      await q(`UPDATE chain_cursor SET block = $2 WHERE chain_id = $1`, [this.chain, n.toString()]);
      return evs;
    });
  }
}

function rowToEvent(r: any): IndexedEvent {
  return { id: r.id, contract: r.contract, name: r.name, args: revive(r.args), blockNumber: BigInt(r.block_number), blockHash: r.block_hash, blockTime: BigInt(Math.floor(new Date(r.block_time).getTime() / 1000)), logIndex: r.log_index, txHash: r.tx_hash, address: r.address };
}

export function createIndexer(deps: Deps) {
  const store = new PgIndexerStore(deps);
  return new ChainIndexer(viemSource(deps.chain), store, {
    contracts: { identity: deps.contracts.identity, thesis: deps.contracts.thesis, review: deps.contracts.review, outcome: deps.contracts.outcome },
    startBlock: deps.contracts.startBlock,
    confirmations: deps.contracts.chainId === 31337 ? 1 : 15,
    batchSize: 1000,
    maxReorgDepth: 64,
  }, {
    async onFinal(evs) {
      for (const e of evs) {
        const tid = e.args.thesisId?.toString();
        if (!tid) continue;
        const [t] = await deps.db.sys(`SELECT author_id FROM theses WHERE registry = $1 AND onchain_id = $2`, [deps.contracts.thesis.toLowerCase(), tid]);
        for (const job of notificationsForChainEvent(e, { thesisAuthorUserId: t?.author_id })) await deps.notify.enqueue(job);
      }
    },
  });
}
