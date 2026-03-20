-- Tracking de la última promoción de rango noble
-- Formato: 'year-month' (ej: '208-3') para permitir máximo 1 ascenso por mes
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_rank_promotion VARCHAR(20) DEFAULT NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('066_noble_rank_promotion.sql')
ON CONFLICT DO NOTHING;
