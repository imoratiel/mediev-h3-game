-- 080_terrain_colors_sync.sql
-- Sincroniza los colores de terrain_types con la paleta usada en gen_tiles.py
-- Los colores provienen de TERRAIN_RGB en tools/gen_tiles/gen_tiles.py (RGB → hex).

UPDATE terrain_types SET color = '#3675af' WHERE terrain_type_id = 1;  -- Mar
UPDATE terrain_types SET color = '#e6d294' WHERE terrain_type_id = 2;  -- Costa
UPDATE terrain_types SET color = '#58a8d0' WHERE terrain_type_id = 4;  -- Río
UPDATE terrain_types SET color = '#6c9480' WHERE terrain_type_id = 5;  -- Pantanos
UPDATE terrain_types SET color = '#aad26c' WHERE terrain_type_id = 6;  -- Tierras de Cultivo
UPDATE terrain_types SET color = '#d2c382' WHERE terrain_type_id = 7;  -- Tierras de Secano
UPDATE terrain_types SET color = '#bcaf70' WHERE terrain_type_id = 8;  -- Estepas
UPDATE terrain_types SET color = '#386e32' WHERE terrain_type_id = 9;  -- Bosque
UPDATE terrain_types SET color = '#b98a48' WHERE terrain_type_id = 11; -- Cerros
UPDATE terrain_types SET color = '#dab25c' WHERE terrain_type_id = 12; -- Colinas
UPDATE terrain_types SET color = '#945834' WHERE terrain_type_id = 13; -- Alta Montaña
UPDATE terrain_types SET color = '#9b948a' WHERE terrain_type_id = 15; -- Puente

-- IDs 3 (Agua) y 10 (Espesuras) no tienen celdas asignadas en h3_map → se eliminan.
DELETE FROM terrain_types WHERE terrain_type_id IN (3, 10);

INSERT INTO schema_migrations (script_name)
VALUES ('080_terrain_colors_sync.sql')
ON CONFLICT DO NOTHING;