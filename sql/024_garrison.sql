-- Add garrison flag to armies table
-- Garrisoned armies stay in their fief, cannot move, do not count toward army limit
ALTER TABLE armies ADD COLUMN IF NOT EXISTS is_garrison BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO schema_migrations (script_name)
VALUES ('024_garrison.sql');
