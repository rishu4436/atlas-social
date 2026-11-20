-- Audit 2026-11-20 F1 + F5: durable outcome proposal state machine (outbox) and worker bookkeeping.
--
-- Before this migration the evaluator wrote theses.outcome and then attempted proposeOutcome; the worker only
-- selected outcome = 'Open', so a failed transaction was never retried. Proposal state now lives in its own
-- table, independent of the evaluated outcome:
--   EVALUATED          evaluated off-chain; not queued for an on-chain proposal (e.g. unscorable, nothing to propose)
--   PROPOSAL_PENDING   queued; eligible when next_retry_at <= now() (failed attempts return here with backoff)
--   PROPOSAL_BROADCAST a signed tx (hash + nonce + raw bytes persisted BEFORE sending) awaits its receipt
--   PROPOSED_ONCHAIN   the registry holds a Proposed attestation (dispute window running; finalize is permissionless)
--   CHALLENGED         an Agent ID holder challenged it on-chain; a re-proposal needs human review
--   FINALIZED          the registry state is Final (verified rankings count only these)
CREATE TABLE outcome_proposals (
  thesis_id        uuid PRIMARY KEY REFERENCES theses(id),
  chain_id         bigint NOT NULL,
  registry         text NOT NULL,                 -- AtlasOutcomeRegistry address (lowercase)
  onchain_id       numeric(78,0) NOT NULL,        -- thesis id in AtlasThesisRegistry
  state            text NOT NULL CHECK (state IN ('EVALUATED','PROPOSAL_PENDING','PROPOSAL_BROADCAST','PROPOSED_ONCHAIN','CHALLENGED','FINALIZED')),
  outcome          text NOT NULL,                 -- evaluated outcome name (OUTCOME_NAMES)
  outcome_kind     smallint NOT NULL,
  observed_at      bigint,
  observed_price   numeric(78,0),                 -- price8
  evidence         jsonb,
  evidence_hash    text,
  note             text,                          -- why a row is EVALUATED-only, or the challenge note
  -- the single in-flight transaction (propose or finalize); persisted before broadcast so a crash can rebroadcast the same bytes
  tx_kind          text CHECK (tx_kind IN ('propose','finalize')),
  tx_hash          text,
  tx_nonce         bigint,
  tx_from          text,
  tx_raw           text,
  broadcast_at     timestamptz,
  propose_tx       text,                          -- confirmed proposeOutcome tx
  finalize_tx      text,                          -- confirmed finalizeOutcome tx (if ATLAS sent it)
  onchain_outcome  text,                          -- as read from the registry
  onchain_round    int,
  proposed_at      bigint,                        -- registry proposedAt (unix s)
  attempts         int NOT NULL DEFAULT 0,
  last_error       text,
  next_retry_at    timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outcome_proposals_due ON outcome_proposals (next_retry_at) WHERE state IN ('PROPOSAL_PENDING','PROPOSAL_BROADCAST','PROPOSED_ONCHAIN');

-- Append-only attempt log (evidence for every broadcast / failure / reconciliation decision).
CREATE TABLE outcome_proposal_events (
  id          bigserial PRIMARY KEY,
  thesis_id   uuid NOT NULL REFERENCES theses(id),
  kind        text NOT NULL,      -- evaluated / queued / broadcast / rebroadcast / mined / reverted / dropped / failed / reconciled / finalized / challenged
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outcome_proposal_events_thesis ON outcome_proposal_events (thesis_id, id);

-- Single-runner leases (one evaluator signer at a time => nonce safety; a duplicate worker run is a no-op).
CREATE TABLE worker_leases (
  name        text PRIMARY KEY,
  owner       text NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- Heartbeats for /health/workers.
CREATE TABLE worker_runs (
  name                 text PRIMARY KEY,
  last_started_at      timestamptz,
  last_finished_at     timestamptz,
  last_ok_at           timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  runs                 bigint NOT NULL DEFAULT 0,
  detail               jsonb NOT NULL DEFAULT '{}'
);

-- Backfill (safe, idempotent): on-chain states the indexer already projected onto theses.
INSERT INTO outcome_proposals (thesis_id, chain_id, registry, onchain_id, state, outcome, outcome_kind, evidence, evidence_hash, onchain_outcome, note)
SELECT t.id, t.chain_id, '', t.onchain_id,
       CASE t.outcome_state WHEN 'Final' THEN 'FINALIZED' WHEN 'Challenged' THEN 'CHALLENGED' ELSE 'PROPOSED_ONCHAIN' END,
       t.outcome,
       CASE t.outcome WHEN 'TargetHit' THEN 1 WHEN 'InvalidationHit' THEN 2 WHEN 'Expired' THEN 3 WHEN 'Unresolved' THEN 4 WHEN 'Void' THEN 5 WHEN 'Forfeited' THEN 6 ELSE 0 END,
       t.evidence, t.evidence_hash, t.outcome, 'backfilled from indexed outcome_state'
  FROM theses t
 WHERE t.onchain_id IS NOT NULL AND t.outcome_state IN ('Proposed','Challenged','Final')
ON CONFLICT (thesis_id) DO NOTHING;

-- Backfill: theses the old worker resolved off-chain (outcome set, never proposed) are queued for a proposal.
-- observed_at / observed_price come from the stored, hash-checked evidence, and the worker re-reads the registry before sending.
INSERT INTO outcome_proposals (thesis_id, chain_id, registry, onchain_id, state, outcome, outcome_kind, observed_at, observed_price, evidence, evidence_hash, note)
SELECT t.id, t.chain_id, '', t.onchain_id,
       CASE WHEN t.scoring_status = 'unscorable' THEN 'EVALUATED' ELSE 'PROPOSAL_PENDING' END,
       t.outcome,
       CASE t.outcome WHEN 'TargetHit' THEN 1 WHEN 'InvalidationHit' THEN 2 WHEN 'Expired' THEN 3 WHEN 'Unresolved' THEN 4 WHEN 'Void' THEN 5 ELSE 0 END,
       nullif(t.evidence->'result'->>'observedAt','')::numeric::bigint,
       CASE WHEN t.evidence->'result'->>'exitPrice' IS NULL THEN NULL ELSE round((t.evidence->'result'->>'exitPrice')::numeric * 100000000) END,
       t.evidence, t.evidence_hash,
       CASE WHEN t.scoring_status = 'unscorable' THEN 'unscorable: no allowed real price source (not proposed)' ELSE 'backfilled: resolved off-chain before the proposal outbox existed' END
  FROM theses t
 WHERE t.onchain_id IS NOT NULL AND t.chain_status = 'published' AND t.evidence_hash IS NOT NULL
   AND t.outcome IN ('TargetHit','InvalidationHit','Expired','Unresolved')
   AND (t.outcome_state IS NULL OR t.outcome_state = 'Evaluated')
ON CONFLICT (thesis_id) DO NOTHING;

-- registry is filled in by the worker on first touch (the migration cannot know the deployment address)
REVOKE ALL ON outcome_proposals, outcome_proposal_events, worker_leases, worker_runs FROM PUBLIC;
