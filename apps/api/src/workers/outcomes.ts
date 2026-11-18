import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, bsc, bscTestnet } from "viem/chains";
import { evaluateWithProvider } from "@atlas/outcome-engine";
import { AtlasOutcomeRegistryAbi, OutcomeKind, toPrice8 } from "@atlas/shared-types";
import { BinancePublicProvider, CachedProvider, type MarketDataProvider } from "@atlas/market-data";
import type { Deps } from "../deps.js";
import { termsFromJson, OUTCOME_NAMES } from "../lib/theses.js";

/**
 * Evaluates published theses with ATLAS-M1 using LIVE market data only, stores reproducible evidence,
 * and (only if EVALUATOR_PRIVATE_KEY is configured for a disclosed evaluator) proposes the outcome on-chain.
 */
export async function evaluateOpenTheses(deps: Deps, opts: { provider?: MarketDataProvider; log?: (m: string) => void } = {}) {
  const provider = opts.provider ?? new CachedProvider(new BinancePublicProvider(), 60_000);
  const log = opts.log ?? (() => {});
  const rows = await deps.db.sys(`SELECT * FROM theses WHERE chain_status = 'published' AND outcome = 'Open' AND start_time IS NOT NULL ORDER BY start_time LIMIT 50`);
  let resolved = 0;
  for (const t of rows) {
    try {
      const ev = await evaluateWithProvider(provider, { terms: termsFromJson(t.terms), startTime: Math.floor(new Date(t.start_time).getTime() / 1000), symbol: t.symbol, now: deps.now() });
      if (ev.status !== "RESOLVED") continue;
      await deps.db.sys(`UPDATE theses SET outcome = $2, return_bps = $3, evidence = $4, evidence_hash = $5, resolved_at = now(), outcome_state = coalesce(outcome_state, 'Evaluated') WHERE id = $1 AND outcome = 'Open'`,
        [t.id, OUTCOME_NAMES[ev.outcome], ev.returnBps, ev.evidence, ev.evidenceHash]);
      resolved++;
      await proposeOnchain(deps, BigInt(t.onchain_id), ev).catch((e) => log(`propose failed for ${t.id}: ${(e as Error).message}`));
    } catch (e) {
      log(`evaluation failed for ${t.id}: ${(e as Error).message}`);
    }
  }
  return { checked: rows.length, resolved };
}

async function proposeOnchain(deps: Deps, thesisId: bigint, ev: Awaited<ReturnType<typeof evaluateWithProvider>>) {
  const key = process.env.EVALUATOR_PRIVATE_KEY as Hex | undefined;
  if (!key) return;
  const chain = deps.contracts.chainId === 56 ? bsc : deps.contracts.chainId === 97 ? bscTestnet : foundry;
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(deps.cfg.RPC_URL) });
  const observedAt = BigInt(ev.observedAt ?? Math.floor(Date.now() / 1000));
  const price = ev.exitPrice ? toPrice8(ev.exitPrice.toFixed(8)) : 0n;
  if (ev.outcome === OutcomeKind.None) return;
  await wallet.writeContract({ address: deps.contracts.outcome, abi: AtlasOutcomeRegistryAbi, functionName: "proposeOutcome", args: [thesisId, ev.outcome, observedAt, price, ev.evidenceHash] as any });
}
