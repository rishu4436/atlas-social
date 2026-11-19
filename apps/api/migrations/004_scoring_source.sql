-- Outcome scoring provenance: which real price source scored a thesis, or why it cannot be scored.
ALTER TABLE theses ADD COLUMN IF NOT EXISTS scoring_status text CHECK (scoring_status IN ('scored', 'pending', 'unscorable'));
ALTER TABLE theses ADD COLUMN IF NOT EXISTS scoring_source text;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS scoring_note text;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS scoring_checked_at timestamptz;
