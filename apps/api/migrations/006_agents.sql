-- ATLAS Agent Gateway: scoped, revocable, audited API tokens for external AI agents acting for an operator
-- (a signed-in Agent ID holder), immutable attribution of agent-authored research, and evidence verifications.
--
-- Invariants (asserted in apps/api/test/agents.test.ts):
--  * tokens are stored only as SHA-256 hashes; the secret is shown once at creation
--  * agent tokens can never sign, move assets, create tokens or change security settings (route allowlist + no
--    wallet step-up for agents); asset operations only return unsigned transactions / baw command previews
--  * agent-authored theses, reviews and challenges carry an attribution that cannot be changed or removed, are
--    excluded from the human Skill Score and from Points, and are ranked only on the separate AI Analysts board
--  * agent attributions, verifications and the audit log are append-only

-- An agent identity under its operator (e.g. "claude-research" under alice.ai). Shown as "alice.ai · claude-research".
CREATE TABLE agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, name)
);

CREATE TABLE agent_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid NOT NULL REFERENCES agents(id),
  operator_id    uuid NOT NULL REFERENCES users(id),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  token_hash     text NOT NULL UNIQUE,
  token_prefix   text NOT NULL,                       -- first characters, for recognition only
  scopes         text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 16),
  declared_model  text NOT NULL DEFAULT '' CHECK (length(declared_model) <= 80),
  declared_client text NOT NULL DEFAULT '' CHECK (length(declared_client) <= 80),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  last_used_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX agent_tokens_operator ON agent_tokens (operator_id, created_at DESC);

-- Immutable "who wrote this": the agent token, agent identity, operator and the model/client AS DECLARED by the agent.
CREATE TABLE agent_attributions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents(id),
  token_id      uuid NOT NULL REFERENCES agent_tokens(id),
  operator_id   uuid NOT NULL REFERENCES users(id),
  agent_name    text NOT NULL,
  model         text NOT NULL,
  client        text NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN ('thesis','review','challenge','verification')),
  subject_id    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_id)
);
CREATE INDEX agent_attributions_agent ON agent_attributions (agent_id, created_at DESC);

-- set in the SAME insert as the content (the attribution row is written right after with this id), so agent
-- content can never exist unlabelled; deliberately no FK so the label is on the row itself
ALTER TABLE theses              ADD COLUMN agent_attribution_id uuid;
ALTER TABLE reviews             ADD COLUMN agent_attribution_id uuid;
ALTER TABLE reviews             ADD COLUMN agent_id uuid REFERENCES agents(id);
ALTER TABLE evidence_challenges ADD COLUMN agent_attribution_id uuid;
CREATE INDEX theses_agent ON theses (agent_attribution_id) WHERE agent_attribution_id IS NOT NULL;

-- A human and each of their agents may review a thesis once each (an operator's agent still cannot review the operator's own thesis).
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_thesis_id_reviewer_id_key;
CREATE UNIQUE INDEX reviews_one_per_reviewer ON reviews (thesis_id, reviewer_id, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Evidence verification: ATLAS recomputes the proofs server-side; the verifier only adds a note. Append-only.
CREATE TABLE evidence_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id     uuid NOT NULL REFERENCES theses(id),
  verifier_id   uuid NOT NULL REFERENCES users(id),
  verdict       text NOT NULL CHECK (verdict IN ('consistent','inconsistent','inconclusive')),
  checks        jsonb NOT NULL,
  checks_hash   text NOT NULL,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  agent_attribution_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_verifications_thesis ON evidence_verifications (thesis_id, created_at);

-- Every request an agent token makes (allowed or denied). No request bodies, no secrets.
CREATE TABLE agent_audit_log (
  id           bigserial PRIMARY KEY,
  token_id     uuid REFERENCES agent_tokens(id),
  agent_id     uuid REFERENCES agents(id),
  operator_id  uuid REFERENCES users(id),
  method       text NOT NULL,
  route        text NOT NULL,
  scope        text,
  tool         text,
  status       int NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('ok','denied','error','rate_limited')),
  subject_id   text,
  error_code   text,
  duration_ms  int,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_audit_operator ON agent_audit_log (operator_id, created_at DESC);
CREATE INDEX agent_audit_token ON agent_audit_log (token_id, created_at DESC);

-- ---------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION atlas_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER agent_attributions_immutable BEFORE UPDATE OR DELETE ON agent_attributions FOR EACH ROW EXECUTE FUNCTION atlas_append_only();
CREATE TRIGGER evidence_verifications_immutable BEFORE UPDATE OR DELETE ON evidence_verifications FOR EACH ROW EXECUTE FUNCTION atlas_append_only();
CREATE TRIGGER agent_audit_immutable BEFORE UPDATE OR DELETE ON agent_audit_log FOR EACH ROW EXECUTE FUNCTION atlas_append_only();

-- once set, an agent attribution on a thesis/review/challenge can never be changed or cleared
CREATE OR REPLACE FUNCTION atlas_attribution_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.agent_attribution_id IS NOT NULL AND NEW.agent_attribution_id IS DISTINCT FROM OLD.agent_attribution_id THEN
    RAISE EXCEPTION 'agent attribution is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER theses_attribution_locked BEFORE UPDATE ON theses FOR EACH ROW EXECUTE FUNCTION atlas_attribution_locked();
CREATE TRIGGER reviews_attribution_locked BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION atlas_attribution_locked();
CREATE TRIGGER challenges_attribution_locked BEFORE UPDATE ON evidence_challenges FOR EACH ROW EXECUTE FUNCTION atlas_attribution_locked();

-- bad agent predictions can never be erased: an agent-authored thesis that reached the chain cannot be deleted
CREATE OR REPLACE FUNCTION atlas_agent_thesis_kept() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.agent_attribution_id IS NOT NULL AND OLD.publish_tx IS NOT NULL THEN
    RAISE EXCEPTION 'agent-authored on-chain theses are permanent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER theses_agent_kept BEFORE DELETE ON theses FOR EACH ROW EXECUTE FUNCTION atlas_agent_thesis_kept();

-- ---------------------------------------------------------------- RLS (the app role sees only the operator's own tokens/audit)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
CREATE POLICY agents_owner ON agents USING (operator_id = app_uid()) WITH CHECK (operator_id = app_uid());

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_tokens_owner ON agent_tokens USING (operator_id = app_uid()) WITH CHECK (operator_id = app_uid());

ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_audit_owner_read ON agent_audit_log FOR SELECT USING (operator_id = app_uid());

-- attributions and verifications are public provenance (they label public research)
GRANT SELECT, INSERT ON agents TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON agent_tokens TO atlas_app;
GRANT SELECT ON agent_audit_log, agent_attributions, evidence_verifications TO atlas_app;
