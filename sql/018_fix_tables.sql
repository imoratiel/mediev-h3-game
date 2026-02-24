-- 1. Añadir campo 'destination' a la tabla armies
ALTER TABLE armies 
ADD COLUMN IF NOT EXISTS destination VARCHAR(16);

-- 2. Añadir campo 'recovering' a la tabla armies
-- Usamos INT4 (que es el alias de INTEGER en Postgres)
ALTER TABLE armies 
ADD COLUMN IF NOT EXISTS recovering INT4 DEFAULT 0;

-- 3. Registrar el cambio en tu tabla de versiones manual
-- (Cambiando el nombre al que corresponda en tu secuencia)
INSERT INTO schema_migrations (script_name) 
VALUES ('018_fix_tablesds.sql');

-- 4. Verificar que se han creado correctamente
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'armies' 
AND column_name IN ('destination', 'recovering');