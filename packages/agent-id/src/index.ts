import { keccak256, toBytes, type Address, type PublicClient } from "viem";
import { AGENT_ID_REGISTRY_BSC } from "@atlas/shared-types";

export const AGENT_ID_READ_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "handleOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "string" }] },
] as const;

export interface AgentIdentity {
  wallet: Address;
  eligible: boolean;
  handle: string | null;
  /** `${handle}.ai` */
  agentName: string | null;
  tokenId: bigint | null;
  registry: Address;
  source: "onchain" | "mock";
}

/**
 * Resolves the Agent ID held by a wallet the user has ALREADY proven control of.
 * Deliberately exposes no name -> wallet lookup (hackathon rule: Agent ID must not be packaged as a tool
 * for looking up other people's wallets by name).
 */
export interface AgentIdResolver {
  readonly source: "onchain" | "mock";
  resolve(wallet: Address): Promise<AgentIdentity>;
}

export const agentTokenId = (handle: string): bigint => BigInt(keccak256(toBytes(handle)));

/** Live on-chain resolver: balanceOf > 0, handleOf(wallet) non-empty, ownerOf(keccak(handle)) == wallet. */
export class OnchainAgentIdResolver implements AgentIdResolver {
  readonly source = "onchain" as const;
  constructor(private client: Pick<PublicClient, "readContract">, private registry: Address = AGENT_ID_REGISTRY_BSC) {}

  async resolve(wallet: Address): Promise<AgentIdentity> {
    const none: AgentIdentity = { wallet, eligible: false, handle: null, agentName: null, tokenId: null, registry: this.registry, source: this.source };
    const bal = (await this.client.readContract({ address: this.registry, abi: AGENT_ID_READ_ABI, functionName: "balanceOf", args: [wallet] })) as bigint;
    if (bal === 0n) return none;
    const handle = (await this.client.readContract({ address: this.registry, abi: AGENT_ID_READ_ABI, functionName: "handleOf", args: [wallet] })) as string;
    if (!handle) return none;
    const tokenId = agentTokenId(handle);
    let owner: string;
    try {
      owner = (await this.client.readContract({ address: this.registry, abi: AGENT_ID_READ_ABI, functionName: "ownerOf", args: [tokenId] })) as string;
    } catch {
      return none;
    }
    if (owner.toLowerCase() !== wallet.toLowerCase()) return none;
    return { wallet, eligible: true, handle, agentName: `${handle}.ai`, tokenId, registry: this.registry, source: this.source };
  }
}

/**
 * DEV/TEST ONLY. In-memory Agent ID registry for local development without BSC mainnet access.
 * Never enable in production (the API refuses AGENT_ID_MODE=mock when NODE_ENV=production).
 */
export class MockAgentIdResolver implements AgentIdResolver {
  readonly source = "mock" as const;
  private map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}, private registry: Address = "0x000000000000000000000000000000000000dEaD") {
    for (const [w, h] of Object.entries(entries)) this.map.set(w.toLowerCase(), h);
  }
  set(wallet: Address, handle: string | null) {
    if (handle) this.map.set(wallet.toLowerCase(), handle);
    else this.map.delete(wallet.toLowerCase());
  }
  ownerOfHandle(handle: string): Address | null {
    for (const [w, h] of this.map) if (h === handle) return w as Address;
    return null;
  }
  async resolve(wallet: Address): Promise<AgentIdentity> {
    const handle = this.map.get(wallet.toLowerCase()) ?? null;
    return { wallet, eligible: !!handle, handle, agentName: handle ? `${handle}.ai` : null, tokenId: handle ? agentTokenId(handle) : null, registry: this.registry, source: this.source };
  }
}

/** Caches positive and negative results briefly; ownership must still be re-checked for protected actions. */
export class CachedAgentIdResolver implements AgentIdResolver {
  private cache = new Map<string, { at: number; v: AgentIdentity }>();
  constructor(private inner: AgentIdResolver, private ttlMs = 60_000) {}
  get source() { return this.inner.source; }
  async resolve(wallet: Address, opts: { fresh?: boolean } = {}): Promise<AgentIdentity> {
    const k = wallet.toLowerCase();
    const hit = this.cache.get(k);
    if (!opts.fresh && hit && Date.now() - hit.at < this.ttlMs) return hit.v;
    const v = await this.inner.resolve(wallet);
    this.cache.set(k, { at: Date.now(), v });
    return v;
  }
}

/**
 * Payment-recipient read for ATLAS Pay ONLY. Returns the CURRENT owner of a specific Agent ID (by its handle)
 * so a sender can see, before approving, the address the AtlasPay contract will pay. It is not a directory:
 * the API calls it only inside an authenticated, rate-limited send flow for one recipient profile, never caches
 * it, and the contract re-resolves at execution anyway (a stale answer can only make the payment revert).
 */
export interface PaymentRecipientReader {
  readonly source: "onchain" | "mock";
  currentOwner(handle: string): Promise<Address | null>;
}

export class OnchainPaymentRecipientReader implements PaymentRecipientReader {
  readonly source = "onchain" as const;
  constructor(private client: Pick<PublicClient, "readContract">, private registry: Address = AGENT_ID_REGISTRY_BSC) {}
  async currentOwner(handle: string): Promise<Address | null> {
    try {
      const o = (await this.client.readContract({ address: this.registry, abi: AGENT_ID_READ_ABI, functionName: "ownerOf", args: [agentTokenId(handle)] })) as Address;
      return /^0x0{40}$/i.test(o) ? null : o;
    } catch {
      return null; // nonexistent / revoked token
    }
  }
}

/** DEV/TEST ONLY: reads the mock registry map. */
export class MockPaymentRecipientReader implements PaymentRecipientReader {
  readonly source = "mock" as const;
  constructor(private mock: MockAgentIdResolver) {}
  async currentOwner(handle: string): Promise<Address | null> {
    return this.mock.ownerOfHandle(handle);
  }
}
