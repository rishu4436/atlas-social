/**
 * Audit 2026-11-20 F6: "distinct Agent ID addresses interacting on-chain".
 *
 * Counting rules (also returned as `method`):
 * - one address = the actor of a user-action event emitted by an ATLAS contract on this chain, read from the
 *   reorg-aware indexer (`chain_events`), lowercased and de-duplicated across all actions;
 * - actions: IdentityRegistered.wallet, ThesisCommitted.author, ThesisPublished.author, ReviewPublished.reviewer,
 *   EvidenceChallenged.challenger, OutcomeChallenged.challenger, PaymentSent.sender. Every one of these calls is gated by
 *   Agent ID ownership at execution time (or, for AtlasPay, a sender Agent ID token in the event);
 * - excluded: OutcomeProposed (evaluator service), OutcomeFinalized (permissionless keeper call), EvaluatorSet (owner),
 *   payment recipients (passive), and anything only prepared or signed off-chain;
 * - default `final` counts events at final depth only; `all` also counts provisional ones.
 */
import type { Deps } from "../deps.js";

export const ACTOR_FIELDS: Record<string, string> = {
  IdentityRegistered: "wallet", ThesisCommitted: "author", ThesisPublished: "author", ReviewPublished: "reviewer",
  EvidenceChallenged: "challenger", OutcomeChallenged: "challenger", PaymentSent: "sender",
};

export async function onchainAgentMetric(deps: Deps, include: "final" | "all" = "final") {
  const cases = Object.entries(ACTOR_FIELDS).map(([n, f]) => `WHEN '${n}' THEN args->>'${f}'`).join(" ");
  const rows = await deps.db.sys(
    `WITH actors AS (
       SELECT name, lower(CASE name ${cases} END) AS addr, block_time FROM chain_events
        WHERE chain_id = $1 AND name = ANY($2::text[]) ${include === "final" ? "AND status = 'final'" : ""})
     SELECT name, count(DISTINCT addr)::int AS n, count(*)::int AS events, NULL::int AS total, min(block_time) AS first_at, max(block_time) AS last_at FROM actors WHERE addr ~ '^0x[0-9a-f]{40}$' GROUP BY name
     UNION ALL
     SELECT '*', count(DISTINCT addr)::int, count(*)::int, NULL, min(block_time), max(block_time) FROM actors WHERE addr ~ '^0x[0-9a-f]{40}$'`,
    [deps.contracts.chainId, Object.keys(ACTOR_FIELDS)],
  );
  const all = rows.find((r: any) => r.name === "*");
  const [linked] = await deps.db.sys(`SELECT count(DISTINCT wallet_address)::int AS n FROM agent_id_links WHERE chain_id = $1 AND revoked_at IS NULL`, [deps.contracts.chainId]);
  return {
    chainId: deps.contracts.chainId,
    include,
    distinctAgentIdAddresses: all?.n ?? 0,
    events: all?.events ?? 0,
    firstAt: all?.first_at ?? null, lastAt: all?.last_at ?? null,
    byAction: Object.fromEntries(rows.filter((r: any) => r.name !== "*").map((r: any) => [r.name, { distinctAddresses: r.n, events: r.events }])),
    linkedAgentIdWallets: linked?.n ?? 0,
    method: "Distinct lowercase actor addresses of Agent-ID-gated user-action events on ATLAS contracts (IdentityRegistered.wallet, ThesisCommitted/ThesisPublished.author, ReviewPublished.reviewer, EvidenceChallenged/OutcomeChallenged.challenger, PaymentSent.sender), from the reorg-aware indexer. Excludes evaluator proposals, permissionless finalizations, owner actions, payment recipients and anything not mined. `final` (default) counts only events at final depth.",
  };
}
