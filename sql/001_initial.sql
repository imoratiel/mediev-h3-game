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
    food_output INT DEFAULT 0,
    wood_output INT DEFAULT 0,
    stone_output INT DEFAULT 0,
    iron_output INT DEFAULT 0,
    fishing_output INT DEFAULT 0,
    defense_bonus INT DEFAULT 0,
    movement_cost DECIMAL(5,2) DEFAULT 1.0
);

INSERT INTO terrain_types (terrain_type_id, name, color, food_output, wood_output, fishing_output, stone_output, iron_output, movement_cost, defense_bonus) VALUES
(1, 'Mar', '#0a4b78', 0, 0, 100, 0, 0, -1.0, 0),
(2, 'Costa', '#fff59d', 10, 5, 85, 5, 0, 1.0, 0),
(3, 'Agua', '#4fc3f7', 0, 0, 70, 0, 0, -1.0, 0),
(4, 'Río', '#00bcd4', 90, 10, 50, 0, 0, -1.0, 20),
(5, 'Pantanos', '#4e342e', 30, 15, 40, 0, 10, 5.0, 10),
(6, 'Tierras de Cultivo', '#7db35d', 100, 5, 0, 0, 0, 1.0, 0),
(7, 'Tierras de Secano', '#b8a170', 55, 15, 0, 10, 5, 1.0, 5),
(8, 'Estepas', '#d4e157', 35, 5, 0, 5, 5, 1.0, 0),
(9, 'Bosque', '#558b2f', 20, 100, 0, 10, 0, 3.0, 30),
(10, 'Espesuras', '#2d5a27', 10, 120, 0, 20, 0, 4.0, 50),
(11, 'Cerros', '#a1887f', 15, 10, 0, 80, 40, 3.0, 40),
(12, 'Colinas', '#8d6e63', 10, 20, 0, 60, 60, 3.0, 30),
(13, 'Alta Montaña', '#546e7a', 0, 5, 0, 100, 100, 10.0, 80),
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
