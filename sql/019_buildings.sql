-- 2. Building Definitions (Static data)
CREATE TABLE buildings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type_id INT NOT NULL REFERENCES building_types(building_type_id),
    gold_cost INT DEFAULT 0,
    construction_time_turns INT DEFAULT 1,
    required_building_id INT NULL REFERENCES buildings(id),
    food_bonus INT DEFAULT 0,
    description TEXT
);

-- 3. Fief Buildings (Dynamic data - replaces adding columns to h3_map)
-- This table links a specific hex (h3_index) with a building and its status
CREATE TABLE fief_buildings (
    h3_index TEXT PRIMARY KEY REFERENCES h3_map(h3_index),
    building_id INT NOT NULL REFERENCES buildings(id),
    remaining_construction_turns INT DEFAULT 0,
    is_under_construction BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

TRUNCATE TABLE building_types RESTART IDENTITY CASCADE;

-- 4. Initial Data Seed
INSERT INTO building_types (name, icon_slug) VALUES 
('military',''), ('religious',''), ('economic',''), ('other','');

INSERT INTO buildings (name, type_id, gold_cost, construction_time_turns, food_bonus) 
VALUES 
('Cuartel', 1, 5000, 15, 0),
('Iglesia', 2, 3000, 20, 5),
('Mercado', 3, 4000, 20, 10);

-- Fortress requires Barracks (ID 1)
INSERT INTO buildings (name, type_id, gold_cost, construction_time_turns, required_building_id) 
VALUES 
('Fortaleza', 1, 15000, 60, 1);

ALTER TABLE h3_map DROP COLUMN building_type_id CASCADE;

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
    COALESCE(td.custom_name, s.name) AS location_name,
    s.type AS settlement_type,
    s.population_rank,
    m.coord_x,
    m.coord_y
FROM h3_map m
JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN settlements s ON m.h3_index = s.h3_index
LEFT JOIN territory_details td ON m.h3_index = td.h3_index;

-- (Cambiando el nombre al que corresponda en tu secuencia)
INSERT INTO schema_migrations (script_name) 
VALUES ('019_buildings.sql');