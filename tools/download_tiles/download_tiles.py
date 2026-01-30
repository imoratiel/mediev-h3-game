import os
import requests
from pathlib import Path

def download_world_map():
    base_url = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    
    # Ruta absoluta basada en la ubicación del script
    data_dir = Path(__file__).resolve().parents[2] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # RANGO DEL GRAN MAPA:
    # Latitudes: De 30°N (África) hasta 69°N (Escandinavia) en saltos de 3 grados
    lats = range(30, 72, 3) 
    
    # Longitudes: De 12°W (Atlántico) hasta 36°E (Turquía) en saltos de 3 grados
    lons = range(-12, 39, 3)

    tiles_to_process = []
    for lat in lats:
        for lon in lons:
            ns = 'N' if lat >= 0 else 'S'
            ew = 'E' if lon >= 0 else 'W'
            tile_name = f"ESA_WorldCover_10m_2021_v200_{ns}{abs(lat):02d}{ew}{abs(lon):03d}_Map.tif"
            tiles_to_process.append((tile_name, f"{base_url}{tile_name}"))

    total_tiles = len(tiles_to_process)
    print(f"🌍 Iniciando descarga del Gran Mapa ({total_tiles} tiles planeados)")
    print(f"📂 Carpeta de destino: {data_dir.absolute()}")
    print("-" * 50)

    count = 0
    for tile_name, url in tiles_to_process:
        count += 1
        dest_path = data_dir / tile_name

        if dest_path.exists():
            print(f"[{count}/{total_tiles}] ⏩ Saltando: {tile_name} (Ya existe)")
            continue

        print(f"[{count}/{total_tiles}] 📥 Descargando: {tile_name}...")
        try:
            with requests.get(url, stream=True, timeout=60) as r:
                if r.status_code == 404:
                    # Algunos tiles en mar abierto podrían no existir en el servidor de la ESA
                    print(f"    ℹ️ No disponible en el servidor (posiblemente solo agua).")
                    continue
                
                r.raise_for_status()
                with open(dest_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=1024*1024): # 1MB chunks
                        if chunk:
                            f.write(chunk)
                print(f"    ✅ Completado")
        except Exception as e:
            print(f"    ❌ Error: {e}")

    print("-" * 50)
    print("🚀 Proceso finalizado.")

if __name__ == "__main__":
    download_world_map()