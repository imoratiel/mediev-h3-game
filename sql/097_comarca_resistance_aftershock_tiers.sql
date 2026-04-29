-- Aftershock tiers based on conquering army size vs comarca population
-- aftershock_multiplier: applied to countdown value (0.5 = halved impact, same duration)
-- aftershock_override: if set, adds this fixed value per turn instead of countdown × multiplier

ALTER TABLE comarca_resistance
    ADD COLUMN IF NOT EXISTS aftershock_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS aftershock_override   DECIMAL(5,2)          DEFAULT NULL;

INSERT INTO schema_migrations (script_name) VALUES ('097_comarca_resistance_aftershock_tiers.sql')
ON CONFLICT DO NOTHING;
