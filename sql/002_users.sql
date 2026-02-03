-- 1. Crear el jugador
INSERT INTO players (username, color, gold) 
VALUES ('LordAdmin', '#FFD700', 5000);

-- 2. (Opcional) Asignarte una capital inicial manualmente para ver si el mapa la pinta
-- Sustituye el ID por uno que sepas que es una ciudad (ej: León) o uno al azar
-- Si no sabes el ID, usa este truco para asignarte la ciudad 'Legio' (León):
UPDATE h3_map 
SET player_id = (SELECT player_id FROM players WHERE username = 'LordAdmin'),
    building_type_id = 4 -- Icono de Castillo
WHERE h3_index = (SELECT h3_index::bigint FROM settlements WHERE name ILIKE '%Legio%' LIMIT 1);