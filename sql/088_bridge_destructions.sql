-- Órdenes de destrucción de puentes en curso
CREATE TABLE IF NOT EXISTS bridge_destructions (
    id               SERIAL PRIMARY KEY,
    h3_index         TEXT    NOT NULL UNIQUE,
    player_id        INT     NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    turns_remaining  INT     NOT NULL CHECK (turns_remaining >= 0),
    started_turn     INT     NOT NULL,
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_destructions_player ON bridge_destructions(player_id);

INSERT INTO schema_migrations (script_name) VALUES ('088_bridge_destructions.sql') ON CONFLICT DO NOTHING;
