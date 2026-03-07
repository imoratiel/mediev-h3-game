-- 034_division_tax_rate_range.sql
-- Ajusta el rango válido de tax_rate en political_divisions: 1-15% (antes 0-100%).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_division_tax_rate'
    ) THEN
        ALTER TABLE political_divisions DROP CONSTRAINT chk_division_tax_rate;
    END IF;
END$$;

ALTER TABLE political_divisions
ADD CONSTRAINT chk_division_tax_rate CHECK (tax_rate >= 1 AND tax_rate <= 15);

-- Clamp existing values que queden fuera del nuevo rango
UPDATE political_divisions SET tax_rate = 1  WHERE tax_rate < 1;
UPDATE political_divisions SET tax_rate = 15 WHERE tax_rate > 15;

INSERT INTO schema_migrations (script_name)
VALUES ('034_division_tax_rate_range.sql')
ON CONFLICT DO NOTHING;
