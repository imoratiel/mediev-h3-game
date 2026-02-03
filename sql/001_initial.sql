-- Medieval H3 Game - Schema V2 (Unified H3 Index as TEXT)

-- 1. LIMPIEZA
DROP VIEW IF EXISTS v_map_display;
DROP TABLE IF EXISTS armies;
DROP TABLE IF EXISTS territory_details;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS h3_map;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS world_state;
DROP TABLE IF EXISTS unit_types;
DROP TABLE IF EXISTS building_types;
DROP TABLE IF EXISTS terrain_types;

-- 2. CATÁLOGOS
CREATE TABLE terrain_types (
    terrain_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) NOT NULL,
    fertility INT DEFAULT 0,
    wood_output INT DEFAULT 0,
    stone_output INT DEFAULT 0,
    iron_output INT DEFAULT 0,
    fishing_output INT DEFAULT 0,
    defense_bonus INT DEFAULT 0,
    movement_cost DECIMAL(5,2) DEFAULT 1.0
);

INSERT INTO terrain_types (terrain_type_id, name, color, fertility, wood_output, fishing_output, stone_output, iron_output, movement_cost, defense_bonus) VALUES
(1, 'Mar', '#0a4b78', 0, 0, 100, 0, 0, 10.0, 0),
(2, 'Costa', '#fff59d', 10, 5, 85, 5, 0, 1.0, 0),
(3, 'Agua', '#4fc3f7', 0, 0, 70, 0, 0, 5.0, 0),
(4, 'Río', '#00bcd4', 90, 10, 50, 0, 0, 1.5, 20),
(5, 'Pantanos', '#4e342e', 30, 15, 40, 0, 10, 3.0, 10),
(6, 'Tierras de Cultivo', '#7db35d', 100, 5, 0, 0, 0, 1.0, 0),
(7, 'Tierras de Secano', '#b8a170', 55, 15, 0, 10, 5, 1.0, 5),
(8, 'Estepas', '#d4e157', 35, 5, 0, 5, 5, 1.0, 0),
(9, 'Bosque', '#558b2f', 20, 100, 0, 10, 0, 2.0, 30),
(10, 'Espesuras', '#2d5a27', 10, 120, 0, 20, 0, 3.0, 50),
(11, 'Oteros', '#a1887f', 15, 10, 0, 80, 40, 2.0, 40),
(12, 'Colinas', '#8d6e63', 10, 20, 0, 60, 60, 2.0, 30),
(13, 'Alta Montaña', '#546e7a', 0, 5, 0, 100, 100, 5.0, 80),
(14, 'Asentamiento', '#e53935', 0, 0, 0, 0, 0, 1.0, 50);

CREATE TABLE building_types (
    building_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon_slug VARCHAR(50)
);

INSERT INTO building_types (building_type_id, name, icon_slug) VALUES
(0, 'Ninguno', NULL),
(1, 'Aldea', 'village'),
(2, 'Villa', 'town'),
(3, 'Ciudad', 'city'),
(4, 'Castillo', 'castle'),
(5, 'Granja', 'farm'),
(6, 'Mina', 'mine'),
(7, 'Puerto', 'port');

CREATE TABLE unit_types (
    unit_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    base_attack INT NOT NULL,
    base_defense INT NOT NULL,
    base_speed INT NOT NULL,
    carry_capacity INT DEFAULT 0,
    cost_gold INT DEFAULT 0,
    cost_pop INT DEFAULT 1
);

INSERT INTO unit_types (name, base_attack, base_defense, base_speed, carry_capacity) VALUES 
('Levas Campesinas', 5, 5, 2, 5),
('Infantería Ligera', 15, 10, 3, 10),
('Arqueros', 25, 5, 3, 5),
('Caballería', 40, 20, 6, 20);

-- 3. JUGADORES Y ESTADO
CREATE TABLE world_state (
    id INT PRIMARY KEY CHECK (id = 1),
    current_turn INT NOT NULL DEFAULT 1,
    game_date DATE NOT NULL DEFAULT '1039-03-01',
    is_paused BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO world_state (id, current_turn, game_date) VALUES (1, 1, '1039-03-01');

CREATE TABLE players (
    player_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(7) NOT NULL DEFAULT '#cccccc',
    gold INT DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO players (username, color, gold) VALUES ('Neutral', '#999999', 0);
INSERT INTO players (username, color, gold) VALUES ('LordAdmin', '#FFD700', 5000);

-- 4. EL MAPA (H3_INDEX como TEXT)
CREATE TABLE h3_map (
    h3_index TEXT PRIMARY KEY,
    terrain_type_id INT NOT NULL REFERENCES terrain_types(terrain_type_id),
    player_id INT REFERENCES players(player_id) ON DELETE SET NULL,
    building_type_id INT DEFAULT 0 REFERENCES building_types(building_type_id),
    has_road BOOLEAN DEFAULT FALSE,
    is_capital BOOLEAN DEFAULT FALSE,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settlements (
    settlement_id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE REFERENCES h3_map(h3_index) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT,
    population_rank INTEGER
);

CREATE TABLE territory_details (
    territory_id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE REFERENCES h3_map(h3_index) ON DELETE CASCADE,
    custom_name VARCHAR(100),
    population INT DEFAULT 200,
    happiness INT DEFAULT 50,
    food_stored DECIMAL(10,2) DEFAULT 0,
    wood_stored DECIMAL(10,2) DEFAULT 0,
    stone_stored DECIMAL(10,2) DEFAULT 0,
    iron_stored DECIMAL(10,2) DEFAULT 0,
    farm_level INT DEFAULT 0,
    mine_level INT DEFAULT 0,
    lumber_level INT DEFAULT 0,
    port_level INT DEFAULT 0,
    defense_level INT DEFAULT 0
);

CREATE TABLE armies (
    army_id SERIAL PRIMARY KEY,
    player_id INT NOT NULL REFERENCES players(player_id),
    unit_type_id INT NOT NULL REFERENCES unit_types(unit_type_id),
    h3_index TEXT NOT NULL, 
    count INT NOT NULL DEFAULT 1,
    current_health DECIMAL(5,2) DEFAULT 100.0,
    fatigue DECIMAL(5,2) DEFAULT 0.0,
    experience DECIMAL(10,2) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. VISTA API
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
