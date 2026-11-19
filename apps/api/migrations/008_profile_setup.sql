-- First-run profile setup is a tracked state, so any account that never finished it is sent to /welcome/profile at sign-in
-- (not only the request that created it). Existing accounts that already edited their profile count as completed.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;
UPDATE profiles SET setup_completed_at = updated_at
 WHERE setup_completed_at IS NULL AND (updated_at > created_at + interval '1 second' OR bio <> '' OR topics <> '{}');
