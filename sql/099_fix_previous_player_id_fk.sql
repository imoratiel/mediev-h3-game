-- Fix h3_map.previous_player_id FK: add ON DELETE SET NULL so player deletion during reset doesn't fail
ALTER TABLE h3_map
    DROP CONSTRAINT IF EXISTS h3_map_previous_player_id_fkey;

ALTER TABLE h3_map
    ADD CONSTRAINT h3_map_previous_player_id_fkey
    FOREIGN KEY (previous_player_id) REFERENCES players(player_id) ON DELETE SET NULL;

INSERT INTO schema_migrations (script_name) VALUES ('099_fix_previous_player_id_fk.sql')
ON CONFLICT DO NOTHING;
