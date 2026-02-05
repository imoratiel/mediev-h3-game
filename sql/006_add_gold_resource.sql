-- Add gold resource to territory_details
-- Gold is a precious metal that can be mined from mountains

ALTER TABLE territory_details
ADD COLUMN IF NOT EXISTS gold_stored DECIMAL(10, 2) DEFAULT 0.0;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_territory_details_oro ON territory_details(gold_stored);

-- Update existing territories to have 0 gold initially
UPDATE territory_details SET oro = 0.0 WHERE gold_stored IS NULL;





-- 1. Renombrar el campo de oro (ejecutar primero)
ALTER TABLE territory_details RENAME COLUMN oro TO gold_stored;

-- 2. Añadir campos para la exploración
ALTER TABLE territory_details 
ADD COLUMN exploration_end_turn INT DEFAULT NULL,
ADD COLUMN discovered_resource VARCHAR(20) DEFAULT NULL; -- 'stone', 'iron', 'gold' o NULL

-- 3. Crear tabla de configuración global
CREATE TABLE game_config (
    id SERIAL PRIMARY KEY,
    "group" VARCHAR(50),
    "key" VARCHAR(50) UNIQUE,
    "value" VARCHAR(255)
);

-- Insertar los valores iniciales con las comillas correctas
INSERT INTO game_config ("group", "key", "value") VALUES 
('exploration', 'turns_required', '5'),
('exploration', 'gold_cost', '100');