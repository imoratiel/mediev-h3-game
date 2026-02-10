import psycopg2
import sys
import os

# Intentar importar la configuración de tu extractor
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from extractor import DB_CONFIG
    print("🔍 Intentando conectar con:", {k: (v if k != 'password' else '****') for k, v in DB_CONFIG.items()})
except ImportError:
    print("❌ No se encontró extractor.py")
    sys.exit(1)

def test_connection():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("✅ ¡Conexión exitosa a PostgreSQL local!")
        
        cur = conn.cursor()
        cur.execute("SELECT version();")
        record = cur.fetchone()
        print(f"Versión del servidor: {record[0]}")
        
        cur.close()
        conn.close()
    except Exception as e:
        print("\n❌ ERROR DE CONEXIÓN:")
        # Esto fuerza a imprimir el error ignorando caracteres que den problemas de decode
        error_msg = str(e).encode('ascii', 'ignore').decode('ascii')
        print(f"Mensaje limpio: {error_msg}")
        print("\n--- Posibles causas ---")
        print("1. El usuario 'postgres' tiene otra contraseña.")
        print("2. La base de datos 'medieval_h3' no ha sido creada en pgAdmin.")
        print("3. El puerto 5432 está bloqueado o PostgreSQL no está arrancado.")

if __name__ == "__main__":
    test_connection()