-- Añadir columna para la gestión de la ocupación
ALTER TABLE territory_details 
ADD COLUMN grace_turns INT DEFAULT 0;

-- Comentario para documentación
COMMENT ON COLUMN territory_details.grace_turns IS 'Indica los turnos restantes en los que el feudo no bloquea la conquista de adyacentes';

-- (Opcional) Si quieres que los feudos actuales empiecen en 0
UPDATE territory_details SET grace_turns = 0 WHERE grace_turns IS NULL;