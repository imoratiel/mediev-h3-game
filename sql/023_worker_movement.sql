-- Add destination_h3 to workers for turn-based straight-line movement
ALTER TABLE workers ADD COLUMN IF NOT EXISTS destination_h3 VARCHAR(20) NULL;

-- Partial index: only rows that actually have a destination need fast lookup
CREATE INDEX IF NOT EXISTS idx_workers_destination ON workers(destination_h3)
    WHERE destination_h3 IS NOT NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('023_worker_movement.sql');
