#!/usr/bin/env python3
"""
gen_tiles.py — Genera tiles XYZ PNG desde celdas H3 con datos de terreno.

Área de prueba: Islas Baleares
  bbox: lat [38.5, 40.1], lon [1.0, 4.5]
  zoom: 6–9

Uso:
  pip install psycopg2-binary h3 Pillow python-dotenv
  python tools/gen_tiles.py

Los tiles se guardan en server/tiles/{z}/{x}/{y}.png
"""

import os
import math
import time
from pathlib import Path

import psycopg2
import h3
from PIL import Image, ImageDraw
from dotenv import dotenv_values

# ── Configuración ───────────────────────────────────────────────────────────

# Bounding box: Islas Baleares
BBOX = {
    'min_lat': 38.5,
    'max_lat': 40.1,
    'min_lon': 1.0,
    'max_lon': 4.5,
}

ZOOM_LEVELS = [6, 7, 8, 9]
TILE_SIZE   = 256

# Directorio de salida — relativo a la raíz del proyecto
OUTPUT_DIR = Path(__file__).parent.parent.parent / 'server' / 'tiles'

# Fallback de colores por nombre de terreno (deben coincidir con terrain_types en BD)
TERRAIN_COLORS_FALLBACK = {
    'Mar':      '#1a6fa3',
    'Costa':    '#e8d5a0',
    'Llanura':  '#8fbb6b',
    'Rio':      '#4fc3f7',
    'Pantano':  '#789fa8',
    'Bosque':   '#3a7d44',
    'Colinas':  '#b09070',
    'Montana':  '#888888',
}

# ── Utilidades de proyección Web Mercator ────────────────────────────────────

def lat_lon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Lat/lon → coordenadas de tile (x, y) en zoom dado."""
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def tile_bounds(tx: int, ty: int, zoom: int) -> tuple[float, float, float, float]:
    """Devuelve (min_lat, min_lon, max_lat, max_lon) del tile."""
    n = 2 ** zoom

    def y_to_lat(y_frac: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y_frac / n))))

    min_lon = tx / n * 360 - 180
    max_lon = (tx + 1) / n * 360 - 180
    max_lat = y_to_lat(ty)
    min_lat = y_to_lat(ty + 1)
    return min_lat, min_lon, max_lat, max_lon


def merc(lat: float) -> float:
    """Valor Mercator para una latitud."""
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_lon_to_px(
    lat: float, lon: float,
    min_lat: float, min_lon: float,
    max_lat: float, max_lon: float,
    size: int,
) -> tuple[int, int]:
    """Proyecta lat/lon a píxel (Web Mercator) dentro del tile."""
    m_min = merc(min_lat)
    m_max = merc(max_lat)
    m_val = merc(lat)
    px = int((lon - min_lon) / (max_lon - min_lon) * size)
    py = int((m_max - m_val) / (m_max - m_min) * size)
    return px, py


def hex_to_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip('#')
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)

# ── Renderizado ──────────────────────────────────────────────────────────────

def render_tile(cells: list[dict], zoom: int, tx: int, ty: int) -> bool:
    """
    Renderiza un tile PNG. Devuelve True si se dibujó algo.
    cells: lista de {'h3_index': str, 'color': str}
    """
    min_lat, min_lon, max_lat, max_lon = tile_bounds(tx, ty, zoom)
    padding = 0.05  # margen para celdas en el borde

    img  = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    drawn = 0

    for cell in cells:
        boundary = h3.h3_to_geo_boundary(cell['h3_index'])  # [(lat, lon), ...]

        # Filtro rápido: ¿algún vértice cerca del tile?
        if not any(
            (min_lat - padding) <= lat <= (max_lat + padding) and
            (min_lon - padding) <= lon <= (max_lon + padding)
            for lat, lon in boundary
        ):
            continue

        pixels = [
            lat_lon_to_px(lat, lon, min_lat, min_lon, max_lat, max_lon, TILE_SIZE)
            for lat, lon in boundary
        ]

        r, g, b = hex_to_rgb(cell['color'])
        draw.polygon(pixels, fill=(r, g, b, 220), outline=(r, g, b, 160))
        drawn += 1

    if drawn == 0:
        return False

    tile_path = OUTPUT_DIR / str(zoom) / str(tx) / f'{ty}.png'
    tile_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(tile_path, 'PNG')
    return True


def generate_tiles(cells: list[dict]) -> None:
    total_tiles = 0
    total_drawn = 0

    for zoom in ZOOM_LEVELS:
        x_min, y_max = lat_lon_to_tile(BBOX['min_lat'], BBOX['min_lon'], zoom)
        x_max, y_min = lat_lon_to_tile(BBOX['max_lat'], BBOX['max_lon'], zoom)

        count = (x_max - x_min + 1) * (y_max - y_min + 1)
        print(f'  zoom {zoom}: {count} tiles  (x {x_min}–{x_max}, y {y_min}–{y_max})')
        t0 = time.time()

        for tx in range(x_min, x_max + 1):
            for ty in range(y_min, y_max + 1):
                drawn = render_tile(cells, zoom, tx, ty)
                total_tiles += 1
                if drawn:
                    total_drawn += 1

        print(f'         ✓ {time.time() - t0:.1f}s — {total_drawn} tiles con contenido')

    print(f'\n✅ Total: {total_drawn}/{total_tiles} tiles generados en {OUTPUT_DIR}')

# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    # Cargar credenciales desde .env (raíz del proyecto)
    env_path = Path(__file__).parent.parent.parent / '.env'
    env = dotenv_values(env_path)

    # Desde fuera de Docker siempre conectar a localhost:5444
    # (DB_HOST=db y DB_PORT=5432 son nombres internos de Docker)
    print('Conectando a la base de datos (localhost:5444)...')
    conn = psycopg2.connect(
        host='localhost',
        port=5444,
        dbname=env.get('DB_NAME'),
        user=env.get('DB_USER'),
        password=env.get('DB_PASSWORD'),
    )

    # Generar todas las celdas H3 res-7 dentro del bbox usando H3
    print(f'Calculando celdas H3 en bbox {BBOX}...')
    bbox_cells = list(h3.polyfill_geojson({
        'type': 'Polygon',
        'coordinates': [[
            [BBOX['min_lon'], BBOX['max_lat']],
            [BBOX['max_lon'], BBOX['max_lat']],
            [BBOX['max_lon'], BBOX['min_lat']],
            [BBOX['min_lon'], BBOX['min_lat']],
            [BBOX['min_lon'], BBOX['max_lat']],
        ]]
    }, 7))
    print(f'Celdas H3 en el bbox: {len(bbox_cells)}')

    if not bbox_cells:
        print('⚠️  El bbox no contiene celdas H3. Revisa las coordenadas.')
        conn.close()
        return

    # Consultar solo las celdas que existen en la BD
    print('Consultando terreno en la BD...')
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.h3_index, t.name AS terrain_name, t.color AS terrain_color
            FROM h3_map m
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            WHERE m.h3_index = ANY(%s)
        """, (bbox_cells,))
        rows = cur.fetchall()
    conn.close()
    print(f'Celdas con datos en BD: {len(rows)} de {len(bbox_cells)} posibles')

    cells = [
        {
            'h3_index': h3_index,
            'color': terrain_color or TERRAIN_COLORS_FALLBACK.get(terrain_name, '#9e9e9e'),
        }
        for h3_index, terrain_name, terrain_color in rows
    ]

    print(f'Celdas encontradas: {len(cells)}')
    if not cells:
        print('⚠️  No se encontraron celdas. Verifica el bbox y la conexión a BD.')
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Generando tiles en {OUTPUT_DIR} ...\n')
    generate_tiles(cells)


if __name__ == '__main__':
    main()
