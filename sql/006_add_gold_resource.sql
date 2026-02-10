-- Add gold resource to territory_details
-- Gold is a precious metal that can be mined from mountains

ALTER TABLE territory_details
ADD COLUMN IF NOT EXISTS gold_stored DECIMAL(10, 2) DEFAULT 0.0;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_territory_details_oro ON territory_details(gold_stored);

-- Update existing territories to have 0 gold initially
UPDATE territory_details SET gold_stored = 0.0 WHERE gold_stored IS NULL;

commit;

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

commit;

-- Insertar los valores iniciales con las comillas correctas
INSERT INTO game_config ("group", "key", "value") VALUES 
('exploration', 'turns_required', '5'),
('exploration', 'gold_cost', '100');

INSERT INTO game_config ("group", "key", "value") VALUES
('gameplay', 'turn_duration_seconds', '60'); -- Por defecto, 1 minuto por turno

-- Infrastructure system configuration
INSERT INTO game_config ("group", "key", "value") VALUES
('infrastructure', 'prod_multiplier_per_level', '0.20'),
('infrastructure', 'upgrade_cost_gold_base', '100')
ON CONFLICT ("key") DO NOTHING;

-- 2. Asegurarnos de que el coste base de los puertos esté en la configuración
-- (Si ya existe la clave gold_cost_base_port, esto la actualizará)
INSERT INTO game_config ("group", "key", "value") 
VALUES ('buildings', 'port_base_cost', '10000')
ON CONFLICT ("key") DO UPDATE SET "value" = '10000';

-- 2. Configuración de costes base para edificios
INSERT INTO game_config ("group", "key", "value") VALUES
('buildings', 'standard_upgrade_base_cost', '100')
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED.value;

-- 3. Asegurar que los niveles iniciales sean 0
UPDATE territory_details SET 
    farm_level = 0, 
    mine_level = 0, 
    lumber_level = 0, 
    port_level = 0 
WHERE farm_level IS NULL;

-- 2. Crear la restricción de unicidad compuesta
ALTER TABLE game_config 
ADD CONSTRAINT unique_group_key UNIQUE ("group", "key");