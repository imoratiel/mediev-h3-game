-- 067_battle_recovery.sql
-- Añade columnas de recuperación post-batalla a la tabla armies.
-- battle_recovery_rate:       stamina recuperada por turno mientras el ejército está estático
-- battle_recovery_turns_left: turnos de recuperación rápida restantes (0 = recuperación normal)

ALTER TABLE armies
  ADD COLUMN IF NOT EXISTS battle_recovery_rate      DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battle_recovery_turns_left INT          NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (script_name)
VALUES ('067_battle_recovery.sql')
ON CONFLICT DO NOTHING;
