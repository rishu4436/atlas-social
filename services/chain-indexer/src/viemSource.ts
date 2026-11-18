import type { Address, PublicClient } from "viem";
import type { ChainSource, RawLog } from "./indexer.js";

export function viemSource(client: PublicClient): ChainSource {
  return {
    head: () => client.getBlockNumber({ cacheTime: 0 }),
    async block(n) {
      const b = await client.getBlock({ blockNumber: n });
      return { number: b.number!, hash: b.hash!, parentHash: b.parentHash, timestamp: b.timestamp };
    },
    async logs(from, to, addresses: Address[]) {
      const ls = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
      return ls.filter((l) => !l.removed).map((l) => ({
        address: l.address, blockNumber: l.blockNumber!, blockHash: l.blockHash!, logIndex: l.logIndex!, transactionHash: l.transactionHash!, data: l.data, topics: l.topics as RawLog["topics"],
      }));
    },
  };
}
