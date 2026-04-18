-- 090_food_output_rebalance.sql
-- Reajuste de valores de producción de comida por tipo de terreno.

UPDATE terrain_types SET food_output =   0 WHERE name = 'Mar';
UPDATE terrain_types SET food_output =  90 WHERE name = 'Costa';
UPDATE terrain_types SET food_output =   0 WHERE name = 'Río';
UPDATE terrain_types SET food_output =  40 WHERE name = 'Pantanos';
UPDATE terrain_types SET food_output = 100 WHERE name = 'Tierras de Cultivo';
UPDATE terrain_types SET food_output =  80 WHERE name = 'Tierras de Secano';
UPDATE terrain_types SET food_output =  60 WHERE name = 'Estepas';
UPDATE terrain_types SET food_output =  50 WHERE name = 'Bosque';
UPDATE terrain_types SET food_output =  50 WHERE name = 'Cerros';
UPDATE terrain_types SET food_output =  60 WHERE name = 'Colinas';
UPDATE terrain_types SET food_output =  30 WHERE name = 'Alta Montaña';
UPDATE terrain_types SET food_output =   0 WHERE name = 'Puente';

INSERT INTO schema_migrations (script_name) VALUES ('090_food_output_rebalance.sql') ON CONFLICT DO NOTHING;
