-- 095_comarca_resistance.sql
-- Sistema de resistencia de comarca: rastrea la tensión de la población
-- contra el propietario actual. Al llegar al umbral, se dispara una rebelión.

CREATE TABLE IF NOT EXISTS comarca_resistance (
    id           SERIAL PRIMARY KEY,
    division_id  INT            NOT NULL REFERENCES political_divisions(id) ON DELETE CASCADE,
    player_id    INT            NOT NULL REFERENCES players(player_id)      ON DELETE CASCADE,
    resistance   DECIMAL(6,2)   NOT NULL DEFAULT 0,   -- tensión acumulada a largo plazo
    aftershock   DECIMAL(6,2)   NOT NULL DEFAULT 0,   -- choque inmediato post-conquista (decae mensualmente)
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE(division_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_comarca_resistance_player ON comarca_resistance(player_id);
CREATE INDEX IF NOT EXISTS idx_comarca_resistance_division ON comarca_resistance(division_id);

-- Historial del propietario anterior de cada hex (para registrar conquistas)
ALTER TABLE h3_map
    ADD COLUMN IF NOT EXISTS previous_player_id INT REFERENCES players(player_id);

-- Marca ejércitos rebeldes (campesinos en armas sin dueño jugador)
ALTER TABLE armies
    ADD COLUMN IF NOT EXISTS is_rebel BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO schema_migrations (script_name)
VALUES ('095_comarca_resistance.sql')
ON CONFLICT DO NOTHING;
