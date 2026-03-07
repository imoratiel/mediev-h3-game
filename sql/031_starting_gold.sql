-- Cambia el oro inicial por defecto de los jugadores a 100.000
ALTER TABLE players ALTER COLUMN gold SET DEFAULT 100000;

CREATE TABLE IF NOT EXISTS landmarks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    h3_index VARCHAR(15) NOT NULL, -- La posición en el mapa
    type VARCHAR(50) -- 'pueblo', 'monte', 'río', 'pantano'
);

-- Crea un índice para búsquedas rápidas
CREATE INDEX idx_landmarks_h3 ON landmarks(h3_index);

INSERT INTO schema_migrations (script_name)
VALUES ('031_starting_gold.sql')
ON CONFLICT DO NOTHING;
