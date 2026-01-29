# Terrain Extractor Tool

Tool for extracting terrain data from GeoTIFF raster files and populating the H3 hexagonal grid in the database.

## Features

- Generates H3 hexagonal cells at resolution 8 for Mallorca region
- Extracts terrain values from GeoTIFF raster files
- Maps raster pixel values to terrain type IDs
- Batch inserts data into PostgreSQL database for efficiency
- Comprehensive logging of the extraction process

## Installation

1. Install Python 3.8 or higher

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Configuration

### Option 1: Using config.py (Recommended)

1. Copy the example configuration file:
```bash
cp config.example.py config.py
```

2. Edit `config.py` with your values:
   - Update `RASTER_PATH` with your GeoTIFF file path
   - Update `DB_CONFIG` with your database credentials
   - Update `TERRAIN_MAPPING` to match your raster values to terrain types

### Option 2: Direct editing

Alternatively, edit the default values directly in `extractor.py` (not recommended for version control)

## Usage

Run the extractor:
```bash
python extractor.py
```

The script will:
1. Generate H3 cells covering Mallorca (BBox: [2.3, 39.1] - [3.5, 40.0])
2. Extract terrain values from the raster for each cell center
3. Insert the data into the `h3_map` table

## Output

- Console output with progress information
- Log file: `terrain_extraction.log`

## Performance

- Uses batch inserts (1000 records per batch) for optimal database performance
- Progress logging every 1000 cells processed
- ON CONFLICT handling for re-running the extraction (updates existing records)

## Area Coverage

**Mallorca Bounding Box:**
- Min: [2.3°E, 39.1°N]
- Max: [3.5°E, 40.0°N]

**H3 Resolution:** 8 (~0.461 km² per hexagon)

## Database Schema

The tool expects the following table structure:

```sql
CREATE TABLE h3_map (
    h3_index BIGINT PRIMARY KEY,
    terrain_type_id INTEGER NOT NULL,
    -- other fields...
);
```
