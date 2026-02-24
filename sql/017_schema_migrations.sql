-- Tabla para controlar qué scripts se han ejecutado
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    script_name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registramos este primer script como aplicado
INSERT INTO schema_migrations (script_name) VALUES 
('001_initial.sql'),
('002_fix_h3_index_type.sql'),
('003_days_per_year.sql'),
('004_messages.sql'),
('005_message_threading.sql'),
('006_add_gold_resource.sql'),
('007_troops.sql'),
('008_h3_xy.sql'),
('009_capital_to_players.sql'),
('010_paths.sql'),
('011_notifications.sql'),
('012_is_colonizable.sql'),
('013_army_detection_cache.sql'),
('014_player_name.sql'),
('015_turnos_gracia.sql'),
('016_exile_system.sql'),
('017_schema_migrations.sql');

