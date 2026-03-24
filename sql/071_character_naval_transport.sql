-- Characters (not attached to any army) can now board a fleet directly.
-- transported_by → army_id of the fleet carrying this character (NULL = not on a fleet).
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS transported_by INTEGER REFERENCES armies(army_id) ON DELETE SET NULL;

-- ── Migration record ────────────────────────────────────────────────────────
INSERT INTO schema_migrations (script_name)
VALUES ('071_character_naval_transport.sql')
ON CONFLICT DO NOTHING;
