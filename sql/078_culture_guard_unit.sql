-- Unidad de guardia personal por cultura
-- Determina qué tipo de tropa de élite usa cada facción como guardia

ALTER TABLE cultures ADD COLUMN IF NOT EXISTS guard_unit_type_id INT REFERENCES unit_types(unit_type_id);

-- Romanos → Pretorianos (7)
UPDATE cultures SET guard_unit_type_id = 7  WHERE id = 1;
-- Cartagineses → Infantería Libia (9) — élite de infantería cartaginesa
UPDATE cultures SET guard_unit_type_id = 9  WHERE id = 2;
-- Íberos → Devotio (23) — guerreros sagrados ibéricos
UPDATE cultures SET guard_unit_type_id = 23 WHERE id = 3;
-- Celtas → Lanzahachas (28) — guerreros celtas de élite
UPDATE cultures SET guard_unit_type_id = 28 WHERE id = 4;

INSERT INTO schema_migrations (script_name)
VALUES ('078_culture_guard_unit.sql') ON CONFLICT DO NOTHING;
