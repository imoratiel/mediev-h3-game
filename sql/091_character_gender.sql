-- 091_character_gender.sql
-- Añade columna gender a la tabla characters (ya existe en players).

ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS gender CHAR(1) CHECK (gender IN ('M', 'F')) DEFAULT 'M';

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS gender CHAR(1) CHECK (gender IN ('M', 'F')) DEFAULT 'M';

INSERT INTO schema_migrations (script_name) VALUES ('091_character_gender.sql') ON CONFLICT DO NOTHING;
