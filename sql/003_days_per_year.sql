-- 1. Añadir la columna days_per_year a world_state
-- Usamos 365 como valor por defecto para el año natural
ALTER TABLE world_state 
ADD COLUMN days_per_year INT DEFAULT 365;

-- 2. Asegurarnos de que el registro único de estado esté actualizado
-- (Normalmente el ID es 1 en esta tabla de control)
UPDATE world_state 
SET 
    days_per_year = 365,
    current_turn = 1,              -- Reiniciamos al Día 1
    game_date = '1039-03-01'       -- Fecha de inicio (Primavera medieval)
WHERE id = 1;

-- 3. (Opcional) Si quieres que el consumo sea consistente desde ya:
-- El consumo diario es 0.01 por cada 100 habitantes (10% del anterior)