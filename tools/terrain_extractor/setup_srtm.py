#!/usr/bin/env python3
"""
SRTM Elevation Data Setup Script
Downloads SRTM 90m elevation tiles from CGIAR-CSI for the target region.
Works on Windows without requiring 'make' utility.
"""

import os
import sys
import logging
import requests
import zipfile
from pathlib import Path
from typing import List, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Base data directory
BASE_DATA_DIR = Path(__file__).parent.parent.parent.resolve() / 'data'
ELEVATION_DIR = BASE_DATA_DIR / 'elevation'

# SRTM tiles base URL (CGIAR-CSI SRTM 90m v4.1)
# Alternative source: https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/
SRTM_BASE_URL = "https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/"


def get_srtm_tiles_for_region(min_lat: float, max_lat: float, min_lng: float, max_lng: float) -> List[str]:
    """
    Calculates which SRTM 5x5 degree tiles are needed for a given region.

    SRTM tile naming convention: srtm_XX_YY.zip
    - XX: longitude zone (1-72, each 5 degrees)
    - YY: latitude zone (1-24, each 5 degrees)

    Longitude zones start at -180° (zone 1) and go to 180°
    Latitude zones start at -60° (zone 1) and go to 60°

    Args:
        min_lat: Minimum latitude
        max_lat: Maximum latitude
        min_lng: Minimum longitude
        max_lng: Maximum longitude

    Returns:
        List of SRTM tile names (e.g., ['srtm_37_04.zip', 'srtm_38_04.zip'])
    """
    tiles = []

    # Calculate longitude zones (each zone is 5 degrees, starting at -180°)
    # Zone 1 = -180° to -175°, Zone 2 = -175° to -170°, etc.
    # Formula: zone = floor((longitude + 180) / 5) + 1
    min_lng_zone = int((min_lng + 180) / 5) + 1
    max_lng_zone = int((max_lng + 180) / 5) + 1

    # Calculate latitude zones (each zone is 5 degrees, starting at -60°)
    # Zone 1 = -60° to -55°, Zone 2 = -55° to -50°, etc.
    # Formula: zone = floor((latitude + 60) / 5) + 1
    min_lat_zone = int((min_lat + 60) / 5) + 1
    max_lat_zone = int((max_lat + 60) / 5) + 1

    # Generate tile names
    for lng_zone in range(min_lng_zone, max_lng_zone + 1):
        for lat_zone in range(min_lat_zone, max_lat_zone + 1):
            tile_name = f"srtm_{lng_zone:02d}_{lat_zone:02d}.zip"
            tiles.append(tile_name)

    return tiles


def download_srtm_tile(tile_name: str, output_dir: Path) -> bool:
    """
    Downloads a single SRTM tile from CGIAR-CSI.

    Args:
        tile_name: Name of the tile (e.g., 'srtm_37_04.zip')
        output_dir: Directory to save the downloaded file

    Returns:
        True if successful, False otherwise
    """
    url = SRTM_BASE_URL + tile_name
    output_path = output_dir / tile_name

    # Skip if already downloaded
    if output_path.exists():
        logger.info(f"✓ Tile already exists: {tile_name}")
        return True

    logger.info(f"Downloading {tile_name} from {url}...")

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, stream=True, timeout=60)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Log progress every 1MB
                    if downloaded % (1024 * 1024) == 0 or downloaded == total_size:
                        mb_downloaded = downloaded / (1024 * 1024)
                        mb_total = total_size / (1024 * 1024)
                        logger.info(f"  Downloaded {mb_downloaded:.1f} MB / {mb_total:.1f} MB")

        logger.info(f"✓ Downloaded: {tile_name}")
        return True

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download {tile_name}: {e}")
        if output_path.exists():
            output_path.unlink()
        return False


def extract_srtm_tile(zip_path: Path, extract_dir: Path) -> bool:
    """
    Extracts SRTM tile from ZIP archive.

    Args:
        zip_path: Path to the ZIP file
        extract_dir: Directory to extract to

    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Extracting {zip_path.name}...")

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Extract all .tif files
            tif_files = [f for f in zip_ref.namelist() if f.endswith('.tif')]

            for tif_file in tif_files:
                zip_ref.extract(tif_file, extract_dir)
                logger.info(f"  ✓ Extracted: {tif_file}")

        logger.info(f"✓ Extraction complete: {zip_path.name}")
        return True

    except zipfile.BadZipFile as e:
        logger.error(f"Invalid ZIP file {zip_path.name}: {e}")
        return False


def setup_srtm_for_galicia():
    """
    Main function to setup SRTM data for Galicia region.
    """
    logger.info("=" * 70)
    logger.info("SRTM ELEVATION DATA SETUP FOR GALICIA")
    logger.info("=" * 70)

    # Galicia bounding box
    min_lat, max_lat = 41.3, 44.3
    min_lng, max_lng = -9.9, -6.1

    logger.info(f"Region: lat=[{min_lat}, {max_lat}], lng=[{min_lng}, {max_lng}]")

    # Create directories
    ELEVATION_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Elevation directory: {ELEVATION_DIR}")

    # Calculate required tiles
    tiles = get_srtm_tiles_for_region(min_lat, max_lat, min_lng, max_lng)
    logger.info(f"Required SRTM tiles: {tiles}")

    # Download and extract tiles
    success_count = 0
    for tile_name in tiles:
        # Download
        if download_srtm_tile(tile_name, ELEVATION_DIR):
            # Extract
            zip_path = ELEVATION_DIR / tile_name
            if extract_srtm_tile(zip_path, ELEVATION_DIR):
                success_count += 1
                # Optionally delete ZIP to save space
                # zip_path.unlink()
            else:
                logger.warning(f"Failed to extract {tile_name}")
        else:
            logger.warning(f"Failed to download {tile_name}")

    logger.info("")
    logger.info("=" * 70)
    logger.info(f"SETUP COMPLETE: {success_count}/{len(tiles)} tiles ready")
    logger.info("=" * 70)

    if success_count > 0:
        logger.info("")
        logger.info("Next steps:")
        logger.info("  1. Run the terrain extractor:")
        logger.info("     cd tools/terrain_extractor")
        logger.info("     python extractor.py")
        logger.info("")
        logger.info("  The extractor will automatically use the SRTM data")
        logger.info("  to detect mountains (>1000m) and hills (500-1000m)")
    else:
        logger.error("")
        logger.error("ERROR: No tiles were successfully downloaded")
        logger.error("Please check your internet connection and try again")
        logger.error("")
        logger.error("Alternative: Download tiles manually from:")
        logger.error("  https://srtm.csi.cgiar.org/srtmdata/")
        logger.error(f"  Save them to: {ELEVATION_DIR}")


if __name__ == "__main__":
    try:
        setup_srtm_for_galicia()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
