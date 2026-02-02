-- Migration 004: Add historical infrastructure (Roman roads and settlements)
-- Date: 2026-02-02
-- Description: Adds support for historical infrastructure overlays

-- ========================================
-- 1. Add has_road column to h3_map table
-- ========================================
-- This column marks hexagons that contain Roman roads or historical routes
-- Does NOT change terrain type - roads are an overlay attribute

ALTER TABLE h3_map
ADD COLUMN IF NOT EXISTS has_road BOOLEAN NOT NULL DEFAULT FALSE;

-- Create index for efficient road queries
CREATE INDEX IF NOT EXISTS idx_h3_map_has_road ON h3_map(has_road) WHERE has_road = TRUE;

COMMENT ON COLUMN h3_map.has_road IS 'Indicates if hexagon contains a Roman road or historical route (overlay attribute, does not affect terrain type)';

-- ========================================
-- 2. Create settlements table
-- ========================================
-- Stores historical settlements (cities, towns, villages) with their metadata

CREATE TABLE IF NOT EXISTS settlements (
    settlement_id SERIAL PRIMARY KEY,
    h3_index BIGINT NOT NULL UNIQUE, -- UNIQUE constraint for ON CONFLICT
    name TEXT NOT NULL,
    settlement_type TEXT NOT NULL CHECK (settlement_type IN ('city', 'town', 'village', 'fort', 'monastery')),
    population_rank INTEGER CHECK (population_rank >= 1 AND population_rank <= 10),
    period TEXT, -- 'roman', 'medieval', 'modern'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Foreign key to h3_map
    CONSTRAINT fk_settlement_h3_index FOREIGN KEY (h3_index)
        REFERENCES h3_map(h3_index) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_settlements_type ON settlements(settlement_type);
CREATE INDEX IF NOT EXISTS idx_settlements_period ON settlements(period);

-- Add comments
COMMENT ON TABLE settlements IS 'Historical settlements (cities, towns, villages) mapped to H3 hexagons';
COMMENT ON COLUMN settlements.h3_index IS 'H3 index (resolution 8) where settlement is located';
COMMENT ON COLUMN settlements.name IS 'Historical name of the settlement';
COMMENT ON COLUMN settlements.settlement_type IS 'Type of settlement: city, town, village, fort, monastery';
COMMENT ON COLUMN settlements.population_rank IS 'Population ranking (1=largest, 10=smallest)';
COMMENT ON COLUMN settlements.period IS 'Historical period: roman, medieval, modern';

-- ========================================
-- 3. Create view for enriched map data
-- ========================================
-- Combines terrain, roads, and settlements for easy querying

CREATE OR REPLACE VIEW v_enriched_map AS
SELECT
    h3_map.h3_index,
    h3_map.terrain_type_id,
    terrain_types.name AS terrain_name,
    terrain_types.color AS terrain_color,
    h3_map.has_road,
    s.settlement_id,
    s.name AS settlement_name,
    s.settlement_type,
    s.population_rank,
    s.period
FROM h3_map
LEFT JOIN terrain_types ON h3_map.terrain_type_id = terrain_types.terrain_type_id
LEFT JOIN settlements s ON h3_map.h3_index = s.h3_index;

COMMENT ON VIEW v_enriched_map IS 'Enriched map view combining terrain, roads, and settlements';

-- ========================================
-- 4. Sample data (for testing)
-- ========================================
-- Uncomment to insert sample data

/*
-- Mark some hexagons as having roads (example)
UPDATE h3_map SET has_road = TRUE WHERE h3_index IN (
    -- Add sample H3 indices here
);

-- Insert sample settlements (example)
INSERT INTO settlements (h3_index, name, settlement_type, population_rank, period) VALUES
    (599999999999999, 'Legio VII Gemina', 'city', 1, 'roman'),
    (599999999999998, 'Asturica Augusta', 'city', 2, 'roman'),
    (599999999999997, 'Bracara Augusta', 'city', 3, 'roman');
*/

-- ========================================
-- 5. Verification queries
-- ========================================

-- Count hexagons with roads
SELECT COUNT(*) AS hexagons_with_roads FROM h3_map WHERE has_road = TRUE;

-- Count settlements by type
SELECT settlement_type, COUNT(*) AS count FROM settlements GROUP BY settlement_type;

-- Count settlements by period
SELECT period, COUNT(*) AS count FROM settlements GROUP BY period;

COMMIT;
