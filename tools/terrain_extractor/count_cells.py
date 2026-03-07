import psycopg2
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from config import DB_CONFIG

try:
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM h3_map")
    h3_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM territory_details")
    td_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM h3_map m LEFT JOIN territory_details td ON m.h3_index = td.h3_index WHERE td.h3_index IS NULL")
    missing = cur.fetchone()[0]

    print(f"h3_map:            {h3_count:>10,}")
    print(f"territory_details: {td_count:>10,}")
    print(f"Sin economy data:  {missing:>10,}")

    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
