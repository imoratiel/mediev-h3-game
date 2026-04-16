-- Órdenes de demolición de edificios de feudo en curso
CREATE TABLE IF NOT EXISTS building_demolitions (
    id               SERIAL PRIMARY KEY,
    h3_index         TEXT    NOT NULL UNIQUE,
    player_id        INT     NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    building_id      INT     NOT NULL,
    building_name    TEXT    NOT NULL,
    turns_remaining  INT     NOT NULL CHECK (turns_remaining >= 0),
    started_turn     INT     NOT NULL,
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_building_demolitions_player ON building_demolitions(player_id);

INSERT INTO schema_migrations (script_name) VALUES ('089_building_demolitions.sql') ON CONFLICT DO NOTHING;
