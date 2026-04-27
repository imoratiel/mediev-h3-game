-- Threshold tracking for army provision warnings (food and gold)
-- NULL = never notified / above 30 days
-- 30 / 20 / 10 = lowest threshold already notified
ALTER TABLE armies
    ADD COLUMN IF NOT EXISTS food_threshold_notified INT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS gold_threshold_notified INT DEFAULT NULL;

INSERT INTO schema_migrations (filename) VALUES ('094_army_provision_thresholds.sql') ON CONFLICT DO NOTHING;
