-- =================================================================
-- SCRIPT DE MIGRACIÓN: SISTEMA DE PERSONAJES Y DINASTÍA
-- =================================================================

-- 1. TABLA DE PERSONAJES
CREATE TABLE IF NOT EXISTS characters (
    id SERIAL PRIMARY KEY,
    player_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    age INT DEFAULT 20,
    health INT DEFAULT 100 CHECK (health >= 0 AND health <= 100),
    level INT DEFAULT 1,
    personal_guard INT DEFAULT 25, -- Máximo 25, no debe subir de ahí
    is_heir BOOLEAN DEFAULT FALSE,
    is_main_character BOOLEAN DEFAULT FALSE,
    parent_character_id INT REFERENCES characters(id) ON DELETE SET NULL, -- Árbol genealógico
    army_id INT, -- NULL si no está en un ejército
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_player FOREIGN KEY (player_id) REFERENCES players(player_id)
);

-- 2. TABLA DE HABILIDADES
CREATE TABLE IF NOT EXISTS character_abilities (
    id SERIAL PRIMARY KEY,
    character_id INT NOT NULL,
    ability_key VARCHAR(50) NOT NULL, -- ej: 'estrategia', 'logistica'
    level INT DEFAULT 1,
    CONSTRAINT fk_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- 3. ÍNDICES PARA RENDIMIENTO
CREATE INDEX idx_characters_player ON characters(player_id);
CREATE INDEX idx_characters_army ON characters(army_id);
CREATE INDEX idx_characters_heir ON characters(is_heir) WHERE is_heir = TRUE;

INSERT INTO schema_migrations (script_name)
VALUES ('035_characters.sql')
ON CONFLICT DO NOTHING;
