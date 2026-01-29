import requests
import os

# Configuración de rutas
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "../../data")
os.makedirs(DATA_DIR, exist_ok=True)

# Coordenadas que cubren España (Península + Baleares)
# Latitudes: 36, 39, 42 (Cada tile cubre 3 grados hacia el norte)
# Longitudes: W009, W006, W003, E000, E003 (Cada tile cubre 3 grados hacia el este)
latitudes = [36, 39, 42]
longitudes = [-9, -6, -3, 0, 3]

def get_tile_name(lat, lon):
    lat_str = f"N{lat:02d}"
    lon_str = f"E{abs(lon):03d}" if lon >= 0 else f"W{abs(lon):03d}"
    return f"ESA_WorldCover_10m_2021_v200_{lat_str}{lon_str}_Map.tif"

tiles_to_download = [get_tile_name(lat, lon) for lat in latitudes for lon in longitudes]

def download_tile(tile_name):
    url = f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{tile_name}"
    output_path = os.path.join(DATA_DIR, tile_name)
    
    if os.path.exists(output_path):
        print(f"[-] {tile_name} already exists. Skipping.")
        return

    print(f"[+] Downloading {tile_name}...")
    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"    ✓ Success")
    except Exception as e:
        print(f"    × Failed: {e}")

if __name__ == "__main__":
    print(f"Target Directory: {os.path.abspath(DATA_DIR)}")
    print(f"Starting download of {len(tiles_to_download)} tiles...\n")
    for tile in tiles_to_download:
        download_tile(tile)
    print("\n[!] All downloads finished.")