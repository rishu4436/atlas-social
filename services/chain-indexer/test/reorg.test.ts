import { describe, it, expect } from "vitest";
import { encodeEventTopics, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { AtlasThesisRegistryAbi } from "@atlas/shared-types/abi";
import { ChainIndexer, MemoryStore, type ChainSource, type RawLog, type BlockHeader, type IndexedEvent } from "../src/index.js";

const THESIS = "0x00000000000000000000000000000000000000a1" as Address;
const contracts = { identity: "0x00000000000000000000000000000000000000a0" as Address, thesis: THESIS, review: "0x00000000000000000000000000000000000000a2" as Address, outcome: "0x00000000000000000000000000000000000000a3" as Address };

function cancelLog(id: bigint): Omit<RawLog, "blockNumber" | "blockHash" | "logIndex"> {
  return {
    address: THESIS,
    topics: encodeEventTopics({ abi: AtlasThesisRegistryAbi, eventName: "ThesisCancelled", args: { thesisId: id } }) as Hex[],
    data: encodeAbiParameters([{ type: "bool" }], [false]),
    transactionHash: keccak256(toHex(`tx${id}`)),
  };
}

/** A fake chain whose tip can be replaced to simulate reorgs. */
class FakeChain implements ChainSource {
  blocks: { h: BlockHeader; logs: RawLog[] }[] = [];
  constructor() { this.mine(0, [], "genesis"); }
  mine(n: number, ids: bigint[], fork = "a") {
    for (let i = 0; i < Math.max(n, 1); i++) {
      const number = BigInt(this.blocks.length);
      const parentHash = this.blocks.at(-1)?.h.hash ?? ("0x" + "00".repeat(32)) as Hex;
      const hash = keccak256(toHex(`${fork}:${number}:${parentHash}`));
      const logs = (i === 0 ? ids : []).map((id, k) => ({ ...cancelLog(id), blockNumber: number, blockHash: hash, logIndex: k }));
      this.blocks.push({ h: { number, hash, parentHash, timestamp: 1000n + number * 3n }, logs });
      if (n === 0) break;
    }
  }
  reorg(depth: number) { this.blocks.splice(this.blocks.length - depth, depth); }
  async head() { return BigInt(this.blocks.length - 1); }
  async block(n: bigint) { const b = this.blocks[Number(n)]; if (!b) throw new Error("no block"); return b.h; }
  async logs(from: bigint, to: bigint) { return this.blocks.slice(Number(from), Number(to) + 1).flatMap((b) => b.logs); }
}

const ids = (s: MemoryStore) => s.list().map((x) => `${x.e.args.thesisId}:${x.status}`);

describe("reorg-aware chain indexer", () => {
  it("indexes, finalizes after confirmations, and rolls back orphaned provisional events", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const reorgs: { removed: IndexedEvent[] }[] = [];
    const finals: IndexedEvent[] = [];
    const ix = new ChainIndexer(chain, store, { contracts, startBlock: 1n, confirmations: 3, batchSize: 5, maxReorgDepth: 10 }, {
      onReorg: (r) => { reorgs.push(r); }, onFinal: (e) => { finals.push(...e); },
    });
    chain.mine(1, [1n]); // block 1
    chain.mine(4, []); // 2..5
    chain.mine(1, [2n]); // 6
    chain.mine(1, [3n]); // 7
    while (!(await ix.step()).caughtUp);
    expect(ids(store)).toEqual(["1:final", "2:provisional", "3:provisional"]);

    // reorg out blocks 6-7, replace with a fork containing thesis 4 only
    chain.reorg(2);
    chain.mine(1, [4n], "b");
    chain.mine(1, [], "b");
    while (!(await ix.step()).caughtUp);
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.removed.map((e) => e.args.thesisId)).toEqual([2n, 3n]);
    expect(ids(store)).toEqual(["1:final", "4:provisional"]);

    chain.mine(5, [], "b");
    while (!(await ix.step()).caughtUp);
    expect(ids(store)).toEqual(["1:final", "4:final"]);
    expect(finals.map((e) => e.args.thesisId)).toContain(4n);
    expect(finals.map((e) => e.args.thesisId)).not.toContain(2n);
  });

  it("never rolls back events that were already final", async () => {
    const store = new MemoryStore();
    await store.saveHeaders([{ number: 1n, hash: "0x01", parentHash: "0x00", timestamp: 1n }], 1n);
    await store.upsertEvents([{ id: "x", contract: "thesis", name: "ThesisCancelled", args: {}, blockNumber: 1n, blockHash: "0x01", blockTime: 1n, logIndex: 0, txHash: "0x02", address: THESIS }], "final");
    await expect(store.rollbackAfter(0n)).rejects.toThrow(/final/);
  });

  it("ignores logs from unknown contracts and is idempotent on replay", async () => {
    const chain = new FakeChain();
    chain.mine(1, [7n]);
    chain.blocks[1]!.logs.push({ ...chain.blocks[1]!.logs[0]!, address: "0x00000000000000000000000000000000000000ff", logIndex: 1 });
    chain.mine(3, []);
    const store = new MemoryStore();
    const ix = new ChainIndexer(chain, store, { contracts, startBlock: 1n, confirmations: 1, batchSize: 100, maxReorgDepth: 5 });
    await ix.step();
    await store.upsertEvents(store.list().map((x) => x.e), "final");
    expect(store.list()).toHaveLength(1);
  });
});
