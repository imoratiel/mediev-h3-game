-- Límites de spawn de ejércitos rebeldes por comarca
-- Max 2 rebeldes por ciclo, con cooldowns entre apariciones y tras destrucción

ALTER TABLE comarca_resistance
    ADD COLUMN IF NOT EXISTS rebel_spawn_count         INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rebel_cooldown_until_turn INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rebel_is_alive            BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN comarca_resistance.rebel_spawn_count         IS 'Número de rebeldes generados en el ciclo actual (0-2)';
COMMENT ON COLUMN comarca_resistance.rebel_cooldown_until_turn IS 'No se puede generar un nuevo rebelde antes de este turno';
COMMENT ON COLUMN comarca_resistance.rebel_is_alive            IS 'Indica que hay un rebelde activo (para detectar destrucciones)';

INSERT INTO schema_migrations (script_name) VALUES ('102_rebel_spawn_limits.sql') ON CONFLICT DO NOTHING;
