#!/usr/bin/env python3
"""
Setup Assets Script
Downloads and prepares geospatial assets for terrain extraction.
Downloads Natural Earth 10m Land shapefile for land mask processing.
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

# Natural Earth 10m Land (Physical vectors)
# URL actualizada - Natural Earth ahora usa naciscdn.org para descargas
NATURAL_EARTH_LAND_URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip"
NATURAL_EARTH_LAND_FILENAME = "ne_10m_land.zip"

def download_file(url: str, output_path: Path, chunk_size: int = 8192) -> None:
    """
    Download a file from URL with progress logging.

    Args:
        url: URL to download from
        output_path: Path to save the file
        chunk_size: Download chunk size in bytes
    """
    logger.info(f"Downloading {url}...")
    logger.info(f"Saving to: {output_path}")

    try:
        # Headers con User-Agent para evitar error 406 de Natural Earth
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        response = requests.get(url, stream=True, headers=headers, timeout=30)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        last_logged_mb = 0

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Log progress every 1 MB
                    current_mb = int(downloaded / (1024 * 1024))
                    if current_mb > last_logged_mb:
                        last_logged_mb = current_mb
                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            logger.info(f"Descargados {downloaded / (1024*1024):.1f} MB de {total_size / (1024*1024):.1f} MB ({progress:.1f}%)")
                        else:
                            logger.info(f"Descargados {downloaded / (1024*1024):.1f} MB")

        logger.info(f"✓ Descarga completa: {downloaded / (1024*1024):.1f} MB")

    except requests.exceptions.RequestException as e:
        logger.error(f"Error en descarga: {e}")
        raise


def extract_zip(zip_path: Path, extract_dir: Path, required_extensions: list = None) -> None:
    """
    Extract a ZIP file to the specified directory.
    Optionally filter by file extensions (e.g., ['.shp', '.shx', '.dbf', '.prj']).

    Args:
        zip_path: Path to the ZIP file
        extract_dir: Directory to extract to
        required_extensions: List of file extensions to extract (None = extract all)
    """
    logger.info(f"Extrayendo {zip_path.name}...")
    logger.info(f"Destino: {extract_dir}")

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Si no hay filtro, extraer todo
            if required_extensions is None:
                zip_ref.extractall(extract_dir)
                extracted_count = len(zip_ref.namelist())
            else:
                # Filtrar solo archivos con extensiones requeridas
                extracted_count = 0
                for file_info in zip_ref.filelist:
                    file_ext = Path(file_info.filename).suffix.lower()
                    if file_ext in required_extensions:
                        zip_ref.extract(file_info, extract_dir)
                        extracted_count += 1
                        logger.info(f"  ✓ {file_info.filename}")

        logger.info(f"✓ Extraídos {extracted_count} archivos")

    except zipfile.BadZipFile as e:
        logger.error(f"Archivo ZIP inválido: {e}")
        raise


def setup_natural_earth_land(data_dir: Path) -> None:
    """
    Download and setup Natural Earth 10m Land shapefile.
    Solo extrae archivos necesarios: .shp, .shx, .dbf, .prj

    Args:
        data_dir: Base data directory
    """
    vectors_dir = data_dir / 'vectors'
    vectors_dir.mkdir(parents=True, exist_ok=True)

    land_dir = vectors_dir / 'ne_10m_land'
    zip_path = vectors_dir / NATURAL_EARTH_LAND_FILENAME

    # Check if already exists
    shapefile_path = land_dir / 'ne_10m_land.shp'
    if shapefile_path.exists():
        logger.info(f"✓ Shapefile de Natural Earth ya existe en {shapefile_path}")
        logger.info("Saltando descarga. Elimina el archivo para volver a descargar.")
        return

    # Download ZIP
    if not zip_path.exists():
        download_file(NATURAL_EARTH_LAND_URL, zip_path)
    else:
        logger.info(f"Archivo ZIP ya existe: {zip_path}")

    # Extract ZIP (solo archivos necesarios para shapefile)
    land_dir.mkdir(parents=True, exist_ok=True)
    required_extensions = ['.shp', '.shx', '.dbf', '.prj', '.cpg']
    logger.info("Extrayendo archivos de shapefile (.shp, .shx, .dbf, .prj, .cpg)...")
    extract_zip(zip_path, land_dir, required_extensions)

    # Verify shapefile exists
    if shapefile_path.exists():
        file_size_mb = shapefile_path.stat().st_size / (1024 * 1024)
        logger.info(f"✓ Shapefile listo: {shapefile_path}")
        logger.info(f"  Tamaño: {file_size_mb:.1f} MB")
    else:
        logger.error(f"❌ Shapefile no encontrado tras extracción: {shapefile_path}")
        raise FileNotFoundError("Fallo en extracción de shapefile")

    # Opcional: Eliminar ZIP para ahorrar espacio
    logger.info(f"Manteniendo archivo ZIP: {zip_path} (puedes eliminarlo manualmente si lo deseas)")


def main():
    """
    Main execution function.
    """
    logger.info("=" * 70)
    logger.info("CONFIGURACIÓN DE ASSETS GEOESPACIALES")
    logger.info("=" * 70)

    # Get script directory and data directory
    script_dir = Path(__file__).parent.resolve()
    data_dir = (script_dir / '../../data').resolve()

    logger.info(f"Directorio del script: {script_dir}")
    logger.info(f"Directorio de datos: {data_dir}")
    logger.info("")

    try:
        # Setup Natural Earth Land shapefile
        logger.info("1. Descargando Natural Earth 10m Land (Land Mask)...")
        logger.info("   URL: " + NATURAL_EARTH_LAND_URL)
        logger.info("")
        setup_natural_earth_land(data_dir)

        logger.info("")
        logger.info("=" * 70)
        logger.info("✓ CONFIGURACIÓN COMPLETA")
        logger.info("=" * 70)
        logger.info("")
        logger.info("Ahora puedes ejecutar el extractor de terreno:")
        logger.info("  cd tools/terrain_extractor")
        logger.info("  python extractor.py")
        logger.info("")
        logger.info("El extractor usará el shapefile para:")
        logger.info("  - Detectar mar abierto sin procesar TIF (optimización)")
        logger.info("  - Asignar Mar (ID 1) a celdas fuera de tierra firme")
        logger.info("  - Consultar TIF solo para celdas en tierra")

    except Exception as e:
        logger.error(f"Configuración fallida: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
