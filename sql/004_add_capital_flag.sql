DROP VIEW v_map_display

ALTER TABLE territory_details 
ALTER COLUMN h3_index TYPE BIGINT 
USING ('x' || h3_index)::bit(64)::bigint;

ALTER TABLE settlements 
ALTER COLUMN h3_index TYPE BIGINT 
USING ('x' || h3_index)::bit(64)::bigint;

-- Actualizar la vista v_map_display para incluir is_capital
CREATE OR REPLACE VIEW v_map_display AS
SELECT
    m.h3_index,
    m.terrain_type_id,
    t.color AS terrain_color,
    t.name AS terrain_name,
    m.has_road,
    m.player_id,
    p.color AS player_color,
    p.username AS owner_name,
    m.building_type_id,
    b.icon_slug,
    m.is_capital,
    s.name AS location_name,
    s.type AS settlement_type
FROM h3_map m
LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN building_types b ON m.building_type_id = b.building_type_id
LEFT JOIN settlements s ON m.h3_index = s.h3_index;