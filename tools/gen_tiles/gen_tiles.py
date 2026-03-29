#!/usr/bin/env python3
"""
gen_tiles.py — Genera tiles XYZ PNG con estilo de mapa ilustrado/de fantasía.

Terreno relleno sin bordes de rejilla. El mar parece mar. Símbolos cartográficos
en zoom 8-9 (montañas, bosques, olas).

Área: Galicia — bbox lat [41.8, 43.8], lon [-9.3, -6.7], zoom 6–9

Uso:
  pip install h3 Pillow psycopg2-binary python-dotenv
  python tools/gen_tiles/gen_tiles.py
"""

import argparse
import math
import time
from pathlib import Path

import psycopg2
import h3
from PIL import Image, ImageDraw
from dotenv import dotenv_values

# ── Compatibilidad h3 v3 / v4 ────────────────────────────────────────────────
if not hasattr(h3, 'geo_to_cells'):
    # h3 v3 → alias a nombres de v4 que usa este script
    h3.geo_to_cells    = h3.polyfill_geojson        # type: ignore[attr-defined]
    h3.cell_to_latlng  = h3.h3_to_geo               # type: ignore[attr-defined]
    h3.cell_to_boundary = h3.h3_to_geo_boundary     # type: ignore[attr-defined]

# ── Configuración ───────────────────────────────────────────────────────────

BBOX = {
    'min_lat': 35.0,
    'max_lat': 44.2,
    'min_lon': -9.8,
    'max_lon':  4.5,
}

ZOOM_LEVELS = [6, 7, 8, 9]
TILE_SIZE   = 256

OUTPUT_DIR = Path(__file__).parent.parent.parent / 'server' / 'tiles'

# ── Paleta de fantasía ───────────────────────────────────────────────────────

# Fondo de pergamino (áreas fuera de datos)
PARCHMENT = (242, 228, 196, 255)

# Colores de terreno — estilo mapa antiguo ilustrado
TERRAIN_RGB = {
    # Agua
    'Mar':                ( 54, 117, 175),  # azul atlas
    'Río':                ( 88, 168, 208),  # azul claro agua dulce
    'Pantanos':           (108, 148, 128),  # verde gris pantano
    # Costa
    'Costa':              (230, 210, 148),  # arena amarillenta
    # Tierras bajas cultivadas
    'Tierras de Cultivo': (170, 210, 108),  # verde claro cultivado
    'Tierras de Secano':  (210, 195, 130),  # amarillo ocre seco
    # Vegetación natural
    'Bosque':             ( 56, 110,  50),  # verde oscuro bosque
    'Estepas':            (188, 175, 112),  # amarillo-pardo estepario
    # Relieve
    'Colinas':            (218, 178,  92),  # ocre ámbar
    'Cerros':             (185, 138,  72),  # marrón medio
    'Alta Montaña':       (148,  88,  52),  # marrón rojizo oscuro
    # Infraestructura
    'Puente':             (155, 148, 138),  # piedra gris
}

SEA_TERRAINS = {'Mar', 'Río', 'Pantanos'}

# Tinta para borde sutil en celdas de tierra (solo zoom 9, muy tenue)
INK = (55, 35, 15, 22)
INK_MIN_ZOOM = 9

# Olas: líneas azul claro en celdas de mar (solo zoom >= 8)
WAVE_COLOR    = (110, 185, 225, 190)
WAVE_MIN_ZOOM = 8
# Fracción de celdas de mar que reciben símbolo de ola (evitar saturación)
WAVE_DENSITY  = 0.18


# Símbolos: activados a partir de este zoom
SYMBOL_MIN_ZOOM = 7

# Tamaño del símbolo en px por zoom — más pequeño = más sutil
SYMBOL_SIZE = {7: 3, 8: 5, 9: 8}

# ── Utilidades de proyección ─────────────────────────────────────────────────

def lat_lon_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def tile_bounds(tx: int, ty: int, zoom: int) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon)"""
    n = 2 ** zoom

    def y_to_lat(yf: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yf / n))))

    min_lon = tx / n * 360 - 180
    max_lon = (tx + 1) / n * 360 - 180
    return y_to_lat(ty + 1), min_lon, y_to_lat(ty), max_lon


def merc(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_lon_to_px(lat, lon, min_lat, min_lon, max_lat, max_lon, size):
    m_min = merc(min_lat)
    m_max = merc(max_lat)
    px = int((lon - min_lon) / (max_lon - min_lon) * size)
    py = int((m_max - merc(lat)) / (m_max - m_min) * size)
    return px, py


# ── Símbolos cartográficos ───────────────────────────────────────────────────

def draw_mountain_symbol(draw: ImageDraw.Draw, cx: int, cy: int, size: int) -> None:
    """
    Estilo cartográfico clásico: solo líneas de contorno /\, sin relleno.
    Dos picos solapados — el de atrás más pequeño y claro.
    """
    pw    = max(2, int(size * 1.0))
    base_y = cy + size // 2
    INK   = (80, 55, 30, 140)
    INK2  = (80, 55, 30, 80)   # pico trasero más tenue

    # Pico trasero (desplazado a la derecha, más bajo)
    bx, bh = cx + pw // 2, int(size * 0.65)
    draw.line([(bx - pw // 2, base_y), (bx, base_y - bh)], fill=INK2, width=1)
    draw.line([(bx, base_y - bh),      (bx + pw // 2, base_y)], fill=INK2, width=1)

    # Pico frontal (centrado, el más alto)
    draw.line([(cx - pw // 2, base_y), (cx, base_y - size)], fill=INK, width=1)
    draw.line([(cx, base_y - size),    (cx + pw // 2, base_y)], fill=INK, width=1)


def draw_forest_symbol(draw: ImageDraw.Draw, cx: int, cy: int, size: int) -> None:
    """Cluster de círculos verdes — copa de árbol estilo mapa ilustrado."""
    r = max(2, size // 2)
    offsets = [(0, 0), (-r, r // 2), (r, r // 2), (0, r)]
    for dx, dy in offsets:
        x, y = cx + dx, cy + dy
        draw.ellipse(
            [x - r, y - r, x + r, y + r],
            fill=(42, 92, 42, 200),
            outline=(28, 62, 28, 160),
        )


def draw_wave_symbol(draw: ImageDraw.Draw, cx: int, cy: int, size: int) -> None:
    """Una línea de ola horizontal — estilo carta náutica."""
    half = max(3, size // 2)
    pts = []
    steps = max(4, half)
    for i in range(steps + 1):
        t = i / steps
        x = cx - half + int(t * half * 2)
        y = cy + int(math.sin(t * math.pi * 2) * max(1, size // 6))
        pts.append((x, y))
    if len(pts) >= 2:
        draw.line(pts, fill=WAVE_COLOR, width=1)


# ── Renderizado ──────────────────────────────────────────────────────────────

def render_tile(cells: list[dict], zoom: int, tx: int, ty: int) -> bool:
    """
    Estilo mapa de fantasía:
    1. Fondo pergamino
    2. Hexágonos rellenos sin borde (solo borde tenue en tierra)
    3. Símbolos (olas, montañas, bosques) en zoom >= 8
    """
    min_lat, min_lon, max_lat, max_lon = tile_bounds(tx, ty, zoom)
    padding = 0.06  # pequeño margen para celdas en el borde del tile

    img  = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), PARCHMENT)
    draw = ImageDraw.Draw(img)

    drawn   = 0
    symbols = []  # (terrain, cx, cy) — se pintan encima de todos los polígonos

    # ── Paso 1: rellenar polígonos hexagonales ────────────────────────────────
    for cell in cells:
        boundary = h3.cell_to_boundary(cell['h3_index'])  # [(lat, lon), ...]

        # Filtrar por tile
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

        terrain = cell.get('terrain', 'Llanura')
        rgb     = TERRAIN_RGB.get(terrain, (150, 150, 150))
        is_sea  = terrain in SEA_TERRAINS

        # Relleno opaco + borde oscuro sutil para definir las celdas
        draw.polygon(pixels, fill=(*rgb, 255),
                     outline=(max(0, rgb[0]-30), max(0, rgb[1]-30), max(0, rgb[2]-30), 180))
        drawn += 1

        # Acumular símbolos para segundo pase
        # Se amplía la zona de búsqueda más allá del tile para evitar cortes en bordes
        if zoom >= SYMBOL_MIN_ZOOM and terrain in ('Alta Montaña', 'Mar'):
            clat, clon = h3.cell_to_latlng(cell['h3_index'])
            sym_pad = SYMBOL_SIZE.get(zoom, 8) * 360.0 / (TILE_SIZE * 2 ** zoom)
            if (
                (min_lat - sym_pad) <= clat <= (max_lat + sym_pad) and
                (min_lon - sym_pad) <= clon <= (max_lon + sym_pad)
            ):
                # Para olas, filtrar por densidad usando hash determinista del índice
                if terrain in ('Mar', 'Rio'):
                    if (hash(cell['h3_index']) % 100) / 100.0 >= WAVE_DENSITY:
                        continue
                cx, cy = lat_lon_to_px(clat, clon, min_lat, min_lon, max_lat, max_lon, TILE_SIZE)
                symbols.append((terrain, cx, cy))

    if drawn == 0:
        return False

    # ── Paso 2: símbolos encima del terreno ──────────────────────────────────
    size = SYMBOL_SIZE.get(zoom, 0)
    for terrain, cx, cy in symbols:
        if terrain == 'Alta Montaña':
            draw_mountain_symbol(draw, cx, cy, size)
        elif zoom >= WAVE_MIN_ZOOM and terrain == 'Mar':
            draw_wave_symbol(draw, cx, cy, size)

    tile_path = OUTPUT_DIR / str(zoom) / str(tx) / f'{ty}.png'
    tile_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(tile_path, 'PNG')
    return True


def build_tile_index(cells: list[dict], zoom: int) -> dict:
    """
    Crea un índice (tx, ty) → [celdas] para no pasar las 236K celdas
    a cada render_tile. Cada celda se registra en su tile y los 8 adyacentes
    para cubrir el padding de bordes.
    """
    index: dict = {}
    for cell in cells:
        clat, clon = h3.cell_to_latlng(cell['h3_index'])
        tx0, ty0 = lat_lon_to_tile(clat, clon, zoom)
        for dtx in (-1, 0, 1):
            for dty in (-1, 0, 1):
                key = (tx0 + dtx, ty0 + dty)
                if key not in index:
                    index[key] = []
                index[key].append(cell)
    return index


def generate_tiles(cells: list[dict]) -> None:
    total_tiles = 0
    total_drawn = 0

    for zoom in ZOOM_LEVELS:
        x_min, y_max = lat_lon_to_tile(BBOX['min_lat'], BBOX['min_lon'], zoom)
        x_max, y_min = lat_lon_to_tile(BBOX['max_lat'], BBOX['max_lon'], zoom)

        count = (x_max - x_min + 1) * (y_max - y_min + 1)
        print(f'  zoom {zoom}: {count} tiles  (x {x_min}-{x_max}, y {y_min}-{y_max})')
        t0 = time.time()

        tile_index = build_tile_index(cells, zoom)

        for tx in range(x_min, x_max + 1):
            for ty in range(y_min, y_max + 1):
                tile_cells = tile_index.get((tx, ty), [])
                if tile_cells and render_tile(tile_cells, zoom, tx, ty):
                    total_drawn += 1
                total_tiles += 1

        print(f'         OK {time.time() - t0:.1f}s -- {total_drawn} tiles con contenido')

    print(f'\nTotal: {total_drawn}/{total_tiles} tiles generados en {OUTPUT_DIR}')


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    env_path = Path(__file__).parent.parent.parent / '.env'
    env = dotenv_values(env_path)

    print('Conectando a la base de datos (localhost:5444)...')
    conn = psycopg2.connect(
        host='localhost',
        port=5444,
        dbname=env.get('DB_NAME'),
        user=env.get('DB_USER'),
        password=env.get('DB_PASSWORD'),
    )

    print('Consultando todas las celdas en la BD...')
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.h3_index, t.name AS terrain_name
            FROM h3_map m
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        """)
        rows = cur.fetchall()
    conn.close()
    print(f'Celdas cargadas: {len(rows)}')

    cells = [
        {'h3_index': h3_index, 'terrain': terrain_name}
        for h3_index, terrain_name in rows
    ]

    if not cells:
        print('AVISO: No se encontraron celdas.')
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Generando tiles en {OUTPUT_DIR} ...\n')
    generate_tiles(cells)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Genera tiles XYZ de terreno')
    parser.add_argument('--min-zoom', type=int, default=ZOOM_LEVELS[0],
                        help=f'Zoom mínimo (defecto: {ZOOM_LEVELS[0]})')
    parser.add_argument('--max-zoom', type=int, default=ZOOM_LEVELS[-1],
                        help=f'Zoom máximo (defecto: {ZOOM_LEVELS[-1]})')
    args = parser.parse_args()

    if args.min_zoom > args.max_zoom:
        parser.error('--min-zoom no puede ser mayor que --max-zoom')

    ZOOM_LEVELS[:] = list(range(args.min_zoom, args.max_zoom + 1))
    main()
