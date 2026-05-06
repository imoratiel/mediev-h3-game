-- Turno de fundación de la comarca para calcular el tiempo mínimo antes de rebelión por felicidad
-- Las comarcas existentes reciben founded_turn = 1 (elegibles de forma inmediata)

ALTER TABLE political_divisions
    ADD COLUMN IF NOT EXISTS founded_turn INT NOT NULL DEFAULT 1;

INSERT INTO schema_migrations (script_name) VALUES ('101_political_divisions_founded_turn.sql')
ON CONFLICT DO NOTHING;
