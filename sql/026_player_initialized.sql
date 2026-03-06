-- Migration 026: Add is_initialized flag to players
-- Tracks whether a player has gone through the Epic Initialization flow.
-- Existing players with a capital are already considered initialized.

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS is_initialized BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark existing players who already have a capital as initialized
-- so they do not get the welcome panel on next login.
UPDATE players
    SET is_initialized = TRUE
    WHERE capital_h3 IS NOT NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('026_player_initialized.sql');
