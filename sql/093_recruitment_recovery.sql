-- Seguimiento de reclutamiento por feudo para el sistema de recuperación mensual.
-- recruited_turn:   turno en que se realizó el último cálculo de reclutamiento.
-- recruited_amount: reclutas descontados en ese turno (se amortiza linealmente en 30 turnos).

ALTER TABLE territory_details
  ADD COLUMN IF NOT EXISTS recruited_turn   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recruited_amount INT NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (script_name) VALUES ('093_recruitment_recovery.sql') ON CONFLICT DO NOTHING;
