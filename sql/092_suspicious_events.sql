-- 092_suspicious_events.sql
-- Tabla de alertas de seguridad generadas por el SuspicionDetector.

CREATE TABLE IF NOT EXISTS suspicious_events (
    id          SERIAL PRIMARY KEY,
    player_id   INT REFERENCES players(player_id) ON DELETE SET NULL,
    username    VARCHAR(100),
    rule        VARCHAR(50)  NOT NULL,
    severity    VARCHAR(10)  NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    details     JSONB        NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    reviewed_by INT,
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suspicious_events_player   ON suspicious_events (player_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_events_reviewed ON suspicious_events (reviewed_at) WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suspicious_events_created  ON suspicious_events (created_at DESC);

INSERT INTO schema_migrations (script_name) VALUES ('092_suspicious_events.sql') ON CONFLICT DO NOTHING;
