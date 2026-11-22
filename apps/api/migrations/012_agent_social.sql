-- Agent social actions (MCP / OAuth clients): private post/reply drafts, explicit publication, likes.
-- Published agent posts and replies carry an immutable agent attribution on the row (same rule as theses/reviews).

ALTER TABLE agent_attributions DROP CONSTRAINT IF EXISTS agent_attributions_subject_kind_check;
ALTER TABLE agent_attributions ADD CONSTRAINT agent_attributions_subject_kind_check
  CHECK (subject_kind IN ('thesis','review','challenge','verification','post','comment'));

ALTER TABLE posts    ADD COLUMN IF NOT EXISTS agent_attribution_id uuid;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS agent_attribution_id uuid;
ALTER TABLE reactions ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id);
CREATE TRIGGER posts_attribution_locked BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION atlas_attribution_locked();
CREATE TRIGGER comments_attribution_locked BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION atlas_attribution_locked();

CREATE TABLE agent_post_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES users(id),
  agent_id        uuid NOT NULL REFERENCES agents(id),
  token_id        uuid NOT NULL REFERENCES agent_tokens(id),
  kind            text NOT NULL CHECK (kind IN ('post','reply')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  topics          text[] NOT NULL DEFAULT '{}',
  reply_to        uuid REFERENCES posts(id),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','discarded')),
  published_kind  text CHECK (published_kind IN ('post','comment')),
  published_id    uuid,
  model           text NOT NULL DEFAULT '',
  client          text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  CHECK ((kind = 'reply') = (reply_to IS NOT NULL))
);
CREATE INDEX agent_post_drafts_operator ON agent_post_drafts (operator_id, created_at DESC);

ALTER TABLE agent_post_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_post_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_post_drafts_owner ON agent_post_drafts USING (operator_id = app_uid()) WITH CHECK (operator_id = app_uid());
GRANT SELECT, INSERT, UPDATE ON agent_post_drafts TO atlas_app;
