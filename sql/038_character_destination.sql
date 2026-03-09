-- Añade columna destination a characters para movimiento por turnos.

ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS destination VARCHAR(15) REFERENCES h3_map(h3_index) ON DELETE SET NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('038_character_destination.sql')
ON CONFLICT DO NOTHING;
