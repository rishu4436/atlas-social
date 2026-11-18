-- Optional: TimescaleDB hypertable for candles. Skipped silently when the extension is unavailable.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('candles', 'open_time', if_not_exists => true, migrate_data => true);
  ELSE
    RAISE NOTICE 'timescaledb not available; candles stays a regular table';
  END IF;
END $$;
