#!/usr/bin/env python3
"""
Terrain Extractor Tool
Extracts terrain data from GeoTIFF raster and populates H3 hexagonal grid into database.
"""

import logging
import sys
import os
import glob
import time
from typing import List, Tuple, Dict, Optional
from pathlib import Path
import h3
import rasterio
from rasterio.transform import rowcol
from rasterio.windows import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import calculate_default_transform, reproject, Resampling
import psycopg2
from psycopg2.extras import execute_values
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('terrain_extraction.log')
    ]
)
logger = logging.getLogger(__name__)

# Import configuration from config.py
try:
    from config import (
        BOUNDING_BOX,
        H3_RESOLUTION,
        BATCH_SIZE,
        TERRAIN_MAPPING,
        DEFAULT_TERRAIN_TYPE_ID,
        RASTER_DIR,
        DB_CONFIG
    )
    logger.info("Using configuration from config.py")
except ImportError as e:
    logger.error("config.py not found. Please copy config.example.py to config.py and configure it.")
    logger.error(f"Error: {e}")
    sys.exit(1)


def create_region_polygon() -> List[Tuple[float, float]]:
    """
    Creates a polygon boundary for the target region based on bounding box.
    Returns list of (lat, lng) tuples in GeoJSON format.
    """
    return [
        (BOUNDING_BOX['min_lat'], BOUNDING_BOX['min_lng']),
        (BOUNDING_BOX['max_lat'], BOUNDING_BOX['min_lng']),
        (BOUNDING_BOX['max_lat'], BOUNDING_BOX['max_lng']),
        (BOUNDING_BOX['min_lat'], BOUNDING_BOX['max_lng']),
        (BOUNDING_BOX['min_lat'], BOUNDING_BOX['min_lng'])  # Close the polygon
    ]


def generate_h3_cells() -> List[str]:
    """
    Generates H3 cells covering the target region using polygon_to_cells (h3 v4 API).
    Returns list of H3 cell indices as strings.
    """
    logger.info(f"Generating H3 cells at resolution {H3_RESOLUTION} for target region...")

    # Create polygon coordinates in (lat, lng) format for h3 v4
    polygon_coords = [
        (BOUNDING_BOX['min_lat'], BOUNDING_BOX['min_lng']),
        (BOUNDING_BOX['min_lat'], BOUNDING_BOX['max_lng']),
        (BOUNDING_BOX['max_lat'], BOUNDING_BOX['max_lng']),
        (BOUNDING_BOX['max_lat'], BOUNDING_BOX['min_lng']),
    ]

    # Use h3.polygon_to_cells with LatLngPoly (h3 v4 API)
    h3_cells = h3.polygon_to_cells(h3.LatLngPoly(polygon_coords), H3_RESOLUTION)
    h3_cells_list = list(h3_cells)

    logger.info(f"Generated {len(h3_cells_list)} H3 cells")
    return h3_cells_list


def create_vrt_from_tiffs(raster_dir: str, vrt_path: str = None) -> str:
    """
    Creates a Virtual Raster (VRT) from all .tif files in the specified directory.
    Returns the path to the created VRT file.

    Args:
        raster_dir: Directory containing .tif files
        vrt_path: Optional path for the VRT file. If None, creates it in the raster directory.

    Returns:
        Path to the VRT file
    """
    
    #print(f"📍 Directorio de trabajo actual: {os.getcwd()}")
    #print(f"📄 Ruta del script: {os.path.abspath(__file__)}")
    #print(f"📂 Archivos detectados en raster_dir: {os.listdir(raster_dir)}")

    
    logger.info(f"Scanning for .tif files in: {raster_dir}")

    # Find all .tif files in the directory
    tif_pattern = os.path.join(raster_dir, "*.tif")
    tif_files = glob.glob(tif_pattern)

    if not tif_files:
        raise FileNotFoundError(f"No .tif files found in {raster_dir}")

    logger.info(f"Found {len(tif_files)} .tif files")
    for tif_file in tif_files:
        logger.info(f"  - {os.path.basename(tif_file)}")

    # Create VRT path if not provided
    if vrt_path is None:
        vrt_path = os.path.join(raster_dir, "merged_mosaic.vrt")

    # Build VRT using rasterio
    # We'll use rasterio.vrt.WarpedVRT or build it manually
    # For simplicity, we'll use gdal command via subprocess if available
    # But to keep it pure Python, we'll create a simple approach

    try:
        # Try using gdalbuildvrt if available (faster and more reliable)
        from osgeo import gdal

        logger.info(f"Creating VRT using GDAL at: {vrt_path}")
        vrt_options = gdal.BuildVRTOptions(resampleAlg='nearest')
        vrt_dataset = gdal.BuildVRT(vrt_path, tif_files, options=vrt_options)
        vrt_dataset = None  # Close the dataset

        logger.info(f"VRT created successfully: {vrt_path}")
        return vrt_path

    except ImportError:
        logger.warning("GDAL not available, using rasterio merge approach")
        # Fallback: return the directory and we'll handle multiple files differently
        # For now, we'll just use the first file as a fallback
        logger.warning("Using first .tif file as fallback (VRT creation requires GDAL)")
        return tif_files[0]


def scan_raster_coverage(raster_dir: str) -> Dict[str, dict]:
    """
    Scans all .tif files in directory and returns coverage information.

    Returns:
        Dict mapping filename to {bounds, path, dataset_handle}
    """
    tif_pattern = os.path.join(raster_dir, "*.tif")
    tif_files = glob.glob(tif_pattern)

    if not tif_files:
        raise FileNotFoundError(f"No .tif files found in {raster_dir}")

    logger.info(f"Scanning coverage of {len(tif_files)} .tif files...")
    coverage_map = {}

    for tif_file in tif_files:
        try:
            with rasterio.open(tif_file) as ds:
                coverage_map[os.path.basename(tif_file)] = {
                    'path': tif_file,
                    'bounds': ds.bounds,
                    'crs': ds.crs,
                    'width': ds.width,
                    'height': ds.height
                }
                logger.info(f"  - {os.path.basename(tif_file)}: "
                           f"lat=[{ds.bounds.bottom:.2f}, {ds.bounds.top:.2f}], "
                           f"lng=[{ds.bounds.left:.2f}, {ds.bounds.right:.2f}]")
        except Exception as e:
            logger.warning(f"Could not read {tif_file}: {e}")

    return coverage_map


def find_raster_for_coord(lat: float, lng: float, coverage_map: Dict[str, dict]) -> Optional[str]:
    """
    Finds which raster file contains the given coordinates.

    Args:
        lat: Latitude
        lng: Longitude
        coverage_map: Dictionary from scan_raster_coverage

    Returns:
        Path to the raster file, or None if not found
    """
    for filename, info in coverage_map.items():
        bounds = info['bounds']
        if (bounds.left <= lng <= bounds.right and
            bounds.bottom <= lat <= bounds.top):
            return info['path']
    return None


def extract_terrain_from_raster(
    raster_dir: str,
    h3_cells: List[str]
) -> List[Tuple[int, int]]:
    """
    Extracts terrain values from GeoTIFF files for each H3 cell center.
    Dynamically selects the correct tile based on cell coordinates.
    Returns list of tuples (h3_index_as_int, terrain_type_id).

    If a coordinate falls outside the downloaded tiles, it assigns DEFAULT_TERRAIN_TYPE_ID.
    """
    # Scan all available raster files and their coverage
    coverage_map = scan_raster_coverage(raster_dir)

    if not coverage_map:
        raise FileNotFoundError(f"No valid .tif files found in {raster_dir}")

    # Validate coverage for target region bounding box
    logger.info("Validating coverage for target region...")
    center_lat = (BOUNDING_BOX['min_lat'] + BOUNDING_BOX['max_lat']) / 2
    center_lng = (BOUNDING_BOX['min_lng'] + BOUNDING_BOX['max_lng']) / 2

    test_tile = find_raster_for_coord(center_lat, center_lng, coverage_map)
    if not test_tile:
        logger.warning(f"⚠️ No tile found covering region center ({center_lat:.2f}, {center_lng:.2f})")
        logger.warning(f"Available tiles:")
        for filename in coverage_map.keys():
            logger.warning(f"  - {filename}")
        logger.info("Continuing with available tiles - cells outside coverage will use default terrain type")

    logger.info(f"✓ Found coverage tile: {os.path.basename(test_tile)}")

    # Process cells with dynamic tile selection
    terrain_data = []
    processed = 0
    skipped = 0
    out_of_bounds = 0

    # Cache for open datasets to avoid reopening the same file
    dataset_cache = {}
    failed_tiles = set()  # Track tiles that failed to open

    # Performance tracking
    start_time = time.time()
    last_log_time = start_time

    # Log first H3 cell for debugging
    if h3_cells:
        first_lat, first_lng = h3.cell_to_latlng(h3_cells[0])
        logger.info(f"First H3 cell: {h3_cells[0]}")
        logger.info(f"  - Coordinates: lat={first_lat:.6f}, lng={first_lng:.6f}")

    try:
        for idx, h3_index in enumerate(h3_cells):
            # Get center coordinates of H3 cell (returns lat, lng) - h3 v4 API
            lat, lng = h3.cell_to_latlng(h3_index)

            try:
                # Find which raster file contains this coordinate
                raster_path = find_raster_for_coord(lat, lng, coverage_map)

                if not raster_path:
                    # Coordinate outside all available tiles
                    h3_int = int(h3_index, 16)
                    terrain_data.append((h3_int, DEFAULT_TERRAIN_TYPE_ID))
                    out_of_bounds += 1

                    if out_of_bounds <= 5:
                        logger.warning(f"Cell outside all tiles: lat={lat:.6f}, lng={lng:.6f}")
                    continue

                # Skip tiles that previously failed to open
                if raster_path in failed_tiles:
                    h3_int = int(h3_index, 16)
                    terrain_data.append((h3_int, DEFAULT_TERRAIN_TYPE_ID))
                    skipped += 1
                    continue

                # Open dataset (use cache if already open)
                if raster_path not in dataset_cache:
                    try:
                        open_start = time.time()
                        dataset_cache[raster_path] = rasterio.open(raster_path)
                        open_duration = time.time() - open_start

                        logger.info(f"Opened raster: {os.path.basename(raster_path)} ({open_duration:.2f}s)")

                        if open_duration > 5.0:
                            logger.warning(f"⚠️ Slow file open: {os.path.basename(raster_path)} took {open_duration:.1f}s")

                    except Exception as e:
                        logger.error(f"Failed to open {os.path.basename(raster_path)}: {e}")
                        failed_tiles.add(raster_path)
                        h3_int = int(h3_index, 16)
                        terrain_data.append((h3_int, DEFAULT_TERRAIN_TYPE_ID))
                        skipped += 1
                        continue

                dataset = dataset_cache[raster_path]

                # Get pixel row and column for this coordinate
                # rowcol expects (x, y) where x=longitude, y=latitude
                row, col = rowcol(dataset.transform, lng, lat)

                # Check if coordinates are within raster bounds
                if 0 <= row < dataset.height and 0 <= col < dataset.width:
                    # Read single pixel value (windowed reading for efficiency)
                    # Read a 1x1 window at the specific pixel location
                    pixel_value = dataset.read(1, window=((row, row+1), (col, col+1)))[0, 0]

                    # Handle nodata values
                    nodata_value = dataset.nodata
                    if nodata_value is not None and pixel_value == nodata_value:
                        terrain_type_id = DEFAULT_TERRAIN_TYPE_ID
                        skipped += 1
                    else:
                        # Map raster value to terrain_type_id
                        terrain_type_id = TERRAIN_MAPPING.get(
                            int(pixel_value),
                            DEFAULT_TERRAIN_TYPE_ID
                        )
                        processed += 1

                    # Convert H3 index to integer for database storage
                    h3_int = int(h3_index, 16)
                    terrain_data.append((h3_int, terrain_type_id))
                else:
                    # Coordinate within tile bounds but outside raster
                    h3_int = int(h3_index, 16)
                    terrain_data.append((h3_int, DEFAULT_TERRAIN_TYPE_ID))
                    out_of_bounds += 1

            except Exception as e:
                # Any error in reading: assign default terrain type
                if idx < 5:  # Log first few errors
                    logger.warning(f"Error processing cell {h3_index} at lat={lat:.6f}, lng={lng:.6f}: {e}")
                h3_int = int(h3_index, 16)
                terrain_data.append((h3_int, DEFAULT_TERRAIN_TYPE_ID))
                skipped += 1

            # Log progress every 1000 cells with performance stats
            total_cells = processed + skipped + out_of_bounds
            if total_cells % 1000 == 0 and total_cells > 0:
                current_time = time.time()
                elapsed = current_time - start_time
                interval = current_time - last_log_time
                cells_per_sec = 1000 / interval if interval > 0 else 0

                logger.info(f"Processed {total_cells}/{len(h3_cells)} cells "
                           f"({cells_per_sec:.1f} cells/s, "
                           f"{len(dataset_cache)} files open, "
                           f"elapsed: {elapsed:.1f}s)")
                last_log_time = current_time

        total_time = time.time() - start_time
        logger.info(f"Extraction complete in {total_time:.1f}s:")
        logger.info(f"  - {processed} cells with valid terrain data")
        logger.info(f"  - {skipped} cells with nodata values (assigned default)")
        logger.info(f"  - {out_of_bounds} cells outside tile bounds (assigned default)")
        logger.info(f"  - {len(dataset_cache)} raster files used")
        logger.info(f"  - {len(failed_tiles)} raster files failed to open")

        # Calculate coverage percentage
        if h3_cells:
            coverage_pct = (processed / len(h3_cells)) * 100
            logger.info(f"  - Coverage: {coverage_pct:.2f}% of cells have valid terrain data")

            if coverage_pct == 0:
                logger.error("❌ ERROR: 0% coverage - no valid terrain data extracted!")
                logger.error("This likely means the required tile is missing.")

    finally:
        # Close all cached datasets
        logger.info("Closing raster files...")
        for path, dataset in dataset_cache.items():
            try:
                dataset.close()
                logger.debug(f"Closed {os.path.basename(path)}")
            except Exception as e:
                logger.warning(f"Error closing {os.path.basename(path)}: {e}")

    return terrain_data


def insert_terrain_data_batch(
    db_config: Dict[str, str],
    terrain_data: List[Tuple[int, int]]
) -> None:
    """
    Inserts terrain data into h3_map table using optimized batch inserts with execute_values.
    Clears existing data before inserting to avoid duplicates.
    Uses batches of 1000 records and logs progress.
    """
    logger.info(f"Connecting to database at {db_config['host']}...")

    conn = psycopg2.connect(
        host=db_config['host'],
        port=db_config['port'],
        database=db_config['database'],
        user=db_config['user'],
        password=db_config['password']
    )

    try:
        with conn.cursor() as cursor:
            # Clear existing data to avoid duplicates
            logger.info("Clearing existing h3_map data...")
            cursor.execute("TRUNCATE TABLE h3_map;")
            conn.commit()
            logger.info("h3_map table cleared")

            logger.info(f"Inserting {len(terrain_data)} records in batches of {BATCH_SIZE}...")

            # Prepare insert query (execute_values doesn't need %s placeholders in VALUES)
            insert_query = """
                INSERT INTO h3_map (h3_index, terrain_type_id)
                VALUES %s
                ON CONFLICT (h3_index)
                DO UPDATE SET terrain_type_id = EXCLUDED.terrain_type_id
            """

            # Insert in batches with progress logging
            total_inserted = 0
            start_time = time.time()

            for i in range(0, len(terrain_data), BATCH_SIZE):
                batch = terrain_data[i:i + BATCH_SIZE]
                execute_values(cursor, insert_query, batch, page_size=BATCH_SIZE)
                conn.commit()

                total_inserted += len(batch)

                # Log progress every 1000 records
                if total_inserted % 1000 == 0 or total_inserted == len(terrain_data):
                    elapsed = time.time() - start_time
                    rate = total_inserted / elapsed if elapsed > 0 else 0
                    logger.info(f"Inserted {total_inserted}/{len(terrain_data)} records "
                               f"({rate:.1f} records/s)")

            logger.info(f"Successfully inserted {len(terrain_data)} records in {elapsed:.1f}s")

    except Exception as e:
        logger.error(f"Database error: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()
        logger.info("Database connection closed")


def main():
    """
    Main execution function.
    """
    logger.info("=" * 60)
    logger.info("Starting Terrain Extraction Process")
    logger.info("=" * 60)

    # Convert RASTER_DIR to absolute path using pathlib
    script_dir = Path(__file__).parent.resolve()
    raster_dir = (script_dir / RASTER_DIR).resolve()

    logger.info(f"Script directory: {script_dir}")
    logger.info(f"Raster directory: {raster_dir}")
    logger.info(f"Database: {DB_CONFIG['database']} at {DB_CONFIG['host']}")
    logger.info(f"H3 Resolution: {H3_RESOLUTION}")
    logger.info(f"Batch size: {BATCH_SIZE}")
    logger.info(f"Bounding box: lat=[{BOUNDING_BOX['min_lat']}, {BOUNDING_BOX['max_lat']}], "
                f"lng=[{BOUNDING_BOX['min_lng']}, {BOUNDING_BOX['max_lng']}]")

    try:
        # Step 1: Generate H3 cells for target region
        h3_cells = generate_h3_cells()

        # Step 2: Extract terrain data from raster (creates VRT automatically)
        terrain_data = extract_terrain_from_raster(str(raster_dir), h3_cells)

        # Step 3: Insert data into database
        insert_terrain_data_batch(DB_CONFIG, terrain_data)

        logger.info("=" * 60)
        logger.info("Terrain Extraction Process Completed Successfully")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
