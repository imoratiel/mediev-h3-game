-- ============================================================
-- 086_market.sql
-- Sistema de mercado: commodities + accesos a recursos
-- ============================================================

-- Catálogo de recursos negociables
CREATE TABLE IF NOT EXISTS market_resource_types (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50)  NOT NULL UNIQUE,  -- clave interna: 'food', 'stone', ...
    display_name    VARCHAR(100) NOT NULL,
    category        VARCHAR(20)  NOT NULL CHECK (category IN ('commodity', 'access')),
    base_price      DECIMAL(10,2) NOT NULL,  -- precio de equilibrio
    base_reserve    INTEGER       NOT NULL,  -- reserva de referencia (punto de equilibrio)
    min_price       DECIMAL(10,2) NOT NULL,
    max_price       DECIMAL(10,2) NOT NULL,
    spread          DECIMAL(5,4)  NOT NULL DEFAULT 0.10,  -- margen de mercado (10%)
    access_cost_monthly INTEGER   NULL,   -- solo para category='access': coste mensual en oro
    description     TEXT
);

-- Estado actual de reservas del mercado (una fila por recurso commodity)
CREATE TABLE IF NOT EXISTS market_reserves (
    resource_type_id INTEGER PRIMARY KEY REFERENCES market_resource_types(id),
    current_reserve  INTEGER NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historial de transacciones
CREATE TABLE IF NOT EXISTS market_transactions (
    id               SERIAL PRIMARY KEY,
    player_id        INTEGER NOT NULL REFERENCES players(player_id),
    resource_type_id INTEGER NOT NULL REFERENCES market_resource_types(id),
    transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('buy', 'sell', 'access_buy', 'access_renew', 'access_expired')),
    quantity         INTEGER,           -- NULL para transacciones de tipo 'access'
    unit_price       DECIMAL(10,2),     -- precio por unidad al momento
    total_gold       INTEGER NOT NULL,  -- oro intercambiado (positivo = cobrado al jugador)
    h3_index         TEXT,              -- feudo de origen para ventas
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Accesos a recursos comprados por jugadores
CREATE TABLE IF NOT EXISTS player_resource_access (
    id               SERIAL PRIMARY KEY,
    player_id        INTEGER NOT NULL REFERENCES players(player_id),
    resource_type_id INTEGER NOT NULL REFERENCES market_resource_types(id),
    acquired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL,   -- se renueva cada turn mensual
    UNIQUE (player_id, resource_type_id)
);

CREATE INDEX IF NOT EXISTS idx_market_transactions_player ON market_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_market_transactions_resource ON market_transactions(resource_type_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_resource_access_expires ON player_resource_access(expires_at);

-- ── Datos iniciales ────────────────────────────────────────────────────────────
INSERT INTO market_resource_types (name, display_name, category, base_price, base_reserve, min_price, max_price, spread, access_cost_monthly, description)
VALUES
    ('food',  'Comida',  'commodity', 2.00, 5000, 0.50, 8.00, 0.10, 0, 'Alimentos producidos en los feudos. El precio sube cuando las reservas escasean.'),
    ('stone', 'Piedra',  'access',    0, 0, 0, 0, 0, 3000, 'Acceso a canteras de piedra. Tus edificios no se deterioran y se reparan solos cada turno.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO market_reserves (resource_type_id, current_reserve)
SELECT id, 5000 FROM market_resource_types WHERE name = 'food'
ON CONFLICT (resource_type_id) DO NOTHING;

-- =============================================================
INSERT INTO schema_migrations (script_name)
VALUES ('086_market.sql')
ON CONFLICT DO NOTHING;
