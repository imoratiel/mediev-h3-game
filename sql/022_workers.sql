-- 1. Tabla de Configuración (fuente de verdad)
-- Almacena las plantillas de los trabajadores
CREATE TABLE IF NOT EXISTS workers_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    hp INT NOT NULL DEFAULT 1,
    speed INT NOT NULL DEFAULT 1,
    detection_range INT NOT NULL DEFAULT 1,
    cost INT NOT NULL DEFAULT 0
);

-- 2. Tabla de Instancias (trabajadores activos en el mapa)
-- Almacena las unidades vivas en el juego
CREATE TABLE IF NOT EXISTS workers (
    id SERIAL PRIMARY KEY,
    player_id INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    h3_index VARCHAR(20) NOT NULL,
    type_id INT NOT NULL REFERENCES workers_types(id),
    -- Guardamos los stats actuales aquí para permitir buffs/debuffs o daño
    hp INT NOT NULL,
    speed INT NOT NULL,
    detection_range INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Índices para optimizar el motor de juego
-- Indispensables para consultas espaciales (búsqueda por radio, movimiento)
CREATE INDEX IF NOT EXISTS idx_workers_h3_index ON workers(h3_index);
CREATE INDEX IF NOT EXISTS idx_workers_player ON workers(player_id);
CREATE INDEX IF NOT EXISTS idx_workers_type ON workers(type_id);

-- 4. Inserción de datos iniciales (El tipo constructor)
INSERT INTO workers_types (name, hp, speed, detection_range, cost)
VALUES ('constructor', 1, 1, 1, 1000)
ON CONFLICT (name) DO NOTHING;

INSERT INTO schema_migrations (script_name)
VALUES ('022_workers.sql');
