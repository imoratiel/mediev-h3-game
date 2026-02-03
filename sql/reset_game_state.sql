BEGIN;

-- 1. Resetear el mapa (H3_MAP)
UPDATE h3_map 
SET 
    player_id = NULL,        -- Quitar dueños
    building_type_id = 0,   -- Quitar edificios (vuelven a 'Ninguno')
    is_capital = FALSE,     -- Quitar estrellas de capital
    has_road = FALSE;       -- Opcional: Quitar caminos (ponlo a TRUE si quieres mantener los romanos)

-- 2. Limpiar nombres personalizados en la economía
UPDATE territory_details 
SET custom_name = NULL;

-- 3. Borrar ejércitos (Tabula Rasa militar)
TRUNCATE TABLE armies CASCADE;

-- 4. Resetear el estado del mundo (Turno 1)
UPDATE world_state 
SET 
    current_turn = 1, 
    game_date = '1039-03-01',
    is_paused = TRUE 
WHERE id = 1;

-- 5. Resetear oro de los jugadores (Opcional)
UPDATE players 
SET gold = 5000 
WHERE username = 'Neutral';

COMMIT;