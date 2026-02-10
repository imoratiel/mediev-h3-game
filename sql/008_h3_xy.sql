-- Añadir columnas de coordenadas humanas a la tabla de territorios
ALTER TABLE h3_map 
ADD COLUMN coord_x INT DEFAULT 0,
ADD COLUMN coord_y INT DEFAULT 0;

-- Crear un índice para que las búsquedas por coordenadas sean instantáneas
CREATE INDEX idx_h3_map_coords ON h3_map (coord_x, coord_y);


-- 1. Añadir la columna al jugador
ALTER TABLE players ADD COLUMN capital_h3 VARCHAR(20);

-- 2. Migrar los datos actuales (si ya tenías capitales marcadas)
UPDATE players p
SET capital_h3 = m.h3_index
FROM h3_map m
WHERE m.player_id = p.player_id AND m.is_capital = TRUE;

-- 3. Eliminar la columna antigua
ALTER TABLE h3_map DROP COLUMN is_capital CASCADE;