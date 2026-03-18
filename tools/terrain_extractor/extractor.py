#!/usr/bin/env python3
"""
Terrain Extractor Tool - OPTIMIZED VERSION WITH MEDIEVAL NATURALIZATION
Extracts terrain data from GeoTIFF raster and populates H3 hexagonal grid into database.

OPTIMIZACIONES APLICADAS (2026-02-02):
- Pre-carga SRTM completo en memoria (array numpy) para lectura instantanea
- Pre-calcula river_h3_set para lookup O(1) en lugar de spatial queries
- Usa Window() para lectura de pixels individuales del TIF (evita cargar bandas completas)
- Jerarquia maestra de decision reordenada segun prioridades:
  A) Mar (land_mask) -> B) Rio (river_h3_set) -> C) Montana (>1100m) ->
  D) Ciudad Moderna (TIF=50) -> E) Colina (>500m + rugosidad) -> F) TIF estandar
- Logs limpios sin emojis, resumen cada 10,000 celdas

RENATURALIZACION DE CIUDADES MODERNAS (2026-02-02B):
- Las ciudades modernas (TIF=50) se marcan temporalmente como ID 0
- POST-PROCESADO: Inpainting con vecinos H3 (convierte ciudades en terreno natural)
  * Si tiene vecino Mar -> Costa (ID 2)
  * Si es interior -> Moda de vecinos (el terreno mas frecuente alrededor)
- OVERLAY FINAL: Solo asentamientos historicos (tabla settlements) reciben ID 14

CONFIGURACION:
- Bounding Box recomendado (Galicia+Asturias): lat [41.68, 44.1], lng [-9.55, -4.45]
- Configurar en config.py antes de ejecutar

NOTA MULTIPROCESSING:
- Los objetos rasterio.Dataset no son serializables (pickle), lo que dificulta el uso
  de ProcessPoolExecutor sin modificaciones arquitectonicas mayores.
- Alternativa: Cada proceso abre su propio dataset y procesa un chunk de celdas H3.
- Implementacion futura si se requiere mayor velocidad (actualmente optimizado con pre-carga).
"""

import logging
import sys
import os
import glob
import time
from typing import List, Tuple, Dict, Optional
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import h3
import rasterio
from rasterio.transform import rowcol
from rasterio.windows import Window
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
        logging.FileHandler('terrain_extraction.log', encoding='utf-8') # Forzado UTF-8
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
        RUGGEDNESS_THRESHOLD
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


def generate_h3_cells() -> Tuple[List[str], Dict[str, Tuple[int, int]]]:
    """
    Generates H3 cells covering the target region using polygon_to_cells (h3 v4 API).
    Calculates cartesian coordinates (X, Y) for each cell with origin at Southwest.

    Returns:
        Tuple of (list of H3 cell indices as strings, dict mapping h3_index to (coord_x, coord_y))

    Coordinate System:
        - Origin (0, 0) at Southwest corner (min_lat, min_lng)
        - X increases towards East (longitude increases)
        - Y increases towards North (latitude increases)
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

    logger.info(f"Generated {len(h3_cells_list)} H3 cells (pre-filter)")

    # ====== FILTRADO ESTRICTO: Solo celdas dentro del BOUNDING_BOX ======
    logger.info("Filtering cells: removing any outside BOUNDING_BOX...")

    filtered_cells = []
    outside_count = 0

    for h3_index in h3_cells_list:
        lat, lng = h3.cell_to_latlng(h3_index)

        # Verificar que la celda esté DENTRO del bounding box
        if (BOUNDING_BOX['min_lat'] <= lat <= BOUNDING_BOX['max_lat'] and
            BOUNDING_BOX['min_lng'] <= lng <= BOUNDING_BOX['max_lng']):
            filtered_cells.append(h3_index)
        else:
            outside_count += 1
            if outside_count <= 5:  # Log primeras 5 celdas descartadas
                logger.info(f"  Discarded cell outside bbox: {h3_index} at ({lat:.6f}, {lng:.6f})")

    h3_cells_list = filtered_cells

    logger.info(f"Filtered: {len(h3_cells_list)} cells inside bbox, {outside_count} cells discarded")
    logger.info(f"BBox limits: lat=[{BOUNDING_BOX['min_lat']}, {BOUNDING_BOX['max_lat']}], "
                f"lng=[{BOUNDING_BOX['min_lng']}, {BOUNDING_BOX['max_lng']}]")

    # ====== CALCULATE CARTESIAN COORDINATES (X, Y) ======
    logger.info("Calculating cartesian coordinates (X, Y) for H3 cells...")

    # Find origin cell: closest to Southwest corner (min_lat, min_lng)
    origin_lat = BOUNDING_BOX['min_lat']
    origin_lng = BOUNDING_BOX['min_lng']
    origin_cell = h3.latlng_to_cell(origin_lat, origin_lng, H3_RESOLUTION)

    logger.info(f"Origin cell (Southwest): {origin_cell} at ({origin_lat:.6f}, {origin_lng:.6f})")

    # Calculate local IJ coordinates for each cell relative to origin
    coord_dict = {}  # {h3_index: (i, j)}
    failed_coords = 0

    for h3_index in h3_cells_list:
        try:
            # Get local IJ coordinates relative to origin
            # Returns CoordIJ with .i and .j attributes
            local_ij = h3.cell_to_local_ij(origin_cell, h3_index)
            coord_dict[h3_index] = (local_ij.i, local_ij.j)
        except Exception as e:
            # Some cells might be too far from origin for local IJ calculation
            # Fallback: use center coordinates converted to approximate grid position
            lat, lng = h3.cell_to_latlng(h3_index)
            # Approximate grid position based on distance from origin
            approx_i = int((lng - origin_lng) * 111000 / 500)  # ~500m per cell
            approx_j = int((lat - origin_lat) * 111000 / 500)
            coord_dict[h3_index] = (approx_i, approx_j)
            failed_coords += 1
            if failed_coords <= 3:
                logger.warning(f"Failed to calculate local IJ for {h3_index}, using approximation: {e}")

    if failed_coords > 0:
        logger.warning(f"Used approximation for {failed_coords} cells (too far from origin for local IJ)")

    # ====== NORMALIZE COORDINATES TO START AT (0, 0) ======
    # Find minimum I and J values
    all_i_values = [coord[0] for coord in coord_dict.values()]
    all_j_values = [coord[1] for coord in coord_dict.values()]

    min_i = min(all_i_values)
    min_j = min(all_j_values)
    max_i = max(all_i_values)
    max_j = max(all_j_values)

    logger.info(f"Raw coordinate ranges: I=[{min_i}, {max_i}], J=[{min_j}, {max_j}]")

    # Normalize: shift so minimum is (0, 0)
    # X = I coordinate (increases East), Y = J coordinate (increases North)
    normalized_coords = {}
    for h3_index, (i, j) in coord_dict.items():
        coord_x = int(i - min_i)  # Normalize I to X (starts at 0)
        coord_y = int(j - min_j)  # Normalize J to Y (starts at 0)
        normalized_coords[h3_index] = (coord_x, coord_y)

    # Calculate grid dimensions
    grid_width = max_i - min_i + 1
    grid_height = max_j - min_j + 1

    logger.info(f"Normalized grid: {grid_width} x {grid_height} cells (X: 0-{grid_width-1}, Y: 0-{grid_height-1})")
    logger.info(f"Origin (0,0) at Southwest corner, X increases East, Y increases North")

    return h3_cells_list, normalized_coords


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
    
    #print(f"[DEBUG] Directorio de trabajo actual: {os.getcwd()}")
    #print(f"[DEBUG] Ruta del script: {os.path.abspath(__file__)}")
    #print(f"[DEBUG] Archivos detectados en raster_dir: {os.listdir(raster_dir)}")

    
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

    logger.info("=" * 80)
    logger.info(f"SCANNING RASTER COVERAGE: {len(tif_files)} .tif files found")
    logger.info("=" * 80)
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
                logger.info(f"  ✓ {os.path.basename(tif_file):<30} | "
                           f"Lat: [{ds.bounds.bottom:7.2f}, {ds.bounds.top:7.2f}] | "
                           f"Lng: [{ds.bounds.left:7.2f}, {ds.bounds.right:7.2f}] | "
                           f"Size: {ds.width}x{ds.height}")
        except Exception as e:
            logger.warning(f"  ✗ Could not read {os.path.basename(tif_file)}: {e}")

    logger.info("=" * 80)
    logger.info(f"Total valid tiles: {len(coverage_map)}")
    logger.info("=" * 80)

    return coverage_map


def calculate_expected_tile_name(lat: float, lng: float) -> str:
    """
    Calculates the expected SRTM tile name for given coordinates.

    Args:
        lat: Latitude
        lng: Longitude

    Returns:
        Expected tile name (e.g., "N42W006" for coordinates in that tile)
    """
    # Round down to get tile corner
    lat_int = int(np.floor(lat))
    lng_int = int(np.floor(lng))

    # Format tile name
    lat_prefix = 'N' if lat_int >= 0 else 'S'
    lng_prefix = 'E' if lng_int >= 0 else 'W'

    lat_str = f"{abs(lat_int):02d}"
    lng_str = f"{abs(lng_int):03d}"

    return f"{lat_prefix}{lat_str}{lng_prefix}{lng_str}"


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
    Muestrea el valor del pixel en las coordenadas dadas usando Window optimizado.
    Retorna el valor del pixel o -1 si está fuera de bounds o es nodata.
    OPTIMIZADO: Lee SOLO el pixel necesario usando Window(col, row, 1, 1).
    """
    try:
        row, col = rowcol(dataset.transform, lng, lat)

        if 0 <= row < dataset.height and 0 <= col < dataset.width:
            # OPTIMIZACION: Usar Window(col_off, row_off, width, height) para leer 1 pixel
            pixel_value = dataset.read(1, window=Window(col, row, 1, 1))[0, 0]
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

        logger.info(f"Buscando mascara en: {shapefile_path.absolute()}")

        if not shapefile_path.exists():
            logger.warning(f"Land mask shapefile NO ENCONTRADO: {shapefile_path.absolute()}")
            logger.warning("Ejecuta 'python setup_assets.py' para descargarlo")
            logger.warning("Continuando SIN land mask - todas las celdas seran procesadas")
            return None

        start_time = time.time()
        gdf = gpd.read_file(str(shapefile_path))
        land_polygons = [geom for geom in gdf.geometry]
        land_index = STRtree(land_polygons)

        load_time = time.time() - start_time
        logger.info(f"Land mask cargado: {len(land_polygons)} poligonos en {load_time:.2f}s")

        return (land_polygons, land_index)

    except Exception as e:
        logger.error(f"[ERROR] Failed to load land mask: {e}")
        logger.warning("Proceeding WITHOUT land mask optimization")
        return None


def get_river_h3_set(data_dir: Path = BASE_DATA_DIR, h3_resolution: int = 8) -> set:
    """
    Carga la red de rios principales y genera un SET de indices H3 (O(1) lookup).
    OPTIMIZACION MAXIMA: Carga -> Buffer ANCHO (800m) -> H3 conversion con API v4 -> Libera memoria.

    Este proceso se ejecuta UNA SOLA VEZ al inicio del extractor.
    Despues, el bucle principal solo verifica: 'if h3_index in river_h3_set'.

    CORRECCION 2026-02-02: Usa H3 v4 API correctamente con LatLngPoly y coordenadas invertidas.
    Buffer aumentado a 800m para garantizar continuidad en hexagonos H3 nivel 8.

    Args:
        data_dir: Directorio base de datos (contiene vectors/rivers_main.shp)
        h3_resolution: Resolucion H3 a usar (default: 8)

    Returns:
        Set de indices H3 (strings) que intersectan con rios buffereados (800m)
        Set vacio si no se encuentra el shapefile o si falla la carga
    """
    try:
        # Ruta al shapefile de rios generado por setup_rivers.py
        shapefile_path = data_dir / 'vectors' / 'rivers_main.shp'

        logger.info(f"Buscando red de rios en: {shapefile_path.absolute()}")

        if not shapefile_path.exists():
            logger.warning(f"Rivers shapefile NO ENCONTRADO: {shapefile_path.absolute()}")
            logger.warning("Ejecuta 'python setup_rivers.py' para descargar HydroRIVERS")
            logger.warning("Continuando SIN red de rios - deteccion solo desde TIF")
            return set()

        start_time = time.time()

        # Cargar y reproyectar a WGS84
        gdf = gpd.read_file(str(shapefile_path))
        if gdf.crs != 'EPSG:4326':
            gdf = gdf.to_crs('EPSG:4326')

        # Filtrar geometrias invalidas
        invalid_count = (~gdf.geometry.is_valid).sum()
        if invalid_count > 0:
            gdf = gdf[gdf.geometry.is_valid]

        logger.info(f"Rios validos: {len(gdf)} segmentos")

        # Buffer calibrado por resolución H3 (≈ 1.5× longitud de arista de celda)
        # res 6: arista ~3.2km, res 7: ~1.2km, res 8: ~0.46km
        BUFFER_BY_RES = {5: 8000, 6: 3500, 7: 1800, 8: 800, 9: 350, 10: 150}
        buffer_meters = BUFFER_BY_RES.get(h3_resolution, 800)
        logger.info(f"Buffer de rio: {buffer_meters}m (para resolucion H3={h3_resolution})")
        gdf_metric = gdf.to_crs('EPSG:3857')
        gdf_buffered = gdf_metric.buffer(buffer_meters)
        gdf_buffered_wgs84 = gdf_buffered.to_crs('EPSG:4326')

        river_h3_set = set()
        error_count = 0

        for idx, river_geom in enumerate(gdf_buffered_wgs84):
            if river_geom is None or not river_geom.is_valid:
                error_count += 1
                continue

            try:
                # CORRECCION H3 v4 API: Extraer coordenadas e invertir (lng,lat) -> (lat,lng)
                # Los poligonos Shapely usan (x,y) = (lng,lat), pero H3 espera (lat,lng)
                coords = list(river_geom.exterior.coords)
                latlng_coords = [(lat, lng) for lng, lat in coords]

                # Crear objeto H3 LatLngPoly
                h3_poly = h3.LatLngPoly(latlng_coords)

                # Obtener celdas H3 usando API v4
                h3_cells = h3.polygon_to_cells(h3_poly, h3_resolution)
                river_h3_set.update(h3_cells)

                if (idx + 1) % 2000 == 0:
                    logger.info(f"  Procesados {idx + 1}/{len(gdf_buffered_wgs84)} segmentos -> {len(river_h3_set):,} celdas H3")

            except Exception as e:
                # Log primer error para debug, resto silencioso
                if error_count == 0:
                    logger.warning(f"Error convirtiendo rio a H3: {e}")
                error_count += 1
                continue

        # Bridge-fill: rellenar celdas intermedias entre dos celdas de río a distancia 2.
        # Garantiza continuidad cuando el buffer no alcanza a cubrir la celda entre dos segmentos.
        logger.info("Ejecutando bridge-fill para garantizar continuidad de rios...")
        bridge_start = time.time()
        bridged = set()
        for cell in list(river_h3_set):
            for k2_cell in h3.grid_ring(cell, 2):
                if k2_cell in river_h3_set:
                    path = h3.grid_path_cells(cell, k2_cell)
                    bridged.update(path)
        added = bridged - river_h3_set
        river_h3_set.update(bridged)
        logger.info(f"Bridge-fill: {len(added):,} celdas intermedias añadidas en {time.time()-bridge_start:.2f}s")

        # Liberar memoria
        del gdf, gdf_metric, gdf_buffered, gdf_buffered_wgs84
        import gc
        gc.collect()

        elapsed = time.time() - start_time
        logger.info(f"Rios convertidos: {len(river_h3_set):,} celdas H3 en {elapsed:.2f}s")

        # LOG DE VERIFICACION: Detectar problemas si el numero es muy bajo
        if len(river_h3_set) < 5000:
            logger.warning(f"ATENCION: Solo {len(river_h3_set):,} celdas de rio detectadas (esperado >5000 para Galicia)")
            logger.warning("Posible problema en conversion H3 o shapefile incompleto")
        else:
            logger.info(f"Red hidrografica completada: {len(river_h3_set):,} celdas unicas marcadas como rio")

        if error_count > 0:
            logger.warning(f"{error_count} poligonos ignorados por errores de conversion")

        return river_h3_set

    except Exception as e:
        logger.error(f"Error cargando rios: {e}", exc_info=True)
        logger.warning("Continuando sin red de rios")
        return set()


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
        logger.warning(f"Directorio de elevacion no encontrado: {elevation_dir}")
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
                    logger.info(f"  [OK] Tile relevante: {filename} (covers lat={lat}-{lat+1}, lng={lng}-{lng+1})")
                else:
                    logger.info(f"  [X] Tile fuera del bbox: {filename} (covers lat={lat}-{lat+1}, lng={lng}-{lng+1})")

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
        logger.warning("Continuando sin datos de elevacion...")
        return None


def load_srtm_elevation_dataset(srtm_file: Optional[str]) -> Optional[dict]:
    """
    Carga el dataset de elevacion SRTM Y la banda completa en memoria (OPTIMIZACION).

    En lugar de leer pixel por pixel del disco, carga toda la banda en un numpy array.
    Esto reduce el I/O de disco de ~100,000 lecturas a 1 sola lectura inicial.

    Args:
        srtm_file: Path al archivo SRTM DEM

    Returns:
        Dict con 'dataset' (rasterio), 'array' (numpy), 'transform', 'bounds', 'nodata'
        None si falla
    """
    if not srtm_file or not Path(srtm_file).exists():
        logger.warning("Archivo SRTM no disponible, elevacion no se usara")
        return None

    try:
        dataset = rasterio.open(srtm_file)

        # Cargar toda la banda en memoria (1 lectura vs miles)
        elevation_array = dataset.read(1)
        array_size_mb = elevation_array.nbytes / (1024 * 1024)

        logger.info(f"SRTM cargado en memoria: {array_size_mb:.1f} MB, shape={elevation_array.shape}")

        return {
            'dataset': dataset,
            'array': elevation_array,
            'transform': dataset.transform,
            'bounds': dataset.bounds,
            'nodata': dataset.nodata
        }
    except Exception as e:
        logger.error(f"Error cargando SRTM dataset: {e}")
        return None


def get_elevation(lat: float, lng: float, srtm_data: Optional[dict], cache: Optional[dict] = None) -> Optional[float]:
    """
    Obtiene la elevacion (en metros) desde el array SRTM cargado en memoria.
    OPTIMIZACION MAXIMA: Lee directamente del numpy array (O(1)) en lugar de disco.

    Args:
        lat: Latitud
        lng: Longitud
        srtm_data: Dict con 'array', 'transform', 'bounds', 'nodata' de load_srtm_elevation_dataset()
        cache: Diccionario de cache {(lat_rounded, lng_rounded): elevation}

    Returns:
        Elevacion en metros, o None si no disponible
    """
    if srtm_data is None:
        return None

    # Redondear coordenadas a 5 decimales (~1.1m precision) para cache
    cache_key = (round(lat, 5), round(lng, 5))

    # Check cache first
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    try:
        # Convertir coordenadas geograficas a indices de pixel usando transform
        row, col = ~srtm_data['transform'] * (lng, lat)
        row, col = int(row), int(col)

        # Verificar bounds
        if row < 0 or col < 0 or row >= srtm_data['array'].shape[0] or col >= srtm_data['array'].shape[1]:
            result = None
        else:
            # OPTIMIZACION: Leer directamente del array en memoria (instantaneo)
            elevation_value = srtm_data['array'][col, row]

            # SRTM usa valores negativos para depresiones, 0 para mar
            # Valores muy negativos (< -500) suelen ser NoData
            if elevation_value < -500 or elevation_value == srtm_data['nodata']:
                result = None
            else:
                result = float(elevation_value)

        # Store in cache
        if cache is not None:
            cache[cache_key] = result

        return result

    except Exception as e:
        # Punto fuera de bounds o error de lectura
        if cache is not None:
            cache[cache_key] = None
        return None


def calculate_terrain_ruggedness(lat: float, lng: float, srtm_data: Optional[dict], cache: Optional[dict] = None) -> Optional[float]:
    """
    Calcula el Terrain Ruggedness Index (TRI) en un punto.
    OPTIMIZACION: Lee del array SRTM en memoria + cache de elevaciones.

    El TRI mide la variabilidad de la elevacion en un area, distinguiendo:
    - Llanuras/Mesetas: Altitud alta pero rugosidad baja (<15m)
    - Colinas/Montanas: Altitud alta y rugosidad alta (>15m)

    Metodologia:
    - Obtiene elevacion del centro y 8 puntos vecinos a ~500m
    - Calcula desviacion estandar de las elevaciones
    - Retorna rugosidad en metros

    Args:
        lat: Latitud del punto central
        lng: Longitud del punto central
        srtm_data: Dict con array SRTM en memoria
        cache: Diccionario de cache de elevaciones

    Returns:
        Rugosidad TRI en metros, o None si no se puede calcular
    """
    if srtm_data is None:
        return None

    try:
        # Offset de ~500m en grados (~0.0045° ≈ 500m a lat 42°)
        # Usamos mayor distancia para capturar variabilidad de mesetas vs colinas
        offset = 0.0045

        # Elevaciones de 9 puntos (centro + 8 vecinos en grid 3x3)
        elevations = []

        # Centro
        elev_center = get_elevation(lat, lng, srtm_data, cache)
        if elev_center is None:
            return None
        elevations.append(elev_center)

        # 8 puntos cardinales e intercardiales
        neighbor_offsets = [
            (offset, 0),      # Este
            (-offset, 0),     # Oeste
            (0, offset),      # Norte
            (0, -offset),     # Sur
            (offset, offset),    # NE
            (-offset, offset),   # NO
            (offset, -offset),   # SE
            (-offset, -offset)   # SO
        ]

        for lat_off, lng_off in neighbor_offsets:
            elev = get_elevation(lat + lat_off, lng + lng_off, srtm_data, cache)
            if elev is not None:
                elevations.append(elev)

        # Necesitamos al menos 5 puntos validos (centro + 4 vecinos)
        if len(elevations) < 5:
            return None

        # Calcular desviacion estandar (TRI)
        # TRI = std de las diferencias absolutas respecto al centro
        differences = [abs(e - elev_center) for e in elevations[1:]]
        tri = np.std(differences) if len(differences) > 0 else 0.0

        return float(tri)

    except Exception as e:
        # Error en calculo de rugosidad
        return None


def renaturalize_modern_cities(terrain_data: List[Tuple[str, int, int, int]]) -> List[Tuple[str, int, int, int]]:
    """
    Renaturaliza ciudades modernas (TIF=50, marcadas como ID 0) usando inpainting.

    PROCESO:
    1. Identifica celdas con ID 0 (ciudades modernas a renaturalizar)
    2. Para cada una, busca vecinos H3 con h3.grid_disk(index, 1)
    3. Si tiene vecino Mar (ID 1), convierte en Costa (ID 2)
    4. Si es interior, aplica Moda de vecinos naturales (relleno)

    Args:
        terrain_data: Lista de tuplas (h3_index_hex_string, terrain_type_id, coord_x, coord_y)

    Returns:
        Lista actualizada con ciudades renaturalizadas
    """
    logger.info("Identificando ciudades modernas (TIF=50) para renaturalizar...")

    # Crear diccionarios para lookup rapido
    terrain_dict = {h3_idx: terrain_id for h3_idx, terrain_id, _, _ in terrain_data}
    coords_dict = {h3_idx: (cx, cy) for h3_idx, _, cx, cy in terrain_data}

    # Identificar ciudades modernas (ID 0)
    modern_cities = [(h3_idx, terrain_id) for h3_idx, terrain_id, _, _ in terrain_data if terrain_id == 0]
    logger.info(f"Ciudades modernas detectadas: {len(modern_cities)}")

    if not modern_cities:
        logger.info("No hay ciudades modernas para renaturalizar")
        return terrain_data

    converted_to_coast = 0
    renaturalized = 0

    for h3_idx_str, _ in modern_cities:
        # Obtener vecinos H3 (k=1 ring, 6 vecinos)
        try:
            neighbors_set = h3.grid_disk(h3_idx_str, 1)
            neighbors_list = [n for n in neighbors_set if n != h3_idx_str]
        except Exception as e:
            logger.warning(f"Error obteniendo vecinos para {h3_idx_str}: {e}")
            continue

        # Obtener terrain_type_id de vecinos
        neighbor_terrains = []
        has_sea_neighbor = False

        for neighbor_str in neighbors_list:
            neighbor_terrain = terrain_dict.get(neighbor_str)

            if neighbor_terrain is not None:
                if neighbor_terrain == 1:  # Mar
                    has_sea_neighbor = True
                    break
                # Solo considerar terrenos naturales validos (no urbanos, no temporal)
                if neighbor_terrain > 1:
                    neighbor_terrains.append(neighbor_terrain)

        # DECISION:
        if has_sea_neighbor:
            # Convertir en Costa
            terrain_dict[h3_idx_str] = 2
            converted_to_coast += 1
        elif neighbor_terrains:
            # Aplicar Moda (terreno mas frecuente)
            from collections import Counter
            terrain_mode = Counter(neighbor_terrains).most_common(1)[0][0]
            terrain_dict[h3_idx_str] = terrain_mode
            renaturalized += 1
        else:
            # Sin vecinos validos, asignar default (Cultivo ID 6)
            terrain_dict[h3_idx_str] = 6
            renaturalized += 1

    logger.info(f"Ciudades modernas renaturalizadas: {renaturalized}")
    logger.info(f"Convertidas en costa: {converted_to_coast}")

    # Reconstruir terrain_data con valores actualizados y coordenadas preservadas
    updated_terrain_data = [
        (h3_idx, terrain_dict[h3_idx], coords_dict[h3_idx][0], coords_dict[h3_idx][1])
        for h3_idx, _, _, _ in terrain_data
    ]

    return updated_terrain_data


def overlay_historical_settlements(terrain_data: List[Tuple[str, int, int, int]]) -> List[Tuple[str, int, int, int]]:
    """
    Carga asentamientos historicos desde la base de datos y sobreescribe el terreno con ID 14.

    Este paso asegura que SOLO los asentamientos historicos (tabla settlements) reciban ID 14,
    no las ciudades modernas detectadas en el TIF.

    Args:
        terrain_data: Lista de tuplas (h3_index_hex_string, terrain_type_id, coord_x, coord_y)

    Returns:
        Lista actualizada con asentamientos historicos marcados como ID 14
    """
    logger.info("Cargando asentamientos historicos desde base de datos...")

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # Consultar todos los asentamientos historicos
        cursor.execute("SELECT h3_index FROM settlements")
        settlements = cursor.fetchall()

        cursor.close()
        conn.close()

        if not settlements:
            logger.info("No hay asentamientos historicos en la base de datos")
            return terrain_data

        logger.info(f"Asentamientos historicos encontrados: {len(settlements)}")

        # Crear diccionarios para lookup rapido
        terrain_dict = {h3_idx: terrain_id for h3_idx, terrain_id, _, _ in terrain_data}
        coords_dict = {h3_idx: (cx, cy) for h3_idx, _, cx, cy in terrain_data}

        # Sobreescribir con ID 14
        overlayed = 0
        for (settlement_h3_idx,) in settlements:
            if settlement_h3_idx in terrain_dict:
                terrain_dict[settlement_h3_idx] = 14  # Asentamiento historico
                overlayed += 1

        logger.info(f"Asentamientos historicos inyectados: {overlayed}")

        # Reconstruir terrain_data con coordenadas preservadas
        updated_terrain_data = [
            (h3_idx, terrain_dict[h3_idx], coords_dict[h3_idx][0], coords_dict[h3_idx][1])
            for h3_idx, _, _, _ in terrain_data
        ]

        return updated_terrain_data

    except Exception as e:
        logger.error(f"Error cargando asentamientos historicos: {e}", exc_info=True)
        logger.warning("Continuando sin overlay de asentamientos historicos")
        return terrain_data


def extract_terrain_from_raster(
    raster_dir: str,
    h3_cells: List[str],
    h3_coords: Dict[str, Tuple[int, int]] = None
) -> List[Tuple[str, int, int, int]]:
    """
    Extracts terrain values from GeoTIFF files using OPTIMIZED MASTER HIERARCHY
    with MEDIEVAL NATURALIZATION.

    JERARQUIA MAESTRA (orden estricto):
    A) Mar (mascara Natural Earth) -> ID 1
    B) Rio (H3 index en river_h3_set pre-calculado) -> ID 4
    C) Alta Montana (Altitud SRTM > 1100m) -> ID 13
    D) Ciudad Moderna (TIF == 50) -> ID 0 (temporal, renaturalizar)
    E) Colina (Altitud > 500m Y Rugosidad > 15m) -> ID 12
    F) Resto -> Mapeo estandar del TIF

    POST-PROCESADO:
    1. Renaturalizacion de ciudades modernas (ID 0):
       - Si vecino es Mar -> Costa (ID 2)
       - Si interior -> Moda de vecinos (terreno mas frecuente)
    2. Overlay de asentamientos historicos (tabla settlements) -> ID 14

    OPTIMIZACIONES:
    - Pre-carga SRTM en memoria (array completo)
    - Pre-calcula river_h3_set para lookup O(1)
    - Usa Window() para lectura de pixels individuales
    - Logs limpios sin emojis, resumen cada 10,000 celdas

    Returns list of tuples (h3_index_as_hex_string, terrain_type_id, coord_x, coord_y).
    """
    # Ensure h3_coords is provided
    if h3_coords is None:
        logger.warning("No coordinates provided, using default (0, 0) for all cells")
        h3_coords = {h3_index: (0, 0) for h3_index in h3_cells}

    # Load land mask for spatial optimization
    logger.info("Cargando mascara de tierra (Natural Earth 10m)...")
    land_mask = load_land_mask()

    # Load river network and convert to H3 SET (O(1) lookup optimization)
    logger.info("Cargando red de rios y generando indices H3...")
    river_h3_set = get_river_h3_set(BASE_DATA_DIR, H3_RESOLUTION)

    # Load SRTM elevation data (banda completa en memoria)
    logger.info("Cargando datos de elevacion SRTM...")
    srtm_file = download_srtm_for_region(BOUNDING_BOX)
    srtm_data = load_srtm_elevation_dataset(srtm_file)

    if srtm_data:
        logger.info(f"SRTM cargado en memoria. Reglas: >1100m=Montana, 500-1100m+Rugosidad>{RUGGEDNESS_THRESHOLD}m=Colinas")
    else:
        logger.warning("SRTM no disponible - usando solo clasificacion TIF")

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
        logger.warning(f"[!] No tile found covering region center ({center_lat:.2f}, {center_lng:.2f})")
        logger.warning(f"Available tiles:")
        for filename in coverage_map.keys():
            logger.warning(f"  - {filename}")
        logger.info("Continuing with available tiles - cells outside coverage will use default terrain type")

    if test_tile:
        logger.info(f"[OK] Found coverage tile: {os.path.basename(test_tile)}")

    # Process cells with dynamic tile selection
    terrain_data = []
    processed = 0
    skipped = 0
    out_of_bounds = 0

    # CONTADOR DE TIPOS DE TERRENO (IDs 0-14, incluye 0 para ciudades modernas temporales)
    terrain_counter = {i: 0 for i in range(0, 15)}

    # Contadores por fase
    phase_1_mar = 0
    phase_2_costa = 0
    phase_3_agua = 0
    phase_4_montana = 0
    phase_5_resto = 0
    open_sea_discarded = 0  # Celdas descartadas por estar en mar abierto
    river_network_burned = 0  # Celdas quemadas como Río por red hidrográfica

    # Contadores de elevación (PRIORIDAD MÁXIMA sobre TIF)
    elevation_high_mountain = 0  # Montañas detectadas por elevación > 1100m
    elevation_hills = 0  # Colinas detectadas por elevación 500-1100m + pendiente
    plateau_protected = 0  # Mesetas protegidas (altitud alta pero sin pendiente)

    # Cache for open datasets to avoid reopening the same file
    dataset_cache = {}
    failed_tiles = set()  # Track tiles that failed to open

    # OPTIMIZACION: Cache de elevaciones para evitar consultas SRTM repetidas
    elevation_cache = {}

    # Performance tracking
    start_time = time.time()
    last_log_time = start_time

    # ====== VALIDACIÓN DE COORDENADAS: Verificar que todas las celdas están en el bbox ======
    logger.info("=" * 80)
    logger.info("VALIDATING H3 CELLS COORDINATES")
    logger.info("=" * 80)

    if h3_cells:
        # Verificar primera celda
        first_lat, first_lng = h3.cell_to_latlng(h3_cells[0])
        logger.info(f"First H3 cell: {h3_cells[0]}")
        logger.info(f"  - Coordinates: lat={first_lat:.6f}, lng={first_lng:.6f}")

        # Verificar última celda
        last_lat, last_lng = h3.cell_to_latlng(h3_cells[-1])
        logger.info(f"Last H3 cell: {h3_cells[-1]}")
        logger.info(f"  - Coordinates: lat={last_lat:.6f}, lng={last_lng:.6f}")

        # Calcular rangos de coordenadas de todas las celdas
        all_lats = []
        all_lngs = []
        for h3_idx in h3_cells[:min(1000, len(h3_cells))]:  # Sample primeras 1000
            lat, lng = h3.cell_to_latlng(h3_idx)
            all_lats.append(lat)
            all_lngs.append(lng)

        min_cell_lat = min(all_lats)
        max_cell_lat = max(all_lats)
        min_cell_lng = min(all_lngs)
        max_cell_lng = max(all_lngs)

        logger.info(f"Cell coordinate ranges (from {len(all_lats)} samples):")
        logger.info(f"  Latitude:  [{min_cell_lat:.6f}, {max_cell_lat:.6f}]")
        logger.info(f"  Longitude: [{min_cell_lng:.6f}, {max_cell_lng:.6f}]")
        logger.info(f"Expected bbox:")
        logger.info(f"  Latitude:  [{BOUNDING_BOX['min_lat']:.6f}, {BOUNDING_BOX['max_lat']:.6f}]")
        logger.info(f"  Longitude: [{BOUNDING_BOX['min_lng']:.6f}, {BOUNDING_BOX['max_lng']:.6f}]")

        # VALIDACIÓN CRÍTICA: Detectar coordenadas fuera del bbox
        if (min_cell_lng > 0 and BOUNDING_BOX['min_lng'] < 0):
            logger.error("=" * 80)
            logger.error("CRITICAL ERROR: LONGITUDE SIGN MISMATCH!")
            logger.error(f"  Cell longitudes are POSITIVE: [{min_cell_lng:.2f}, {max_cell_lng:.2f}]")
            logger.error(f"  Expected NEGATIVE longitudes: [{BOUNDING_BOX['min_lng']:.2f}, {BOUNDING_BOX['max_lng']:.2f}]")
            logger.error("  This indicates the cells are NOT in the Iberian Peninsula!")
            logger.error("=" * 80)
            raise ValueError(f"Generated cells have wrong longitude sign. Expected negative (Iberia), got positive.")

        if (min_cell_lat < BOUNDING_BOX['min_lat'] - 0.5 or max_cell_lat > BOUNDING_BOX['max_lat'] + 0.5 or
            min_cell_lng < BOUNDING_BOX['min_lng'] - 0.5 or max_cell_lng > BOUNDING_BOX['max_lng'] + 0.5):
            logger.warning("=" * 80)
            logger.warning("WARNING: Some cells appear to be outside the bounding box!")
            logger.warning(f"  This may cause missing tile errors.")
            logger.warning("=" * 80)

    logger.info("=" * 80)

    try:
        for idx, h3_index in enumerate(h3_cells):
            # Get center coordinates of H3 cell (returns lat, lng) - h3 v4 API
            lat, lng = h3.cell_to_latlng(h3_index)
            # CHANGED: Store h3_index as hexadecimal string, not integer
            terrain_type_id = None

            # Get cartesian coordinates for this cell
            coord_x, coord_y = h3_coords.get(h3_index, (0, 0))

            # ====== A) MAR: Descartar mar abierto con land_mask ======
            if not is_point_on_land(lat, lng, land_mask, debug=False):
                terrain_type_id = 1  # Mar
                terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
                terrain_counter[terrain_type_id] += 1
                phase_1_mar += 1
                open_sea_discarded += 1
                continue

            # ====== B) RIO: Pre-verificar si esta en river_h3_set (O(1)) ======
            # Pasaremos este flag a determine_terrain para aplicar jerarquia correcta
            is_river_cell = h3_index in river_h3_set

            try:
                # Find which raster file contains this coordinate
                raster_path = find_raster_for_coord(lat, lng, coverage_map)

                # ====== FASE 1: MAR (fuera de cobertura) ======
                if not raster_path:
                    terrain_type_id = 1  # Mar
                    terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
                    terrain_counter[terrain_type_id] += 1
                    phase_1_mar += 1
                    out_of_bounds += 1
                    if out_of_bounds <= 5:
                        expected_tile = calculate_expected_tile_name(lat, lng)
                        logger.warning(f"TILE FALTANTE: Cell {h3_index} at ({lat:.6f}, {lng:.6f}) requires tile {expected_tile}")
                        logger.warning(f"  Available tiles: {', '.join(coverage_map.keys())}")
                    if out_of_bounds == 10:
                        logger.warning(f"  ... (suppressing further missing tile warnings, total: {out_of_bounds})")
                    continue

                # Skip tiles that previously failed to open
                if raster_path in failed_tiles:
                    terrain_type_id = 1  # Mar
                    terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
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
                            logger.warning(f"[!] Slow file open: {os.path.basename(raster_path)} took {open_duration:.1f}s")
                    except Exception as e:
                        logger.error("=" * 80)
                        logger.error(f"RASTER FILE ERROR: Failed to open tile for cell {h3_index}")
                        logger.error(f"  Cell coordinates: lat={lat:.6f}, lng={lng:.6f}")
                        logger.error(f"  Required tile: {os.path.basename(raster_path)}")
                        logger.error(f"  Full path: {raster_path}")
                        logger.error(f"  Error: {e}")
                        logger.error("=" * 80)
                        failed_tiles.add(raster_path)
                        terrain_type_id = 1  # Mar
                        terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
                        terrain_counter[terrain_type_id] += 1
                        phase_1_mar += 1
                        skipped += 1
                        continue

                dataset = dataset_cache[raster_path]

                # Muestreo del centro
                center_value = sample_pixel_value(dataset, lat, lng)

                # ====== FUNCION MAESTRA: DETERMINE_TERRAIN ======
                # JERARQUIA MAESTRA - VERSION 2026-02-02B (sin ciudades modernas)
                def determine_terrain(cv, elev, ruggedness, h3_idx, cell_idx, is_river_cell):
                    """
                    Determina el tipo de terreno con JERARQUIA MAESTRA.

                    Orden ESTRICTO de prioridad:
                    A) Mar (mascara Natural Earth - ya procesado antes)
                    B) Rio (H3 index en river_h3_set) -> ID 4
                    C) Alta Montana (Altitud > 1100m) -> ID 13
                    D) Ciudades modernas (TIF == 50) -> ID 0 (temporal, renaturalizar)
                    E) Colina (Altitud > 500m Y Rugosidad > threshold) -> ID 12
                    F) Resto -> Mapeo estandar del TIF

                    NOTA: Los asentamientos historicos (ID 14) se asignan en post-procesado
                    """
                    nonlocal phase_1_mar, phase_2_costa, phase_3_agua, phase_4_montana
                    nonlocal phase_5_resto, elevation_high_mountain, elevation_hills, plateau_protected, river_network_burned

                    # A) Mar: Ya procesado antes del bucle con land_mask

                    # B) RIO: Verificar si esta en river_h3_set (O(1) lookup)
                    if is_river_cell:
                        phase_3_agua += 1
                        river_network_burned += 1
                        return 4  # Rio

                    # C) ALTA MONTANA: Altitud > 1100m (PRIORIDAD sobre TIF)
                    if elev is not None and elev > 1100:
                        elevation_high_mountain += 1
                        phase_4_montana += 1
                        return 13  # Alta Montana

                    # D) CIUDAD MODERNA: TIF == 50 -> Marcar como 0 (renaturalizar)
                    if cv == 50:
                        phase_5_resto += 1
                        return 0  # Temporal - sera rellenado en post-procesado

                    # E) COLINA: Altitud > 500m Y Rugosidad > threshold
                    if elev is not None and elev > 500:
                        if ruggedness is not None and ruggedness > RUGGEDNESS_THRESHOLD:
                            elevation_hills += 1
                            phase_5_resto += 1
                            return 12  # Colinas

                    # F) RESTO: Mapeo estandar del TIF
                    # Casos especiales:
                    # - NoData -> Mar o Costa
                    if cv == -1:
                        circular_points = sample_circular_points(lat, lng)
                        neighbor_values = [sample_pixel_value(dataset, p[0], p[1]) for p in circular_points[1:]]
                        if all(v == -1 for v in neighbor_values):
                            phase_1_mar += 1
                            return 1  # Mar
                        else:
                            phase_2_costa += 1
                            return 2  # Costa

                    # Mapeo estandar segun TERRAIN_MAPPING
                    phase_5_resto += 1
                    return TERRAIN_MAPPING.get(cv, DEFAULT_TERRAIN_TYPE_ID)

                # OPTIMIZACION: Consultar elevacion y rugosidad SRTM desde memoria con cache
                elevation = get_elevation(lat, lng, srtm_data, elevation_cache) if srtm_data else None
                ruggedness = calculate_terrain_ruggedness(lat, lng, srtm_data, elevation_cache) if srtm_data else None

                # EJECUTAR FUNCION MAESTRA DE DECISION
                terrain_type_id = determine_terrain(center_value, elevation, ruggedness, h3_index, idx, is_river_cell)

                terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
                terrain_counter[terrain_type_id] += 1
                processed += 1

            except Exception as e:
                # Any error in reading: assign default terrain type
                if idx < 5:  # Log first few errors
                    logger.warning(f"Error processing cell {h3_index} at lat={lat:.6f}, lng={lng:.6f}: {e}")
                terrain_type_id = 1  # Mar
                terrain_data.append((h3_index, terrain_type_id, coord_x, coord_y))
                terrain_counter[terrain_type_id] += 1
                phase_1_mar += 1
                skipped += 1

            # Log progreso cada 10,000 celdas
            total_cells = idx + 1
            if total_cells % 10000 == 0 and total_cells > 0:
                current_time = time.time()
                elapsed = current_time - start_time
                interval = current_time - last_log_time
                cells_per_sec = 10000 / interval if interval > 0 else 0

                logger.info(f"Procesadas {total_cells:,}/{len(h3_cells):,} ({total_cells/len(h3_cells)*100:.1f}%) | "
                           f"{cells_per_sec:.0f} cells/s | "
                           f"Montana:{elevation_high_mountain:,} Rio:{river_network_burned:,} Colina:{elevation_hills:,} Mar:{open_sea_discarded:,}")
                last_log_time = current_time

        total_time = time.time() - start_time
        logger.info(f"\nEXTRACCION COMPLETA en {total_time:.1f}s ({total_time/60:.1f}min)")
        logger.info(f"Total celdas: {len(h3_cells):,} | Validas: {processed:,} | Errores: {skipped}")

        logger.info("\nDISTRIBUCION DE TERRENOS (PRE-PROCESADO):")
        terrain_names = {
            0: "Ciudad Moderna (temp)", 1: "Mar", 2: "Costa", 3: "Agua", 4: "Rio", 5: "Pantanos",
            6: "Cultivo", 7: "Secano", 8: "Estepas",
            9: "Bosque", 10: "Bosque Denso", 11: "Paramo", 12: "Colinas",
            13: "Montana", 14: "Asentamientos"
        }

        total_counted = sum(terrain_counter.values())
        for terrain_id in range(0, 15):
            count = terrain_counter[terrain_id]
            if count > 0:
                percentage = (count / total_counted * 100) if total_counted > 0 else 0
                name = terrain_names.get(terrain_id, f"ID{terrain_id}")
                logger.info(f"  {terrain_id:2d}. {name:20s}: {count:7,} ({percentage:5.2f}%)")

        logger.info(f"\nRESUMEN JERARQUIA:")
        logger.info(f"  Mar (land_mask): {open_sea_discarded:,}")
        logger.info(f"  Rios (river_h3_set): {river_network_burned:,}")
        logger.info(f"  Montana (>1100m): {elevation_high_mountain:,}")
        logger.info(f"  Colinas (500-1100m + rugosidad>{RUGGEDNESS_THRESHOLD}m): {elevation_hills:,}")

        # ====== POST-PROCESADO: RENATURALIZACION DE CIUDADES MODERNAS ======
        logger.info("\n" + "=" * 60)
        logger.info("POST-PROCESADO: Renaturalización de ciudades modernas")
        logger.info("=" * 60)

        terrain_data = renaturalize_modern_cities(terrain_data)

        # ====== POST-PROCESADO: OVERLAY DE ASENTAMIENTOS HISTORICOS ======
        logger.info("\n" + "=" * 60)
        logger.info("POST-PROCESADO: Overlay de asentamientos históricos")
        logger.info("=" * 60)

        terrain_data = overlay_historical_settlements(terrain_data)

        logger.info("\n" + "=" * 60)
        logger.info("POST-PROCESADO COMPLETADO")
        logger.info("=" * 60)

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
        if srtm_data:
            try:
                srtm_data['dataset'].close()
                logger.debug("Closed SRTM elevation dataset")
            except Exception as e:
                logger.warning(f"Error closing SRTM dataset: {e}")

    return terrain_data


def insert_terrain_data_batch(
    db_config: Dict[str, str],
    terrain_data: List[Tuple[str, int, int, int]]
) -> None:
    """
    Inserts terrain data into h3_map table using optimized batch inserts with execute_values.
    PRESERVES has_road column when updating existing records (for historical infrastructure).
    Uses batches of 1000 records and logs progress.

    IMPORTANT: Does NOT truncate table - preserves has_road markers set by setup_history.py
    IMPORTANT: h3_index is stored as TEXT (hexadecimal string), not BIGINT
    IMPORTANT: Now includes coord_x and coord_y for cartesian coordinate system
    """
    logger.info(f"Connecting to database at {db_config['host']}...")

    sql_dump_path = BASE_DATA_DIR / 'extractor.sql'
    if sql_dump_path.exists():
        sql_dump_path.unlink()
    logger.info(f"SQL dump will be written to: {sql_dump_path}")

    conn = psycopg2.connect(
        host=db_config['host'],
        port=db_config['port'],
        database=db_config['database'],
        user=db_config['user'],
        password=db_config['password']
    )

    try:
        with open(sql_dump_path, 'w', encoding='utf-8') as sql_file, conn.cursor() as cursor:
            # NO TRUNCATE: Preserve has_road column set by setup_history.py
            logger.info("Updating h3_map data (preserving has_road markers and inserting coordinates)...")

            # Prepare insert query that PRESERVES has_road on conflict and includes coord_x, coord_y
            # New schema includes player_id, coord_x, coord_y (defaults: NULL, 0, 0, 0)
            insert_query = """
                INSERT INTO h3_map (h3_index, terrain_type_id, player_id, has_road, coord_x, coord_y)
                VALUES %s
                ON CONFLICT (h3_index)
                DO UPDATE SET
                    terrain_type_id = EXCLUDED.terrain_type_id,
                    coord_x = EXCLUDED.coord_x,
                    coord_y = EXCLUDED.coord_y
                    -- player_id, has_road NOT updated, preserving existing values
            """

            # Note: We need to provide all fields for new inserts
            # Defaults: player_id=NULL, has_road=FALSE
            # h3_index is already a hexadecimal string, coord_x and coord_y are integers

            # VALIDACIÓN: Verificar que coord_x y coord_y son enteros
            logger.info("Validating coordinate data types...")
            invalid_coords = 0
            for h3_index, terrain_id, coord_x, coord_y in terrain_data[:min(100, len(terrain_data))]:
                if not isinstance(coord_x, int) or not isinstance(coord_y, int):
                    logger.error(f"Invalid coordinate types for {h3_index}: coord_x={coord_x} (type={type(coord_x)}), coord_y={coord_y} (type={type(coord_y)})")
                    invalid_coords += 1

            if invalid_coords > 0:
                raise TypeError(f"Found {invalid_coords} cells with non-integer coordinates. All coords must be int.")

            logger.info("✓ All coordinates are valid integers")

            terrain_data_with_fields = [
                (h3_index, terrain_id, None, False, int(coord_x), int(coord_y))
                for h3_index, terrain_id, coord_x, coord_y in terrain_data
            ]

            logger.info(f"Inserting/updating {len(terrain_data_with_fields)} records in batches of {BATCH_SIZE}...")

            # Log sample of coordinates being inserted
            if len(terrain_data_with_fields) > 0:
                sample_size = min(5, len(terrain_data_with_fields))
                logger.info(f"Sample of first {sample_size} records (h3_index, terrain_id, coord_x, coord_y):")
                for i in range(sample_size):
                    h3_idx, terrain_id, _, _, cx, cy = terrain_data_with_fields[i]
                    logger.info(f"  {i+1}. {h3_idx} -> terrain={terrain_id}, coords=({cx}, {cy})")

            # Insert in batches with progress logging
            total_inserted = 0
            start_time = time.time()

            for i in range(0, len(terrain_data_with_fields), BATCH_SIZE):
                batch = terrain_data_with_fields[i:i + BATCH_SIZE]
                execute_values(cursor, insert_query, batch, page_size=BATCH_SIZE)
                conn.commit()

                # Write executed SQL to dump file
                rows_sql = ',\n    '.join(
                    cursor.mogrify("(%s, %s, %s, %s,%s, %s)", row).decode('utf-8')
                    for row in batch
                )
                sql_file.write(insert_query.replace('VALUES %s', f'VALUES\n    {rows_sql}') + ';\n\n')

                total_inserted += len(batch)

                # Log progress every 1000 records
                if total_inserted % 1000 == 0 or total_inserted == len(terrain_data_with_fields):
                    elapsed = time.time() - start_time
                    rate = total_inserted / elapsed if elapsed > 0 else 0
                    logger.info(f"Inserted/updated {total_inserted}/{len(terrain_data_with_fields)} records "
                               f"({rate:.1f} records/s)")

            logger.info(f"Successfully inserted/updated {len(terrain_data_with_fields)} records in {elapsed:.1f}s")

    except Exception as e:
        logger.error(f"Database error: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()
        logger.info("Database connection closed")


def postprocess_coastal_detection(terrain_data: List[Tuple[str, int, int, int]]) -> List[Tuple[str, int, int, int]]:
    """
    Post-procesa los datos de terreno para detectar Costa Inteligente.

    LÓGICA:
    - Identifica celdas clasificadas como Río (ID 4) o Agua (ID 3).
    - Para cada una, verifica si tiene al menos un vecino clasificado como Mar (ID 1).
    - Si es así, reclasifica la celda como Costa (ID 2).

    Args:
        terrain_data: Lista de tuplas (h3_index_hex_string, terrain_type_id, coord_x, coord_y)

    Returns:
        Lista actualizada de tuplas (h3_index_hex_string, terrain_type_id, coord_x, coord_y) con costas detectadas
    """
    logger.info("=" * 80)
    logger.info("FASE DE POST-PROCESAMIENTO: DETECCIÓN DE COSTA INTELIGENTE")
    logger.info("=" * 80)

    start_time = time.time()

    # Crear diccionarios para búsqueda rápida
    terrain_dict = {h3_hex: terrain_id for h3_hex, terrain_id, _, _ in terrain_data}
    coords_dict = {h3_hex: (cx, cy) for h3_hex, _, cx, cy in terrain_data}

    logger.info(f"Total de celdas a procesar: {len(terrain_data)}")

    # Identificar candidatos a costa: SOLO Agua (ID 3).
    # Los Ríos (ID 4) adyacentes al mar son desembocaduras y se gestionan
    # en postprocess_river_mouth — NO deben convertirse en Costa aquí.
    water_candidates = [
        h3_hex
        for h3_hex, terrain_id, _, _ in terrain_data
        if terrain_id == 3
    ]

    logger.info(f"Candidatos a costa (solo Agua ID=3, Rios excluidos): {len(water_candidates)} celdas")

    # Reclasificar celdas que tocan el mar
    reclassified_count = 0
    updated_terrain = {}  # {h3_hex: new_terrain_id}

    for h3_hex in water_candidates:
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
                updated_terrain[h3_hex] = 2  # Costa
                reclassified_count += 1

        except Exception as e:
            logger.warning(f"Error procesando vecinos de {h3_hex}: {e}")
            continue

    logger.info(f"Celdas reclasificadas como Costa (ID 2): {reclassified_count}")

    # Aplicar las reclasificaciones a terrain_data con coordenadas preservadas
    updated_terrain_data = []
    for h3_hex, terrain_id, coord_x, coord_y in terrain_data:
        if h3_hex in updated_terrain:
            updated_terrain_data.append((h3_hex, updated_terrain[h3_hex], coord_x, coord_y))
        else:
            updated_terrain_data.append((h3_hex, terrain_id, coord_x, coord_y))

    elapsed = time.time() - start_time
    logger.info(f"Post-procesamiento completado en {elapsed:.2f}s")
    logger.info("=" * 80)

    return updated_terrain_data


def fix_isolated_rivers(terrain_data: List[Tuple[str, int, int, int]]) -> List[Tuple[str, int, int, int]]:
    """
    Reclasifica rios (ID 4) aislados como pantanos (ID 5).

    Un rio se considera aislado si ninguno de sus 6 vecinos H3 inmediatos
    es tambien un rio. Estos rios sueltos son artefactos del proceso de
    extraccion y no representan cauces reales continuos.

    PROCESO:
    1. Construye un Set con todos los h3_index de tipo Rio (ID 4)
    2. Para cada celda de tipo Rio, comprueba si al menos un vecino
       (h3.grid_disk k=1, excluyendo el propio) esta en el set de rios
    3. Si ningun vecino es rio -> celda aislada -> reclasificar como Pantanos (ID 5)

    Args:
        terrain_data: Lista de tuplas (h3_index, terrain_type_id, coord_x, coord_y)

    Returns:
        Lista actualizada con rios aislados convertidos en pantanos
    """
    logger.info("=" * 80)
    logger.info("PASO 2.6: Reclasificacion de rios aislados como pantanos")
    logger.info("=" * 80)
    start_time = time.time()

    WATER_IDS = {1, 3, 4}  # Mar, Agua, Río

    # Sets de lookup
    river_set    = {h3_idx for h3_idx, terrain_id, _, _ in terrain_data if terrain_id == 4}
    terrain_dict = {h3_idx: terrain_id for h3_idx, terrain_id, _, _ in terrain_data}
    logger.info(f"Total celdas de tipo Rio (ID 4): {len(river_set)}")

    if not river_set:
        logger.info("No hay celdas de tipo Rio. Saltando paso.")
        return terrain_data

    isolated_rivers = set()  # Sin vecino río ni mar → pantano
    mouth_rivers    = set()  # Adyacente al mar con vecino río → proteger
    river_to_sea    = set()  # Rodeado SOLO de mar → mar
    river_to_coast  = set()  # Rodeado de mar + tierra → costa

    for h3_idx in river_set:
        try:
            neighbors         = set(h3.grid_disk(h3_idx, 1)) - {h3_idx}
            neighbor_terrains = [terrain_dict[n] for n in neighbors if n in terrain_dict]

            has_river_neighbor = any(n in river_set for n in neighbors)
            has_sea_neighbor   = any(t == 1 for t in neighbor_terrains)
            has_land_neighbor  = any(t not in WATER_IDS for t in neighbor_terrains)
            all_sea            = neighbor_terrains and all(t == 1 for t in neighbor_terrains)

            if has_river_neighbor:
                pass  # Parte de una cadena de río — no tocar
            elif all_sea:
                river_to_sea.add(h3_idx)          # Solo mar, sin río → mar
            elif has_sea_neighbor and has_land_neighbor:
                river_to_coast.add(h3_idx)        # Mar + tierra, sin río → costa
            elif has_sea_neighbor:
                mouth_rivers.add(h3_idx)          # Desembocadura aislada — proteger
            else:
                isolated_rivers.add(h3_idx)       # Aislado real — pantano
        except Exception as e:
            logger.warning(f"Error comprobando vecinos de {h3_idx}: {e}")
            continue

    logger.info(f"Rios aislados (sin vecino rio ni mar) → Pantano: {len(isolated_rivers)}")
    logger.info(f"Desembocaduras protegidas (rio junto al mar):     {len(mouth_rivers)}")
    logger.info(f"Rios rodeados solo de mar → Mar:                  {len(river_to_sea)}")
    logger.info(f"Rios entre mar y tierra → Costa:                  {len(river_to_coast)}")
    for idx in sorted(isolated_rivers):
        logger.info(f"  RIO_AISLADO -> PANTANO: {idx}")

    # Reclasificar
    updated_terrain_data = []
    for h3_idx, terrain_id, coord_x, coord_y in terrain_data:
        if h3_idx in river_to_sea:
            updated_terrain_data.append((h3_idx, 1, coord_x, coord_y))   # Mar
        elif h3_idx in river_to_coast:
            updated_terrain_data.append((h3_idx, 2, coord_x, coord_y))   # Costa
        elif h3_idx in isolated_rivers:
            updated_terrain_data.append((h3_idx, 5, coord_x, coord_y))   # Pantanos
        else:
            updated_terrain_data.append((h3_idx, terrain_id, coord_x, coord_y))

    elapsed = time.time() - start_time
    logger.info(f"Reclasificacion completada en {elapsed:.2f}s")
    logger.info("=" * 80)

    return updated_terrain_data


def postprocess_river_mouth(terrain_data: List[Tuple[str, int, int, int]]) -> List[Tuple[str, int, int, int]]:
    """
    Conecta los ríos con el mar creando celdas de desembocadura.

    LÓGICA:
    - Encuentra ríos "terminales": celdas de río con exactamente 1 vecino río
      (o 0, si son el único tramo) que estén a ≤2 celdas del mar.
    - Para cada uno, traza el camino mínimo hacia el mar (BFS sobre vecinos)
      y marca las celdas intermedias como Río (ID 4).
    - Las celdas de Costa (ID 2) intermedias en el trayecto también se
      reclasifican como Río para garantizar continuidad visual.

    IDs:  Mar=1, Costa=2, Río=4
    """
    logger.info("=" * 80)
    logger.info("PASO 2.7: Conexión de desembocaduras de ríos al mar")
    logger.info("=" * 80)
    start_time = time.time()

    terrain_dict  = {h3_hex: terrain_id for h3_hex, terrain_id, _, _ in terrain_data}
    coords_dict   = {h3_hex: (cx, cy)   for h3_hex, _, cx, cy in terrain_data}

    river_set = {h for h, t, _, _ in terrain_data if t == 4}
    sea_set   = {h for h, t, _, _ in terrain_data if t == 1}

    if not river_set or not sea_set:
        logger.info("Sin ríos o sin mar. Saltando paso.")
        return terrain_data

    # Identificar terminales de río: celdas de río con ≤1 vecino río
    terminals = set()
    for h3_idx in river_set:
        neighbors = set(h3.grid_disk(h3_idx, 1)) - {h3_idx}
        river_neighbors = [n for n in neighbors if n in river_set]
        if len(river_neighbors) <= 1:
            terminals.add(h3_idx)

    logger.info(f"Terminales de río detectados: {len(terminals)}")

    # Para cada terminal, BFS hasta encontrar el mar (máx k=2 pasos)
    new_river_cells = set()
    connected = 0

    for terminal in terminals:
        # BFS con profundidad máxima 2
        visited = {terminal}
        queue   = [(terminal, [])]  # (celda_actual, camino_recorrido)
        found   = False

        while queue and not found:
            current, path = queue.pop(0)
            neighbors = set(h3.grid_disk(current, 1)) - {current}

            for nb in neighbors:
                if nb in visited:
                    continue
                visited.add(nb)

                nb_terrain = terrain_dict.get(nb)

                if nb_terrain == 1:  # Tocamos el mar
                    # Marcar todas las celdas del camino como río
                    for step in path + [current]:
                        if terrain_dict.get(step) != 4:
                            new_river_cells.add(step)
                    found = True
                    connected += 1
                    break

                # Continuar BFS solo si no hemos superado profundidad 2
                if len(path) < 2 and nb_terrain in (2, 4, None):
                    queue.append((nb, path + [current]))

    logger.info(f"Ríos extendidos al mar: {connected} (nuevas celdas río: {len(new_river_cells)})")

    # Aplicar nuevas celdas de río
    updated_terrain_data = []
    for h3_hex, terrain_id, coord_x, coord_y in terrain_data:
        if h3_hex in new_river_cells:
            updated_terrain_data.append((h3_hex, 4, coord_x, coord_y))
        else:
            updated_terrain_data.append((h3_hex, terrain_id, coord_x, coord_y))

    elapsed = time.time() - start_time
    logger.info(f"Desembocaduras procesadas en {elapsed:.2f}s")
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
        # Step 1: Generate H3 cells for target region with cartesian coordinates
        h3_cells, h3_coords = generate_h3_cells()

        # Step 2: Extract terrain data from raster (creates VRT automatically)
        terrain_data = extract_terrain_from_raster(str(raster_dir), h3_cells, h3_coords)

        # Step 2.5: Post-procesamiento - Detección de Costa Inteligente
        # (solo convierte Agua ID=3; los Ríos ID=4 se gestionan en 2.7)
        terrain_data = postprocess_coastal_detection(terrain_data)

        # Step 2.6: Reclasificar rios aislados (sin vecinos rio ni mar) como pantanos
        # Las desembocaduras (rio junto al mar) quedan protegidas
        terrain_data = fix_isolated_rivers(terrain_data)

        # Step 2.7: Conectar desembocaduras de rios al mar (extiende ≤2 celdas)
        terrain_data = postprocess_river_mouth(terrain_data)

        # Step 3: Insert data into database (includes coord_x, coord_y)
        insert_terrain_data_batch(DB_CONFIG, terrain_data)

        logger.info("=" * 60)
        logger.info("Terrain Extraction Process Completed Successfully")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
