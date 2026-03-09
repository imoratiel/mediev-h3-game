-- 036_character_abilities_unique.sql
-- Añade constraint UNIQUE en character_abilities(character_id, ability_key)
-- necesario para ON CONFLICT en inserts de habilidades.

ALTER TABLE character_abilities
ADD CONSTRAINT uq_character_ability UNIQUE (character_id, ability_key);

INSERT INTO schema_migrations (script_name)
VALUES ('036_character_abilities_unique.sql')
ON CONFLICT DO NOTHING;
