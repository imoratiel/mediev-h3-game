-- 083_noble_rank_limits.sql
-- Añade límites de ejércitos y flotas a noble_ranks por level_order.

ALTER TABLE noble_ranks
    ADD COLUMN IF NOT EXISTS army_limit  INT NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS fleet_limit INT NOT NULL DEFAULT 2;

-- Aplicar límites según level_order (igual para todas las culturas)
UPDATE noble_ranks SET army_limit = 2,  fleet_limit = 2 WHERE level_order = 1;
UPDATE noble_ranks SET army_limit = 3,  fleet_limit = 2 WHERE level_order = 2;
UPDATE noble_ranks SET army_limit = 4,  fleet_limit = 2 WHERE level_order = 3;
UPDATE noble_ranks SET army_limit = 6,  fleet_limit = 3 WHERE level_order = 4;
UPDATE noble_ranks SET army_limit = 8,  fleet_limit = 3 WHERE level_order = 5;
UPDATE noble_ranks SET army_limit = 10, fleet_limit = 4 WHERE level_order = 6;

INSERT INTO schema_migrations (script_name)
VALUES ('083_noble_rank_limits.sql')
ON CONFLICT DO NOTHING;
