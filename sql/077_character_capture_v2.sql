-- Sistema de captura de personajes v2
-- Añade tabla de rescates, encarcelamiento y cooldown de captura

-- Columnas nuevas en characters
ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_imprisoned BOOLEAN DEFAULT FALSE;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS imprisoned_at_h3 VARCHAR(15);
ALTER TABLE characters ADD COLUMN IF NOT EXISTS capture_cooldown INT DEFAULT 0;

-- Tabla de solicitudes de rescate
CREATE TABLE IF NOT EXISTS ransom_requests (
    id SERIAL PRIMARY KEY,
    character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    captor_player_id INT NOT NULL REFERENCES players(player_id),
    owner_player_id INT NOT NULL REFERENCES players(player_id),
    amount INT NOT NULL CHECK (amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ransom_character ON ransom_requests(character_id);
CREATE INDEX IF NOT EXISTS idx_ransom_owner ON ransom_requests(owner_player_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ransom_captor ON ransom_requests(captor_player_id) WHERE status = 'pending';

-- Añadir 'Captura' al constraint de notificaciones si existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_notification_type'
    ) THEN
        ALTER TABLE notifications DROP CONSTRAINT check_notification_type;
        ALTER TABLE notifications ADD CONSTRAINT check_notification_type
            CHECK (type IN ('Militar', 'Económico', 'Impuestos', 'General', 'Hambre', 'Dinastía', 'Captura'));
    END IF;
END $$;

INSERT INTO schema_migrations (script_name)
VALUES ('077_character_capture_v2.sql') ON CONFLICT DO NOTHING;
