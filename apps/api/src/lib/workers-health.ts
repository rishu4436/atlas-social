/**
 * Audit 2026-11-20 F5: worker health. Public, read-only, secret-free: the evaluator appears only as its public address
 * and balance (never the key), and stored errors are redacted (URLs, hex blobs) before they leave the server.
 */
import { formatEther, parseEther, type Address } from "viem";
import { AtlasOutcomeRegistryAbi } from "@atlas/shared-types";
import type { Deps } from "../deps.js";
import { logAlert, type AlertFn } from "../workers/runs.js";

/** Expected cadence per worker (seconds). A worker is "late" after 3 missed intervals. */
export const WORKER_INTERVALS: Record<string, number> = { "outcome-proposals": 120, "outcome-evaluator": 300, "arena-snapshots": 600, "pay-reconcile": 120 };
export const LIMITS = { indexerLagBlocks: 200, indexerStaleSeconds: 600, proposalStuckSeconds: 1800, consecutiveFailures: 3 };

export const redact = (s: string | null | undefined) =>
  s ? s.replace(/[a-z]+:\/\/[^\s"']+/gi, "<url>").replace(/0x[0-9a-fA-F]{64,}/g, "<hex>").replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>").slice(0, 200) : null;

export async function workersHealth(deps: Deps, opts: { evaluator?: Address | null; minBalanceBnb?: string } = {}) {
  const now = deps.now();
  const age = (t: any) => (t ? Math.max(0, now - Math.floor(new Date(t).getTime() / 1000)) : null);
  const problems: { code: string; message: string; detail?: Record<string, unknown> }[] = [];

  // worker heartbeats
  const runs = await deps.db.sys(`SELECT * FROM worker_runs ORDER BY name`).catch(() => [] as any[]);
  const workers = Object.keys(WORKER_INTERVALS).map((name) => {
    const r = runs.find((x: any) => x.name === name);
    const sinceOk = age(r?.last_ok_at);
    const late = sinceOk === null ? null : sinceOk > WORKER_INTERVALS[name]! * 3;
    const w = {
      name, intervalSeconds: WORKER_INTERVALS[name], runs: Number(r?.runs ?? 0),
      lastStartedAt: r?.last_started_at ?? null, lastOkAt: r?.last_ok_at ?? null, secondsSinceOk: sinceOk,
      consecutiveFailures: r?.consecutive_failures ?? 0, lastError: redact(r?.last_error), lastErrorAt: r?.last_error_at ?? null,
      late, detail: r?.detail ?? {},
    };
    if (w.consecutiveFailures >= LIMITS.consecutiveFailures) problems.push({ code: "WORKER_FAILING", message: `${name} failed ${w.consecutiveFailures} times in a row`, detail: { worker: name } });
    if (late) problems.push({ code: "WORKER_LATE", message: `${name} has not completed for ${sinceOk}s`, detail: { worker: name } });
    return w;
  });

  // indexer lag
  const [cur] = await deps.db.sys(`SELECT block, updated_at FROM chain_cursor WHERE chain_id = $1`, [deps.contracts.chainId]).catch(() => [] as any[]);
  const head = await deps.chain.getBlockNumber({ cacheTime: 0 }).catch(() => null);
  const indexed = cur ? BigInt(cur.block) : null;
  const lagBlocks = head !== null && indexed !== null ? Number(head - indexed) : null;
  const indexer = { enabled: deps.contracts.atlasDeployed || deps.contracts.payDeployed, head: head?.toString() ?? null, indexedBlock: indexed?.toString() ?? null, lagBlocks, cursorUpdatedAt: cur?.updated_at ?? null, secondsSinceCursor: age(cur?.updated_at) };
  if (indexer.enabled) {
    if (lagBlocks !== null && lagBlocks > LIMITS.indexerLagBlocks) problems.push({ code: "INDEXER_LAG", message: `indexer is ${lagBlocks} blocks behind` });
    if (indexer.secondsSinceCursor !== null && indexer.secondsSinceCursor > LIMITS.indexerStaleSeconds) problems.push({ code: "INDEXER_STALE", message: `indexer cursor not updated for ${indexer.secondsSinceCursor}s` });
    if (head === null) problems.push({ code: "RPC_UNAVAILABLE", message: "chain RPC did not answer eth_blockNumber" });
  }

  // outcome proposal outbox
  const states = await deps.db.sys(`SELECT state, count(*)::int AS n, min(updated_at) AS oldest FROM outcome_proposals GROUP BY state`).catch(() => [] as any[]);
  const by = Object.fromEntries(states.map((s: any) => [s.state, { count: s.n, oldestUpdatedAt: s.oldest }]));
  const pendingStates = ["PROPOSAL_PENDING", "PROPOSAL_BROADCAST"];
  const pending = pendingStates.reduce((t, s) => t + (by[s]?.count ?? 0), 0);
  const oldestPending = pendingStates.map((s) => age(by[s]?.oldestUpdatedAt)).filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null;
  const [stuck] = await deps.db.sys(`SELECT count(*)::int AS n FROM outcome_proposals WHERE state IN ('PROPOSAL_PENDING','PROPOSAL_BROADCAST') AND updated_at < to_timestamp($1)`, [now - LIMITS.proposalStuckSeconds]).catch(() => [{ n: 0 }]);
  const proposals = { byState: by, pending, oldestPendingSeconds: oldestPending, stuck: stuck?.n ?? 0, awaitingFinalize: by.PROPOSED_ONCHAIN?.count ?? 0 };
  if (proposals.stuck > 0) problems.push({ code: "PROPOSALS_STUCK", message: `${proposals.stuck} outcome proposal(s) pending for more than ${LIMITS.proposalStuckSeconds / 60} min` });

  // evaluator (address + balance only)
  const min = parseEther(opts.minBalanceBnb ?? process.env.EVALUATOR_MIN_BALANCE_BNB ?? "0.00005");
  let evaluator: Record<string, unknown> = { configured: false };
  if (opts.evaluator) {
    const bal = await deps.chain.getBalance({ address: opts.evaluator }).catch(() => null);
    const authorized = deps.contracts.atlasDeployed
      ? await (deps.chain.readContract({ address: deps.contracts.outcome, abi: AtlasOutcomeRegistryAbi, functionName: "isEvaluator", args: [opts.evaluator] }) as Promise<boolean>).catch(() => null)
      : null;
    evaluator = { configured: true, address: opts.evaluator, balanceBnb: bal === null ? null : formatEther(bal), minBalanceBnb: formatEther(min), low: bal === null ? null : bal < min, authorizedOnChain: authorized };
    if (bal !== null && bal < min) problems.push({ code: "EVALUATOR_LOW_BALANCE", message: `evaluator balance ${formatEther(bal)} BNB is below ${formatEther(min)} BNB`, detail: { address: opts.evaluator } });
    if (authorized === false) problems.push({ code: "EVALUATOR_NOT_AUTHORIZED", message: "the configured evaluator is not authorized on AtlasOutcomeRegistry (revoked or never set)", detail: { address: opts.evaluator } });
  } else if (pending > 0) problems.push({ code: "EVALUATOR_MISSING", message: `${pending} outcome proposal(s) waiting but no evaluator key is configured on this service` });

  // reported payment txs still moving
  const [pay] = await deps.db.sys(`SELECT count(*)::int AS n FROM payment_txs WHERE stage IN ('broadcast','mined','confirmed')`).catch(() => [{ n: null }]);

  return { ok: problems.length === 0, checkedAt: new Date(now * 1000).toISOString(), workers, indexer, proposals, evaluator, payments: { openTxs: pay?.n ?? null }, problems };
}

/** Periodic watchdog: one `[atlas-alert]` log line per problem (Render log stream / log drain). */
export async function alertOnProblems(deps: Deps, opts: { evaluator?: Address | null; alert?: AlertFn } = {}) {
  const h = await workersHealth(deps, opts);
  for (const p of h.problems) (opts.alert ?? logAlert)(`${p.code}: ${p.message}`, p.detail);
  return h;
}
