-- Añade 'Dinastía' al constraint de tipos de notificación
-- Fix: character_lifecycle.js usa este tipo pero no estaba permitido
-- Impacto: los eventos de nacimiento, muerte y herencia no generaban notificaciones

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS check_notification_type;

ALTER TABLE notifications
    ADD CONSTRAINT check_notification_type
    CHECK (type IN ('Militar', 'Económico', 'Impuestos', 'General', 'Hambre', 'Dinastía'));

INSERT INTO schema_migrations (script_name)
VALUES ('075_notification_dynasty_type.sql') ON CONFLICT DO NOTHING;
