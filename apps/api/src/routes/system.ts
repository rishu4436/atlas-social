import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CHAIN_META, explorerAddress } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import { bad, notFound } from "../lib/errors.js";
import { requireCsrf } from "../lib/session.js";
import { workersHealth } from "../lib/workers-health.js";
import { onchainAgentMetric } from "../lib/metrics.js";
import { evaluatorAccount } from "../workers/outcomes.js";

const MAX = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/json", "application/pdf"];

export async function systemRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/health", { schema: { tags: ["system"] } }, async () => {
    const db = await deps.db.sys(`SELECT 1 AS ok`).then(() => true).catch(() => false);
    const [cur] = await deps.db.sys(`SELECT block, updated_at FROM chain_cursor WHERE chain_id = $1`, [deps.contracts.chainId]).catch(() => []);
    return { ok: db, db, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null, chainId: deps.contracts.chainId, indexer: cur ?? null, queue: deps.notify.kind, marketData: deps.market.id, storage: deps.storage.driver };
  });

  // audit F5: worker lag, last runs, pending outcome proposals, evaluator address + balance. No secrets.
  r.get("/health/workers", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["system"], summary: "Worker health: heartbeats, indexer lag, pending outcome proposals, evaluator balance (address only), open payment txs, problems" } }, async () =>
    workersHealth(deps, { evaluator: evaluatorAccount()?.address ?? null }));

  // audit F6: distinct Agent ID addresses that interacted with ATLAS contracts on-chain (counts only, no address list)
  r.get("/metrics/onchain-agents", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["system"], summary: "Distinct Agent ID addresses with on-chain ATLAS interactions (user-action events only; counting rules in `method`)", querystring: z.object({ include: z.enum(["final", "all"]).default("final") }) } }, async (req) =>
    onchainAgentMetric(deps, req.query.include));

  r.get("/config", { schema: { tags: ["system"], summary: "Public deployment info and disclosures" } }, async () => ({
    chainId: deps.contracts.chainId,
    chain: CHAIN_META[deps.contracts.chainId]?.name,
    contracts: (() => {
      const Z = "0x0000000000000000000000000000000000000000";
      const k = { identity: deps.contracts.identity, thesis: deps.contracts.thesis, review: deps.contracts.review, outcome: deps.contracts.outcome };
      const live = Object.fromEntries(Object.entries(k).map(([n, v]) => [n, v === Z ? null : v]));
      return { agentId: deps.contracts.agentId, agentIdExplorer: explorerAddress(deps.contracts.chainId, deps.contracts.agentId), ...live,
        explorer: Object.fromEntries(Object.entries(live).map(([n, v]) => [n, v ? explorerAddress(deps.contracts.chainId, v) : null])) };
    })(),
    contractsDeployed: deps.contracts.atlasDeployed,
    contractsStatus: deps.contracts.atlasDeployed ? "deployed" : "pending",
    contractsNote: deps.contracts.atlasDeployed ? null : "ATLAS registries are pending deployment on this chain. Agent ID eligibility is read live from the official registry; on-chain publishing, reviews and identity anchoring are disabled until the contracts are deployed and verified.",
    agentIdIsMock: deps.contracts.agentIdIsMock || deps.cfg.AGENT_ID_MODE === "mock",
    marketData: { source: deps.market.id, simulated: deps.market.simulated },
    ai: { llm: !!deps.cfg.AI_API_KEY, note: "AI research only; it cannot sign, approve or execute." },
    ownerPowers: "AtlasOutcomeRegistry owner can add/remove outcome evaluators (disclosed). Identity, thesis and review registries have no owner and no upgrade path. No contract holds user funds.",
    messaging: deps.cipher.ephemeral ? "Messages encrypted at rest with an ephemeral dev key (lost on restart)." : "Messages encrypted at rest (server-held key). Not end-to-end encrypted.",
  }));

  // content-addressed uploads (avatars, post images, evidence files)
  r.post("/media", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } }, schema: { tags: ["media"], body: z.object({ purpose: z.enum(["avatar", "post", "evidence"]), contentType: z.enum(TYPES as [string, ...string[]]), dataBase64: z.string().max(Math.ceil((MAX * 4) / 3) + 8) }) } }, async (req) => {
    const a = requireCsrf(req);
    const bytes = Buffer.from(req.body.dataBase64, "base64");
    if (!bytes.length || bytes.length > MAX) throw bad("BAD_SIZE", "File must be 1 byte to 5 MB");
    const sig = bytes.subarray(0, 4).toString("hex");
    const ok = { "image/png": sig.startsWith("89504e47"), "image/jpeg": sig.startsWith("ffd8ff"), "image/gif": sig.startsWith("47494638"), "image/webp": bytes.subarray(8, 12).toString() === "WEBP", "application/pdf": sig === "25504446", "application/json": true }[req.body.contentType];
    if (!ok) throw bad("TYPE_MISMATCH", "File content does not match its declared type");
    const { key, sha256 } = await deps.storage.put(bytes, req.body.contentType, req.body.purpose);
    const [m] = await deps.db.sys(`INSERT INTO media_objects (owner_id, sha256, storage_key, content_type, size, purpose) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [a.userId, sha256, key, req.body.contentType, bytes.length, req.body.purpose]);
    return { id: m.id, sha256, url: `/media/${key}` };
  });

  r.get("/media/:prefix/:hash", { schema: { tags: ["media"], params: z.object({ prefix: z.enum(["avatar", "post", "evidence"]), hash: z.string().regex(/^[0-9a-f]{64}$/) }) } }, async (req, reply) => {
    const key = `${req.params.prefix}/${req.params.hash}`;
    const [m] = await deps.db.sys(`SELECT content_type FROM media_objects WHERE storage_key = $1 LIMIT 1`, [key]);
    const bytes = m && (await deps.storage.get(key));
    if (!bytes) throw notFound("Media");
    reply.header("content-type", m.content_type).header("cache-control", "public, max-age=31536000, immutable").header("x-content-type-options", "nosniff").header("content-security-policy", "default-src 'none'");
    return reply.send(Buffer.from(bytes));
  });
}
