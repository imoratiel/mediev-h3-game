-- Rastrea el último turno en que el ejército usó el reconocimiento co-ubicado
-- Permite limitar a una exploración por turno por ejército

ALTER TABLE armies
    ADD COLUMN IF NOT EXISTS last_colocated_scout_turn INT DEFAULT NULL;

INSERT INTO schema_migrations (script_name) VALUES ('100_armies_colocated_scout_turn.sql')
ON CONFLICT DO NOTHING;
