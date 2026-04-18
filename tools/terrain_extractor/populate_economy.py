import random
import psycopg2
import sys
import os
from psycopg2.extras import execute_values

# 1. CARGA DE CONFIGURACIÓN
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from config import DB_CONFIG, ECONOMY_RESOURCE_MULTIPLIER, ECONOMY_POPULATION_MULTIPLIER
    from pathlib import Path
    BASE_DATA_DIR = Path(__file__).parent.parent.parent.resolve() / 'data'
    print("✅ Configuración cargada correctamente.")
except ImportError:
    print("❌ Error: No se pudo encontrar config.py para leer la configuración.")
    sys.exit(1)

def getRandomInt(min_val, max_val):
    return random.randint(min_val, max_val)

def calculateLoot(baseMin, baseMax, multiplierPercent):
    val = random.randint(baseMin, baseMax)
    return int(val * (multiplierPercent / 100.0))

def populate():
    sql_dump_path = BASE_DATA_DIR / 'populate_economy.sql'
    if sql_dump_path.exists():
        sql_dump_path.unlink()
    print(f"📄 SQL dump will be written to: {sql_dump_path}")

    sql_file = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        sql_file = open(sql_dump_path, 'w', encoding='utf-8')

        # --- PASO 0: TRUNCATE ---
        print("🧹 Limpiando tabla territory_details...")
        cur.execute("TRUNCATE TABLE territory_details RESTART IDENTITY CASCADE;")
        sql_file.write("TRUNCATE TABLE territory_details RESTART IDENTITY CASCADE;\n\n")
        conn.commit()

        # --- PASO 1: LECTURA ---
        print("🔍 Leyendo mapa y tipos de terreno...")
        cur.execute("""
            SELECT m.h3_index, t.food_output, t.wood_output, t.stone_output, t.iron_output 
            FROM h3_map m
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        """)
        cells = cur.fetchall()
        total_cells = len(cells)

        if total_cells == 0:
            print("❌ No hay celdas en h3_map. Ejecuta el extractor primero.")
            return

        print(f"🚀 Iniciando población económica para {total_cells:,} celdas...")

        # --- PASO 2: PROCESAMIENTO POR LOTES (BATCHES) ---
        batch_size = 5000
        for i in range(0, total_cells, batch_size):
            batch = cells[i : i + batch_size]
            inserts = []
            
            for cell in batch:
                h3_index, food_output, wood, stone, iron = cell
                
                # 1. Cálculos base
                pop = getRandomInt(200 * ECONOMY_POPULATION_MULTIPLIER, 400 * ECONOMY_POPULATION_MULTIPLIER)
                hap = getRandomInt(50, 70)
                food = calculateLoot(1000 * ECONOMY_RESOURCE_MULTIPLIER, 2500 * ECONOMY_RESOURCE_MULTIPLIER, food_output)
                wood_s = calculateLoot(500, 2500, wood)
                stone_s = calculateLoot(500, 2500, stone)
                
                # 2. Nueva lógica de Minería, Oro y Recurso Oculto
                # IMPORTANTE: Los recursos físicos (stone, iron, gold) se generan en la base de datos
                # pero discovered_resource se mantiene como NULL para que los jugadores deban explorar
                gold_s = 0
                iron_s = 0
                disc_res = None  # Siempre NULL - los recursos permanecen ocultos hasta explorar

                # Los recursos mineros físicos se generan pero permanecen ocultos
                # El turn engine hará el roll de descubrimiento cuando se complete la exploración
                gold_s = getRandomInt(2000 * ECONOMY_RESOURCE_MULTIPLIER, 6000 * ECONOMY_RESOURCE_MULTIPLIER)
                iron_s = getRandomInt(100, 2000)

                if stone > 0 or iron > 0:
                    pass  # iron_s and gold_s already set above

                # discovered_resource permanece NULL - se asignará al completar exploración
                
                # 3. ÚNICO APPEND con los 9 campos necesarios
                inserts.append((
                    str(h3_index), pop, hap, food, 
                    wood_s, stone_s, iron_s, gold_s, disc_res
                ))

            # 4. Query actualizada con las nuevas columnas
            insert_query = """
                INSERT INTO territory_details (
                    h3_index, population, happiness, food_stored, 
                    wood_stored, stone_stored, iron_stored, 
                    gold_stored, discovered_resource
                ) VALUES %s
            """
            execute_values(cur, insert_query, inserts)
            rows_sql = ',\n    '.join(
                cur.mogrify("(%s, %s, %s, %s, %s, %s, %s, %s, %s)", row).decode('utf-8')
                for row in inserts
            )
            sql_file.write(insert_query.replace('VALUES %s', f'VALUES\n    {rows_sql}') + ';\n\n')
            conn.commit()
            
            # Log de progreso
            progress = min(i + batch_size, total_cells)
            percentage = (progress / total_cells) * 100
            print(f"📦 Progreso: {progress:,}/{total_cells:,} ({percentage:.1f}%)")

        print("\n✅ ¡Población económica completada con éxito!")

    except Exception as e:
        print(f"\n❌ Error crítico: {e}")
        if conn: conn.rollback()
    finally:
        if sql_file:
            sql_file.close()
        if 'conn' in locals():
            cur.close()
            conn.close()

if __name__ == "__main__":
    populate()