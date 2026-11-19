-- ATLAS Connect: browser-bound connection intents for "Continue with Binance Agentic Wallet".
-- The public connection code and the browser verifier are stored only as SHA-256 hashes.
-- System context only: the app role has no access (RLS on, no policies, privileges revoked).

ALTER TABLE login_challenges DROP CONSTRAINT IF EXISTS login_challenges_purpose_check;
ALTER TABLE login_challenges ADD CONSTRAINT login_challenges_purpose_check CHECK (purpose IN ('login','step-up','connect'));

-- "Agentic Wallet available" is a recent, time-limited wallet check on THIS session; record how it was made.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS wallet_check_source text
  CHECK (wallet_check_source IS NULL OR wallet_check_source IN ('signature','onchain','connect','step-up','connect-step-up'));
UPDATE sessions SET wallet_check_source = 'signature' WHERE wallet_verified_at IS NOT NULL AND wallet_check_source IS NULL;

CREATE TABLE connect_intents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash     text NOT NULL UNIQUE,              -- sha256(public ATC- code)
  browser_hash  text NOT NULL,                     -- sha256(browser verifier held in an httpOnly cookie)
  purpose       text NOT NULL CHECK (purpose IN ('login','step-up','pay')),
  user_id       uuid REFERENCES users(id),         -- step-up / pay: the signed-in user who created it
  session_id    uuid REFERENCES sessions(id),      -- step-up / pay: bound to that session
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','challenge_issued','approved','submitted','redeemed','failed','cancelled','expired')),
  stage         text,
  stage_detail  jsonb,
  login_id      uuid REFERENCES login_challenges(id),
  wallet        text,                              -- proven wallet (after signature verification)
  agent_name    text,
  token_id      text,
  proof_method  text CHECK (proof_method IS NULL OR proof_method IN ('signature','erc1271','tx')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb, -- pay: prepared unsigned steps + human summary
  result        jsonb,                             -- pay: verified tx hashes
  attempts      int NOT NULL DEFAULT 0,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  approved_at   timestamptz,
  redeemed_at   timestamptz,
  CHECK ((purpose = 'login') = (user_id IS NULL))
);
CREATE INDEX connect_intents_expires ON connect_intents (expires_at);
CREATE INDEX connect_intents_user ON connect_intents (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE connect_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON connect_intents FROM atlas_app;
