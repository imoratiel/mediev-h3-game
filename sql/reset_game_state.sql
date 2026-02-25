-- BEGIN;

-- -- 1. Resetear el mapa (H3_MAP)
-- UPDATE h3_map 
-- SET 
--     player_id = NULL,        -- Quitar dueños
--     building_type_id = 0,   -- Quitar edificios (vuelven a 'Ninguno')
--     is_capital = FALSE,     -- Quitar estrellas de capital
--     has_road = FALSE;       -- Opcional: Quitar caminos (ponlo a TRUE si quieres mantener los romanos)

-- -- 2. Limpiar nombres personalizados en la economía
-- UPDATE territory_details 
-- SET custom_name = NULL;

-- -- 4. Resetear el estado del mundo (Turno 1)
-- UPDATE world_state 
-- SET 
--     current_turn = 1, 
--     game_date = '1039-03-01',
--     is_paused = TRUE 
-- WHERE id = 1;

-- -- Reset exploration status for all territories
-- -- All territories start as unexplored
-- -- The physical resources (stone, iron, gold) remain in the database but are hidden until explored

-- UPDATE territory_details
-- SET
--   exploration_end_turn = NULL,
--   discovered_resource = NULL;

-- -- 1. Limpiamos la tabla de tropas (instancias individuales)
-- -- Es la tabla "hija" que depende de las otras, por eso va primero.
-- TRUNCATE TABLE troops RESTART IDENTITY CASCADE;

-- -- 2. Limpiamos la tabla de ejércitos (agrupadores de tropas)
-- -- Al usar RESTART IDENTITY, los contadores de ID vuelven a empezar desde 1.
-- TRUNCATE TABLE armies RESTART IDENTITY CASCADE;

-- TRUNCATE TABLE messages RESTART IDENTITY CASCADE;
TRUNCATE TABLE notifications RESTART IDENTITY CASCADE;

-- COMMIT;

update players set capital_h3 = null;

TRUNCATE TABLE fief_buildings CASCADE;


-- -- INDICES

-- ALTER TABLE territory_details DROP CONSTRAINT IF EXISTS idx_territory_details_oro CASCADE;

-- --ALTER TABLE territory_details DROP CONSTRAINT IF EXISTS idx_army_h3_main CASCADE;

-- ALTER TABLE h3_map DROP CONSTRAINT IF EXISTS idx_h3_map_coords CASCADE;


-- VACUUM FULL h3_map;
-- VACUUM FULL territory_details;

