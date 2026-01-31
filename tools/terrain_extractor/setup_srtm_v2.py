#!/usr/bin/env python3
"""
SRTM Elevation Data Setup Script v2
Downloads SRTM 90m elevation tiles from viewfinderpanoramas.org (void-filled version)
for the Galicia region in Spain.
"""

import os
import sys
import logging
import requests
import zipfile
from pathlib import Path

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

# Viewfinder Panoramas SRTM base URL
# K30.zip covers 42°N-44°N, 6°W-4°W (Galicia region)
# K31.zip covers 42°N-44°N, 4°W-2°W (additional coverage)
VIEWFINDER_BASE_URL = "http://viewfinderpanoramas.org/dem3/"
REQUIRED_TILES = [
    "K30.zip",  # Covers Galicia/Cabeza de Yegua
    "K31.zip"   # Additional coverage for eastern Galicia
]


def download_dem_tile(tile_name: str, output_dir: Path) -> bool:
    """
    Downloads a single DEM tile from viewfinderpanoramas.org.

    Args:
        tile_name: Name of the tile (e.g., 'K30.zip')
        output_dir: Directory to save the downloaded file

    Returns:
        True if successful, False otherwise
    """
    url = VIEWFINDER_BASE_URL + tile_name
    output_path = output_dir / tile_name

    # Skip if already downloaded
    if output_path.exists():
        logger.info(f"Tile already exists: {tile_name}")
        return True

    logger.info(f"Downloading {tile_name} from {url}...")

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, stream=True, timeout=120)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Log progress every 5MB
                    if downloaded % (5 * 1024 * 1024) < 8192 or downloaded == total_size:
                        mb_downloaded = downloaded / (1024 * 1024)
                        mb_total = total_size / (1024 * 1024)
                        logger.info(f"  Downloaded {mb_downloaded:.1f} MB / {mb_total:.1f} MB")

        logger.info(f"Downloaded: {tile_name}")
        return True

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to download {tile_name}: {e}")
        if output_path.exists():
            output_path.unlink()
        return False


def extract_hgt_files(zip_path: Path, extract_dir: Path) -> bool:
    """
    Extracts .hgt files from ZIP archive and converts them to GeoTIFF.

    Args:
        zip_path: Path to the ZIP file
        extract_dir: Directory to extract to

    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Extracting {zip_path.name}...")

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Extract all .hgt files
            hgt_files = [f for f in zip_ref.namelist() if f.endswith('.hgt')]

            if not hgt_files:
                logger.warning(f"No .hgt files found in {zip_path.name}")
                return False

            for hgt_file in hgt_files:
                # Extract to elevation directory
                zip_ref.extract(hgt_file, extract_dir)
                logger.info(f"  Extracted: {hgt_file}")

            logger.info(f"Extraction complete: {len(hgt_files)} files from {zip_path.name}")
            return True

    except zipfile.BadZipFile as e:
        logger.error(f"Invalid ZIP file {zip_path.name}: {e}")
        return False
    except Exception as e:
        logger.error(f"Error extracting {zip_path.name}: {e}")
        return False


def convert_hgt_to_tif():
    """
    Converts .hgt files to GeoTIFF format using GDAL.
    """
    logger.info("")
    logger.info("Converting .hgt files to GeoTIFF format...")

    try:
        from osgeo import gdal

        hgt_files = list(ELEVATION_DIR.glob('*.hgt'))

        if not hgt_files:
            logger.warning("No .hgt files found to convert")
            return

        for hgt_file in hgt_files:
            tif_file = hgt_file.with_suffix('.tif')

            # Skip if already converted
            if tif_file.exists():
                logger.info(f"  Skipping {hgt_file.name} (already converted)")
                continue

            logger.info(f"  Converting {hgt_file.name} to GeoTIFF...")

            # Open HGT file
            src_ds = gdal.Open(str(hgt_file))
            if src_ds is None:
                logger.error(f"    Failed to open {hgt_file.name}")
                continue

            # Convert to GeoTIFF with compression
            driver = gdal.GetDriverByName('GTiff')
            dst_ds = driver.CreateCopy(
                str(tif_file),
                src_ds,
                options=['COMPRESS=LZW', 'TILED=YES']
            )

            # Clean up
            src_ds = None
            dst_ds = None

            logger.info(f"    Created: {tif_file.name}")

    except ImportError:
        logger.warning("GDAL not available - .hgt files will not be converted to GeoTIFF")
        logger.warning("The extractor can work with .hgt files directly")
    except Exception as e:
        logger.error(f"Error during conversion: {e}")


def setup_srtm_for_galicia():
    """
    Main function to setup SRTM data for Galicia region.
    """
    logger.info("=" * 70)
    logger.info("SRTM ELEVATION DATA SETUP FOR GALICIA (Viewfinder Panoramas)")
    logger.info("=" * 70)
    logger.info("")
    logger.info("Source: viewfinderpanoramas.org (SRTM void-filled)")
    logger.info("Coverage: Galicia region (42-44°N, 6-4°W)")
    logger.info("")

    # Create directories
    ELEVATION_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Elevation directory: {ELEVATION_DIR}")
    logger.info("")

    # Download and extract tiles
    success_count = 0
    for tile_name in REQUIRED_TILES:
        logger.info(f"Processing {tile_name}...")

        # Download
        if download_dem_tile(tile_name, ELEVATION_DIR):
            # Extract
            zip_path = ELEVATION_DIR / tile_name
            if extract_hgt_files(zip_path, ELEVATION_DIR):
                success_count += 1
            else:
                logger.warning(f"Failed to extract {tile_name}")
        else:
            logger.warning(f"Failed to download {tile_name}")

        logger.info("")

    # Convert HGT to GeoTIFF
    if success_count > 0:
        convert_hgt_to_tif()

    logger.info("")
    logger.info("=" * 70)
    logger.info(f"SETUP COMPLETE: {success_count}/{len(REQUIRED_TILES)} tiles ready")
    logger.info("=" * 70)

    if success_count > 0:
        logger.info("")
        logger.info("Next steps:")
        logger.info("  1. Run the terrain extractor:")
        logger.info("     cd tools/terrain_extractor")
        logger.info("     python extractor.py")
        logger.info("")
        logger.info("  The extractor will automatically use the SRTM data")
        logger.info("  to detect mountains (>1100m) and hills (500-1100m)")
    else:
        logger.error("")
        logger.error("ERROR: No tiles were successfully downloaded")
        logger.error("Please check your internet connection and try again")
        logger.error("")
        logger.error("Alternative: Download tiles manually from:")
        logger.error("  http://viewfinderpanoramas.org/dem3.html")
        logger.error(f"  Save K30.zip and K31.zip to: {ELEVATION_DIR}")


if __name__ == "__main__":
    try:
        setup_srtm_for_galicia()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
