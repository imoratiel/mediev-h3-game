-- 082_world_state_processing_flag.sql
-- Añade flag is_processing a world_state para bloquear acciones durante el cálculo de turno.

ALTER TABLE world_state ADD COLUMN IF NOT EXISTS is_processing BOOLEAN NOT NULL DEFAULT FALSE;

-- Asegurar que no quede bloqueado si el servidor murió durante un turno
UPDATE world_state SET is_processing = FALSE WHERE id = 1;

INSERT INTO schema_migrations (script_name)
VALUES ('082_world_state_processing_flag.sql')
ON CONFLICT DO NOTHING;
