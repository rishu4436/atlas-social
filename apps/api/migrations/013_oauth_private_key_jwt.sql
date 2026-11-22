-- CIMD clients (ChatGPT) authenticate at the token endpoint with private_key_jwt (RFC 7523).
-- There is no shared secret, so secret_hash stays NULL. Replay protection stores used assertion jtis.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oauth_clients' AND c.contype = 'c'
  LOOP
    IF r.def ILIKE '%token_endpoint_auth_method%' OR r.def ILIKE '%secret_hash%' THEN
      EXECUTE format('ALTER TABLE oauth_clients DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE oauth_clients
  ADD CONSTRAINT oauth_clients_auth_method_check
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic', 'private_key_jwt')),
  ADD CONSTRAINT oauth_clients_secret_hash_check
    CHECK ((token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic')) = (secret_hash IS NOT NULL));

CREATE TABLE oauth_assertion_jti (
  client_id   text NOT NULL,
  jti         text NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (client_id, jti)
);
CREATE INDEX oauth_assertion_jti_expires ON oauth_assertion_jti (expires_at);
ALTER TABLE oauth_assertion_jti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_assertion_jti FROM atlas_app;
