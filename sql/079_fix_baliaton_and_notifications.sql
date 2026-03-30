-- Fix notificación Dinastía (constraint no incluía ese tipo)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS check_notification_type;
ALTER TABLE notifications ADD CONSTRAINT check_notification_type
    CHECK (type IN ('Militar', 'Económico', 'Impuestos', 'General', 'Hambre', 'Dinastía', 'Captura'));

-- Fix Baliaton Syphax: se creó con age=5, el jugador indica que debería tener 17
UPDATE characters SET age = 17 WHERE id = 226 AND name ILIKE '%Baliaton%';

INSERT INTO schema_migrations (script_name)
VALUES ('079_fix_baliaton_and_notifications.sql') ON CONFLICT DO NOTHING;
