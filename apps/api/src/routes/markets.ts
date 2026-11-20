import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getAddress, parseAbi, type Address, type Hex } from "viem";
import { MARKETS, marketByAsset, BSC_TOKENS, PANCAKE_V2_ROUTER, PANCAKE_V2_FACTORY, explorerTx } from "@atlas/shared-types";
import { prepareSwap, assertSafeSteps, SwapError, PANCAKE_V2_ROUTER_ABI, ERC20_ABI, RISK_DISCLOSURE, type QuoteReader } from "@atlas/wallet-integration";
import { bawContractCallCommand } from "@atlas/auth";
import { verifyTradeProof } from "@atlas/trade-proof";
import type { Deps } from "../deps.js";
import { bad, notFound, conflict, forbidden } from "../lib/errors.js";
import { requireAuth, requireCsrf } from "../lib/session.js";
import { walletOf, tradeProofView } from "../lib/views.js";
import { createPost } from "./social.js";

export function bscReader(deps: Deps): QuoteReader {
  return {
    getAmountsOut: (amountIn, path) => deps.bsc.readContract({ address: PANCAKE_V2_ROUTER, abi: PANCAKE_V2_ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, path] }) as Promise<bigint[]>,
    allowance: (token, owner, spender) => deps.bsc.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] }) as Promise<bigint>,
    transferCheck: (token, accounts, path) => restrictedTokenCheck(deps, token, accounts, path),
  };
}

const RESTRICTED_ABI = parseAbi([
  "function compliance() view returns (address)",
  "function pauseManager() view returns (address)",
  "function isTokenPaused(address) view returns (bool)",
  "function checkIsCompliant(address,address) view",
  "function getPair(address,address) view returns (address)",
]);

/**
 * Issuer-controlled tokens (e.g. tokenized stocks) revert transfers when paused or when any party fails the
 * compliance check. Check the wallet, the router and every V2 pair the token passes through before preparing steps.
 */
export async function restrictedTokenCheck(deps: Pick<Deps, "bsc">, token: Address, accounts: Address[], path: Address[]): Promise<string | null> {
  const read = (address: Address, functionName: string, args: unknown[] = []) => deps.bsc.readContract({ address, abi: RESTRICTED_ABI, functionName, args } as never) as Promise<unknown>;
  try {
    const [compliance, pauseManager] = (await Promise.all([read(token, "compliance"), read(token, "pauseManager")])) as [Address, Address];
    if (await read(pauseManager, "isTokenPaused", [token])) return "the issuer has paused transfers";
    const pairs: Address[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i]!.toLowerCase() !== token.toLowerCase() && path[i + 1]!.toLowerCase() !== token.toLowerCase()) continue;
      const pair = (await read(PANCAKE_V2_FACTORY, "getPair", [path[i], path[i + 1]])) as Address;
      if (/^0x0{40}$/i.test(pair)) return "no PancakeSwap V2 pair for this hop";
      pairs.push(pair);
    }
    for (const acct of [...accounts, ...pairs]) {
      try { await read(compliance, "checkIsCompliant", [token, acct]); } catch { return `address ${acct} is not allowed by the issuer's compliance list`; }
    }
    return null;
  } catch (e) {
    return `transfer controls could not be read (${(e as Error).message.slice(0, 80)})`;
  }
}

const swapBody = z.object({ tokenIn: z.string().max(10), tokenOut: z.string().max(10), amountIn: z.string().regex(/^\d+(\.\d+)?$/), slippageBps: z.number().int().min(1).max(500).default(50), thesisId: z.string().uuid().optional() });

export async function marketRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/markets", { schema: { tags: ["markets"] } }, async () => {
    const items = await Promise.all(MARKETS.map(async (m) => {
      const t = await deps.market.ticker24h(m.symbol).catch(() => null);
      const spark = await deps.market.klines(m.symbol, "1h", { limit: 48 }).catch(() => []);
      return { ...m, ticker: t, sparkline: spark.map((c) => c.close) };
    }));
    return { source: deps.market.id, simulated: deps.market.simulated, items, disclaimer: `Reference prices from ${deps.market.id === "okx-public" ? "the OKX public market API" : "the Binance public spot API"} (reference only). DEX execution prices on BSC can differ.` };
  });

  r.get("/markets/:asset", { schema: { tags: ["markets"], params: z.object({ asset: z.string().max(10) }) } }, async (req) => {
    const m = marketByAsset(req.params.asset);
    if (!m) throw notFound("Market");
    const ticker = await deps.market.ticker24h(m.symbol);
    const base = BSC_TOKENS.find((t) => t.symbol === m.base)!;
    const theses = await deps.db.sys(`SELECT t.id, t.direction, t.target_price, t.invalidation_price, t.outcome, t.created_at, p.agent_name FROM theses t JOIN profiles p ON p.user_id = t.author_id WHERE t.asset = $1 AND t.chain_status = 'published' ORDER BY t.created_at DESC LIMIT 20`, [m.asset]);
    return { ...m, token: base, ticker, source: deps.market.id, simulated: deps.market.simulated, theses, riskWarning: RISK_DISCLOSURE };
  });

  r.get("/markets/:asset/history", { schema: { tags: ["markets"], params: z.object({ asset: z.string().max(10) }), querystring: z.object({ interval: z.enum(["15m", "1h", "4h", "1d"]).default("1h"), limit: z.coerce.number().int().min(10).max(1000).default(200) }) } }, async (req) => {
    const m = marketByAsset(req.params.asset);
    if (!m) throw notFound("Market");
    const candles = await deps.market.klines(m.symbol, req.query.interval, { limit: req.query.limit });
    return { symbol: m.symbol, interval: req.query.interval, source: deps.market.id, simulated: deps.market.simulated, candles };
  });

  // ---------------------------------------------------------------- trading (prepare only; the user's wallet signs)
  r.post("/trade/quotes", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["trade"], summary: "PancakeSwap V2 quote on BSC mainnet (read-only)", body: swapBody } }, async (req) => {
    const from = (req.auth ? await walletOf(deps.db.sys, req.auth.userId) : null) ?? "0x000000000000000000000000000000000000dEaD";
    try {
      const p = await prepareSwap({ from: getAddress(from), tokenIn: req.body.tokenIn, tokenOut: req.body.tokenOut, amountIn: req.body.amountIn, slippageBps: req.body.slippageBps, reader: { getAmountsOut: bscReader(deps).getAmountsOut } });
      const { steps: _s, ...quote } = p;
      return { ...quote, quotedOnly: true };
    } catch (e) {
      if (e instanceof SwapError) throw bad("SWAP_REJECTED", e.message);
      throw bad("QUOTE_UNAVAILABLE", `Quote unavailable: ${(e as Error).message.slice(0, 140)}`);
    }
  });

  r.post("/trade/prepare", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["trade"], summary: "Unsigned swap transaction(s) for the user's own wallet to preview and confirm", body: swapBody.extend({ acknowledgeRisk: z.literal(true) }) } }, async (req) => {
    const a = requireCsrf(req);
    const wallet = await walletOf(deps.db.sys, a.userId);
    if (!wallet) throw forbidden("NO_AGENT_ID", "No linked Agent ID wallet");
    try {
      const p = await prepareSwap({ from: getAddress(wallet), tokenIn: req.body.tokenIn, tokenOut: req.body.tokenOut, amountIn: req.body.amountIn, slippageBps: req.body.slippageBps, reader: bscReader(deps), now: deps.now(), requireTransferCheck: true });
      if (p.blocked) return { ...p, steps: [], blocked: true };
      assertSafeSteps(p.steps, getAddress(wallet));
      return {
        ...p,
        steps: p.steps.map((s) => ({ ...s, baw: bawContractCallCommand({ chainId: s.chainId, from: s.from, to: s.to, data: s.data as Hex, value: BigInt(s.value) }), eip1193: { from: s.from, to: s.to, data: s.data, value: `0x${BigInt(s.value).toString(16)}`, chainId: "0x38" } })),
        confirmation: "You choose your own size and limits. Confirm each step in your wallet after reviewing its preview. ATLAS does not copy anyone's position size, does not hold sessions to trade for you, and offers no bypass if the wallet preview blocks a call.",
      };
    } catch (e) {
      if (e instanceof SwapError) throw bad("SWAP_REJECTED", e.message);
      throw bad("PREPARE_FAILED", (e as Error).message.slice(0, 200));
    }
  });

  r.post("/trade/evidence", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["trade"], summary: "Submit a BSC swap tx hash as attributable execution evidence", body: z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), thesisId: z.string().uuid().optional(), share: z.boolean().default(true), comment: z.string().max(1000).default("") }) } }, async (req) => {
    const a = requireCsrf(req);
    const wallet = await walletOf(deps.db.sys, a.userId);
    if (!wallet) throw forbidden("NO_AGENT_ID", "No linked Agent ID wallet");
    const txh = req.body.txHash.toLowerCase();
    const [claimed] = await deps.db.sys(`SELECT user_id, status FROM trade_proofs WHERE chain_id = 56 AND tx_hash = $1 AND status <> 'REJECTED'`, [txh]);
    if (claimed && claimed.user_id !== a.userId) throw conflict("ALREADY_CLAIMED", "This transaction is already attributed to another account");
    const res = await verifyTradeProof(deps.bsc, txh as Hex, getAddress(wallet), 56);
    const proof = await deps.db.as(a.userId, async (q) => {
      if (claimed) {
        await deps.db.sys(`UPDATE trade_proofs SET status = $2, reasons = $3, evidence = $4, evidence_hash = $5, verified_at = CASE WHEN $2 = 'VERIFIED' THEN now() ELSE verified_at END WHERE chain_id = 56 AND tx_hash = $1 AND user_id = $6`, [txh, res.status, res.reasons, res.evidence, res.evidenceHash, a.userId]);
        return (await q(`SELECT * FROM trade_proofs WHERE chain_id = 56 AND tx_hash = $1 AND user_id = $2`, [txh, a.userId]))[0];
      }
      const [row] = await q(`INSERT INTO trade_proofs (user_id, chain_id, tx_hash, status, reasons, evidence, evidence_hash, thesis_id, verified_at) VALUES ($1,56,$2,$3,$4,$5,$6,$7, CASE WHEN $3 = 'VERIFIED' THEN now() END) RETURNING *`,
        [a.userId, txh, res.status, res.reasons, res.evidence, res.evidenceHash, req.body.thesisId ?? null]);
      return row;
    });
    let postId: string | null = null;
    if (res.status === "VERIFIED" && req.body.share) postId = await createPost(deps, a.userId, { kind: "trade", body: req.body.comment, topics: ["trade"], mediaIds: [], tradeProofId: proof.id, thesisId: undefined });
    return { proof: tradeProofView(proof), confirmations: res.confirmations, postId, txUrl: explorerTx(56, txh), note: res.status === "REJECTED" ? "Proof rejected: a transaction hash alone does not prove you executed the trade." : res.status === "PENDING" ? "Waiting for confirmations; resubmit shortly." : "Verified execution evidence. This is not a claim of realized profit." };
  });

  r.get("/trade/evidence", { schema: { tags: ["trade"] } }, async (req) => {
    const a = requireAuth(req);
    return (await deps.db.as(a.userId, (q) => q(`SELECT * FROM trade_proofs WHERE user_id = $1 ORDER BY created_at DESC`, [a.userId]))).map(tradeProofView);
  });

  void ({} as Address);
}
