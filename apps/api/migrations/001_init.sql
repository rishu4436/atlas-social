-- ATLAS Social schema v1.
-- Ownership model: every private row is keyed by users.id (UUID). Agent ID is an external, exclusive identity
-- association (agent_id_links), never a relational key. Row-level security is enabled on private tables as
-- defense in depth; the API connects as atlas_app (no BYPASSRLS) and sets app.user_id per transaction.

-- gen_random_uuid() is built in (PostgreSQL 13+)

CREATE OR REPLACE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  kind        text NOT NULL DEFAULT 'human' CHECK (kind IN ('human','ai_agent')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  role    text NOT NULL CHECK (role IN ('moderator','admin')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Production uses chain 56 only; 97/31337 exist for testnet/local development and are refused by the API in production.
CREATE TABLE agent_id_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  chain_id        bigint NOT NULL CHECK (chain_id IN (56, 97, 31337)),
  agent_contract  text NOT NULL CHECK (agent_contract ~ '^0x[0-9a-f]{40}$'),
  token_id        numeric(78,0) NOT NULL,
  handle          text NOT NULL,
  wallet_address  text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  method          text NOT NULL CHECK (method IN ('eip712','erc1271','onchain','mock')),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
-- one permanent active Agent ID per account; one account per Agent ID; one account per wallet
CREATE UNIQUE INDEX one_active_link_per_user  ON agent_id_links (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX one_account_per_agent_id  ON agent_id_links (chain_id, agent_contract, token_id);
CREATE UNIQUE INDEX one_active_agent_wallet   ON agent_id_links (chain_id, wallet_address) WHERE revoked_at IS NULL;

CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  agent_name    text NOT NULL UNIQUE,          -- handle.ai, copied from the verified Agent ID; display only
  display_name  text NOT NULL,
  bio           text NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  avatar_url    text,
  topics        text[] NOT NULL DEFAULT '{}',
  is_ai_agent   boolean NOT NULL DEFAULT false,
  ai_operator   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_settings (
  user_id            uuid PRIMARY KEY REFERENCES users(id),
  show_wallet        boolean NOT NULL DEFAULT false,
  dm_policy          text NOT NULL DEFAULT 'following' CHECK (dm_policy IN ('everyone','following','nobody')),
  show_follows       boolean NOT NULL DEFAULT true,
  personalized_feed  boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_challenges (
  id            uuid PRIMARY KEY,                -- loginId in the signed message
  wallet        text NOT NULL,
  nonce         text NOT NULL UNIQUE,
  chain_id      bigint NOT NULL,
  audience      text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('login','step-up')),
  user_id       uuid REFERENCES users(id),        -- step-up only
  issued_at     timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  payload       jsonb NOT NULL
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  token_hash          text NOT NULL UNIQUE,
  csrf_hash           text NOT NULL,
  auth_method         text NOT NULL CHECK (auth_method IN ('wallet','passkey')),
  wallet_verified_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  user_agent          text,
  ip_hash             text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE passkeys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  credential_id  text NOT NULL UNIQUE,
  public_key     bytea NOT NULL,
  counter        bigint NOT NULL DEFAULT 0,
  transports     text[] NOT NULL DEFAULT '{}',
  name           text NOT NULL DEFAULT 'Passkey',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE TABLE webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('register','login')),
  challenge   text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE squads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  owner_id     uuid NOT NULL REFERENCES users(id),
  topics       text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE squad_members (
  squad_id   uuid NOT NULL REFERENCES squads(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_id, user_id)
);
CREATE TABLE squad_watchlist (
  squad_id  uuid NOT NULL REFERENCES squads(id),
  asset     text NOT NULL,
  added_by  uuid NOT NULL REFERENCES users(id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_id, asset)
);

CREATE TABLE theses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id             uuid NOT NULL REFERENCES users(id),
  author_wallet         text NOT NULL,
  chain_id              bigint NOT NULL,
  registry              text NOT NULL,
  asset                 text NOT NULL,
  symbol                text NOT NULL,
  direction             text NOT NULL CHECK (direction IN ('LONG','SHORT')),
  entry_kind            text NOT NULL,
  entry_price           numeric,
  target_price          numeric NOT NULL,
  invalidation_price    numeric NOT NULL,
  horizon_hours         int NOT NULL,
  confidence            int NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  visibility            text NOT NULL CHECK (visibility IN ('PUBLIC','COMMIT_REVEAL')),
  content               jsonb NOT NULL,
  content_hash          text NOT NULL,
  terms                 jsonb NOT NULL,          -- canonical on-chain terms (bigints as strings)
  salt                  text NOT NULL,           -- private until reveal (RLS: drafts visible to author only)
  commitment            text NOT NULL,
  chain_status          text NOT NULL DEFAULT 'draft' CHECK (chain_status IN ('draft','committed','published','cancelled')),
  onchain_id            numeric(78,0),
  publish_tx            text,
  publish_block         bigint,
  start_time            timestamptz,
  published_at          timestamptz,
  cancelled_after_start boolean NOT NULL DEFAULT false,
  outcome               text NOT NULL DEFAULT 'Open',
  outcome_state         text,                    -- Proposed / Challenged / Final (on-chain)
  return_bps            int,
  resolved_at           timestamptz,
  evidence              jsonb,
  evidence_hash         text,
  squad_id              uuid REFERENCES squads(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, registry, commitment)
);
CREATE UNIQUE INDEX theses_onchain ON theses (chain_id, registry, onchain_id) WHERE onchain_id IS NOT NULL;
CREATE INDEX theses_author ON theses (author_id, created_at DESC);

CREATE TABLE thesis_corrections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id  uuid NOT NULL REFERENCES theses(id),
  note       text NOT NULL,
  note_hash  text NOT NULL,
  tx_hash    text,
  idx        int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  chain_id    bigint NOT NULL,
  tx_hash     text NOT NULL,
  status      text NOT NULL CHECK (status IN ('VERIFIED','PENDING','REJECTED')),
  reasons     text[] NOT NULL DEFAULT '{}',
  evidence    jsonb,
  evidence_hash text,
  thesis_id   uuid REFERENCES theses(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
-- a transaction can be claimed (verified) by exactly one account
CREATE UNIQUE INDEX trade_proof_unique_verified ON trade_proofs (chain_id, tx_hash) WHERE status <> 'REJECTED';

CREATE TABLE posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id          uuid NOT NULL REFERENCES users(id),
  kind               text NOT NULL CHECK (kind IN ('post','chart','poll','thesis','trade','ai_research','squad')),
  body               text NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  topics             text[] NOT NULL DEFAULT '{}',
  mentions           uuid[] NOT NULL DEFAULT '{}',
  links              text[] NOT NULL DEFAULT '{}',
  link_warnings      text[] NOT NULL DEFAULT '{}',
  chart              jsonb,
  poll               jsonb,
  ai_report          jsonb,
  media              jsonb NOT NULL DEFAULT '[]',
  thesis_id          uuid REFERENCES theses(id),
  trade_proof_id     uuid REFERENCES trade_proofs(id),
  squad_id           uuid REFERENCES squads(id),
  reply_to           uuid REFERENCES posts(id),
  repost_of          uuid REFERENCES posts(id),
  moderation_status  text NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible','limited','removed')),
  moderation_note    text,
  simulated          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX posts_author ON posts (author_id, created_at DESC);
CREATE INDEX posts_created ON posts (created_at DESC);
CREATE INDEX posts_topics ON posts USING gin (topics);

CREATE TABLE poll_votes (
  post_id uuid NOT NULL REFERENCES posts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  option  int NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            uuid NOT NULL REFERENCES posts(id),
  author_id          uuid NOT NULL REFERENCES users(id),
  body               text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  moderation_status  text NOT NULL DEFAULT 'visible',
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX comments_post ON comments (post_id, created_at);

CREATE TABLE reactions (
  post_id  uuid NOT NULL REFERENCES posts(id),
  user_id  uuid NOT NULL REFERENCES users(id),
  kind     text NOT NULL CHECK (kind IN ('like','repost','not_interested')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, kind)
);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id),
  followee_id uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows (followee_id);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id   uuid NOT NULL REFERENCES theses(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  stance      text NOT NULL CHECK (stance IN ('ENDORSE','DISPUTE','NEUTRAL')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  content_hash text NOT NULL,
  onchain_status text NOT NULL DEFAULT 'offchain' CHECK (onchain_status IN ('offchain','published')),
  tx_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thesis_id, reviewer_id)
);

CREATE TABLE evidence_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id     uuid NOT NULL REFERENCES theses(id),
  challenger_id uuid REFERENCES users(id),
  kind          text NOT NULL,
  evidence_hash text NOT NULL,
  reason        text,
  reason_hash   text NOT NULL,
  tx_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- private tables (RLS)

CREATE TABLE bookmarks (
  user_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES posts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE notes (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  subject text NOT NULL,
  body    text NOT NULL CHECK (length(body) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE watchlists (
  user_id uuid NOT NULL REFERENCES users(id),
  asset   text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset)
);
CREATE TABLE mutes (
  user_id  uuid NOT NULL REFERENCES users(id),
  muted_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (user_id, muted_id)
);
CREATE TABLE blocks (
  user_id    uuid NOT NULL REFERENCES users(id),
  blocked_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (user_id, blocked_id)
);
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  subject_id  text,
  data        jsonb NOT NULL DEFAULT '{}',
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE TABLE notification_prefs (
  user_id      uuid PRIMARY KEY REFERENCES users(id),
  muted_kinds  text[] NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
-- encrypted at rest (AES-256-GCM, server-held key). NOT end-to-end encrypted.
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id),
  sender_id        uuid NOT NULL REFERENCES users(id),
  ciphertext       bytea NOT NULL,
  iv               bytea NOT NULL,
  tag              bytea NOT NULL,
  key_version      int NOT NULL DEFAULT 1,
  link_warnings    text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv ON messages (conversation_id, created_at);

CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES users(id),
  target_kind  text NOT NULL CHECK (target_kind IN ('post','comment','user','message','squad')),
  target_id    text NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('spam','scam','impersonation','harassment','manipulation','illegal','other')),
  details      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_kind, target_id)
);
CREATE TABLE moderation_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id  uuid NOT NULL REFERENCES users(id),
  report_id     uuid REFERENCES reports(id),
  target_kind   text NOT NULL,
  target_id     text NOT NULL,
  target_user_id uuid REFERENCES users(id),
  action        text NOT NULL CHECK (action IN ('remove','limit','restore','dismiss','suspend')),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE appeals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  action_id   uuid NOT NULL REFERENCES moderation_actions(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 10 AND 3000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','reversed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action_id)
);

CREATE TABLE security_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  kind       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id),
  sha256        text NOT NULL,
  storage_key   text NOT NULL,
  content_type  text NOT NULL,
  size          int NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('avatar','post','evidence')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_snapshots (
  user_id     uuid NOT NULL REFERENCES users(id),
  methodology text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  stats       jsonb NOT NULL,
  PRIMARY KEY (user_id, methodology)
);

-- market data cache (hypertable when TimescaleDB is available)
CREATE TABLE candles (
  symbol     text NOT NULL,
  interval   text NOT NULL,
  open_time  timestamptz NOT NULL,
  open numeric NOT NULL, high numeric NOT NULL, low numeric NOT NULL, close numeric NOT NULL, volume numeric NOT NULL,
  source     text NOT NULL,
  PRIMARY KEY (symbol, interval, open_time)
);

-- chain indexer state
CREATE TABLE chain_blocks (
  chain_id bigint NOT NULL,
  number   bigint NOT NULL,
  hash     text NOT NULL,
  PRIMARY KEY (chain_id, number)
);
CREATE TABLE chain_cursor (
  chain_id bigint PRIMARY KEY,
  block    bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chain_events (
  id           text PRIMARY KEY,
  chain_id     bigint NOT NULL,
  contract     text NOT NULL,
  name         text NOT NULL,
  args         jsonb NOT NULL,
  address      text NOT NULL,
  block_number bigint NOT NULL,
  block_hash   text NOT NULL,
  block_time   timestamptz NOT NULL,
  log_index    int NOT NULL,
  tx_hash      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('provisional','final'))
);
CREATE INDEX chain_events_block ON chain_events (chain_id, block_number);

-- ---------------------------------------------------------------- row-level security
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','passkeys','bookmarks','notes','watchlists','mutes','blocks','notifications','notification_prefs','privacy_settings','appeals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_only ON %I USING (user_id = app_uid()) WITH CHECK (user_id = app_uid())', t);
  END LOOP;
END $$;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY reporter_only ON reports USING (reporter_id = app_uid()) WITH CHECK (reporter_id = app_uid());

-- drafts are private to their author; published/committed theses are public (salt is only exposed by the API after reveal)
ALTER TABLE theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE theses FORCE ROW LEVEL SECURITY;
CREATE POLICY thesis_read ON theses FOR SELECT USING (chain_status <> 'draft' OR author_id = app_uid());
CREATE POLICY thesis_insert ON theses FOR INSERT WITH CHECK (author_id = app_uid());
CREATE POLICY thesis_update ON theses FOR UPDATE USING (author_id = app_uid());

-- trade proofs: verified proofs are public, others visible to the claimant only
ALTER TABLE trade_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_proofs FORCE ROW LEVEL SECURITY;
CREATE POLICY proof_read ON trade_proofs FOR SELECT USING (status = 'VERIFIED' OR user_id = app_uid());
CREATE POLICY proof_write ON trade_proofs FOR INSERT WITH CHECK (user_id = app_uid());

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION is_member(conv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = conv AND m.user_id = app_uid()) $$;
CREATE POLICY member_read ON conversation_members FOR SELECT USING (is_member(conversation_id));
CREATE POLICY member_update ON conversation_members FOR UPDATE USING (user_id = app_uid());
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY msg_read ON messages FOR SELECT USING (is_member(conversation_id));
CREATE POLICY msg_write ON messages FOR INSERT WITH CHECK (sender_id = app_uid() AND is_member(conversation_id));

-- application role (no BYPASSRLS). Password set from env by the migrator.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN CREATE ROLE atlas_app LOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;
-- immutable history: the app role cannot delete theses, corrections, chain events or moderation history
REVOKE DELETE ON theses, thesis_corrections, chain_events, moderation_actions, security_events, trade_proofs FROM atlas_app;
