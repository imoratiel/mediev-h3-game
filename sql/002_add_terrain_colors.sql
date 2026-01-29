-- Add color support to terrain_types table
-- Script: 004_add_terrain_colors.sql
-- Description: Adds color column to terrain_types and sets initial color values for map visualization

-- Add color column to terrain_types
ALTER TABLE terrain_types
ADD COLUMN color VARCHAR(7);

-- Update terrain types with their respective colors
-- Colors are in hexadecimal format (#RRGGBB) for web visualization

UPDATE terrain_types SET color = '#7db35d' WHERE name = 'Vegas Reales';        -- Fertile green
UPDATE terrain_types SET color = '#b8a170' WHERE name = 'Tierras de Secano';   -- Light brown/ochre
UPDATE terrain_types SET color = '#9e9e9e' WHERE name = 'Yermos';              -- Stone gray
UPDATE terrain_types SET color = '#546e7a' WHERE name = 'Picos de Granito';    -- Dark grayish blue
UPDATE terrain_types SET color = '#a1887f' WHERE name = 'Oteros';              -- Hill brown
UPDATE terrain_types SET color = '#2d5a27' WHERE name = 'Espesuras';           -- Dark forest green
UPDATE terrain_types SET color = '#558b2f' WHERE name = 'Sotos';               -- Grove green
UPDATE terrain_types SET color = '#4fc3f7' WHERE name = 'Albuferas';           -- Water blue
UPDATE terrain_types SET color = '#4e342e' WHERE name = 'Tremedales';          -- Dark swamp brown
UPDATE terrain_types SET color = '#d4e157' WHERE name = 'Estepas';             -- Yellowish green

-- Add comment to document the column
COMMENT ON COLUMN terrain_types.color IS 'Hexadecimal color code for map visualization (#RRGGBB format)';
