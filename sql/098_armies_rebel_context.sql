-- Context columns for rebel armies: which comarca they defend and who triggered the rebellion
ALTER TABLE armies
    ADD COLUMN IF NOT EXISTS rebel_division_id       INT REFERENCES political_divisions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rebel_target_player_id  INT REFERENCES players(player_id)      ON DELETE SET NULL;

INSERT INTO schema_migrations (script_name) VALUES ('098_armies_rebel_context.sql')
ON CONFLICT DO NOTHING;
