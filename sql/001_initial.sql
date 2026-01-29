-- 001_initial_schema.sql
-- Initial structure for H3 grid map and terrain metadata

-- Master table for terrain types
-- Content (name/description) is in Spanish as it is user-facing
CREATE TABLE terrain_types (
    terrain_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL, -- Spanish name
    description TEXT,          -- Spanish description
    movement_cost DECIMAL(3,2) DEFAULT 1.0,
    defense_bonus DECIMAL(3,2) DEFAULT 0.0,
    food_yield INT DEFAULT 0,
    wood_yield INT DEFAULT 0,
    stone_yield INT DEFAULT 0,
    iron_yield INT DEFAULT 0
);

-- Main table for H3 cells
-- h3_index uses BigInt to store the 64-bit H3 index
CREATE TABLE h3_map (
    h3_index BIGINT PRIMARY KEY,
    terrain_type_id INT NOT NULL REFERENCES terrain_types(terrain_type_id),
    player_id INT DEFAULT NULL,
    infrastructure_level INT DEFAULT 0,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance optimization
CREATE INDEX idx_h3_map_player ON h3_map(player_id);
CREATE INDEX idx_h3_map_terrain ON h3_map(terrain_type_id);

-- Comments in English for developers
COMMENT ON TABLE terrain_types IS 'Metadata for different biomes and their economic/military modifiers';
COMMENT ON TABLE h3_map IS 'Storage for discovered H3 cells at resolution level 8';

-- 000_enable_extensions.sql
CREATE EXTENSION IF NOT EXISTS postgis;

INSERT INTO terrain_types (name, description, movement_cost, defense_bonus, food_yield, wood_yield, stone_yield, iron_yield) VALUES
('Vegas Reales', 'Vegas Reales.', 1.0, 0.0, 2, 1, 0, 0),
('Tierras de Secano', 'Tierras de Secano.', 1.5, 0.5, 1, 3, 0, 0),
('Yermos', 'Yermos.', 3.0, 2.0, 0, 0, 2, 1),
('Picos de Granito', 'Picos de Granito.', 2.0, 1.0, 1, 0, 0, 0),
('Oteros', 'Oteros.', 2.5, 0.5, 0, 0, 1, 0),
('Espesuras', 'Espesuras.', 3.5, 1.5, 1, 0, 0, 0),
('Sotos', 'Sotos.', 3.5, 1.5, 1, 0, 0, 0),
('Albuferas', 'Albuferas.', 3.5, 1.5, 1, 0, 0, 0),
('Tremedales', 'Tremedales.', 3.5, 1.5, 1, 0, 0, 0),
('Estepas', 'Estepas.', 3.5, 1.5, 1, 0, 0, 0);