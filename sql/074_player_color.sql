-- Actualizar color del jugador principal (Barca) a azul visible
UPDATE players SET color = '#2471A3' WHERE player_id = 34;


INSERT INTO schema_migrations (script_name)
VALUES ('074_player_color.sql') ON CONFLICT DO NOTHING;