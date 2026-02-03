-- 003_fix_schema.sql
-- Fix missing columns and ensure building types exist

-- 1. Ensure building_types table exists and has data
CREATE TABLE IF NOT EXISTS building_types (
    building_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon_slug VARCHAR(50)
);

-- Insert 'Aldea' (Village) if not exists (ID 1)
INSERT INTO building_types (building_type_id, name, icon_slug)
VALUES (1, 'Aldea', 'village')
ON CONFLICT (building_type_id) DO NOTHING;

-- 2. Add columns to h3_map if they don't exist
DO $$
BEGIN
    -- Add building_type_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='h3_map' AND column_name='building_type_id') THEN
        ALTER TABLE h3_map ADD COLUMN building_type_id INT DEFAULT 0 REFERENCES building_types(building_type_id);
    END IF;

    -- Add last_update
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='h3_map' AND column_name='last_update') THEN
        ALTER TABLE h3_map ADD COLUMN last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;
