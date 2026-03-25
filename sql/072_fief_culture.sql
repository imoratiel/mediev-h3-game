-- 072_fief_culture.sql
-- Tabla de cultura por feudo. Columna por cultura (0-100).
-- Se puebla progresivamente por el motor de turnos vía templos.

CREATE TABLE IF NOT EXISTS fief_culture (
    h3_index            VARCHAR(20) PRIMARY KEY REFERENCES h3_map(h3_index) ON DELETE CASCADE,
    culture_romanos     SMALLINT    NOT NULL DEFAULT 0 CHECK (culture_romanos     BETWEEN 0 AND 100),
    culture_cartagineses SMALLINT   NOT NULL DEFAULT 0 CHECK (culture_cartagineses BETWEEN 0 AND 100),
    culture_iberos      SMALLINT    NOT NULL DEFAULT 0 CHECK (culture_iberos      BETWEEN 0 AND 100),
    culture_celtas      SMALLINT    NOT NULL DEFAULT 0 CHECK (culture_celtas      BETWEEN 0 AND 100),
    updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índice para acelerar lecturas por zona
CREATE INDEX IF NOT EXISTS idx_fief_culture_h3 ON fief_culture (h3_index);

INSERT INTO schema_migrations (script_name)
VALUES ('072_fief_culture.sql') ON CONFLICT DO NOTHING;