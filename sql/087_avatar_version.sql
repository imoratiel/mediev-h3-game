-- Avatar version for players (0 = no custom avatar → use culture default)
ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_version INT NOT NULL DEFAULT 0;

-- =============================================================
INSERT INTO schema_migrations (script_name)
VALUES ('087_avatar_version.sql')
ON CONFLICT DO NOTHING;
