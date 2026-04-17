# Configuration Example
# Copy this file to config.py and update with your values

# Directory containing your GeoTIFF raster files (.tif)
# The script will automatically create a VRT (Virtual Raster) mosaic from all .tif files
RASTER_DIR = "path/to/your/raster_directory"
            # Example: D:\claude\mediev-h3-game\data\

# Mallorca bounding box coordinates
MALLORCA_BBOX = {
    'min_lng': 2.3,
    'min_lat': 39.1,
    'max_lng': 3.5,
    'max_lat': 40.0
}

# H3 resolution (8 = ~0.461 km² per hexagon)
H3_RESOLUTION = 8

# Batch size for database inserts
BATCH_SIZE = 1000

# Mapping from raster pixel values to terrain_type_id in database
# Example mappings - update based on your raster and database:
# 1 = Water/Sea
# 2 = Beach/Coast
# 3 = Plains
# 4 = Forest
# 5 = Mountains
TERRAIN_MAPPING = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
}

# Default terrain type for unmapped or nodata values
DEFAULT_TERRAIN_TYPE_ID = 1

# Multiplier applied to the random ranges of gold_stored and food_stored
# when populating territory_details via populate_economy.py.
# gold_stored: getRandomInt(2000 * M, 6000 * M)
# food_stored: calculateLoot(1000 * M, 2500 * M, food_output)
ECONOMY_RESOURCE_MULTIPLIER = 10

# Multiplier applied to the random range of population when populating territory_details.
# population: getRandomInt(200 * M, 400 * M)
ECONOMY_POPULATION_MULTIPLIER = 6
