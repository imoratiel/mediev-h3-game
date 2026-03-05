-- Tabla para gestionar los bloqueos de acciones
CREATE TABLE IF NOT EXISTS army_actions_cooldowns (
    id SERIAL PRIMARY KEY,
    army_id INT NOT NULL REFERENCES armies(army_id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- Ej: 'attack', 'conquer', 'special_ability'
    turns_remaining INT NOT NULL DEFAULT 1 CHECK (turns_remaining >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índice único para evitar duplicados y acelerar búsquedas
-- Un ejército no puede tener dos registros de 'attack' al mismo tiempo
CREATE UNIQUE INDEX IF NOT EXISTS idx_army_action_cooldown 
ON army_actions_cooldowns(army_id, action_type);

-- 1. Limpieza total (según solicitaste)
TRUNCATE TABLE notifications;

-- 2. Aseguramos el valor por defecto
ALTER TABLE notifications ALTER COLUMN type SET DEFAULT 'General';

-- 3. Eliminamos posibles restricciones previas si existen (por seguridad)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS check_notification_type;

-- 4. Añadimos la restricción de categorías (El "Candidato a la verdad")
ALTER TABLE notifications ADD CONSTRAINT check_notification_type 
CHECK (type IN ('Militar', 'Económico', 'Impuestos', 'General', 'Hambre'));

-- Migración: Añadir configuración individual de impuestos a la tabla jugadores
ALTER TABLE players 
ADD COLUMN tax_percentage DECIMAL(5,2) DEFAULT 10.00,
ADD COLUMN tithe_active BOOLEAN DEFAULT FALSE;

-- Nota: Como ya tienes jugadores, el DEFAULT se aplica automáticamente a los existentes.

INSERT INTO schema_migrations (script_name)
VALUES ('025_cooldown.sql');
