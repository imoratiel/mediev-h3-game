-- Personajes empiezan en nivel de display 1 (valor interno 10, ya que displayLevel = floor(level/10))
ALTER TABLE characters ALTER COLUMN level SET DEFAULT 10;
UPDATE characters SET level = 10 WHERE level = 1;

INSERT INTO schema_migrations (script_name)
VALUES ('065_characters_level_default.sql')
ON CONFLICT DO NOTHING;
