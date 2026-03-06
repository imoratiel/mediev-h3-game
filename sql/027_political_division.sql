-- 1. TABLA DE CONFIGURACIÓN DE RANGOS NOBILIARIOS
CREATE TABLE IF NOT EXISTS noble_ranks (
    id SERIAL PRIMARY KEY,
    title_male VARCHAR(50) NOT NULL,
    title_female VARCHAR(50) NOT NULL,
    territory_name VARCHAR(100) NOT NULL,
    min_fiefs_required INT NOT NULL DEFAULT 0,
    level_order INT NOT NULL,
    -- Columnas para la lógica de ascenso (se consultarán desde el backend)
    required_parent_rank_id INT, -- ID del rango inferior necesario para ascender
    required_count INT DEFAULT 0 -- Cantidad de divisiones del rango inferior necesarias
);

-- Población de la jerarquía
INSERT INTO noble_ranks (id, title_male, title_female, territory_name, min_fiefs_required, level_order, required_parent_rank_id, required_count) VALUES
(1, 'Infanzón', 'Infanzona', 'Solar', 1, 1, NULL, 0),
(2, 'Señor', 'Señora', 'Señorío', 30, 2, 1, 1),
(3, 'Barón', 'Baronesa', 'Baronía', 120, 3, 2, 3),
(4, 'Vizconde', 'Vizcondesa', 'Vizcondado', 250, 4, 3, 3),
(5, 'Conde', 'Condesa', 'Condado', 500, 5, 4, 4),
(6, 'Marqués', 'Marquesa', 'Marquesado', 800, 6, 5, 2),
(7, 'Duque', 'Duquesa', 'Ducado', 1200, 7, 6, 3),
(8, 'Rey', 'Reina', 'Reino', 2000, 8, 7, 3)
ON CONFLICT (id) DO NOTHING;

-- Añadir la columna de límite máximo
ALTER TABLE noble_ranks 
ADD COLUMN IF NOT EXISTS max_fiefs_limit INT DEFAULT 999;

-- Actualizar los límites lógicos para cada rango
UPDATE noble_ranks SET max_fiefs_limit = 100  WHERE title_male = 'Infanzón';
UPDATE noble_ranks SET max_fiefs_limit = 40  WHERE title_male = 'Señor';
UPDATE noble_ranks SET max_fiefs_limit = 150 WHERE title_male = 'Barón';
UPDATE noble_ranks SET max_fiefs_limit = 400 WHERE title_male = 'Vizconde';
UPDATE noble_ranks SET max_fiefs_limit = 600 WHERE title_male = 'Conde';
UPDATE noble_ranks SET max_fiefs_limit = 1000 WHERE title_male = 'Marqués';
UPDATE noble_ranks SET max_fiefs_limit = 1500 WHERE title_male = 'Duque';
UPDATE noble_ranks SET max_fiefs_limit = 0 WHERE title_male = 'Rey';

-- 2. ACTUALIZACIÓN DE JUGADORES (Tabla existente 'players')
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) DEFAULT 'Desconocido',
ADD COLUMN IF NOT EXISTS last_name VARCHAR(100) DEFAULT 'Desconocido',
ADD COLUMN IF NOT EXISTS gender CHAR(1) CHECK (gender IN ('M', 'F')) DEFAULT 'M',
ADD COLUMN IF NOT EXISTS noble_rank_id INT DEFAULT 1;

-- Asegurar restricción de llave foránea en 'players'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_noble_rank') THEN
        ALTER TABLE players ADD CONSTRAINT fk_noble_rank FOREIGN KEY (noble_rank_id) REFERENCES noble_ranks(id);
    END IF;
END $$;

-- 3. CREACIÓN DE DIVISIONES POLÍTICAS
CREATE TABLE IF NOT EXISTS political_divisions (
    id SERIAL PRIMARY KEY,
    player_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    noble_rank_id INT NOT NULL,
    capital_territory_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_player FOREIGN KEY (player_id) REFERENCES players(player_id),
    CONSTRAINT fk_noble_rank FOREIGN KEY (noble_rank_id) REFERENCES noble_ranks(id)
);

-- 4. ACTUALIZACIÓN DE TERRITORIOS (Tabla 'territory_details')
-- Nota: Asegúrate de que tu tabla se llame 'territory_details'
ALTER TABLE territory_details 
ADD COLUMN IF NOT EXISTS division_id INT;

-- Relación con las divisiones políticas
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_division') THEN
        ALTER TABLE territory_details ADD CONSTRAINT fk_division FOREIGN KEY (division_id) REFERENCES political_divisions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Añadir la restricción faltante para la capital en divisiones (dependencia circular resuelta)
ALTER TABLE political_divisions 
ADD CONSTRAINT fk_capital_territory FOREIGN KEY (capital_territory_id) REFERENCES territory_details(territory_id);

-- 5. ÍNDICES DE RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_players_noble_rank ON players(noble_rank_id);
CREATE INDEX IF NOT EXISTS idx_political_divisions_player ON political_divisions(player_id);
CREATE INDEX IF NOT EXISTS idx_territory_division ON territory_details(division_id);


INSERT INTO schema_migrations (script_name)
VALUES ('027_political_division.sql');