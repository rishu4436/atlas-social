import { readFileSync } from "node:fs";
import { createPublicClient, http, getAddress, type Address, type PublicClient } from "viem";
import { bsc, bscTestnet, foundry } from "viem/chains";
import { AGENT_ID_REGISTRY_BSC, type AtlasDeployment } from "@atlas/shared-types";
import { OnchainAgentIdResolver, MockAgentIdResolver, CachedAgentIdResolver, type AgentIdResolver } from "@atlas/agent-id";
import { createProvider, CachedProvider, type MarketDataProvider } from "@atlas/market-data";
import { InProcessQueue, createQueue, type NotificationQueue, type NotificationSink, type NotificationJob } from "@atlas/notification-worker";
import type { Config } from "./config.js";
import { createDb, type Db } from "./db/index.js";
import { MessageCipher } from "./lib/crypto.js";
import { LocalStorage, S3Storage, type ObjectStorage } from "./lib/storage.js";

export interface Contracts {
  chainId: number;
  agentId: Address;
  agentIdIsMock: boolean;
  identity: Address;
  thesis: Address;
  review: Address;
  outcome: Address;
  startBlock: bigint;
  /** false until the ATLAS registries are deployed on this chain (e.g. live beta before the mainnet deploy). */
  atlasDeployed: boolean;
}

export interface Deps {
  cfg: Config;
  db: Db;
  contracts: Contracts;
  chain: PublicClient; // ATLAS contracts chain
  bsc: PublicClient; // BSC mainnet (quotes + trade proofs)
  resolver: AgentIdResolver & { resolve(w: Address, o?: { fresh?: boolean }): Promise<any> };
  mockResolver?: MockAgentIdResolver;
  market: MarketDataProvider;
  notify: NotificationQueue;
  cipher: MessageCipher;
  storage: ObjectStorage;
  now(): number; // unix seconds
}

const chainFor = (id: number) => (id === 56 ? bsc : id === 97 ? bscTestnet : foundry);

export function loadContracts(cfg: Config): Contracts {
  let d: Partial<AtlasDeployment> = {};
  if (cfg.DEPLOYMENT_FILE) d = JSON.parse(readFileSync(cfg.DEPLOYMENT_FILE, "utf8"));
  const pick = (env: string | undefined, v: string | undefined, name: string): Address => {
    const a = env ?? v;
    if (!a) return "0x0000000000000000000000000000000000000000";
    try { return getAddress(a); } catch { throw new Error(`bad address for ${name}`); }
  };
  const agentId = pick(cfg.AGENT_ID_ADDRESS, d.agentId ?? (cfg.CHAIN_ID === 56 ? AGENT_ID_REGISTRY_BSC : undefined), "AGENT_ID_ADDRESS");
  if (cfg.CHAIN_ID === 56 && agentId !== getAddress(AGENT_ID_REGISTRY_BSC)) throw new Error("on chain 56 the official Agent ID registry must be used");
  const Z = "0x0000000000000000000000000000000000000000";
  const c = {
    chainId: cfg.CHAIN_ID,
    agentId,
    agentIdIsMock: cfg.CHAIN_ID !== 56 && (d.agentIdIsMock ?? true),
    identity: pick(cfg.IDENTITY_REGISTRY, d.AtlasIdentityRegistry, "IDENTITY_REGISTRY"),
    thesis: pick(cfg.THESIS_REGISTRY, d.AtlasThesisRegistry, "THESIS_REGISTRY"),
    review: pick(cfg.REVIEW_REGISTRY, d.AtlasReviewRegistry, "REVIEW_REGISTRY"),
    outcome: pick(cfg.OUTCOME_REGISTRY, d.AtlasOutcomeRegistry, "OUTCOME_REGISTRY"),
    startBlock: BigInt(d.startBlock ?? 0),
  };
  return { ...c, atlasDeployed: c.identity !== Z && c.thesis !== Z && c.review !== Z };
}

export function dbNotificationSink(db: Db): NotificationSink {
  return {
    async preferences(userId) {
      const [p] = await db.sys(`SELECT muted_kinds FROM notification_prefs WHERE user_id = $1`, [userId]);
      const mutes = await db.sys(`SELECT muted_id FROM mutes WHERE user_id = $1 UNION SELECT blocked_id FROM blocks WHERE user_id = $1`, [userId]);
      return { muted: (p?.muted_kinds ?? []) as any, mutedActors: mutes.map((m: any) => m.muted_id) };
    },
    async insert(j: NotificationJob) {
      const r = await db.sys(
        `INSERT INTO notifications (user_id, kind, actor_id, subject_id, data, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`,
        [j.recipientId, j.kind, j.actorId ?? null, j.subjectId ?? null, j.data, j.dedupeKey ?? null],
      );
      return r.length > 0;
    },
  };
}

export async function createDeps(cfg: Config, overrides: Partial<Deps> = {}): Promise<Deps> {
  const db = overrides.db ?? createDb(cfg.DATABASE_URL, cfg.APP_DATABASE_URL);
  const contracts = overrides.contracts ?? loadContracts(cfg);
  const chain = overrides.chain ?? (createPublicClient({ chain: chainFor(cfg.CHAIN_ID), transport: http(cfg.RPC_URL) }) as PublicClient);
  const bscClient = overrides.bsc ?? (createPublicClient({ chain: bsc, transport: http(cfg.BSC_RPC_URL) }) as PublicClient);
  let mockResolver: MockAgentIdResolver | undefined;
  let inner: AgentIdResolver;
  if (cfg.AGENT_ID_MODE === "mock") {
    if (cfg.NODE_ENV === "production") throw new Error("AGENT_ID_MODE=mock is forbidden in production");
    mockResolver = overrides.mockResolver ?? new MockAgentIdResolver({}, contracts.agentId);
    inner = mockResolver;
  } else {
    inner = new OnchainAgentIdResolver(chain, contracts.agentId);
  }
  const sink = dbNotificationSink(db);
  return {
    cfg,
    db,
    contracts,
    chain,
    bsc: bscClient,
    resolver: overrides.resolver ?? new CachedAgentIdResolver(inner, 30_000),
    mockResolver,
    market: overrides.market ?? new CachedProvider(createProvider(cfg.MARKET_DATA_MODE), 15_000),
    notify: overrides.notify ?? (cfg.NODE_ENV === "test" ? new InProcessQueue(sink) : await createQueue(sink, { REDIS_URL: cfg.REDIS_URL })),
    cipher: overrides.cipher ?? new MessageCipher(cfg.MESSAGE_KEY),
    storage: overrides.storage ?? (cfg.STORAGE_DRIVER === "s3" ? new S3Storage(cfg.S3_BUCKET!, { endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION }) : new LocalStorage(cfg.STORAGE_DIR)),
    now: overrides.now ?? (() => Math.floor(Date.now() / 1000)),
  };
}
