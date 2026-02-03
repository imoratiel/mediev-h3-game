-- Migración: Convertir h3_index de BIGINT a TEXT
-- Este script convierte la columna h3_index en todas las tablas de BIGINT a TEXT (hexadecimal)

BEGIN;

-- 1. Recrear vista (será reconstruida al final)
DROP VIEW IF EXISTS v_map_display;

-- 2. Convertir h3_map.h3_index de BIGINT a TEXT
-- IMPORTANTE: Convertir valores numéricos a hexadecimal antes del cambio de tipo
ALTER TABLE h3_map
  ALTER COLUMN h3_index TYPE TEXT
  USING to_hex(h3_index::bigint);

-- 3. Convertir settlements.h3_index de BIGINT a TEXT
ALTER TABLE settlements
  ALTER COLUMN h3_index TYPE TEXT
  USING to_hex(h3_index::bigint);

-- 4. Convertir territory_details.h3_index de BIGINT a TEXT
ALTER TABLE territory_details
  ALTER COLUMN h3_index TYPE TEXT
  USING to_hex(h3_index::bigint);

-- 5. Recrear la vista v_map_display
CREATE OR REPLACE VIEW v_map_display AS
SELECT
    m.h3_index,
    m.terrain_type_id,
    t.name AS terrain_name,
    t.color AS terrain_color,
    m.has_road,
    m.is_capital,
    m.player_id,
    p.color AS player_color,
    p.username AS owner_name,
    m.building_type_id,
    bt.icon_slug,
    COALESCE(td.custom_name, s.name) AS location_name,
    s.type AS settlement_type,
    s.population_rank
FROM h3_map m
JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN building_types bt ON m.building_type_id = bt.building_type_id
LEFT JOIN settlements s ON m.h3_index = s.h3_index
LEFT JOIN territory_details td ON m.h3_index = td.h3_index;

-- 6. Verificar el cambio
DO $$
DECLARE
    h3_type TEXT;
BEGIN
    SELECT data_type INTO h3_type
    FROM information_schema.columns
    WHERE table_name = 'h3_map' AND column_name = 'h3_index';

    RAISE NOTICE 'Tipo de h3_map.h3_index: %', h3_type;

    IF h3_type != 'text' THEN
        RAISE EXCEPTION 'ERROR: h3_index no es TEXT después de la migración';
    ELSE
        RAISE NOTICE '✓ Migración exitosa: h3_index ahora es TEXT';
    END IF;
END $$;

COMMIT;

-- Mostrar estadísticas
SELECT
    'h3_map' as tabla,
    COUNT(*) as registros,
    MIN(LENGTH(h3_index)) as min_length,
    MAX(LENGTH(h3_index)) as max_length
FROM h3_map
UNION ALL
SELECT
    'territory_details' as tabla,
    COUNT(*) as registros,
    MIN(LENGTH(h3_index)) as min_length,
    MAX(LENGTH(h3_index)) as max_length
FROM territory_details
UNION ALL
SELECT
    'settlements' as tabla,
    COUNT(*) as registros,
    MIN(LENGTH(h3_index)) as min_length,
    MAX(LENGTH(h3_index)) as max_length
FROM settlements;
