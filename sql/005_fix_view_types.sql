-- 009_fix_view_types.sql
-- Regenera v_map_display con casteo correcto de tipos
-- Soluciona el error "operator does not exist: bigint = text"

-- Eliminar vista anterior
DROP VIEW IF EXISTS v_map_display;

-- Crear vista con conversión de tipos correcta
CREATE OR REPLACE VIEW v_map_display AS
SELECT
    m.h3_index::TEXT AS h3_index,  -- BIGINT -> TEXT (para compatibilidad con API Node.js)
    m.terrain_type_id,
    t.color AS terrain_color,
    t.name AS terrain_name,
    m.has_road,
    m.player_id,
    p.color AS player_color,
    p.username AS owner_name,
    m.building_type_id,
    bt.icon_slug,
    m.is_capital,
    s.name AS location_name,  -- Nombre del asentamiento
    s.type AS settlement_type,
    s.population_rank
FROM h3_map m
LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN building_types bt ON m.building_type_id = bt.building_type_id
LEFT JOIN settlements s ON m.h3_index = s.h3_index  -- JOIN con BIGINT (ambas columnas son BIGINT)
WHERE m.terrain_type_id IS NOT NULL;  -- Filtrar entradas inválidas

-- Comentario
COMMENT ON VIEW v_map_display IS 'Vista optimizada para renderizado del mapa con conversión de tipos BIGINT->TEXT para compatibilidad con API';
