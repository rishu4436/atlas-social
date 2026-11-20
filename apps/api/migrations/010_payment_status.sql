-- Audit 2026-11-20 F3/F4: honest payment lifecycle, single-settlement payment requests, salted memo commitments.
-- Nothing here changes the deployed AtlasPay contract or its event format.

-- F4 memo commitments. Rows written before this migration used the deterministic v1 hash (keccak-utf8-v1).
-- New intents store a random 32-byte salt and memoHash = keccak256(salt || "atlas-pay-memo:v2:" || memo).
-- The salt is readable only by the two parties (payment_intents RLS: sender or recipient).
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS memo_salt text CHECK (memo_salt IS NULL OR memo_salt ~ '^0x[0-9a-f]{64}$');
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS memo_scheme text NOT NULL DEFAULT 'keccak-utf8-v1' CHECK (memo_scheme IN ('keccak-utf8-v1','salted-keccak-v2'));
-- the exact unsigned steps the sender reviewed (to, data, value), so a reported tx can be checked against them
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS steps jsonb;

-- F4 single settlement. A request is settled ONLY by its first FINAL matching PaymentSent event (settled_event_id).
-- While a matching tx is broadcast or provisionally indexed, a pending lock blocks new prepares until it expires,
-- the tx fails (reverted, replaced, dropped) or the request settles.
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS pending_tx_hash text;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS pending_until timestamptz;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS settled_event_id text;

-- Requests marked paid by a provisional event before this migration: keep them settled only if that event is final now
UPDATE payment_requests q SET settled_event_id = x.event_id
  FROM payments x WHERE q.status = 'paid' AND q.settled_event_id IS NULL AND x.tx_hash = q.paid_tx_hash AND x.status = 'final';
UPDATE payment_requests SET status = 'open', pending_tx_hash = paid_tx_hash, pending_until = now() + interval '24 hours', paid_tx_hash = NULL
  WHERE status = 'paid' AND settled_event_id IS NULL;

-- F3 lifecycle. Every tx hash a sender reports (ATLAS Connect, browser wallet or pasted hash), checked against the
-- reviewed step. stage: broadcast | mined | confirmed | finalized | reverted | replaced | dropped | approval_mined.
CREATE TABLE IF NOT EXISTS payment_txs (
  tx_hash            text PRIMARY KEY CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id           bigint NOT NULL,
  pay_intent_id      uuid REFERENCES payment_intents(id),
  connect_intent_id  uuid,
  step               int NOT NULL,
  step_kind          text NOT NULL CHECK (step_kind IN ('approve','pay','transfer')),
  sender_id          uuid NOT NULL REFERENCES users(id),
  from_wallet        text NOT NULL,
  nonce              bigint,
  stage              text NOT NULL DEFAULT 'broadcast',
  block_number       bigint,
  reported_via       text NOT NULL CHECK (reported_via IN ('connect','browser','manual')),
  reported_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_txs_intent ON payment_txs (pay_intent_id);
CREATE INDEX IF NOT EXISTS payment_txs_open ON payment_txs (updated_at) WHERE stage IN ('broadcast','mined','confirmed');
