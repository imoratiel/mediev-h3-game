ALTER TABLE terrain_types ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 99;

UPDATE terrain_types SET color = '#0d47a1' WHERE terrain_type_id = 1;
UPDATE terrain_types SET color = '#f5e89a' WHERE terrain_type_id = 2;
UPDATE terrain_types SET color = '#1976d2' WHERE terrain_type_id = 3;
UPDATE terrain_types SET color = '#1976d2' WHERE terrain_type_id = 4;
UPDATE terrain_types SET color = '#b3c67f' WHERE terrain_type_id = 5;
UPDATE terrain_types SET color = '#6aaa3a' WHERE terrain_type_id = 6;
UPDATE terrain_types SET color = '#c4a055' WHERE terrain_type_id = 7;
UPDATE terrain_types SET color = '#d4b84a' WHERE terrain_type_id = 8;
UPDATE terrain_types SET color = '#2e7d32' WHERE terrain_type_id = 9;
UPDATE terrain_types SET color = '#1a4620' WHERE terrain_type_id = 10;
UPDATE terrain_types SET color = '#b09878' WHERE terrain_type_id = 11;
UPDATE terrain_types SET color = '#7a5c4e' WHERE terrain_type_id = 12;
UPDATE terrain_types SET color = '#90a4ae' WHERE terrain_type_id = 13;
UPDATE terrain_types SET color = '#616161' WHERE terrain_type_id = 15;

DELETE FROM terrain_types WHERE terrain_type_id = 14;

UPDATE terrain_types SET sort_order = 1  WHERE terrain_type_id = 1;
UPDATE terrain_types SET sort_order = 2  WHERE terrain_type_id = 3;
UPDATE terrain_types SET sort_order = 3  WHERE terrain_type_id = 4;
UPDATE terrain_types SET sort_order = 4  WHERE terrain_type_id = 2;
UPDATE terrain_types SET sort_order = 5  WHERE terrain_type_id = 8;
UPDATE terrain_types SET sort_order = 6  WHERE terrain_type_id = 7;
UPDATE terrain_types SET sort_order = 8  WHERE terrain_type_id = 6;
UPDATE terrain_types SET sort_order = 7  WHERE terrain_type_id = 5;
UPDATE terrain_types SET sort_order = 9  WHERE terrain_type_id = 9;
UPDATE terrain_types SET sort_order = 10 WHERE terrain_type_id = 10;
UPDATE terrain_types SET sort_order = 11 WHERE terrain_type_id = 11;
UPDATE terrain_types SET sort_order = 12 WHERE terrain_type_id = 12;
UPDATE terrain_types SET sort_order = 13 WHERE terrain_type_id = 13;
UPDATE terrain_types SET sort_order = null WHERE terrain_type_id = 15;

DELETE FROM terrain_types WHERE terrain_type_id = 14;

INSERT INTO schema_migrations (script_name)
VALUES ('060_terrain_types_colores.sql')
ON CONFLICT DO NOTHING;
