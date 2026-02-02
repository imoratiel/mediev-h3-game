#!/usr/bin/env python3
"""
Historical Infrastructure Setup Tool
Processes Roman roads and medieval settlements for H3 mapping.

USAGE:
    python setup_history.py

FEATURES:
    - Auto-generates settlements.csv if not found (20 historical cities)
    - Downloads Roman roads from Overpass API if shapefile not available
    - Updates h3_map.has_road for hexagons containing roads
    - Populates settlements table with historical cities

REQUIREMENTS:
    - PostgreSQL database configured in config.py
    - Internet connection (for Overpass API if needed)
"""

import logging
import sys
import time
import csv
import requests
import json
from pathlib import Path
from typing import Set, List, Tuple, Optional
import h3
import geopandas as gpd
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from shapely.geometry import LineString, MultiLineString, box

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('history_setup.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# Directories
BASE_DATA_DIR = Path(__file__).parent.parent.parent.resolve() / 'data'
VECTORS_DIR = BASE_DATA_DIR / 'vectors'

# Import DB config
try:
    from config import DB_CONFIG, BOUNDING_BOX
    logger.info("Loaded configuration from config.py")
except ImportError as e:
    logger.error("config.py not found. Please copy config.example.py to config.py")
    sys.exit(1)


def generate_settlements_csv(csv_path: Path) -> bool:
    """
    Genera automáticamente un CSV con las 20 ciudades históricas más importantes
    de Galicia, Asturias y León (nombres medievales/romanos con coordenadas precisas).

    Args:
        csv_path: Ruta donde guardar el CSV

    Returns:
        True si se generó exitosamente, False en caso contrario
    """
    logger.info(f"Generando CSV de asentamientos históricos en: {csv_path}")

    # Dataset semilla: 20 ciudades históricas con coordenadas precisas
    # IMPORTANTE: population_rank está en escala 1-10 (1=más importante, 10=menos importante)
    settlements_data = [
        # Reino de León y Castilla (Rango 1-3: Capitales principales)
        ("Legio VII Gemina (León)", 42.5987, -5.5671, "city", 1, "roman"),
        ("Asturica Augusta (Astorga)", 42.4570, -6.0536, "city", 2, "roman"),
        ("Lucus Augusti (Lugo)", 43.0097, -7.5567, "city", 2, "roman"),
        ("Bracara Augusta (Braga)", 41.5454, -8.4265, "city", 2, "roman"),
        ("Ovetum (Oviedo)", 43.3614, -5.8493, "city", 1, "medieval"),

        # Ciudades medievales importantes (Rango 3-5: Centros regionales)
        ("Compostela (Santiago)", 42.8805, -8.5457, "city", 1, "medieval"),
        ("Castrvm Legionense (Castrojeriz)", 42.2894, -4.1410, "town", 6, "medieval"),
        ("Sahagún", 42.3714, -5.0299, "monastery", 4, "medieval"),
        ("Carrión de los Condes", 42.3376, -4.6037, "town", 5, "medieval"),
        ("Ponferrada", 42.5450, -6.5983, "fort", 5, "medieval"),

        # Galicia histórica (Rango 4-7: Centros secundarios)
        ("Iria Flavia (Padrón)", 42.7387, -8.6596, "town", 4, "roman"),
        ("Betanzos", 43.2800, -8.2143, "town", 6, "medieval"),
        ("A Coruña", 43.3623, -8.4115, "city", 3, "medieval"),
        ("Ferrol", 43.4833, -8.2333, "fort", 7, "medieval"),
        ("Tui", 42.0481, -8.6447, "town", 5, "medieval"),

        # Asturias y Cantabria (Rango 3-8: Ciudades costeras y pueblos)
        ("Gijón", 43.5322, -5.6611, "city", 3, "roman"),
        ("Avilés", 43.5564, -5.9249, "town", 6, "medieval"),
        ("Cangas de Onís", 43.3506, -5.1276, "village", 8, "medieval"),
        ("Santander", 43.4623, -3.8100, "city", 4, "medieval"),
        ("Burgos", 42.3439, -3.6969, "city", 2, "medieval"),
    ]

    try:
        # Crear directorio si no existe
        csv_path.parent.mkdir(parents=True, exist_ok=True)

        # Escribir CSV
        with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            # Header
            writer.writerow(['name', 'lat', 'lng', 'type', 'population_rank', 'period'])
            # Data
            writer.writerows(settlements_data)

        logger.info(f"CSV generado exitosamente con {len(settlements_data)} asentamientos históricos")
        return True

    except Exception as e:
        logger.error(f"Error generando CSV de asentamientos: {e}", exc_info=True)
        return False


def download_roman_roads_from_overpass(
    bbox: dict,
    output_shapefile: Path
) -> bool:
    """
    Descarga vías romanas y caminos históricos desde Overpass API (OpenStreetMap).
    Filtra por 'historic=roman_road' y 'highway=path' con nombre histórico.
    ROBUSTEZ: Reintenta hasta 3 veces con delays progresivos antes de usar fallback.

    Args:
        bbox: Bounding box {'min_lat', 'max_lat', 'min_lng', 'max_lng'}
        output_shapefile: Ruta donde guardar el shapefile resultante

    Returns:
        True si se descargó exitosamente, False en caso contrario
    """
    logger.info("Descargando vías romanas desde Overpass API (OpenStreetMap)...")

    # Overpass API endpoint
    overpass_url = "http://overpass-api.de/api/interpreter"

    # Overpass QL query para vías romanas e históricas
    # Busca: historic=roman_road, highway=path con nombre romano/histórico
    query = f"""
    [out:json][timeout:90];
    (
      way["historic"="roman_road"]({bbox['min_lat']},{bbox['min_lng']},{bbox['max_lat']},{bbox['max_lng']});
      way["historic"="road"]["name"~"Via|Vía|Calzada"]({bbox['min_lat']},{bbox['min_lng']},{bbox['max_lat']},{bbox['max_lng']});
      way["highway"~"path|track"]["name"~"Via|Vía|Calzada|Romano"]({bbox['min_lat']},{bbox['min_lng']},{bbox['max_lat']},{bbox['max_lng']});
    );
    out geom;
    """

    # RETRY LOGIC: Intentar hasta 3 veces con delays progresivos
    max_retries = 3
    retry_delays = [5, 10, 20]  # segundos

    for attempt in range(max_retries):
        try:
            logger.info(f"Intento {attempt + 1}/{max_retries} - Consultando Overpass API para bounding box: {bbox}")
            response = requests.post(overpass_url, data={'data': query}, timeout=150)

            if response.status_code == 504:
                logger.warning(f"Overpass API retornó 504 Gateway Timeout (intento {attempt + 1}/{max_retries})")
                if attempt < max_retries - 1:
                    delay = retry_delays[attempt]
                    logger.info(f"Reintentando en {delay} segundos...")
                    time.sleep(delay)
                    continue
                else:
                    logger.error("Agotados todos los intentos con Overpass API")
                    return generate_demo_roads(output_shapefile, bbox)

            if response.status_code != 200:
                logger.error(f"Overpass API retornó código {response.status_code}")
                if attempt < max_retries - 1:
                    delay = retry_delays[attempt]
                    logger.info(f"Reintentando en {delay} segundos...")
                    time.sleep(delay)
                    continue
                else:
                    return generate_demo_roads(output_shapefile, bbox)

            data = response.json()

            if not data.get('elements'):
                logger.warning("Overpass API no encontró vías romanas en la región especificada")
                logger.info("Generando geometrías de demostración conectando ciudades históricas...")
                return generate_demo_roads(output_shapefile, bbox)

            logger.info(f"Overpass API retornó {len(data['elements'])} elementos")

            # Convertir elementos de Overpass a geometrías Shapely
            geometries = []
            properties = []

            for element in data['elements']:
                if element['type'] == 'way' and 'geometry' in element:
                    coords = [(node['lon'], node['lat']) for node in element['geometry']]
                    if len(coords) >= 2:
                        line = LineString(coords)
                        geometries.append(line)
                        properties.append({
                            'osm_id': element.get('id'),
                            'name': element.get('tags', {}).get('name', 'Via Romana'),
                            'historic': element.get('tags', {}).get('historic', 'roman_road')
                        })

            if not geometries:
                logger.warning("No se pudieron extraer geometrías válidas")
                return generate_demo_roads(output_shapefile, bbox)

            # Crear GeoDataFrame
            gdf = gpd.GeoDataFrame(properties, geometry=geometries, crs='EPSG:4326')

            # Guardar shapefile
            output_shapefile.parent.mkdir(parents=True, exist_ok=True)
            gdf.to_file(str(output_shapefile), driver='ESRI Shapefile')

            logger.info(f"Shapefile de vías romanas guardado: {output_shapefile}")
            logger.info(f"Total de vías descargadas: {len(geometries)}")

            return True

        except requests.exceptions.Timeout:
            logger.warning(f"Timeout consultando Overpass API (>150s, intento {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                delay = retry_delays[attempt]
                logger.info(f"Reintentando en {delay} segundos...")
                time.sleep(delay)
                continue
            else:
                logger.error("Agotados todos los intentos - Timeout persistente")
                return generate_demo_roads(output_shapefile, bbox)

        except Exception as e:
            logger.warning(f"Error en intento {attempt + 1}/{max_retries}: {e}")
            if attempt < max_retries - 1:
                delay = retry_delays[attempt]
                logger.info(f"Reintentando en {delay} segundos...")
                time.sleep(delay)
                continue
            else:
                logger.error(f"Error descargando desde Overpass API después de {max_retries} intentos: {e}", exc_info=True)
                return generate_demo_roads(output_shapefile, bbox)

    # Si llegamos aquí, todos los intentos fallaron
    return generate_demo_roads(output_shapefile, bbox)


def generate_demo_roads(output_shapefile: Path, bbox: dict) -> bool:
    """
    Genera geometrías de demostración de vías romanas principales en el NO de España.
    Usa la Via XIX (Asturica-Bracara) y Via XX (Asturica-Tarraco) aproximadas.

    Args:
        output_shapefile: Ruta donde guardar el shapefile
        bbox: Bounding box para filtrar

    Returns:
        True si se generó exitosamente
    """
    logger.info("Generando geometrías de demostración de vías romanas...")

    # Vías romanas principales del Noroeste (simplificadas)
    roads = [
        {
            'name': 'Via XIX (Asturica-Bracara Augusta)',
            'coords': [
                (-6.05, 42.46),  # Astorga
                (-6.35, 42.35),  # Bembibre
                (-6.60, 42.55),  # Ponferrada
                (-6.75, 42.43),  # Villafranca del Bierzo
                (-7.05, 42.40),  # O Barco de Valdeorras
                (-7.56, 43.01),  # Lugo
                (-7.86, 42.88),  # Sarria
                (-8.20, 42.68),  # Portomarín
                (-8.43, 41.55),  # Braga
            ]
        },
        {
            'name': 'Via XX (Asturica-Tarraco)',
            'coords': [
                (-6.05, 42.46),  # Astorga
                (-5.57, 42.60),  # León
                (-5.03, 42.37),  # Sahagún
                (-4.60, 42.34),  # Carrión de los Condes
                (-4.14, 42.29),  # Castrojeriz
                (-3.70, 42.34),  # Burgos
            ]
        },
        {
            'name': 'Camino de Santiago (Ruta Francesa)',
            'coords': [
                (-6.60, 42.55),  # Ponferrada
                (-6.05, 42.46),  # Astorga
                (-5.57, 42.60),  # León
                (-5.03, 42.37),  # Sahagún
                (-4.60, 42.34),  # Carrión
                (-3.70, 42.34),  # Burgos
            ]
        },
        {
            'name': 'Via de la Plata (Asturica-Emerita)',
            'coords': [
                (-6.05, 42.46),  # Astorga
                (-5.93, 42.01),  # Benavente
                (-5.66, 41.65),  # Zamora
                (-5.66, 40.97),  # Salamanca
            ]
        },
    ]

    try:
        geometries = []
        properties = []

        for road in roads:
            # Convertir coordenadas (lng, lat) a LineString
            line = LineString(road['coords'])

            # Filtrar si intersecta con bbox
            if (bbox['min_lng'] <= line.bounds[0] <= bbox['max_lng'] or
                bbox['min_lng'] <= line.bounds[2] <= bbox['max_lng']):
                geometries.append(line)
                properties.append({
                    'osm_id': 0,
                    'name': road['name'],
                    'historic': 'roman_road'
                })

        if not geometries:
            logger.warning("Ninguna vía de demostración intersecta con el bounding box")
            return False

        # Crear GeoDataFrame
        gdf = gpd.GeoDataFrame(properties, geometry=geometries, crs='EPSG:4326')

        # Guardar shapefile
        output_shapefile.parent.mkdir(parents=True, exist_ok=True)
        gdf.to_file(str(output_shapefile), driver='ESRI Shapefile')

        logger.info(f"Shapefile de demostración guardado: {output_shapefile}")
        logger.info(f"Total de vías de demostración: {len(geometries)}")

        return True

    except Exception as e:
        logger.error(f"Error generando vías de demostración: {e}", exc_info=True)
        return False


def get_road_h3_set_multiresolution(
    shapefile_path: Path,
    h3_resolutions: List[int] = [8, 10]
) -> dict:
    """
    Carga vías romanas y genera SETs de índices H3 para múltiples resoluciones.
    Usa buffers adaptativos según resolución:
    - Res 8: Buffer 800m (hexágonos grandes ~0.7 km²)
    - Res 10: Buffer 150m (hexágonos pequeños ~0.015 km²)

    Args:
        shapefile_path: Ruta al shapefile de vías romanas (DARE)
        h3_resolutions: Lista de resoluciones H3 a generar (default: [8, 10])

    Returns:
        Dict {resolution: set_of_h3_indices}
    """
    logger.info(f"Procesando vías romanas: {shapefile_path.absolute()}")

    if not shapefile_path.exists():
        logger.error(f"Shapefile NO ENCONTRADO: {shapefile_path.absolute()}")
        logger.error("Descarga el dataset DARE de vías romanas:")
        logger.error("  https://dh.gu.se/dare/")
        return {res: set() for res in h3_resolutions}

    try:
        start_time = time.time()

        # Cargar shapefile
        gdf = gpd.read_file(str(shapefile_path))

        # Reproyectar a WGS84 si es necesario
        if gdf.crs != 'EPSG:4326':
            gdf = gdf.to_crs('EPSG:4326')

        # Filtrar geometrías inválidas
        gdf = gdf[gdf.geometry.is_valid]

        # Filtrar por bounding box si está configurado
        if BOUNDING_BOX:
            bbox_poly = box(
                BOUNDING_BOX['min_lng'], BOUNDING_BOX['min_lat'],
                BOUNDING_BOX['max_lng'], BOUNDING_BOX['max_lat']
            )
            gdf = gdf[gdf.geometry.intersects(bbox_poly)]

        logger.info(f"Vías romanas en región: {len(gdf)} segmentos")

        # Procesar cada resolución con buffer adaptativo
        road_h3_sets = {}

        for h3_res in h3_resolutions:
            # Buffer adaptativo según resolución
            buffer_meters = 800 if h3_res == 8 else 150

            logger.info(f"\nProcesando Resolución H3 {h3_res} (buffer: {buffer_meters}m)...")

            # Reproyectar a métrico para buffer
            gdf_metric = gdf.to_crs('EPSG:3857')
            gdf_buffered = gdf_metric.buffer(buffer_meters)
            gdf_buffered_wgs84 = gdf_buffered.to_crs('EPSG:4326')

            # Convertir a celdas H3
            road_h3_set = set()
            error_count = 0

            for idx, road_geom in enumerate(gdf_buffered_wgs84):
                if road_geom is None or not road_geom.is_valid:
                    error_count += 1
                    continue

                try:
                    # H3 v4 API: Extraer coordenadas e invertir (lng,lat) -> (lat,lng)
                    coords = list(road_geom.exterior.coords)
                    latlng_coords = [(lat, lng) for lng, lat in coords]

                    # Crear objeto H3 LatLngPoly y obtener celdas
                    h3_poly = h3.LatLngPoly(latlng_coords)
                    h3_cells = h3.polygon_to_cells(h3_poly, h3_res)
                    road_h3_set.update(h3_cells)

                    if (idx + 1) % 500 == 0:
                        logger.info(f"  Procesados {idx + 1}/{len(gdf_buffered_wgs84)} -> {len(road_h3_set):,} celdas H3")

                except Exception as e:
                    if error_count == 0:
                        logger.warning(f"Error convirtiendo camino a H3: {e}")
                    error_count += 1
                    continue

            road_h3_sets[h3_res] = road_h3_set

            elapsed = time.time() - start_time
            logger.info(f"Resolución {h3_res} completada: {len(road_h3_set):,} celdas H3 en {elapsed:.2f}s")

            if error_count > 0:
                logger.warning(f"  {error_count} polígonos ignorados por errores")

        # Liberar memoria
        del gdf, gdf_metric, gdf_buffered, gdf_buffered_wgs84
        import gc
        gc.collect()

        total_elapsed = time.time() - start_time
        logger.info(f"\nProcesamiento completo en {total_elapsed:.2f}s")
        for res, h3_set in road_h3_sets.items():
            logger.info(f"  Res {res}: {len(h3_set):,} celdas con caminos")

        return road_h3_sets

    except Exception as e:
        logger.error(f"Error procesando vías romanas: {e}", exc_info=True)
        return {res: set() for res in h3_resolutions}


def load_settlements_from_csv(csv_path: Path) -> List[Tuple]:
    """
    Carga asentamientos históricos desde CSV y los mapea a índices H3.

    CSV Format (columns):
        name, lat, lng, type, population_rank, period

    Args:
        csv_path: Ruta al CSV de asentamientos

    Returns:
        Lista de tuplas (h3_index_bigint, name, type, pop_rank, period)
    """
    logger.info(f"Cargando asentamientos desde: {csv_path.absolute()}")

    if not csv_path.exists():
        logger.warning(f"CSV NO ENCONTRADO: {csv_path.absolute()}")
        logger.warning("Crea un archivo CSV con columnas: name, lat, lng, type, population_rank, period")
        return []

    try:
        df = pd.read_csv(csv_path)

        required_cols = ['name', 'lat', 'lng', 'type', 'population_rank', 'period']
        if not all(col in df.columns for col in required_cols):
            logger.error(f"CSV debe contener columnas: {required_cols}")
            return []

        settlements = []

        for idx, row in df.iterrows():
            try:
                # Convertir coordenadas geográficas a índice H3 (resolución 8)
                h3_index = h3.latlng_to_cell(row['lat'], row['lng'], 8)
                h3_int = int(h3_index, 16)

                settlements.append((
                    h3_int,
                    row['name'],
                    row['type'],
                    int(row['population_rank']),
                    row['period']
                ))

            except Exception as e:
                logger.warning(f"Error procesando asentamiento {row['name']}: {e}")
                continue

        logger.info(f"Cargados {len(settlements)} asentamientos históricos")
        return settlements

    except Exception as e:
        logger.error(f"Error cargando CSV: {e}", exc_info=True)
        return []


def update_database_with_roads(road_h3_set: Set[str], resolution: int = 8):
    """
    Actualiza la columna has_road en h3_map para hexágonos con caminos.

    Args:
        road_h3_set: Set de índices H3 (strings) con caminos
        resolution: Resolución H3 (default: 8)
    """
    logger.info(f"\nActualizando base de datos con {len(road_h3_set):,} hexágonos con caminos (res {resolution})...")

    if not road_h3_set:
        logger.warning("No hay datos de caminos para actualizar")
        return

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # Convertir índices H3 de hex string a bigint
        h3_bigints = [int(h3_hex, 16) for h3_hex in road_h3_set]

        # Actualizar has_road = TRUE para hexágonos con caminos
        update_query = """
            UPDATE h3_map
            SET has_road = TRUE
            WHERE h3_index = ANY(%s::bigint[])
        """

        cursor.execute(update_query, (h3_bigints,))
        updated_count = cursor.rowcount

        conn.commit()

        logger.info(f"Actualizados {updated_count:,} hexágonos con has_road = TRUE")

        # Verificar resultados
        cursor.execute("SELECT COUNT(*) FROM h3_map WHERE has_road = TRUE")
        total_with_roads = cursor.fetchone()[0]
        logger.info(f"Total de hexágonos con caminos en DB: {total_with_roads:,}")

        cursor.close()
        conn.close()

    except Exception as e:
        logger.error(f"Error actualizando base de datos: {e}", exc_info=True)


def insert_settlements(settlements: List[Tuple]):
    """
    Inserta asentamientos históricos en la tabla settlements.

    Args:
        settlements: Lista de tuplas (h3_index_bigint, name, type, pop_rank, period)
    """
    logger.info(f"\nInsertando {len(settlements)} asentamientos en la base de datos...")

    if not settlements:
        logger.warning("No hay asentamientos para insertar")
        return

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # Limpiar tabla settlements antes de insertar (opcional, comentar si quieres acumular)
        cursor.execute("TRUNCATE TABLE settlements CASCADE;")
        logger.info("Tabla settlements limpiada")

        # Verificar que hexágonos existen en h3_map (para evitar violacion de FK)
        logger.info("Verificando hexágonos existentes en h3_map...")
        h3_indices = [s[0] for s in settlements]
        cursor.execute("SELECT h3_index FROM h3_map WHERE h3_index = ANY(%s::bigint[])", (h3_indices,))
        existing_h3_indices = set(row[0] for row in cursor.fetchall())

        # Filtrar settlements a solo los que tienen hexágonos en h3_map
        valid_settlements = [s for s in settlements if s[0] in existing_h3_indices]
        skipped_count = len(settlements) - len(valid_settlements)

        if skipped_count > 0:
            logger.warning(f"Omitidos {skipped_count} asentamientos (hexágonos no existen en h3_map)")
            logger.warning("Ejecuta el extractor primero para generar el mapa base")

        if not valid_settlements:
            logger.warning("No hay asentamientos válidos para insertar")
            cursor.close()
            conn.close()
            return

        # Insertar asentamientos válidos
        # CORRECCION: ON CONFLICT solo con h3_index (matching UNIQUE constraint)
        insert_query = """
            INSERT INTO settlements (h3_index, name, settlement_type, population_rank, period)
            VALUES %s
            ON CONFLICT (h3_index)
            DO UPDATE SET
                name = EXCLUDED.name,
                settlement_type = EXCLUDED.settlement_type,
                population_rank = EXCLUDED.population_rank,
                period = EXCLUDED.period
        """

        execute_values(cursor, insert_query, valid_settlements)
        inserted_count = cursor.rowcount

        conn.commit()

        logger.info(f"Asentamientos historicos inyectados: {inserted_count}")

        # Verificar resultados por tipo
        cursor.execute("""
            SELECT settlement_type, COUNT(*) as count
            FROM settlements
            GROUP BY settlement_type
            ORDER BY count DESC
        """)
        results = cursor.fetchall()
        logger.info("Distribución de asentamientos por tipo:")
        for settlement_type, count in results:
            logger.info(f"  {settlement_type}: {count}")

        # Verificar resultados por periodo
        cursor.execute("""
            SELECT period, COUNT(*) as count
            FROM settlements
            GROUP BY period
            ORDER BY count DESC
        """)
        results = cursor.fetchall()
        logger.info("Distribución de asentamientos por periodo:")
        for period, count in results:
            logger.info(f"  {period}: {count}")

        cursor.close()
        conn.close()

    except Exception as e:
        logger.error(f"Error insertando asentamientos: {e}", exc_info=True)


def main():
    """
    Proceso principal: Procesa vías romanas y asentamientos históricos.
    Auto-genera archivos faltantes (settlements.csv y roman_roads.shp).
    """
    logger.info("=" * 60)
    logger.info("SETUP DE INFRAESTRUCTURA HISTÓRICA")
    logger.info("=" * 60)

    # 1. Verificar y generar settlements.csv si no existe
    settlements_path = VECTORS_DIR / 'settlements.csv'

    if not settlements_path.exists():
        logger.info("\nArchivo 'settlements.csv' no encontrado")
        logger.info("Generando dataset semilla de 20 ciudades históricas...")

        if not generate_settlements_csv(settlements_path):
            logger.error("FALLO al generar settlements.csv")
            settlements = []
        else:
            logger.info("settlements.csv generado exitosamente")
            settlements = load_settlements_from_csv(settlements_path)
    else:
        logger.info(f"\nCargando settlements.csv existente: {settlements_path.absolute()}")
        settlements = load_settlements_from_csv(settlements_path)

    # 2. Verificar y descargar/generar roman_roads.shp si no existe
    roman_roads_path = VECTORS_DIR / 'roman_roads.shp'

    if not roman_roads_path.exists():
        logger.info("\nArchivo 'roman_roads.shp' no encontrado")
        logger.info("Intentando descargar vías romanas desde Overpass API (OpenStreetMap)...")

        if not download_roman_roads_from_overpass(BOUNDING_BOX, roman_roads_path):
            logger.error("FALLO al descargar/generar roman_roads.shp")
            logger.warning("No se procesarán caminos en esta ejecución")
            road_h3_sets = {8: set(), 10: set()}
        else:
            logger.info("roman_roads.shp generado exitosamente")
            road_h3_sets = get_road_h3_set_multiresolution(roman_roads_path, [8, 10])
    else:
        logger.info(f"\nCargando roman_roads.shp existente: {roman_roads_path.absolute()}")
        road_h3_sets = get_road_h3_set_multiresolution(roman_roads_path, [8, 10])

    # 3. Actualizar base de datos con caminos (resolución 8 base)
    if road_h3_sets[8]:
        update_database_with_roads(road_h3_sets[8], resolution=8)
    else:
        logger.warning("No se actualizaron caminos en la base de datos (set vacío)")

    # 4. Insertar asentamientos históricos
    if settlements:
        insert_settlements(settlements)
    else:
        logger.warning("No se insertaron asentamientos en la base de datos (lista vacía)")

    # 5. Resumen final
    logger.info("\n" + "=" * 60)
    logger.info("SETUP COMPLETADO")
    logger.info("=" * 60)
    logger.info(f"Caminos procesados (res 8): {len(road_h3_sets[8]):,} hexágonos")
    logger.info(f"Caminos procesados (res 10): {len(road_h3_sets[10]):,} hexágonos")
    logger.info(f"Asentamientos insertados: {len(settlements)}")

    # Validación de resultados
    if len(road_h3_sets[8]) == 0:
        logger.warning("ADVERTENCIA: No se procesaron caminos (verifica el shapefile)")
    if len(settlements) == 0:
        logger.warning("ADVERTENCIA: No se insertaron asentamientos (verifica el CSV)")


if __name__ == "__main__":
    main()
