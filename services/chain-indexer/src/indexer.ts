import { decodeEventLog, type Abi, type Address, type Hex } from "viem";
import { AtlasIdentityRegistryAbi, AtlasThesisRegistryAbi, AtlasReviewRegistryAbi, AtlasOutcomeRegistryAbi } from "@atlas/shared-types/abi";

export interface BlockHeader { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint }
export interface RawLog { address: Address; blockNumber: bigint; blockHash: Hex; logIndex: number; transactionHash: Hex; data: Hex; topics: Hex[] }

/** Minimal chain access the indexer needs. `viemSource` adapts a viem PublicClient. */
export interface ChainSource {
  head(): Promise<bigint>;
  block(n: bigint): Promise<BlockHeader>;
  logs(from: bigint, to: bigint, addresses: Address[]): Promise<RawLog[]>;
}

export interface IndexedEvent {
  id: string; // `${blockHash}:${logIndex}`
  contract: "identity" | "thesis" | "review" | "outcome";
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  blockHash: Hex;
  blockTime: bigint;
  logIndex: number;
  txHash: Hex;
  address: Address;
}

export type EventStatus = "provisional" | "final";

/** Persistence port. MemoryStore is used in tests/dev; the API ships a Postgres implementation. */
export interface IndexerStore {
  cursor(): Promise<bigint | null>; // last processed block
  hashAt(n: bigint): Promise<Hex | null>;
  saveHeaders(headers: BlockHeader[], cursor: bigint): Promise<void>;
  upsertEvents(events: IndexedEvent[], status: EventStatus): Promise<void>;
  finalizeUpTo(n: bigint): Promise<IndexedEvent[]>; // returns events newly finalized
  rollbackAfter(n: bigint): Promise<IndexedEvent[]>; // removes everything > n, returns removed events
}

export interface IndexerHooks {
  onEvents?(events: IndexedEvent[], status: EventStatus): Promise<void> | void;
  onFinal?(events: IndexedEvent[]): Promise<void> | void;
  onReorg?(info: { from: bigint; ancestor: bigint; removed: IndexedEvent[] }): Promise<void> | void;
}

export interface IndexerConfig {
  contracts: { identity: Address; thesis: Address; review: Address; outcome: Address };
  startBlock: bigint;
  confirmations: number; // BSC: 15 is the ATLAS default for "final"
  batchSize: number; // RPC getLogs window
  maxReorgDepth: number;
}

const ABIS: Record<IndexedEvent["contract"], Abi> = {
  identity: AtlasIdentityRegistryAbi as Abi,
  thesis: AtlasThesisRegistryAbi as Abi,
  review: AtlasReviewRegistryAbi as Abi,
  outcome: AtlasOutcomeRegistryAbi as Abi,
};

export class ReorgTooDeepError extends Error {}

export class ChainIndexer {
  private byAddress: Map<string, IndexedEvent["contract"]>;
  constructor(private src: ChainSource, private store: IndexerStore, private cfg: IndexerConfig, private hooks: IndexerHooks = {}) {
    this.byAddress = new Map(Object.entries(cfg.contracts).map(([k, a]) => [a.toLowerCase(), k as IndexedEvent["contract"]]));
  }

  decode(log: RawLog, blockTime: bigint): IndexedEvent | null {
    const contract = this.byAddress.get(log.address.toLowerCase());
    if (!contract) return null;
    try {
      const d = decodeEventLog({ abi: ABIS[contract], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return {
        id: `${log.blockHash}:${log.logIndex}`,
        contract,
        name: String(d.eventName),
        args: (d.args ?? {}) as Record<string, unknown>,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        blockTime,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
        address: log.address,
      };
    } catch {
      return null; // unknown event: ignored
    }
  }

  /** Walks back from the cursor until the stored hash matches the canonical chain; rolls back the rest. */
  async reconcile(): Promise<bigint | null> {
    const cur = await this.store.cursor();
    if (cur === null) return null;
    let n = cur;
    for (let depth = 0; depth <= this.cfg.maxReorgDepth; depth++, n--) {
      if (n < this.cfg.startBlock) break;
      const stored = await this.store.hashAt(n);
      if (stored === null) continue; // header not tracked (e.g. pruned); keep walking
      const canon = (await this.src.block(n)).hash;
      if (stored === canon) {
        if (n !== cur) {
          const removed = await this.store.rollbackAfter(n);
          await this.hooks.onReorg?.({ from: cur, ancestor: n, removed });
        }
        return n;
      }
    }
    if (n < this.cfg.startBlock) {
      const removed = await this.store.rollbackAfter(this.cfg.startBlock - 1n);
      await this.hooks.onReorg?.({ from: cur, ancestor: this.cfg.startBlock - 1n, removed });
      return this.cfg.startBlock - 1n;
    }
    throw new ReorgTooDeepError(`reorg deeper than ${this.cfg.maxReorgDepth} blocks at ${cur}`);
  }

  /** One indexing step. Returns the new cursor and whether it caught up with head. */
  async step(): Promise<{ cursor: bigint; head: bigint; caughtUp: boolean }> {
    const head = await this.src.head();
    const ancestor = await this.reconcile();
    const from = (ancestor ?? this.cfg.startBlock - 1n) + 1n;
    if (from > head) return { cursor: from - 1n, head, caughtUp: true };
    const to = from + BigInt(this.cfg.batchSize) - 1n < head ? from + BigInt(this.cfg.batchSize) - 1n : head;

    const logs = await this.src.logs(from, to, Object.values(this.cfg.contracts));
    const needed = new Set<bigint>([to, ...logs.map((l) => l.blockNumber)]);
    // track recent headers so reorgs within maxReorgDepth of head are detectable
    const trackFrom = head - BigInt(this.cfg.maxReorgDepth);
    for (let b = from > trackFrom ? from : trackFrom; b <= to; b++) needed.add(b);
    const headers = new Map<bigint, BlockHeader>();
    for (const n of [...needed].sort((a, b) => (a < b ? -1 : 1))) headers.set(n, await this.src.block(n));

    // logs whose block hash disagrees with the header we just read are from an orphaned fork: retry later
    const consistent = logs.every((l) => headers.get(l.blockNumber)?.hash === l.blockHash);
    if (!consistent) return { cursor: from - 1n, head, caughtUp: false };

    const events = logs
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
      .map((l) => this.decode(l, headers.get(l.blockNumber)!.timestamp))
      .filter((e): e is IndexedEvent => e !== null);

    const finalLine = head - BigInt(this.cfg.confirmations);
    const fin = events.filter((e) => e.blockNumber <= finalLine);
    const prov = events.filter((e) => e.blockNumber > finalLine);
    await this.store.saveHeaders([...headers.values()], to);
    if (fin.length) await this.store.upsertEvents(fin, "final");
    if (prov.length) await this.store.upsertEvents(prov, "provisional");
    if (fin.length) await this.hooks.onEvents?.(fin, "final");
    if (prov.length) await this.hooks.onEvents?.(prov, "provisional");
    const newlyFinal = await this.store.finalizeUpTo(finalLine);
    if (newlyFinal.length) await this.hooks.onFinal?.(newlyFinal);
    return { cursor: to, head, caughtUp: to === head };
  }

  async run(opts: { pollMs?: number; signal?: AbortSignal; log?: (m: string) => void } = {}) {
    const log = opts.log ?? (() => {});
    while (!opts.signal?.aborted) {
      try {
        const r = await this.step();
        if (r.caughtUp) await new Promise((res) => setTimeout(res, opts.pollMs ?? 3000));
      } catch (e) {
        log(`indexer error: ${(e as Error).message}`);
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  }
}

export class MemoryStore implements IndexerStore {
  headers = new Map<bigint, Hex>();
  events = new Map<string, { e: IndexedEvent; status: EventStatus }>();
  private cur: bigint | null = null;
  async cursor() { return this.cur; }
  async hashAt(n: bigint) { return this.headers.get(n) ?? null; }
  async saveHeaders(h: BlockHeader[], cursor: bigint) { for (const x of h) this.headers.set(x.number, x.hash); this.cur = cursor; }
  async upsertEvents(evs: IndexedEvent[], status: EventStatus) { for (const e of evs) this.events.set(e.id, { e, status }); }
  async finalizeUpTo(n: bigint) {
    const out: IndexedEvent[] = [];
    for (const v of this.events.values()) if (v.status === "provisional" && v.e.blockNumber <= n) { v.status = "final"; out.push(v.e); }
    return out;
  }
  async rollbackAfter(n: bigint) {
    const removed: IndexedEvent[] = [];
    for (const [id, v] of this.events) if (v.e.blockNumber > n) {
      if (v.status === "final") throw new Error(`refusing to roll back final event ${id}`);
      removed.push(v.e); this.events.delete(id);
    }
    for (const k of [...this.headers.keys()]) if (k > n) this.headers.delete(k);
    this.cur = n;
    return removed;
  }
  list() { return [...this.events.values()].sort((a, b) => (a.e.blockNumber === b.e.blockNumber ? a.e.logIndex - b.e.logIndex : a.e.blockNumber < b.e.blockNumber ? -1 : 1)); }
}
