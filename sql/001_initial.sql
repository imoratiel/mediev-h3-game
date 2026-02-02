-- ==================================================================================
-- SCHEMA COMPLETO: Medieval H3 Game (Versión Definitiva)
-- Fecha: 2026-02-02
-- Descripción: Reinicio total. Incluye Mapa, Economía, Militar y Turnos.
-- ==================================================================================

-- 1. LIMPIEZA RADICAL (¡CUIDADO! BORRA TODO)
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

-- Habilitar PostGIS (Necesario para geometría avanzada si se usa en el futuro)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==================================================================================
-- CAPA 1: CATÁLOGOS (Metadatos Estáticos)
-- ==================================================================================

-- 1.1 Tipos de Terreno
CREATE TABLE terrain_types (
    terrain_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) NOT NULL,
    -- Modificadores de Juego
    fertility INT DEFAULT 0,
    wood_output INT DEFAULT 0,
    stone_output INT DEFAULT 0,
    iron_output INT DEFAULT 0,
    fishing_output INT DEFAULT 0,
    defense_bonus INT DEFAULT 0,
    -- CORRECCIÓN: Ampliado a (5,2) para permitir valores como 10.0 o 100.0
    movement_cost DECIMAL(5,2) DEFAULT 1.0,
    difficulty_foot INT DEFAULT 0,
    difficulty_horse INT DEFAULT 0
);

-- Inserción de Datos Maestros (IDs Fijos)
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

ALTER SEQUENCE terrain_types_terrain_type_id_seq RESTART WITH 15;

-- 1.2 Tipos de Edificios (Iconos)
CREATE TABLE building_types (
    building_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon_slug VARCHAR(50) -- Nombre del archivo SVG (ej: 'castle', 'farm')
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

-- 1.3 Tipos de Unidades (Tropas)
CREATE TABLE unit_types (
    unit_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    base_attack INT NOT NULL,
    base_defense INT NOT NULL,
    base_speed INT NOT NULL,      -- Hexágonos por turno
    carry_capacity INT DEFAULT 0, -- Recursos que pueden cargar
    cost_gold INT DEFAULT 0,
    cost_pop INT DEFAULT 1
);

INSERT INTO unit_types (name, base_attack, base_defense, base_speed, carry_capacity) VALUES 
('Levas Campesinas', 5, 5, 2, 5),
('Infantería Ligera', 15, 10, 3, 10),
('Arqueros', 25, 5, 3, 5),
('Caballería', 40, 20, 6, 20);

-- ==================================================================================
-- CAPA 2: JUGADORES Y ESTADO GLOBAL
-- ==================================================================================

-- 2.1 Reloj del Juego
CREATE TABLE world_state (
    id INT PRIMARY KEY CHECK (id = 1),
    current_turn INT NOT NULL DEFAULT 1,
    game_date DATE NOT NULL DEFAULT '1039-03-01',
    is_paused BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO world_state (id, current_turn, game_date) VALUES (1, 1, '1039-03-01');

-- 2.2 Jugadores
CREATE TABLE players (
    player_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(7) NOT NULL DEFAULT '#cccccc', -- Color del reino
    gold INT DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Jugador Neutral / IA
INSERT INTO players (username, color) VALUES ('Neutral', '#999999');

-- ==================================================================================
-- CAPA 3: EL MAPA (Optimizado para Lectura Rápida)
-- ==================================================================================

CREATE TABLE h3_map (
    id SERIAL PRIMARY KEY,
    h3_index BIGINT NOT NULL UNIQUE,          -- Índice numérico puro para velocidad
    terrain_type_id INT NOT NULL REFERENCES terrain_types(terrain_type_id),
    
    -- Visual Flags (Desnormalizados para velocidad de renderizado)
    player_id INT REFERENCES players(player_id) ON DELETE SET NULL,
    building_type_id INT DEFAULT 0 REFERENCES building_types(building_type_id),
    has_road BOOLEAN DEFAULT FALSE,
    
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_h3_map_terrain ON h3_map(terrain_type_id);
CREATE INDEX idx_h3_map_player ON h3_map(player_id);

-- ==================================================================================
-- CAPA 4: ECONOMÍA Y LORE (Detalle Profundo)
-- ==================================================================================

-- 4.1 Asentamientos Históricos (Nombres Reales)
CREATE TABLE settlements (
    settlement_id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE, -- Texto para cruce fácil
    name TEXT NOT NULL,
    type TEXT,
    population_rank INTEGER CHECK (population_rank >= 0) -- Sin límite superior
);

-- 4.2 Economía del Territorio (Solo existe si hay un jugador dueño)
CREATE TABLE territory_details (
    territory_id SERIAL PRIMARY KEY,
    h3_index BIGINT NOT NULL UNIQUE REFERENCES h3_map(h3_index) ON DELETE CASCADE,
    
    -- Estado Civil
    custom_name VARCHAR(100),
    population INT DEFAULT 10,
    happiness INT DEFAULT 100,
    
    -- Almacenes Locales
    food_stored DECIMAL(10,2) DEFAULT 0,
    wood_stored DECIMAL(10,2) DEFAULT 0,
    stone_stored DECIMAL(10,2) DEFAULT 0,
    iron_stored DECIMAL(10,2) DEFAULT 0,
    
    -- Niveles de Infraestructura
    farm_level INT DEFAULT 0,
    mine_level INT DEFAULT 0,
    lumber_level INT DEFAULT 0,
    port_level INT DEFAULT 0,
    defense_level INT DEFAULT 0
);

-- ==================================================================================
-- CAPA 5: MILITAR (Ejércitos Móviles)
-- ==================================================================================

CREATE TABLE armies (
    army_id SERIAL PRIMARY KEY,
    player_id INT NOT NULL REFERENCES players(player_id),
    unit_type_id INT NOT NULL REFERENCES unit_types(unit_type_id),
    
    -- Posición (Puede no coincidir con territorio propio)
    h3_index BIGINT NOT NULL, 
    
    -- Estado
    count INT NOT NULL DEFAULT 1,
    current_health DECIMAL(5,2) DEFAULT 100.0,
    fatigue DECIMAL(5,2) DEFAULT 0.0,
    experience DECIMAL(10,2) DEFAULT 0.0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_armies_location ON armies(h3_index);

-- ==================================================================================
-- CAPA 6: VISTA PARA API (El secreto de la velocidad)
-- ==================================================================================

CREATE OR REPLACE VIEW v_map_display AS
SELECT 
    m.h3_index::TEXT AS h3_index, -- Casteo a string para JSON seguro
    m.terrain_type_id,
    t.name AS terrain_name,
    t.color AS terrain_color,
    m.has_road,
    
    -- Capa Jugador
    m.player_id,
    p.color AS player_color,
    p.username AS owner_name,
    
    -- Capa Edificios/Iconos
    m.building_type_id,
    bt.icon_slug,
    
    -- Capa Nombres (Histórico o Custom)
    COALESCE(td.custom_name, s.name) AS location_name,
    s.type AS settlement_type,
    s.population_rank
    
FROM h3_map m
JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN players p ON m.player_id = p.player_id
LEFT JOIN building_types bt ON m.building_type_id = bt.building_type_id
LEFT JOIN settlements s ON m.h3_index::TEXT = s.h3_index
LEFT JOIN territory_details td ON m.h3_index = td.h3_index;