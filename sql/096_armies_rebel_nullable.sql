-- 096_armies_rebel_nullable.sql
-- Permite que armies.player_id sea NULL para ejércitos rebeldes
-- (campesinos en armas sin dueño jugador).

ALTER TABLE armies ALTER COLUMN player_id DROP NOT NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('096_armies_rebel_nullable.sql')
ON CONFLICT DO NOTHING;
