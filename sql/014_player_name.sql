-- Añadir la columna display_name para el nombre de personaje público
ALTER TABLE players ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);

-- Inicializar con el username actual para no dejar campos vacíos
UPDATE players SET display_name = username WHERE display_name IS NULL;

-- Hacer que el campo sea obligatorio
ALTER TABLE players ALTER COLUMN display_name SET NOT NULL;

-- Recrear la vista v_map_display usando display_name en lugar de username
CREATE OR REPLACE VIEW v_map_display AS
SELECT
    m.h3_index,
    m.terrain_type_id,
    t.name AS terrain_name,
    t.color AS terrain_color,
    m.has_road,
    CASE
        WHEN m.player_id IS NOT NULL AND p.capital_h3 = m.h3_index THEN TRUE
        ELSE FALSE
    END AS is_capital,
    m.player_id,
    p.color AS player_color,
    p.display_name AS owner_name,
    m.building_type_id,
    bt.icon_slug,
    COALESCE(td.custom_name, s.name) AS location_name,
    s.type AS settlement_type,
    s.population_rank,
    m.coord_x,
    m.coord_y
FROM h3_map m
JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN building_types bt ON m.building_type_id = bt.building_type_id
LEFT JOIN settlements s ON m.h3_index = s.h3_index
LEFT JOIN territory_details td ON m.h3_index = td.h3_index;

-- Opcional: Crear un índice si vas a permitir búsquedas por nombre de personaje
CREATE INDEX idx_players_display_name ON players(display_name);