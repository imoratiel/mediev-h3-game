"""
populate_geo_culture_weights.py

Asigna pesos de cultura a cada hex colonizable del mapa basándose en su
posición geográfica dentro de la Península Ibérica (resolución H3-7).

Culturas:
  1 = Romanos      → Meseta central, interior
  2 = Cartagineses → Sur y sureste (Andalucía, Cartagena, S Portugal)
  3 = Íberos       → Costa este y levante (Cataluña, Valencia, Murcia, Aragón)
  4 = Celtas       → Noroeste (Galicia, Asturias, Cantabria, N Portugal)

Lógica: cada hex recibe 1-4 filas en geo_culture_weights con pesos 0-100.
La selección de cultura al inicializar un jugador es aleatoria ponderada.
Los pesos > 0 se insertan; los hexes sin cobertura usan el fallback aleatorio.

Uso:
  cd tools
  python populate_geo_culture_weights.py [--dry-run]
"""

import sys
import os
import argparse

try:
    import h3
except ImportError:
    print("❌ Falta librería h3: pip install h3")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("❌ Falta librería psycopg2: pip install psycopg2-binary")
    sys.exit(1)

# ── Configuración DB ────────────────────────────────────────────────────────
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'terrain_extractor'))
try:
    from config import DB_CONFIG
    print("✅ DB_CONFIG cargado desde terrain_extractor/config.py")
except ImportError:
    print("❌ No se encontró terrain_extractor/config.py — usando config por defecto")
    DB_CONFIG = {
        'host': 'localhost',
        'port': '5444',
        'database': 'marca_hispanica',
        'user': 'postgres',
        'password': '',
        'client_encoding': 'utf8'
    }

BATCH_SIZE = 5000

# ── IDs de terrenos no colonizables (no interesa asignar cultura a mar/río) ─
# 1=Mar, 4=Río — se excluyen del volcado para ahorrar filas
NON_COLONIZABLE_TERRAIN_IDS = {1, 4}


# ── Zonas geográficas ───────────────────────────────────────────────────────
def get_culture_weights(lat: float, lng: float) -> dict[int, int]:
    """
    Devuelve {culture_id: weight} para las coordenadas dadas.
    Weights en rango 0-100; solo se incluyen los > 0.

    Distribución histórica aproximada (c. 300-100 a.C.):
      Celtas     → NW: Galicia, Asturias, Cantabria, norte de Portugal
      Íberos     → E: costa mediterránea, Levante, baja Cataluña
      Cartagineses → S: Andalucía, Cartagena, sur de Portugal
      Romanos    → C: Meseta, Extremadura, interior (y base residual)
    """

    # ── Celtas (id=4): noroeste ─────────────────────────────────────────────
    celtic = 0
    if lat > 43.0 and lng < -3.5:
        celtic = 95   # Galicia alta + Asturias oeste
    elif lat > 42.5 and lng < -5.0:
        celtic = 90   # Galicia + Asturias
    elif lat > 42.0 and lng < -3.5:
        celtic = 75
    elif lat > 41.0 and lng < -6.0:
        celtic = 60   # Norte de Portugal interior
    elif lat > 41.5 and lng < -2.0:
        celtic = 45   # Cantabria / País Vasco occidental
    elif lat > 40.0 and lng < -7.0:
        celtic = 35   # Portugal norte

    # ── Íberos (id=3): costa este ───────────────────────────────────────────
    iberian = 0
    if lat > 40.5 and lat < 43.0 and lng > 1.5:
        iberian = 95  # Cataluña costera
    elif lat > 39.0 and lat < 41.5 and lng > 0.5:
        iberian = 90  # Valencia / Castellón
    elif lat > 37.0 and lat < 39.5 and lng > -1.0:
        iberian = 80  # Murcia / Alicante / Almería este
    elif lat > 41.0 and lat < 43.5 and lng > 0.0:
        iberian = 70  # Aragón costal / Gerona interior
    elif lat > 38.0 and lat < 42.0 and lng > -1.0 and lng < 0.5:
        iberian = 55  # Aragón interior / interior valenciano
    elif lat > 37.5 and lat < 41.0 and lng > -2.0 and lng < 0.0:
        iberian = 35  # Transición Meseta-Levante

    # ── Cartagineses (id=2): sur ────────────────────────────────────────────
    carthaginian = 0
    if lat < 36.5 and lng > -6.5 and lng < 2.5:
        carthaginian = 95  # Andalucía baja + Estrecho
    elif lat < 37.5 and lng > -5.0 and lng < 1.0:
        carthaginian = 85  # Andalucía media
    elif lat < 38.5 and lng > -3.5 and lng < 0.5:
        carthaginian = 65  # Granada / Jaén / Murcia sur
    elif lat < 37.5 and lng > -9.5 and lng < -6.0:
        carthaginian = 75  # Sur de Portugal / Algarve
    elif lat < 38.5 and lng > -8.5 and lng < -5.0:
        carthaginian = 50  # Alentejo / Extremadura sur
    elif lat < 38.0 and lng > -6.0 and lng < -3.0:
        carthaginian = 60  # Extremadura sur / Córdoba norte

    # ── Romanos (id=1): Meseta central + base residual ──────────────────────
    roman = 10  # presencia residual en toda la península
    if lat > 39.0 and lat < 42.5 and lng > -6.5 and lng < -2.0:
        roman = 80   # Meseta Norte (Castilla y León)
    elif lat > 38.0 and lat < 40.5 and lng > -5.5 and lng < -1.5:
        roman = 75   # Meseta Sur (Castilla-La Mancha)
    elif lat > 38.5 and lat < 41.0 and lng > -7.5 and lng < -5.0:
        roman = 60   # Extremadura / interior Portugal
    elif lat > 40.0 and lat < 42.0 and lng > -4.0 and lng < -1.0:
        roman = 55   # Zona de transición Meseta-Ebro

    result = {
        1: roman,
        2: carthaginian,
        3: iberian,
        4: celtic,
    }
    return {cid: w for cid, w in result.items() if w > 0}


# ── Main ────────────────────────────────────────────────────────────────────
def main(dry_run: bool = False):
    print(f"🗺️  populate_geo_culture_weights — {'DRY RUN' if dry_run else 'LIVE'}")

    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    # Leer todos los hexes colonizables
    print("📦 Leyendo hexes colonizables desde h3_map…")
    cur.execute("""
        SELECT m.h3_index
        FROM h3_map m
        JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        WHERE t.is_colonizable = TRUE
    """)
    rows = cur.fetchall()
    print(f"   → {len(rows):,} hexes colonizables encontrados")

    if not dry_run:
        print("🧹 Limpiando tabla geo_culture_weights…")
        cur.execute("TRUNCATE TABLE geo_culture_weights;")

    # Generar filas
    print("⚙️  Calculando pesos por hex…")
    batch = []
    total_rows = 0
    skipped = 0

    for i, (h3_index,) in enumerate(rows):
        try:
            lat, lng = h3.cell_to_latlng(h3_index)
        except Exception:
            skipped += 1
            continue

        weights = get_culture_weights(lat, lng)
        if not weights:
            skipped += 1
            continue

        for culture_id, weight in weights.items():
            batch.append((h3_index, culture_id, weight))

        if len(batch) >= BATCH_SIZE:
            if not dry_run:
                execute_values(cur,
                    "INSERT INTO geo_culture_weights (h3_index, culture_id, weight) VALUES %s",
                    batch
                )
            total_rows += len(batch)
            batch = []

        if (i + 1) % 50000 == 0:
            pct = (i + 1) / len(rows) * 100
            print(f"   {i+1:,}/{len(rows):,} ({pct:.1f}%) — {total_rows:,} filas generadas")

    # Último batch
    if batch:
        if not dry_run:
            execute_values(cur,
                "INSERT INTO geo_culture_weights (h3_index, culture_id, weight) VALUES %s",
                batch
            )
        total_rows += len(batch)

    if not dry_run:
        conn.commit()
        print(f"\n✅ Completado: {total_rows:,} filas insertadas en geo_culture_weights")
    else:
        conn.rollback()
        print(f"\n✅ Dry-run: se habrían insertado {total_rows:,} filas")

    if skipped:
        print(f"   ⚠️  {skipped:,} hexes omitidos (sin pesos o error H3)")

    # Resumen por cultura
    if not dry_run:
        cur.execute("""
            SELECT c.name, COUNT(*) as hexes, ROUND(AVG(w.weight), 1) as avg_weight
            FROM geo_culture_weights w
            JOIN cultures c ON c.id = w.culture_id
            GROUP BY c.name ORDER BY hexes DESC
        """)
        print("\n📊 Resumen por cultura:")
        for name, hexes, avg_w in cur.fetchall():
            print(f"   {name:<18} {hexes:>8,} hexes  avg_weight={avg_w}")

    cur.close()
    conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Poblar geo_culture_weights')
    parser.add_argument('--dry-run', action='store_true',
                        help='Simula la ejecución sin escribir en la BD')
    args = parser.parse_args()
    main(dry_run=args.dry_run)
