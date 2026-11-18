import type { Address } from "viem";

/** Official SPACE ID "Agent ID" registry on BNB Smart Chain mainnet (hackathon rules). */
export const AGENT_ID_REGISTRY_BSC: Address = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

export const BSC_MAINNET = 56 as const;
export const BSC_TESTNET = 97 as const;
export const LOCAL_ANVIL = 31337 as const;
export type SupportedChainId = typeof BSC_MAINNET | typeof BSC_TESTNET | typeof LOCAL_ANVIL;

export interface AtlasDeployment {
  chainId: number;
  agentId: Address;
  agentIdIsMock: boolean;
  AtlasIdentityRegistry: Address;
  AtlasThesisRegistry: Address;
  AtlasReviewRegistry: Address;
  AtlasOutcomeRegistry: Address;
  startBlock?: number;
}

export const CHAIN_META: Record<number, { name: string; explorer: string; nativeSymbol: string; rpc: string }> = {
  56: { name: "BNB Smart Chain", explorer: "https://bscscan.com", nativeSymbol: "BNB", rpc: "https://bsc-dataseed.bnbchain.org" },
  97: { name: "BNB Smart Chain Testnet", explorer: "https://testnet.bscscan.com", nativeSymbol: "tBNB", rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545" },
  31337: { name: "Local Anvil (dev)", explorer: "", nativeSymbol: "ETH", rpc: "http://127.0.0.1:8545" },
};

export function explorerTx(chainId: number, hash: string): string | null {
  const e = CHAIN_META[chainId]?.explorer;
  return e ? `${e}/tx/${hash}` : null;
}

export function explorerAddress(chainId: number, address: string): string | null {
  const e = CHAIN_META[chainId]?.explorer;
  return e ? `${e}/address/${address}` : null;
}
