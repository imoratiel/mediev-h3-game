-- =============================================================
-- 062_relations.sql
-- Sistema de relaciones políticas entre jugadores
-- =============================================================

-- ── 1. Catálogo de tipos de relación ─────────────────────────
CREATE TABLE IF NOT EXISTS relation_types (
    id                    SMALLINT PRIMARY KEY,
    code                  VARCHAR(30)  UNIQUE NOT NULL,
    name                  VARCHAR(100) NOT NULL,          -- nombre público del tratado
    oath_payer_template   VARCHAR(200),                   -- juramento del que paga/jura
    oath_receiver_template VARCHAR(200),                  -- juramento del que recibe
    tribute_rate          NUMERIC(5,4) DEFAULT 0,         -- 0.05 = 5% de los ingresos
    exclusive_payer       BOOLEAN      DEFAULT FALSE,     -- solo 1 activa como pagador
    exclusive_receiver    BOOLEAN      DEFAULT FALSE,     -- solo 1 activa como receptor
    creator_cultures      INT[]        DEFAULT NULL,      -- NULL = todas las culturas
    breakable_by_payer    BOOLEAN      DEFAULT TRUE,
    breakable_by_receiver BOOLEAN      DEFAULT TRUE
);

INSERT INTO relation_types
    (id, code, name, oath_payer_template, oath_receiver_template,
     tribute_rate, exclusive_payer, exclusive_receiver,
     creator_cultures, breakable_by_payer, breakable_by_receiver)
VALUES
    -- 1. Devotio: solo íberos(3) y celtas(4) pueden jurarlo
    (1, 'devotio',      'Devotio',
     'Devotio a {receiver}',           'Patrón de {payer}',
     0.05, TRUE,  FALSE, ARRAY[3,4], FALSE, FALSE),

    -- 2. Clientela: protección; solo el cliente (payer) puede romperla
    (2, 'clientela',    'Protección',
     'Estado cliente de {receiver}',   'Patrón de {payer}',
     0.10, TRUE,  FALSE, NULL,        TRUE,  FALSE),

    -- 3. Hospitium: amistad sin tributo, múltiple
    (3, 'hospitium',    'Hospitium',
     'Hospitium con {receiver}',       'Hospitium con {payer}',
     0.00, FALSE, FALSE, NULL,        TRUE,  TRUE),

    -- 4. Rehenes: garantía personal; 2% de ingresos al custodio
    (4, 'rehenes',      'Rehenes',
     'Garantía personal con {receiver}','Custodio de {payer}',
     0.02, FALSE, FALSE, NULL,        TRUE,  TRUE),

    -- 5. Mercenariado: pago fijo mensual, sin % de ingresos
    (5, 'mercenariado', 'Mercenariado',
     'Contrato con {receiver}',        'Contratante {payer}',
     0.00, FALSE, FALSE, NULL,        TRUE,  TRUE),

    -- 6. Alianza: sin tributo, ambas partes equivalentes
    (6, 'alianza',      'Alianza',
     'Alianza con {receiver}',         'Alianza con {payer}',
     0.00, FALSE, FALSE, NULL,        TRUE,  TRUE),

    -- 7. Tributo: % definido por el receptor (5-10%), duración fija
    (7, 'tributo',      'Tributo',
     'Tributario de {receiver}',       'Dominador de {payer}',
     0.00, TRUE,  FALSE, NULL,        FALSE, TRUE),

    -- 8. Guerra: bloquea nuevos tratados con el bloque enemigo
    (8, 'guerra',       'Guerra',
     'En guerra con {receiver}',       'En guerra con {payer}',
     0.00, FALSE, FALSE, NULL,        TRUE,  TRUE)

ON CONFLICT (id) DO NOTHING;

-- ── 2. Tabla principal de relaciones ─────────────────────────
CREATE TABLE IF NOT EXISTS player_relations (
    relation_id          SERIAL PRIMARY KEY,
    type_id              SMALLINT     NOT NULL REFERENCES relation_types(id),

    -- from = quien propone / paga / jura
    -- to   = quien recibe / cobra / es el patrón
    from_player_id       INT          NOT NULL REFERENCES players(player_id),
    to_player_id         INT          NOT NULL REFERENCES players(player_id),

    status               VARCHAR(20)  NOT NULL DEFAULT 'pending',
    -- pending | active | ended

    -- Términos económicos (override por contrato)
    terms_rate           NUMERIC(5,4),         -- tributo: 0.05-0.10 definido por receptor
    terms_fixed_pay      BIGINT,               -- mercenariado: pago mensual en oro
    terms_duration_months INT,                 -- meses de duración del contrato

    -- Rehenes: referencia al personaje
    hostage_character_id INT REFERENCES characters(id) ON DELETE SET NULL,

    proposed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    started_at           TIMESTAMPTZ,
    ended_at             TIMESTAMPTZ,
    expires_at_turn      INT,                  -- turno en que expira (NULL = indefinido)

    end_reason           VARCHAR(100),
    -- broken_payer | broken_receiver | expired | patron_death | non_payment

    CONSTRAINT chk_status CHECK (status IN ('pending','active','ended')),
    CONSTRAINT chk_different_players CHECK (from_player_id <> to_player_id)
);

CREATE INDEX IF NOT EXISTS idx_pr_from   ON player_relations(from_player_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pr_to     ON player_relations(to_player_id)   WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pr_type   ON player_relations(type_id)        WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pr_status ON player_relations(status);

-- ── 3. Historial de eventos ───────────────────────────────────
CREATE TABLE IF NOT EXISTS relation_events (
    event_id        SERIAL PRIMARY KEY,
    relation_id     INT          NOT NULL REFERENCES player_relations(relation_id),
    event_type      VARCHAR(50)  NOT NULL,
    -- proposed | accepted | broken | tribute_paid | expired | patron_death |
    -- non_payment | character_death
    actor_player_id INT          REFERENCES players(player_id),
    amount          BIGINT,
    turn_number     INT,
    details         JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_re_relation ON relation_events(relation_id);
CREATE INDEX IF NOT EXISTS idx_re_actor    ON relation_events(actor_player_id);

-- ── 4. Reputación en players ──────────────────────────────────
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS reputation INT NOT NULL DEFAULT 0
    CHECK (reputation BETWEEN -100 AND 100);

-- ── 5. Migración ──────────────────────────────────────────────
INSERT INTO schema_migrations (script_name)
VALUES ('062_relations.sql')
ON CONFLICT DO NOTHING;
