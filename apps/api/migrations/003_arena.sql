-- ATLAS Arena 1.0: versioned methodologies, immutable leaderboard snapshots, append-only XP ledger,
-- derived levels and achievements, integrity flags and seasons. Realized-P&L tables (trading_lots,
-- realized_trade_results, risk_snapshots) are intentionally NOT created yet: they ship with Arena 2.0.

-- demo rows (local dev seed only) are labelled; production (chain 56) never contains them
ALTER TABLE theses ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;

-- evidence challenges get an adjudication status so "independently upheld" is an explicit moderator decision
ALTER TABLE evidence_challenges ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','rejected'));
ALTER TABLE evidence_challenges ADD COLUMN IF NOT EXISTS adjudicated_by uuid REFERENCES users(id);
ALTER TABLE evidence_challenges ADD COLUMN IF NOT EXISTS adjudicated_at timestamptz;
ALTER TABLE evidence_challenges ADD COLUMN IF NOT EXISTS adjudication_note text;

CREATE TABLE scoring_methodologies (
  id           text PRIMARY KEY,                 -- e.g. atlas-skill-v2
  board        text NOT NULL,
  version      int  NOT NULL,
  status       text NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','active','retired')),
  definition   jsonb NOT NULL,                   -- weights, eligibility, thresholds
  description  text NOT NULL,
  hash         text NOT NULL,                    -- sha256 of definition+description; a changed rule needs a new id
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leaderboard_seasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','final')),
  final_snapshot_ids uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE leaderboard_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board              text NOT NULL CHECK (board IN ('analysts','consistency','rising','contributors')),
  time_window        text NOT NULL CHECK (time_window IN ('24h','7d','30d','90d','all')),
  methodology_id     text NOT NULL REFERENCES scoring_methodologies(id),
  as_of              timestamptz NOT NULL,       -- evidence cut-off
  computed_at        timestamptz NOT NULL DEFAULT now(),
  finalized_block    bigint,
  evidence_coverage  numeric NOT NULL,
  sample_size        int NOT NULL,
  entry_count        int NOT NULL,
  input_hash         text NOT NULL,              -- hash of the evidence that produced it
  idempotency_key    text NOT NULL UNIQUE,       -- board:window:methodology:input_hash (same inputs -> same snapshot)
  backfill           boolean NOT NULL DEFAULT false,
  demo               boolean NOT NULL DEFAULT false,
  season_id          uuid REFERENCES leaderboard_seasons(id)
);
CREATE INDEX leaderboard_snapshots_latest ON leaderboard_snapshots (board, time_window, methodology_id, as_of DESC);

CREATE TABLE leaderboard_entries (
  snapshot_id  uuid NOT NULL REFERENCES leaderboard_snapshots(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  rank         int,                              -- NULL: listed (Emerging/Unranked) but not ranked
  tier         text NOT NULL CHECK (tier IN ('Established','Ranked','Emerging','Unranked')),
  score        numeric NOT NULL,
  components   jsonb NOT NULL,
  sample       jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, user_id)
);
CREATE INDEX leaderboard_entries_user ON leaderboard_entries (user_id);

CREATE TABLE point_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  kind             text NOT NULL CHECK (kind IN ('onboarding','thesis_published','thesis_resolved','review','challenge_upheld','evidence_distinction','squad_milestone')),
  xp               int NOT NULL CHECK (xp >= 0 AND xp <= 100),
  idempotency_key  text NOT NULL UNIQUE,
  source_id        text NOT NULL,
  rules_version    text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX point_events_user ON point_events (user_id, occurred_at DESC);

-- derived cache only: always recomputed as SUM(point_events.xp); never incremented in place
CREATE TABLE user_levels (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  xp             int NOT NULL,
  level          int NOT NULL,
  rules_version  text NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE achievements (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  icon         text NOT NULL
);

CREATE TABLE user_achievements (
  user_id         uuid NOT NULL REFERENCES users(id),
  achievement_id  text NOT NULL REFERENCES achievements(id),
  earned_at       timestamptz NOT NULL,
  evidence_key    text NOT NULL,                 -- the point_events idempotency key that earned it
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE ranking_integrity_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  thesis_id        uuid REFERENCES theses(id),
  kind             text NOT NULL CHECK (kind IN ('near_duplicate','unreliable_price','wash_activity','sybil_suspected','manual')),
  severity         text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','exclude')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
  detail           jsonb NOT NULL DEFAULT '{}',
  idempotency_key  text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  adjudicated_at   timestamptz
);
CREATE INDEX ranking_integrity_flags_user ON ranking_integrity_flags (user_id, status);

-- ---------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION arena_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (immutable history)', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER point_events_append_only BEFORE UPDATE OR DELETE ON point_events FOR EACH ROW EXECUTE FUNCTION arena_immutable();
CREATE TRIGGER snapshots_immutable BEFORE UPDATE OR DELETE ON leaderboard_snapshots FOR EACH ROW EXECUTE FUNCTION arena_immutable();
CREATE TRIGGER entries_immutable BEFORE UPDATE OR DELETE ON leaderboard_entries FOR EACH ROW EXECUTE FUNCTION arena_immutable();
CREATE TRIGGER methodologies_immutable BEFORE UPDATE OR DELETE ON scoring_methodologies FOR EACH ROW EXECUTE FUNCTION arena_immutable();

-- ---------------------------------------------------------------- row-level security
-- The XP ledger is private history: through the app role a user only sees their own events (public surfaces use
-- aggregated balances computed in system context). Writes happen only in system context (the points engine).
ALTER TABLE point_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_events FORCE ROW LEVEL SECURITY;
CREATE POLICY point_events_owner_read ON point_events FOR SELECT USING (user_id = app_uid());

-- integrity flags: visible to the flagged user only (moderators use system context)
ALTER TABLE ranking_integrity_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_integrity_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY integrity_flags_owner_read ON ranking_integrity_flags FOR SELECT USING (user_id = app_uid());

-- public, read-only for the app role
GRANT SELECT ON scoring_methodologies, leaderboard_seasons, leaderboard_snapshots, leaderboard_entries, user_levels, achievements, user_achievements TO atlas_app;
