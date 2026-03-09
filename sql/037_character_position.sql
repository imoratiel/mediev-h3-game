-- Añade posición propia al personaje (independiente del ejército al que esté asignado).
-- Un personaje puede estar en un hex aunque no tenga army_id.

ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS h3_index VARCHAR(15) REFERENCES h3_map(h3_index) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_characters_h3 ON characters(h3_index) WHERE h3_index IS NOT NULL;

-- Inicializar posición de personajes existentes desde el ejército vinculado (si tienen uno)
UPDATE characters c
SET h3_index = a.h3_index
FROM armies a
WHERE c.army_id = a.army_id
  AND c.h3_index IS NULL;

INSERT INTO schema_migrations (script_name)
VALUES ('037_character_position.sql')
ON CONFLICT DO NOTHING;
