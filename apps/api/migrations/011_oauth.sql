-- OAuth 2.1 for remote MCP clients (ChatGPT, Claude, Grok, Gemini CLI, Codex, Cursor, MCP Inspector).
--
-- An OAuth grant IS an agent token row (agent_tokens.oauth_client_id set, token_hash = hash of a random value that is
-- never shown), so every existing guarantee applies unchanged: the same route allowlist and scopes, attribution
-- (agent_attributions.token_id), the audit log, operator status checks, and revocation from Settings → Agents.
-- Access and refresh tokens hang off that grant and are stored only as SHA-256 hashes.
-- System context only: the app role cannot read clients, codes or OAuth tokens.

CREATE TABLE oauth_clients (
  client_id       text PRIMARY KEY,                    -- atlas_dcr_… (RFC 7591) or an https URL (Client ID Metadata Document)
  kind            text NOT NULL CHECK (kind IN ('dcr','cimd')),
  client_name     text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 100),
  client_uri      text,
  logo_uri        text,
  redirect_uris   text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 20),
  token_endpoint_auth_method text NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method IN ('none','client_secret_post','client_secret_basic')),
  secret_hash     text,
  scope           text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((token_endpoint_auth_method = 'none') = (secret_hash IS NULL))
);

CREATE TABLE oauth_auth_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    text NOT NULL,
  scopes          text[] NOT NULL,
  state           text,
  code_challenge  text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),  -- S256 only
  resource        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','redeemed','expired')),
  user_id         uuid REFERENCES users(id),
  granted_scopes  text[],
  code_hash       text UNIQUE,
  grant_id        uuid REFERENCES agent_tokens(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  redeemed_at     timestamptz
);
CREATE INDEX oauth_auth_requests_expires ON oauth_auth_requests (expires_at);

ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS oauth_client_id text REFERENCES oauth_clients(client_id);
CREATE INDEX IF NOT EXISTS agent_tokens_oauth ON agent_tokens (operator_id, oauth_client_id) WHERE oauth_client_id IS NOT NULL;

CREATE TABLE oauth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id    uuid NOT NULL REFERENCES agent_tokens(id),
  kind        text NOT NULL CHECK (kind IN ('access','refresh')),
  token_hash  text NOT NULL UNIQUE,
  resource    text NOT NULL,                     -- audience (RFC 8707): the MCP server URL
  scopes      text[] NOT NULL,
  parent_id   uuid REFERENCES oauth_tokens(id),  -- refresh rotation chain
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                       -- refresh tokens are single-use
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_clients, oauth_auth_requests, oauth_tokens FROM atlas_app;
