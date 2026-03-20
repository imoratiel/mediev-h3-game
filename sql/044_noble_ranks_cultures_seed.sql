-- 044_noble_ranks_cultures_seed.sql
-- Seed de culturas + rangos nobiliarios por cultura.
--
-- Progresión de feudos unificada para todas las culturas:
--   Rango 1: min=1,    max=NULL   (sin límite)
--   Rango 2: min=50,   max=80
--   Rango 3: min=100,  max=150
--   Rango 4: min=250,  max=400
--   Rango 5: min=500,  max=600
--   Rango 6: min=1000, max=NULL   (sin límite, cúspide)

-- ── 0. Resetear secuencia noble_ranks (los datos iniciales usaron IDs explícitos) ──
SELECT setval('noble_ranks_id_seq', (SELECT MAX(id) FROM noble_ranks));

-- ── 1. Culturas ───────────────────────────────────────────────────────────────
INSERT INTO cultures (name, description) VALUES
    ('Romanos',      'El Imperio Romano y sus provincias hispanas. Jerarquía militar y administrativa.')
  , ('Cartagineses', 'La república mercantil de Cartago y sus territorios en Hispania.')
  , ('Íberos',       'Los pueblos íberos nativos de la península, organizados en tribus y reinos.')
  , ('Celtas',       'Los pueblos celtas del norte y centro peninsular, con fuerte tradición druídica.')
ON CONFLICT (name) DO NOTHING;

-- ── 2. Rangos — ROMANOS ───────────────────────────────────────────────────────
DO $$
DECLARE
    cid  INT;
    r1   INT; r2 INT; r3 INT; r4 INT; r5 INT;
BEGIN
    SELECT id INTO cid FROM cultures WHERE name = 'Romanos';
    IF cid IS NULL OR EXISTS (SELECT 1 FROM noble_ranks WHERE culture_id = cid LIMIT 1) THEN RETURN; END IF;

    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Tiro',     'Tiro',     'Contubernium', 1,    NULL, 1, NULL, 0, cid) RETURNING id INTO r1;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Decurión', 'Decurión', 'Decuria',       50,   80,   2, r1,   1, cid) RETURNING id INTO r2;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Centurión', 'Centurión', 'Centuria',    100,  150,  3, r2,   3, cid) RETURNING id INTO r3;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Prefecto',  'Prefecta',  'Prefectura',  250,  400,  4, r3,   6, cid) RETURNING id INTO r4;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Legatus',   'Legata',    'Legatio',     500,  600,  5, r4,   10, cid) RETURNING id INTO r5;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Consul',    'Consul',    'Consulado',   1000, NULL, 6, r5,   20, cid);
END$$;

-- ── 3. Rangos — CARTAGINESES ──────────────────────────────────────────────────
DO $$
DECLARE
    cid  INT;
    r1   INT; r2 INT; r3 INT; r4 INT; r5 INT;
BEGIN
    SELECT id INTO cid FROM cultures WHERE name = 'Cartagineses';
    IF cid IS NULL OR EXISTS (SELECT 1 FROM noble_ranks WHERE culture_id = cid LIMIT 1) THEN RETURN; END IF;

    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Mercenarius',       'Mercenaria',       'Destacamento',  1,    NULL, 1, NULL, 0, cid) RETURNING id INTO r1;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Oficial Mercenario','Oficial Mercenario','Compañía',      50,   80,   2, r1,  1, cid) RETURNING id INTO r2;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Capitán de Flota',  'Capitana de Flota', 'Flota',        100,  150,  3, r2,   3, cid) RETURNING id INTO r3;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Comandante',        'Comandante',        'Comandancia',  250,  400,  4, r3,   6, cid) RETURNING id INTO r4;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Estratego',         'Estratega',         'Estrategia',   500,  600,  5, r4,   10, cid) RETURNING id INTO r5;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Sufete',            'Sufete',            'Sufetado',     1000, NULL, 6, r5,   20, cid);
END$$;

-- ── 4. Rangos — ÍBEROS ───────────────────────────────────────────────────────
DO $$
DECLARE
    cid  INT;
    r1   INT; r2 INT; r3 INT; r4 INT; r5 INT;
BEGIN
    SELECT id INTO cid FROM cultures WHERE name = 'Íberos';
    IF cid IS NULL OR EXISTS (SELECT 1 FROM noble_ranks WHERE culture_id = cid LIMIT 1) THEN RETURN; END IF;

    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Guerrero',        'Guerrera',        'Aldea',              1,    NULL, 1, NULL, 0, cid) RETURNING id INTO r1;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Noble Local',     'Noble Local',     'Territorio Local',   50,   80,   2, r1,   1, cid) RETURNING id INTO r2;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Jefe de Clan',       'Jefa de Clan',       'Dominio del Clan',   100,  150,  3, r2,   3, cid) RETURNING id INTO r3;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Régulo',          'Régula',          'Régulo',             250,  400,  4, r3,   6, cid) RETURNING id INTO r4;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Gran Caudillo',   'Gran Caudilla',   'Gran Caudillaje',    500,  600,  5, r4,   10, cid) RETURNING id INTO r5;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Rey de Reyes',    'Reina de Reinas', 'Reino Supremo',      1000, NULL, 6, r5,   20, cid);
END$$;

-- ── 5. Rangos — CELTAS ────────────────────────────────────────────────────────
DO $$
DECLARE
    cid  INT;
    r1   INT; r2 INT; r3 INT; r4 INT; r5 INT;
BEGIN
    SELECT id INTO cid FROM cultures WHERE name = 'Celtas';
    IF cid IS NULL OR EXISTS (SELECT 1 FROM noble_ranks WHERE culture_id = cid LIMIT 1) THEN RETURN; END IF;

    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Tribal',                'Tribal',                  'Tribu',            1,    NULL, 1, NULL, 0, cid) RETURNING id INTO r1;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Guerrero de Élite',     'Guerrera de Élite',       'Élite Tribal',     50,   80,   2, r1,   1, cid) RETURNING id INTO r2;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Jefe de Aldea',         'Jefa de Aldea',           'Aldea',            100,  150,  3, r2,   1, cid) RETURNING id INTO r3;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Vate',     'Vate',       'Cantón Druídico',  250,  400,  4, r3,   1, cid) RETURNING id INTO r4;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Vergobretus',           'Vergobretra',             'Vergobrecia',      500,  600,  5, r4,   1, cid) RETURNING id INTO r5;
    INSERT INTO noble_ranks (title_male, title_female, territory_name, min_fiefs_required, max_fiefs_limit, level_order, required_parent_rank_id, required_count, culture_id)
    VALUES ('Gran Rey',  'Gran Reina','Gran Druidiato',   1000, NULL, 6, r5,   1, cid);
END$$;

update players set noble_rank_id = 9; 

delete from noble_ranks where id <=8;

-- ── 6. Registro de migración ──────────────────────────────────────────────────
INSERT INTO schema_migrations (script_name)
VALUES ('044_noble_ranks_cultures_seed.sql')
ON CONFLICT DO NOTHING;
