-- sql/003_update_terrain_types.sql
-- Description: Reorganización lógica de terrenos, nuevos atributos de simulación y recursos.

-- 1. Añadir nuevas columnas para atributos de jugabilidad
ALTER TABLE terrain_types 
ADD COLUMN IF NOT EXISTS fertility INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS wood INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS fishing INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS mining INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS difficulty_foot INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS difficulty_horse INT DEFAULT 0;

-- 2. Limpieza de datos existentes para forzar el nuevo orden y IDs
-- Usamos CASCADE para que h3_map (que depende de estos IDs) se limpie también
TRUNCATE TABLE terrain_types CASCADE;

-- 3. Reiniciar el contador de ID para empezar desde 1
ALTER SEQUENCE terrain_types_terrain_type_id_seq RESTART WITH 1;

-- 4. Inserción masiva siguiendo la Jerarquía Lógica (Aguas -> Llanuras -> Bosques -> Relieve -> Ciudad)
-- IDs fijos para asegurar consistencia en el extractor y el motor de juego
INSERT INTO terrain_types (terrain_type_id, name, color, fertility, wood, fishing, mining, difficulty_foot, difficulty_horse) VALUES
(1, 'Mar', '#0a4b78', 0, 0, 100, 0, 100, 100),
(2, 'Costa', '#fff59d', 10, 5, 85, 15, 15, 25),
(3, 'Agua', '#4fc3f7', 0, 0, 70, 5, 100, 100),
(4, 'Río', '#00bcd4', 90, 10, 50, 20, 80, 95),
(5, 'Pantanos', '#4e342e', 30, 15, 40, 10, 85, 95),
(6, 'Tierras de Cultivo', '#7db35d', 100, 5, 0, 5, 10, 10),
(7, 'Tierras de Secano', '#b8a170', 55, 15, 0, 10, 15, 20),
(8, 'Estepas', '#d4e157', 35, 5, 0, 15, 5, 5),
(9, 'Bosque', '#558b2f', 40, 75, 0, 30, 45, 65),
(10, 'Bosque Denso', '#2d5a27', 20, 100, 0, 40, 75, 95),
(11, 'Páramo', '#9e9e9e', 5, 0, 0, 70, 30, 40),
(12, 'Colinas', '#8d6e63', 20, 20, 0, 85, 55, 75),
(13, 'Alta montaña', '#546e7a', 0, 5, 0, 100, 95, 100),
(14, 'Asentamientos', '#a1887f', 45, 0, 5, 0, 10, 10);

-- 5. Documentación de metadatos en la base de datos
COMMENT ON COLUMN terrain_types.fertility IS 'Rendimiento agrícola (0-100)';
COMMENT ON COLUMN terrain_types.wood IS 'Disponibilidad de madera (0-100)';
COMMENT ON COLUMN terrain_types.fishing IS 'Potencial de pesca (0-100)';
COMMENT ON COLUMN terrain_types.mining IS 'Probabilidad de encontrar minerales (0-100)';
COMMENT ON COLUMN terrain_types.difficulty_foot IS 'Dificultad de paso a pie (0-100)';
COMMENT ON COLUMN terrain_types.difficulty_horse IS 'Dificultad de paso a caballo (0-100)';