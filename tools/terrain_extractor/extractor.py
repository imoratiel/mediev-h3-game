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
import geopandas as gpd
from shapely.geometry import Point
from shapely.strtree import STRtree

# Base data directory - CRUCIAL para rutas correctas
BASE_DATA_DIR = Path(__file__).parent.parent.parent.resolve() / 'data'
SRTM_CACHE_DIR = BASE_DATA_DIR / 'srtm_cache'

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
        DB_CONFIG,
        SLOPE_THRESHOLD
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


def sample_circular_points(lat: float, lng: float, radius_km: float = 0.3) -> List[Tuple[float, float]]:
    """
    Genera 7 puntos de muestreo en círculo alrededor del centro (lat, lng).
    Retorna lista de tuplas [(lat, lng), ...] con el centro + 6 puntos cardinales.

    Args:
        lat: Latitud del centro
        lng: Longitud del centro
        radius_km: Radio del círculo en km (default 0.3 km para H3 res 8)
    """
    # Centro
    points = [(lat, lng)]

    # 6 puntos en círculo (cada 60 grados)
    # Conversión aproximada: 1 grado ≈ 111 km
    lat_offset = radius_km / 111.0
    lng_offset = radius_km / (111.0 * np.cos(np.radians(lat)))

    for angle_deg in [0, 60, 120, 180, 240, 300]:
        angle_rad = np.radians(angle_deg)
        point_lat = lat + lat_offset * np.sin(angle_rad)
        point_lng = lng + lng_offset * np.cos(angle_rad)
        points.append((point_lat, point_lng))

    return points


def sample_pixel_value(dataset, lat: float, lng: float) -> int:
    """
    Muestrea el valor del pixel en las coordenadas dadas.
    Retorna el valor del pixel o -1 si está fuera de bounds o es nodata.
    """
    try:
        row, col = rowcol(dataset.transform, lng, lat)

        if 0 <= row < dataset.height and 0 <= col < dataset.width:
            pixel_value = dataset.read(1, window=((row, row+1), (col, col+1)))[0, 0]
            nodata_value = dataset.nodata

            if nodata_value is not None and pixel_value == nodata_value:
                return -1
            return int(pixel_value)
        else:
            return -1
    except Exception:
        return -1


def load_land_mask(data_dir: str = None) -> Optional[tuple]:
    """
    Carga el shapefile de Natural Earth Land y crea un spatial index (STRtree).
    Retorna tupla (land_polygons, spatial_index) para búsquedas espaciales rápidas.

    Args:
        data_dir: Directorio base de datos (opcional, usa BASE_DATA_DIR por defecto)

    Returns:
        Tupla (lista de geometrías, STRtree) o None si falla
    """
    try:
        # Usar BASE_DATA_DIR si no se proporciona data_dir
        if data_dir is None:
            data_dir = BASE_DATA_DIR
        else:
            data_dir = Path(data_dir)

        # Ruta EXPLÍCITA al shapefile
        shapefile_path = data_dir / 'vectors' / 'ne_10m_land' / 'ne_10m_land.shp'

        logger.info(f"Buscando máscara en: {shapefile_path.absolute()}")

        if not shapefile_path.exists():
            logger.warning(f"❌ Land mask shapefile NOT FOUND at {shapefile_path.absolute()}")
            logger.warning("Run 'python setup_assets.py' to download it")
            logger.warning("Proceeding WITHOUT land mask optimization - ALL ocean cells will be processed")
            return None

        logger.info(f"✓ Shapefile encontrado: {shapefile_path.absolute()}")
        logger.info(f"Cargando geometrías de tierra firme...")
        start_time = time.time()

        # Cargar shapefile con geopandas
        gdf = gpd.read_file(str(shapefile_path))

        # Extraer lista de geometrías (objetos Shapely)
        land_polygons = [geom for geom in gdf.geometry]

        # Crear spatial index (STRtree) para búsquedas rápidas
        land_index = STRtree(land_polygons)

        load_time = time.time() - start_time
        logger.info(f"✓ Land mask loaded: {len(land_polygons)} polygons in {load_time:.2f}s")

        return (land_polygons, land_index)

    except Exception as e:
        logger.error(f"❌ Failed to load land mask: {e}")
        logger.warning("Proceeding WITHOUT land mask optimization")
        return None


def is_point_on_land(lat: float, lng: float, land_mask: Optional[tuple], debug: bool = False, fallback_to_land: bool = True) -> bool:
    """
    Verifica si un punto (lat, lng) está sobre tierra firme.
    Usa el spatial index para búsqueda rápida.

    Args:
        lat: Latitud del punto
        lng: Longitud del punto
        land_mask: Tupla (land_polygons, land_index) de load_land_mask()
        debug: Si True, imprime información de debug
        fallback_to_land: Si land_mask es None, retornar True (tierra) o False (mar)

    Returns:
        True si el punto está en tierra, False si está en mar
        Si land_mask es None, retorna fallback_to_land (default: True)
    """
    # Si no hay land mask, usar fallback
    if land_mask is None:
        if debug:
            logger.info(f"DEBUG: Land mask NO DISPONIBLE - usando fallback={fallback_to_land}")
        return fallback_to_land

    land_polygons, land_index = land_mask

    try:
        # CRÍTICO: Shapely usa (x, y) = (longitud, latitud)
        point = Point(lng, lat)

        # Buscar índices de geometrías que podrían intersectar
        possible_match_indices = land_index.query(point)

        # Verificar si alguna geometría contiene el punto (acceso por índice)
        is_on_land = any(land_polygons[i].contains(point) for i in possible_match_indices)

        if debug:
            logger.info(f"DEBUG: Punto (lat={lat:.6f}, lng={lng:.6f}) - ¿Es Tierra?: {is_on_land} (matches: {len(possible_match_indices)})")

        return is_on_land

    except Exception as e:
        logger.debug(f"Error checking point ({lat}, {lng}): {e}")
        return fallback_to_land  # Fallback configurable en caso de error


def download_srtm_for_region(bounds: dict) -> str:
    """
    Loads SRTM elevation data from local .hgt files in data/elevation/.
    Uses pre-downloaded SRTM tiles from viewfinderpanoramas.org (run setup_srtm_v2.py first).

    Args:
        bounds: Diccionario con min_lat, max_lat, min_lng, max_lng

    Returns:
        Path al archivo SRTM DEM merged, or None if not available
    """
    from rasterio.merge import merge

    # Elevation directory (contains K30/, K31/ subdirectories with .hgt files)
    elevation_dir = BASE_DATA_DIR / 'elevation'

    # Crear directorio de caché si no existe
    SRTM_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Archivo de salida merged
    output_file = SRTM_CACHE_DIR / f"srtm_merged_{bounds['min_lat']}_{bounds['max_lat']}_{bounds['min_lng']}_{bounds['max_lng']}.tif"

    # Si ya existe el merged, usarlo
    if output_file.exists():
        logger.info(f"SRTM DEM merged ya existe: {output_file}")
        return str(output_file)

    # Buscar archivos SRTM en el directorio de elevación
    if not elevation_dir.exists():
        logger.warning(f"Directorio de elevación no encontrado: {elevation_dir}")
        logger.warning("Ejecuta 'python setup_srtm_v2.py' para descargar datos SRTM")
        return None

    # Buscar archivos .hgt en subdirectorios K30/, K31/, etc.
    srtm_files = []
    srtm_files.extend(list(elevation_dir.glob('K*/*.hgt')))  # K30/N42W006.hgt, etc.
    srtm_files.extend(list(elevation_dir.glob('*.hgt')))      # También archivos en raíz

    if not srtm_files:
        logger.warning(f"No se encontraron archivos .hgt en: {elevation_dir}")
        logger.warning("Ejecuta 'python setup_srtm_v2.py' para descargar datos SRTM")
        return None

    logger.info(f"Encontrados {len(srtm_files)} tiles SRTM (.hgt) locales")
    logger.info(f"Target bounds: lat=[{bounds['min_lat']}, {bounds['max_lat']}], lng=[{bounds['min_lng']}, {bounds['max_lng']}]")

    try:
        # Filtrar tiles que intersectan con el bounding box
        relevant_tiles = []
        for hgt_file in srtm_files:
            # Parsear nombre del archivo (e.g., N42W006.hgt)
            filename = hgt_file.stem  # N42W006
            try:
                # Extraer latitud y longitud del nombre
                if filename[0] == 'N':
                    lat = int(filename[1:3])
                elif filename[0] == 'S':
                    lat = -int(filename[1:3])
                else:
                    logger.info(f"Skipping {filename}: invalid lat prefix")
                    continue

                if filename[3] == 'E':
                    lng = int(filename[4:7])
                elif filename[3] == 'W':
                    lng = -int(filename[4:7])
                else:
                    logger.info(f"Skipping {filename}: invalid lng prefix")
                    continue

                # Verificar si el tile intersecta con el bounding box
                # Cada tile .hgt cubre 1°x1° desde (lat, lng) hasta (lat+1, lng+1)
                intersects = (lat <= bounds['max_lat'] and lat + 1 >= bounds['min_lat'] and
                              lng <= bounds['max_lng'] and lng + 1 >= bounds['min_lng'])

                if intersects:
                    relevant_tiles.append(hgt_file)
                    logger.info(f"  ✓ Tile relevante: {filename} (covers lat={lat}-{lat+1}, lng={lng}-{lng+1})")
                else:
                    logger.info(f"  ✗ Tile fuera del bbox: {filename} (covers lat={lat}-{lat+1}, lng={lng}-{lng+1})")

            except (ValueError, IndexError) as e:
                logger.warning(f"No se pudo parsear nombre de archivo: {filename} - {e}")
                continue

        if not relevant_tiles:
            logger.warning(f"No se encontraron tiles relevantes para el bounding box")
            logger.warning(f"Bounds: lat=[{bounds['min_lat']}, {bounds['max_lat']}], lng=[{bounds['min_lng']}, {bounds['max_lng']}]")
            return None

        logger.info(f"Usando {len(relevant_tiles)} tiles relevantes para el bounding box")

        # Abrir todos los tiles SRTM relevantes
        src_files_to_mosaic = []
        for file_path in relevant_tiles:
            src = rasterio.open(file_path)
            src_files_to_mosaic.append(src)
            logger.debug(f"  - {file_path.name}: bounds={src.bounds}")

        # Merge todos los tiles
        logger.info("Merging SRTM tiles...")
        mosaic, out_trans = merge(src_files_to_mosaic)

        # Guardar el mosaic merged
        out_meta = src_files_to_mosaic[0].meta.copy()
        out_meta.update({
            "driver": "GTiff",
            "height": mosaic.shape[1],
            "width": mosaic.shape[2],
            "transform": out_trans,
            "compress": "lzw"
        })

        with rasterio.open(output_file, "w", **out_meta) as dest:
            dest.write(mosaic)

        # Cerrar todos los archivos fuente
        for src in src_files_to_mosaic:
            src.close()

        logger.info(f"SRTM mosaic creado: {output_file}")
        return str(output_file)

    except Exception as e:
        logger.error(f"Error creando SRTM mosaic: {e}", exc_info=True)
        logger.warning("Continuando sin datos de elevación...")
        return None


def load_srtm_elevation_dataset(srtm_file: Optional[str]) -> Optional[object]:
    """
    Carga el dataset de elevación SRTM usando rasterio.

    Args:
        srtm_file: Path al archivo SRTM DEM

    Returns:
        Dataset de rasterio o None si falla
    """
    if not srtm_file or not Path(srtm_file).exists():
        logger.warning("Archivo SRTM no disponible, elevación no se usará")
        return None

    try:
        dataset = rasterio.open(srtm_file)
        logger.info(f"✓ SRTM dataset cargado: {srtm_file}")
        logger.info(f"  - Bounds: {dataset.bounds}")
        logger.info(f"  - CRS: {dataset.crs}")
        return dataset
    except Exception as e:
        logger.error(f"Error cargando SRTM dataset: {e}")
        return None


def get_elevation(lat: float, lng: float, srtm_dataset: Optional[object]) -> Optional[float]:
    """
    Obtiene la elevación (en metros) de un punto (lat, lng) desde el dataset SRTM.

    Args:
        lat: Latitud
        lng: Longitud
        srtm_dataset: Dataset SRTM cargado con rasterio

    Returns:
        Elevación en metros, o None si no disponible
    """
    if srtm_dataset is None:
        return None

    try:
        # Convertir coordenadas geográficas a índices de píxel
        row, col = srtm_dataset.index(lng, lat)

        # Leer el valor del píxel
        elevation_value = srtm_dataset.read(1)[row, col]

        # SRTM usa valores negativos para depresiones, 0 para mar
        # Valores muy negativos (< -500) suelen ser NoData
        if elevation_value < -500 or elevation_value == srtm_dataset.nodata:
            return None

        return float(elevation_value)

    except Exception as e:
        # Punto fuera de bounds o error de lectura
        return None


def calculate_slope(lat: float, lng: float, srtm_dataset: Optional[object]) -> Optional[float]:
    """
    Calcula la pendiente aproximada en un punto usando elevaciones de puntos vecinos.

    Metodología:
    - Obtiene elevación del centro y 4 puntos cardinales (N, S, E, O) a ~100m
    - Calcula gradientes en X e Y
    - Retorna pendiente en grados usando: arctan(sqrt(dx² + dy²))

    Args:
        lat: Latitud del punto central
        lng: Longitud del punto central
        srtm_dataset: Dataset SRTM cargado con rasterio

    Returns:
        Pendiente en grados, o None si no se puede calcular
    """
    if srtm_dataset is None:
        return None

    try:
        # Offset de ~100m en grados (~0.001° ≈ 111m a lat 42°)
        offset = 0.001

        # Elevaciones de 5 puntos (centro + 4 cardinales)
        elev_center = get_elevation(lat, lng, srtm_dataset)
        elev_north = get_elevation(lat + offset, lng, srtm_dataset)
        elev_south = get_elevation(lat - offset, lng, srtm_dataset)
        elev_east = get_elevation(lat, lng + offset, srtm_dataset)
        elev_west = get_elevation(lat, lng - offset, srtm_dataset)

        # Si algún punto no tiene datos válidos, no calcular pendiente
        elevations = [elev_center, elev_north, elev_south, elev_east, elev_west]
        if any(e is None for e in elevations):
            return None

        # Calcular gradientes (rise/run)
        # Distancia horizontal: 2 * offset en grados * 111km/grado ≈ 222m
        distance_m = 2 * offset * 111000  # metros (aprox. a lat 42°)

        # Gradiente en Y (Norte-Sur)
        gradient_y = (elev_north - elev_south) / distance_m

        # Gradiente en X (Este-Oeste)
        gradient_x = (elev_east - elev_west) / distance_m

        # Magnitud del gradiente (pendiente como ratio rise/run)
        gradient_magnitude = np.sqrt(gradient_x**2 + gradient_y**2)

        # Convertir a grados: arctan(rise/run)
        slope_degrees = np.degrees(np.arctan(gradient_magnitude))

        return slope_degrees

    except Exception as e:
        # Error en cálculo de pendiente
        return None


def extract_terrain_from_raster(
    raster_dir: str,
    h3_cells: List[str]
) -> List[Tuple[int, int]]:
    """
    Extracts terrain values from GeoTIFF files using 5-PHASE ALGORITHM:

    FASE 1 (MAR): Si fuera de cobertura o todos los puntos son NoData → ID 1 (Mar)
    FASE 2 (COSTA): Si centro NoData pero vecinos tienen tierra → ID 2 (Costa)
    FASE 3 (RÍOS/PANTANOS): Si ESA=80 → ID 4 (Río), ESA=90/95 → ID 5 (Pantanos)
    FASE 4 (ALTA MONTAÑA): Si ESA=70 o (ESA=60 con vecinos 70) → ID 13 (Alta Montaña)
    FASE 5 (RESTO): Mapear según TERRAIN_MAPPING estándar

    Returns list of tuples (h3_index_as_int, terrain_type_id).
    """
    # Load land mask for spatial optimization (usa BASE_DATA_DIR automáticamente)
    logger.info("=" * 80)
    logger.info("CARGANDO LAND MASK (Natural Earth 10m Land)")
    logger.info("=" * 80)
    land_mask = load_land_mask()  # Usa BASE_DATA_DIR por defecto

    # Load SRTM elevation data
    logger.info("=" * 80)
    logger.info("CARGANDO DATOS DE ELEVACIÓN SRTM")
    logger.info("=" * 80)
    srtm_file = download_srtm_for_region(BOUNDING_BOX)
    srtm_dataset = load_srtm_elevation_dataset(srtm_file)

    if srtm_dataset:
        logger.info("✓ Datos de elevación SRTM disponibles")
        logger.info("  Reglas de relieve:")
        logger.info("    - Elevación > 1100m → Alta Montaña (ID 13)")
        logger.info(f"    - Elevación 500-1100m + Pendiente > {SLOPE_THRESHOLD}° → Colinas (ID 12)")
        logger.info(f"    - Elevación 500-1100m + Pendiente < {SLOPE_THRESHOLD}° → Meseta (usar TIF)")
        logger.info(f"  Umbral de pendiente: {SLOPE_THRESHOLD}° (protege mesetas de León/Castilla)")
    else:
        logger.warning("⚠️ SRTM no disponible - usando solo clasificación ESA WorldCover")

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

    if test_tile:
        logger.info(f"✓ Found coverage tile: {os.path.basename(test_tile)}")

    # Process cells with dynamic tile selection
    terrain_data = []
    processed = 0
    skipped = 0
    out_of_bounds = 0

    # CONTADOR DE TIPOS DE TERRENO (IDs 1-14)
    terrain_counter = {i: 0 for i in range(1, 15)}

    # Contadores por fase
    phase_1_mar = 0
    phase_2_costa = 0
    phase_3_agua = 0
    phase_4_montana = 0
    phase_5_resto = 0
    open_sea_discarded = 0  # Celdas descartadas por estar en mar abierto

    # Contadores de elevación (PRIORIDAD MÁXIMA sobre TIF)
    elevation_high_mountain = 0  # Montañas detectadas por elevación > 1100m
    elevation_hills = 0  # Colinas detectadas por elevación 500-1100m + pendiente
    plateau_protected = 0  # Mesetas protegidas (altitud alta pero sin pendiente)

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
            h3_int = int(h3_index, 16)
            terrain_type_id = None

            # ====== DEBUG: Primeros 5 hexágonos ======
            if idx < 5:
                is_land_debug = is_point_on_land(lat, lng, land_mask, debug=False)
                logger.info(f"H3: {h3_index} | Lat: {lat:.6f} | Lng: {lng:.6f} | ¿En Tierra?: {is_land_debug}")

            # ====== LAND MASK CHECK: Descartar mar abierto ANTES de procesar TIF ======
            # Debug para los primeros 10 puntos
            debug_mode = (idx < 10)
            if not is_point_on_land(lat, lng, land_mask, debug=debug_mode):
                # Punto en mar abierto - asignar Mar (ID 1) inmediatamente
                terrain_type_id = 1  # Mar
                terrain_data.append((h3_int, terrain_type_id))
                terrain_counter[terrain_type_id] += 1
                phase_1_mar += 1
                open_sea_discarded += 1
                continue

            try:
                # Find which raster file contains this coordinate
                raster_path = find_raster_for_coord(lat, lng, coverage_map)

                # ====== FASE 1: MAR (fuera de cobertura) ======
                if not raster_path:
                    terrain_type_id = 1  # Mar
                    terrain_data.append((h3_int, terrain_type_id))
                    terrain_counter[terrain_type_id] += 1
                    phase_1_mar += 1
                    out_of_bounds += 1
                    if out_of_bounds <= 5:
                        logger.info(f"FASE 1 (MAR): Cell outside tiles at lat={lat:.6f}, lng={lng:.6f}")
                    continue

                # Skip tiles that previously failed to open
                if raster_path in failed_tiles:
                    terrain_type_id = 1  # Mar
                    terrain_data.append((h3_int, terrain_type_id))
                    terrain_counter[terrain_type_id] += 1
                    phase_1_mar += 1
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
                        terrain_type_id = 1  # Mar
                        terrain_data.append((h3_int, terrain_type_id))
                        terrain_counter[terrain_type_id] += 1
                        phase_1_mar += 1
                        skipped += 1
                        continue

                dataset = dataset_cache[raster_path]

                # Muestreo del centro
                center_value = sample_pixel_value(dataset, lat, lng)

                # ====== FUNCIÓN INTERNA: DETERMINE_TERRAIN ======
                # Jerarquía de decisión correcta: ALTITUD primero, luego TIF
                def determine_terrain(cv, elev, slope, h3_idx, cell_idx):
                    """
                    Determina el tipo de terreno con jerarquía estricta.

                    Orden de prioridad:
                    1. NoData (center_value == -1) -> Mar o Costa
                    2. ALTITUD > 1100m -> Alta Montaña (ID 13) [PRIORIDAD ABSOLUTA]
                    3. Agua TIF (0, 80, 90, 95) -> Río o Pantanos
                    3.5. Asentamientos TIF (50) -> Asentamientos (ID 14) [ANTES de colinas]
                    4. ALTITUD 500-1100m + PENDIENTE > umbral -> Colinas (ID 12)
                    4.5. ALTITUD 500-1100m + PENDIENTE < umbral -> Meseta (usar TIF)
                    5. Nieve TIF (70) -> Alta Montaña
                    6. Resto -> Mapeo estándar
                    """
                    nonlocal phase_1_mar, phase_2_costa, phase_3_agua, phase_4_montana
                    nonlocal phase_5_resto, elevation_high_mountain, elevation_hills, plateau_protected

                    # CASO 1: NoData -> Mar o Costa
                    if cv == -1:
                        circular_points = sample_circular_points(lat, lng)
                        neighbor_values = [sample_pixel_value(dataset, p[0], p[1]) for p in circular_points[1:]]

                        if all(v == -1 for v in neighbor_values):
                            phase_1_mar += 1
                            return 1  # Mar
                        else:
                            phase_2_costa += 1
                            return 2  # Costa

                    # CASO 2: ALTITUD > 1100m -> SIEMPRE Alta Montaña (PRIORIDAD MÁXIMA)
                    # NO sobrescribir solo si es agua clara (0, 80, 90, 95)
                    if elev is not None and elev > 1100:
                        if cv not in [0, 80, 90, 95]:
                            elevation_high_mountain += 1
                            phase_4_montana += 1

                            if cell_idx < 50:
                                logger.info(f"⛰️  MONTAÑA DETECTADA: {h3_idx} | Alt: {elev:.1f}m | TIF: {cv} -> Alta Montaña (ID 13)")

                            return 13  # Alta Montaña

                    # CASO 3: Agua TIF -> Río o Pantanos (antes de colinas)
                    if cv in [0, 80]:
                        # Special check for value 80: distinguish Mar vs Río
                        if cv == 80:
                            is_on_land_check = is_point_on_land(lat, lng, land_mask, debug=False)
                            if not is_on_land_check:
                                phase_1_mar += 1
                                return 1  # Mar (value 80 but in open sea)
                        phase_3_agua += 1
                        return 4  # Río

                    if cv in [90, 95]:
                        phase_3_agua += 1
                        return 5  # Pantanos

                    # CASO 3.5: Asentamientos TIF (50 = Built-up) -> PRIORIDAD sobre colinas
                    # No sobrescribir Alta Montaña (ya procesada en CASO 2)
                    if cv == 50:
                        phase_5_resto += 1
                        if cell_idx < 50:
                            logger.info(f"🏘️  ASENTAMIENTO: {h3_idx} | Alt: {elev if elev else 'N/A'}m | TIF: {cv} -> Asentamientos (ID 14)")
                        return 14  # Asentamientos

                    # CASO 4: ALTITUD 500-1100m -> Verificar PENDIENTE para distinguir Colinas vs Meseta
                    # Solo si TIF no es nieve (70), agua, ni urbano (50)
                    if elev is not None and elev >= 500:
                        if cv not in [0, 50, 70, 80, 90, 95]:
                            # Si tenemos pendiente, usarla para distinguir
                            if slope is not None:
                                if slope > SLOPE_THRESHOLD:
                                    # PENDIENTE ALTA: Es una colina real
                                    elevation_hills += 1
                                    phase_5_resto += 1

                                    if cell_idx < 50:
                                        logger.info(f"🏔️  COLINA DETECTADA: {h3_idx} | Alt: {elev:.1f}m | Pendiente: {slope:.2f}° | TIF: {cv} -> Colinas (ID 12)")

                                    return 12  # Colinas
                                else:
                                    # PENDIENTE BAJA: Es meseta (altitud alta pero llana)
                                    # Dejar que el TIF decida (Secano/Cultivo/etc.)
                                    plateau_protected += 1

                                    if cell_idx < 50:
                                        logger.info(f"🏞️  MESETA PROTEGIDA: {h3_idx} | Alt: {elev:.1f}m | Pendiente: {slope:.2f}° | TIF: {cv} -> Usar TIF")

                                    # Continuar al CASO 7 (mapeo TIF)
                            else:
                                # Sin datos de pendiente: comportamiento conservador
                                # Si altitud > 800m, asumir colina; si < 800m, asumir meseta
                                if elev > 800:
                                    elevation_hills += 1
                                    phase_5_resto += 1
                                    return 12  # Colinas (por altitud alta sin pendiente)
                                else:
                                    plateau_protected += 1
                                    # Continuar al CASO 7 (mapeo TIF)

                    # CASO 5: Nieve TIF -> Alta Montaña
                    if cv == 70:
                        phase_4_montana += 1
                        return 13  # Alta montaña

                    # CASO 6: TIF 60 con vecinos nieve
                    if cv == 60:
                        circular_points = sample_circular_points(lat, lng)
                        neighbor_values = [sample_pixel_value(dataset, p[0], p[1]) for p in circular_points[1:]]
                        if 70 in neighbor_values:
                            phase_4_montana += 1
                            return 13  # Alta montaña (transición)

                    # CASO 7: Resto -> Mapeo estándar
                    phase_5_resto += 1
                    return TERRAIN_MAPPING.get(cv, DEFAULT_TERRAIN_TYPE_ID)

                # Consultar elevación y pendiente SRTM
                elevation = get_elevation(lat, lng, srtm_dataset) if srtm_dataset else None
                slope = calculate_slope(lat, lng, srtm_dataset) if srtm_dataset else None

                # Log detallado para las primeras 50 celdas
                if idx < 50:
                    is_land_status = is_point_on_land(lat, lng, land_mask, debug=False) if land_mask else "N/A"
                    slope_str = f"{slope:.2f}°" if slope is not None else "N/A"
                    logger.info(f"DEBUG {idx:03d}: H3={h3_index} | Alt={elevation if elevation else 'N/A':>6}m | Pendiente={slope_str:>6} | TIF={center_value:>3} | IsLand={is_land_status}")

                # EJECUTAR FUNCIÓN DE DECISIÓN
                terrain_type_id = determine_terrain(center_value, elevation, slope, h3_index, idx)

                terrain_data.append((h3_int, terrain_type_id))
                terrain_counter[terrain_type_id] += 1
                processed += 1

            except Exception as e:
                # Any error in reading: assign default terrain type
                if idx < 5:  # Log first few errors
                    logger.warning(f"Error processing cell {h3_index} at lat={lat:.6f}, lng={lng:.6f}: {e}")
                terrain_type_id = 1  # Mar
                terrain_data.append((h3_int, terrain_type_id))
                terrain_counter[terrain_type_id] += 1
                phase_1_mar += 1
                skipped += 1

            # Log progress every 1000 cells with performance stats
            total_cells = idx + 1
            if total_cells % 1000 == 0 and total_cells > 0:
                current_time = time.time()
                elapsed = current_time - start_time
                interval = current_time - last_log_time
                cells_per_sec = 1000 / interval if interval > 0 else 0

                logger.info(f"Processed {total_cells}/{len(h3_cells)} cells "
                           f"({cells_per_sec:.1f} cells/s) | "
                           f"Mar: {phase_1_mar} | Costa: {phase_2_costa} | "
                           f"Agua: {phase_3_agua} | Montaña: {phase_4_montana} | Resto: {phase_5_resto}")
                last_log_time = current_time

        total_time = time.time() - start_time
        logger.info("=" * 80)
        logger.info(f"✓ EXTRACTION COMPLETE in {total_time:.1f}s")
        logger.info("=" * 80)

        logger.info(f"Total cells processed: {len(h3_cells)}")
        logger.info(f"  - Valid terrain data: {processed}")
        logger.info(f"  - Skipped (errors): {skipped}")
        logger.info(f"  - Out of bounds: {out_of_bounds}")
        logger.info(f"  - Open sea discarded (land mask): {open_sea_discarded}")
        logger.info(f"  - Raster files used: {len(dataset_cache)}")
        logger.info(f"  - Failed files: {len(failed_tiles)}")

        logger.info("")
        logger.info("RESUMEN POR FASES:")
        logger.info(f"  FASE 1 (Mar): {phase_1_mar} celdas")
        logger.info(f"  FASE 2 (Costa): {phase_2_costa} celdas")
        logger.info(f"  FASE 3 (Ríos/Pantanos): {phase_3_agua} celdas")
        logger.info(f"  FASE 4 (Alta Montaña): {phase_4_montana} celdas")
        logger.info(f"  FASE 4.5 (Relieve SRTM - Prioridad Máxima):")
        logger.info(f"    - Montañas detectadas (>1100m): {elevation_high_mountain} celdas")
        logger.info(f"    - Colinas detectadas (500-1100m + pendiente >{SLOPE_THRESHOLD}°): {elevation_hills} celdas")
        logger.info(f"    - Mesetas protegidas (500-1100m + pendiente <{SLOPE_THRESHOLD}°): {plateau_protected} celdas")
        logger.info(f"  FASE 5 (Resto): {phase_5_resto} celdas")

        logger.info("")
        logger.info("DISTRIBUCIÓN DE TERRENOS (IDs 1-14):")

        # Nombres de terrenos según 003_update_terrain_types.sql
        terrain_names = {
            1: "Mar", 2: "Costa", 3: "Agua", 4: "Río", 5: "Pantanos",
            6: "Tierras de Cultivo", 7: "Tierras de Secano", 8: "Estepas",
            9: "Bosque", 10: "Bosque Denso", 11: "Páramo", 12: "Colinas",
            13: "Alta montaña", 14: "Asentamientos"
        }

        total_counted = sum(terrain_counter.values())
        for terrain_id in range(1, 15):
            count = terrain_counter[terrain_id]
            if count > 0:
                percentage = (count / total_counted * 100) if total_counted > 0 else 0
                name = terrain_names.get(terrain_id, f"Unknown ID {terrain_id}")
                logger.info(f"  {terrain_id:2d}. {name:20s}: {count:6d} celdas ({percentage:5.2f}%)")

        logger.info("")
        if total_counted != len(h3_cells):
            logger.warning(f"⚠️ Discrepancia: contador={total_counted}, total={len(h3_cells)}")

        # Calculate coverage percentage
        if h3_cells:
            coverage_pct = (processed / len(h3_cells)) * 100
            logger.info(f"Cobertura de datos válidos: {coverage_pct:.2f}%")

            if coverage_pct == 0:
                logger.error("❌ ERROR: 0% coverage - no valid terrain data extracted!")
                logger.error("This likely means the required tile is missing.")

        logger.info("=" * 80)

    finally:
        # Close all cached datasets
        logger.info("Closing raster files...")
        for path, dataset in dataset_cache.items():
            try:
                dataset.close()
                logger.debug(f"Closed {os.path.basename(path)}")
            except Exception as e:
                logger.warning(f"Error closing {os.path.basename(path)}: {e}")

        # Close SRTM dataset
        if srtm_dataset:
            try:
                srtm_dataset.close()
                logger.debug("Closed SRTM elevation dataset")
            except Exception as e:
                logger.warning(f"Error closing SRTM dataset: {e}")

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


def postprocess_coastal_detection(terrain_data: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """
    Post-procesa los datos de terreno para detectar Costa Inteligente.

    LÓGICA:
    - Identifica celdas clasificadas como Río (ID 4) o Agua (ID 3).
    - Para cada una, verifica si tiene al menos un vecino clasificado como Mar (ID 1).
    - Si es así, reclasifica la celda como Costa (ID 2).

    Args:
        terrain_data: Lista de tuplas (h3_index_int, terrain_type_id)

    Returns:
        Lista actualizada de tuplas (h3_index_int, terrain_type_id) con costas detectadas
    """
    logger.info("=" * 80)
    logger.info("FASE DE POST-PROCESAMIENTO: DETECCIÓN DE COSTA INTELIGENTE")
    logger.info("=" * 80)

    start_time = time.time()

    # Crear diccionario para búsqueda rápida: {h3_index_hex_str: terrain_type_id}
    terrain_dict = {}
    for h3_int, terrain_id in terrain_data:
        h3_hex = format(h3_int, 'x')  # Convertir int a hex string
        terrain_dict[h3_hex] = terrain_id

    logger.info(f"Total de celdas a procesar: {len(terrain_data)}")

    # Identificar candidatos a costa: celdas Río (ID 4) o Agua (ID 3)
    water_candidates = [
        (h3_int, h3_hex)
        for h3_int, terrain_id in terrain_data
        if terrain_id in [3, 4]
        for h3_hex in [format(h3_int, 'x')]
    ]

    logger.info(f"Candidatos a costa (Río/Agua): {len(water_candidates)} celdas")

    # Reclasificar celdas que tocan el mar
    reclassified_count = 0
    updated_terrain = {}  # {h3_int: new_terrain_id}

    for h3_int, h3_hex in water_candidates:
        # Obtener vecinos usando h3.grid_disk (radio 1 = vecinos inmediatos)
        try:
            neighbors = h3.grid_disk(h3_hex, 1)

            # Verificar si algún vecino es Mar (ID 1)
            has_sea_neighbor = False
            for neighbor_hex in neighbors:
                if neighbor_hex == h3_hex:
                    continue  # Saltar la celda misma

                neighbor_terrain_id = terrain_dict.get(neighbor_hex, None)
                if neighbor_terrain_id == 1:  # Mar
                    has_sea_neighbor = True
                    break

            # Si toca el mar, reclasificar como Costa (ID 2)
            if has_sea_neighbor:
                updated_terrain[h3_int] = 2  # Costa
                reclassified_count += 1

        except Exception as e:
            logger.warning(f"Error procesando vecinos de {h3_hex}: {e}")
            continue

    logger.info(f"Celdas reclasificadas como Costa (ID 2): {reclassified_count}")

    # Aplicar las reclasificaciones a terrain_data
    updated_terrain_data = []
    for h3_int, terrain_id in terrain_data:
        if h3_int in updated_terrain:
            updated_terrain_data.append((h3_int, updated_terrain[h3_int]))
        else:
            updated_terrain_data.append((h3_int, terrain_id))

    elapsed = time.time() - start_time
    logger.info(f"Post-procesamiento completado en {elapsed:.2f}s")
    logger.info("=" * 80)

    return updated_terrain_data


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

        # Step 2.5: Post-procesamiento - Detección de Costa Inteligente
        terrain_data = postprocess_coastal_detection(terrain_data)

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
