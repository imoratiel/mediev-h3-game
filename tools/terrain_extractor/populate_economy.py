import random
import psycopg2
import sys
import os
from psycopg2.extras import execute_values

# 1. CARGA DE CONFIGURACIÓN
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from extractor import DB_CONFIG
    print("✅ Configuración cargada correctamente.")
except ImportError:
    print("❌ Error: No se pudo encontrar extractor.py para leer la configuración.")
    sys.exit(1)

def getRandomInt(min_val, max_val):
    return random.randint(min_val, max_val)

def calculateLoot(baseMin, baseMax, multiplierPercent):
    val = random.randint(baseMin, baseMax)
    return int(val * (multiplierPercent / 100.0))

def populate():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        # --- PASO 0: TRUNCATE ---
        print("🧹 Limpiando tabla territory_details...")
        cur.execute("TRUNCATE TABLE territory_details RESTART IDENTITY CASCADE;")
        conn.commit()

        # --- PASO 1: LECTURA ---
        print("🔍 Leyendo mapa y tipos de terreno...")
        cur.execute("""
            SELECT m.h3_index, t.fertility, t.wood_output, t.stone_output, t.iron_output 
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
                h3_index, fertility, wood, stone, iron = cell
                
                # 1. Cálculos base
                pop = getRandomInt(200, 400)
                hap = getRandomInt(50, 70)
                food = calculateLoot(500, 2500, fertility)
                wood_s = calculateLoot(500, 2500, wood)
                stone_s = calculateLoot(500, 2500, stone)
                
                # 2. Nueva lógica de Minería, Oro y Recurso Oculto
                gold_s = 0
                iron_s = 0
                disc_res = None 

                # Si el terreno tiene potencial minero (Montaña/Colinas)
                if stone > 0 or iron > 0: 
                    rand_discovery = random.random()
                    
                    if rand_discovery < 0.05:   # 5% ORO
                        disc_res = 'gold'
                        gold_s = getRandomInt(100, 500) 
                    elif rand_discovery < 0.30: # 25% HIERRO
                        disc_res = 'iron'
                        iron_s = calculateLoot(500, 2500, iron)
                    else:                       # 70% PIEDRA
                        disc_res = 'stone'
                
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
        if 'conn' in locals():
            cur.close()
            conn.close()

if __name__ == "__main__":
    populate()