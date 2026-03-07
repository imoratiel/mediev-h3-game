-- 030_drop_capital_h3_fk.sql
-- Elimina el FK fk_division_capital_h3 que referenciaba territory_details(h3_index).
-- Muchos feudos no tienen fila en territory_details, lo que causaba violaciones de FK
-- al crear divisiones con esos feudos como capital.
-- La integridad se garantiza por logica de negocio (verificacion en h3_map).

ALTER TABLE political_divisions
DROP CONSTRAINT IF EXISTS fk_division_capital_h3;

-- Añadimos la columna para guardar el borde precalculado
ALTER TABLE political_divisions 
ADD COLUMN IF NOT EXISTS boundary_geojson JSONB;

-- Índice para acelerar la recuperación si la tabla crece mucho
CREATE INDEX IF NOT EXISTS idx_political_divisions_geojson ON political_divisions USING GIN (boundary_geojson);

INSERT INTO schema_migrations (script_name)
VALUES ('030_drop_capital_h3_fk.sql')
ON CONFLICT DO NOTHING;
