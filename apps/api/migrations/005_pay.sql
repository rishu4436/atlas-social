-- ATLAS Pay: non-custodial Agent ID → Agent ID payments through the AtlasPay contract.
-- Payments NEVER feed reputation, Arena Skill Score, points, levels or achievements: no table here is read by
-- the reputation/arena engines, and no trigger links them (asserted in apps/api/test/pay.test.ts).
-- No wallet addresses are searchable: addresses here are copies of on-chain receipt data, visible only to the
-- two parties through RLS; there is no name → address directory.

ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS accept_payments boolean NOT NULL DEFAULT true;

-- Shareable request: an amount + asset the payer authorizes independently in their own wallet.
CREATE TABLE payment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id),
  payer_id      uuid REFERENCES users(id),                 -- null = anyone with the link
  asset         text NOT NULL CHECK (asset IN ('BNB','USDT')),
  amount        text NOT NULL CHECK (amount ~ '^[0-9]+(\.[0-9]{1,18})?$'),
  amount_wei    numeric(78,0) NOT NULL CHECK (amount_wei > 0),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 140),
  context_kind  text NOT NULL CHECK (context_kind IN ('link','post','dm')),
  context_id    uuid,                                       -- post or conversation id (never message content)
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  paid_tx_hash  text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (payer_id IS NULL OR payer_id <> requester_id)
);
CREATE INDEX payment_requests_requester ON payment_requests (requester_id, created_at DESC);

-- What the sender was shown and approved in the ATLAS send sheet (before signing). Not a payment.
CREATE TABLE payment_intents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id           uuid NOT NULL REFERENCES users(id),
  recipient_id        uuid NOT NULL REFERENCES users(id),
  chain_id            bigint NOT NULL,
  pay_contract        text NOT NULL,
  asset               text NOT NULL CHECK (asset IN ('BNB','USDT')),
  amount_wei          numeric(78,0) NOT NULL CHECK (amount_wei > 0),
  kind                text NOT NULL CHECK (kind IN ('direct','tip','request')),
  context_kind        text NOT NULL CHECK (context_kind IN ('profile','post','thesis','dm','request')),
  context_id          uuid,
  request_id          uuid REFERENCES payment_requests(id),
  context_ref         text NOT NULL UNIQUE CHECK (context_ref ~ '^0x[0-9a-f]{64}$'),
  memo                text NOT NULL DEFAULT '' CHECK (length(memo) <= 140),
  memo_hash           text NOT NULL,
  expected_recipient  text NOT NULL,
  recipient_token_id  numeric(78,0) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX payment_intents_sender ON payment_intents (sender_id, created_at DESC);

-- Receipts, projected from AtlasPay PaymentSent events by the reorg-aware indexer (provisional → final).
CREATE TABLE payments (
  event_id            text PRIMARY KEY REFERENCES chain_events(id) ON DELETE CASCADE,
  chain_id            bigint NOT NULL,
  pay_contract        text NOT NULL,
  tx_hash             text NOT NULL,
  block_number        bigint NOT NULL,
  block_time          timestamptz NOT NULL,
  sender_wallet       text NOT NULL,
  recipient_wallet    text NOT NULL,
  sender_token_id     numeric(78,0) NOT NULL,
  recipient_token_id  numeric(78,0) NOT NULL,
  sender_id           uuid REFERENCES users(id),
  recipient_id        uuid REFERENCES users(id),
  token               text NOT NULL,
  asset               text NOT NULL,
  amount_wei          numeric(78,0) NOT NULL,
  kind                text NOT NULL,
  context_ref         text NOT NULL,
  memo_hash           text NOT NULL,
  intent_id           uuid REFERENCES payment_intents(id),
  status              text NOT NULL CHECK (status IN ('provisional','final'))
);
CREATE INDEX payments_sender ON payments (sender_id, block_time DESC);
CREATE INDEX payments_recipient ON payments (recipient_id, block_time DESC);
CREATE INDEX payments_tx ON payments (chain_id, tx_hash);

ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests FORCE ROW LEVEL SECURITY;
-- the requester, the named payer, conversation members (DM card) or anyone holding a link/post request id
CREATE POLICY payreq_read ON payment_requests FOR SELECT USING (
  requester_id = app_uid() OR payer_id = app_uid() OR (context_kind = 'dm' AND is_member(context_id)) OR context_kind IN ('link','post'));
CREATE POLICY payreq_insert ON payment_requests FOR INSERT WITH CHECK (requester_id = app_uid());
CREATE POLICY payreq_update ON payment_requests FOR UPDATE USING (requester_id = app_uid());

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY intents_party_read ON payment_intents FOR SELECT USING (sender_id = app_uid() OR recipient_id = app_uid());
CREATE POLICY intents_sender_insert ON payment_intents FOR INSERT WITH CHECK (sender_id = app_uid());

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_party_read ON payments FOR SELECT USING (sender_id = app_uid() OR recipient_id = app_uid());
-- receipts are written only by the indexer (system context)

GRANT SELECT, INSERT, UPDATE ON payment_requests TO atlas_app;
GRANT SELECT, INSERT ON payment_intents TO atlas_app;
GRANT SELECT ON payments TO atlas_app;
