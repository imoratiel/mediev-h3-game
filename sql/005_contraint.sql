-- ========================================
-- Migration 005: Fix settlements constraints
-- Date: 2026-02-02
-- Description: Fixes population_rank constraint and ensures h3_index uniqueness
-- ========================================

BEGIN;

-- 1. Eliminamos la restricción de rango de población que estaba causando errores
ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_population_rank_check;

-- 2. Añadimos una nueva restricción flexible (1-10 o NULL)
-- NULL permite asentamientos sin ranking de población
ALTER TABLE settlements ADD CONSTRAINT settlements_population_rank_check
CHECK (population_rank IS NULL OR (population_rank >= 1 AND population_rank <= 10));

-- 3. Aseguramos que h3_index sea único para que funcione el 'ON CONFLICT'
-- Este constraint ya existe en 004_add_historical_infrastructure.sql (línea 26),
-- pero lo verificamos por si se ejecutó fuera de orden
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'settlements_h3_index_key'
        AND conrelid = 'settlements'::regclass
    ) THEN
        ALTER TABLE settlements ADD CONSTRAINT settlements_h3_index_key UNIQUE (h3_index);
        RAISE NOTICE 'UNIQUE constraint on h3_index created';
    ELSE
        RAISE NOTICE 'UNIQUE constraint on h3_index already exists';
    END IF;
END $$;

-- 4. Limpiamos posibles datos corruptos de intentos anteriores
DELETE FROM settlements WHERE population_rank IS NOT NULL AND (population_rank < 1 OR population_rank > 10);

-- 5. Verificación
SELECT
    COUNT(*) AS total_settlements,
    COUNT(CASE WHEN population_rank IS NOT NULL THEN 1 END) AS with_rank,
    MIN(population_rank) AS min_rank,
    MAX(population_rank) AS max_rank
FROM settlements;

COMMIT;