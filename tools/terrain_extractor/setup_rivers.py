#!/usr/bin/env python3
"""
HydroRIVERS Network Setup Script
Downloads and processes major river networks for Europe from HydroRIVERS dataset.
Filters to keep only significant rivers (Stream Order >= 4).
"""

import os
import sys
import logging
import requests
import zipfile
import geopandas as gpd
from pathlib import Path
from shapely.geometry import box

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Base data directory
BASE_DATA_DIR = Path(__file__).parent.parent.parent.resolve() / 'data'
VECTORS_DIR = BASE_DATA_DIR / 'vectors'
RIVERS_DIR = VECTORS_DIR / 'rivers'

# HydroRIVERS download URL (HydroSHEDS project)
# Note: Europe is covered by multiple regions (eu, as)
HYDRORIVERS_REGIONS = {
    'eu': 'https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_eu_shp.zip',
    'as': 'https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip'  # For eastern Europe/Russia
}

# Europe bounding box for filtering
EUROPE_BBOX = {
    'min_lat': 27.0,
    'max_lat': 72.0,
    'min_lng': -25.0,
    'max_lng': 45.0
}

# Stream order threshold (4+ = Major rivers: Danube, Rhine, Elbe, etc.)
MIN_STREAM_ORDER = 4


def download_hydrorivers_region(region_code: str, output_dir: Path) -> bool:
    """
    Downloads HydroRIVERS data for a specific region.

    Args:
        region_code: Region code (e.g., 'eu', 'as')
        output_dir: Directory to save the downloaded file

    Returns:
        True if successful, False otherwise
    """
    url = HYDRORIVERS_REGIONS.get(region_code)
    if not url:
        logger.error(f"Unknown region code: {region_code}")
        return False

    zip_filename = f"HydroRIVERS_v10_{region_code}_shp.zip"
    zip_path = output_dir / zip_filename

    # Skip if already downloaded
    if zip_path.exists():
        logger.info(f"✓ {zip_filename} already exists")
        return True

    logger.info(f"Downloading HydroRIVERS {region_code.upper()} from {url}...")

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, stream=True, timeout=300)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0

        with open(zip_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Log progress every 10MB
                    if downloaded % (10 * 1024 * 1024) < 8192 or downloaded == total_size:
                        mb_downloaded = downloaded / (1024 * 1024)
                        mb_total = total_size / (1024 * 1024) if total_size > 0 else 0
                        logger.info(f"  Downloaded {mb_downloaded:.1f} MB / {mb_total:.1f} MB")

        logger.info(f"✓ Downloaded: {zip_filename}")
        return True

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download {region_code}: {e}")
        if zip_path.exists():
            zip_path.unlink()
        return False


def extract_hydrorivers_shapefile(zip_path: Path, extract_dir: Path) -> Path:
    """
    Extracts shapefile from HydroRIVERS ZIP archive.

    Args:
        zip_path: Path to the ZIP file
        extract_dir: Directory to extract to

    Returns:
        Path to the extracted .shp file
    """
    logger.info(f"Extracting {zip_path.name}...")

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Extract all files
            zip_ref.extractall(extract_dir)

            # Find the .shp file
            shp_files = list(extract_dir.glob('**/*.shp'))

            if not shp_files:
                raise FileNotFoundError(f"No .shp file found in {zip_path.name}")

            shp_file = shp_files[0]
            logger.info(f"  ✓ Extracted: {shp_file.name}")
            return shp_file

    except zipfile.BadZipFile as e:
        logger.error(f"Invalid ZIP file {zip_path.name}: {e}")
        raise
    except Exception as e:
        logger.error(f"Error extracting {zip_path.name}: {e}")
        raise


def process_rivers_for_europe(shapefiles: list, output_path: Path) -> None:
    """
    Processes HydroRIVERS shapefiles for Europe:
    - Filters by bounding box
    - Filters by stream order (>= MIN_STREAM_ORDER)
    - Merges multiple regions
    - Saves as single shapefile

    Args:
        shapefiles: List of paths to regional .shp files
        output_path: Path for the output shapefile
    """
    logger.info("")
    logger.info("=" * 80)
    logger.info("PROCESSING RIVERS FOR EUROPE")
    logger.info("=" * 80)

    # Europe bounding box as shapely geometry
    europe_bbox = box(
        EUROPE_BBOX['min_lng'],
        EUROPE_BBOX['min_lat'],
        EUROPE_BBOX['max_lng'],
        EUROPE_BBOX['max_lat']
    )

    all_rivers = []

    for shp_file in shapefiles:
        if not shp_file.exists():
            logger.warning(f"Shapefile not found: {shp_file}")
            continue

        logger.info(f"Loading {shp_file.name}...")

        try:
            # Read shapefile
            gdf = gpd.read_file(shp_file)

            logger.info(f"  Total rivers in file: {len(gdf):,}")

            # Filter by bounding box
            gdf = gdf[gdf.intersects(europe_bbox)]
            logger.info(f"  Rivers in Europe bbox: {len(gdf):,}")

            # Filter by stream order (ORD_STRA or ORD_STR field)
            if 'ORD_STRA' in gdf.columns:
                stream_order_field = 'ORD_STRA'
            elif 'ORD_STR' in gdf.columns:
                stream_order_field = 'ORD_STR'
            else:
                logger.warning(f"  No stream order field found, using all rivers")
                stream_order_field = None

            if stream_order_field:
                gdf = gdf[gdf[stream_order_field] >= MIN_STREAM_ORDER]
                logger.info(f"  Major rivers (order >= {MIN_STREAM_ORDER}): {len(gdf):,}")

            all_rivers.append(gdf)

        except Exception as e:
            logger.error(f"Error processing {shp_file.name}: {e}")
            continue

    if not all_rivers:
        raise ValueError("No rivers data was successfully loaded")

    # Merge all regions
    logger.info("")
    logger.info("Merging all river networks...")
    merged_rivers = gpd.GeoDataFrame(
        pd.concat(all_rivers, ignore_index=True),
        crs=all_rivers[0].crs
    )

    logger.info(f"Total major rivers in Europe: {len(merged_rivers):,}")

    # Ensure CRS is EPSG:4326 (WGS84)
    if merged_rivers.crs != 'EPSG:4326':
        logger.info("Reprojecting to EPSG:4326...")
        merged_rivers = merged_rivers.to_crs('EPSG:4326')

    # Save to output shapefile
    logger.info(f"Saving to {output_path}...")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    merged_rivers.to_file(output_path)

    logger.info("")
    logger.info("=" * 80)
    logger.info(f"✓ RIVERS PROCESSING COMPLETE")
    logger.info(f"  Output: {output_path}")
    logger.info(f"  Major rivers: {len(merged_rivers):,}")
    logger.info(f"  Stream order threshold: >= {MIN_STREAM_ORDER}")
    logger.info("=" * 80)


def setup_rivers_for_europe():
    """
    Main function to setup river network data for Europe.
    """
    logger.info("=" * 80)
    logger.info("HYDRORIVERS EUROPE SETUP")
    logger.info("=" * 80)
    logger.info("")
    logger.info("Source: HydroSHEDS HydroRIVERS v1.0")
    logger.info(f"Coverage: Europe (lat {EUROPE_BBOX['min_lat']}-{EUROPE_BBOX['max_lat']}, lng {EUROPE_BBOX['min_lng']}-{EUROPE_BBOX['max_lng']})")
    logger.info(f"Filter: Stream Order >= {MIN_STREAM_ORDER}")
    logger.info("")

    # Create directories
    RIVERS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Rivers directory: {RIVERS_DIR}")
    logger.info("")

    # Download regions
    download_success = {}
    for region_code in HYDRORIVERS_REGIONS.keys():
        logger.info(f"Processing region: {region_code.upper()}")
        success = download_hydrorivers_region(region_code, RIVERS_DIR)
        download_success[region_code] = success
        logger.info("")

    if not any(download_success.values()):
        logger.error("ERROR: No regions were successfully downloaded")
        sys.exit(1)

    # Extract shapefiles
    shapefiles = []
    for region_code, success in download_success.items():
        if not success:
            continue

        zip_filename = f"HydroRIVERS_v10_{region_code}_shp.zip"
        zip_path = RIVERS_DIR / zip_filename
        extract_dir = RIVERS_DIR / region_code

        try:
            shp_file = extract_hydrorivers_shapefile(zip_path, extract_dir)
            shapefiles.append(shp_file)
        except Exception as e:
            logger.error(f"Failed to extract {region_code}: {e}")
            continue

    if not shapefiles:
        logger.error("ERROR: No shapefiles were successfully extracted")
        sys.exit(1)

    # Process and merge rivers
    output_path = VECTORS_DIR / 'rivers_main.shp'

    try:
        # Import pandas here (only needed for processing)
        import pandas as pd
        globals()['pd'] = pd

        process_rivers_for_europe(shapefiles, output_path)

    except Exception as e:
        logger.error(f"Failed to process rivers: {e}", exc_info=True)
        sys.exit(1)

    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Run the terrain extractor:")
    logger.info("     cd tools/terrain_extractor")
    logger.info("     python extractor.py")
    logger.info("")
    logger.info("  The extractor will automatically detect and use the river network")
    logger.info("  to ensure continuous river flow across the H3 hexagonal grid.")


if __name__ == "__main__":
    try:
        setup_rivers_for_europe()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
