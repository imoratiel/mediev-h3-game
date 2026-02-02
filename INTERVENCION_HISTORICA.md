# 🏰 INTERVENCIÓN HISTÓRICA - Guía de Ejecución

Esta guía describe cómo ejecutar la intervención completa para limpiar ciudades modernas y activar la infraestructura histórica del mapa medieval.

## 📋 Estado Actual del Código

### ✅ YA IMPLEMENTADO

1. **Extractor (extractor.py)**:
   - ✅ TIF=50 (ciudades modernas) asigna ID 0 temporal (línea 1142)
   - ✅ `renaturalize_modern_cities()`: Convierte ID 0 en costa o moda de vecinos (línea 783)
   - ✅ `overlay_historical_settlements()`: Asigna ID 14 solo a settlements de la tabla (línea 875)
   - ✅ Flujo de post-procesamiento configurado (líneas 1230-1242)

2. **Backend API (server/index.js)**:
   - ✅ Endpoint `/api/settlements` con codificación UTF-8 mejorada
   - ✅ Endpoint `/api/map/region` con LEFT JOIN a settlements
   - ✅ Manejo robusto de errores con logging detallado

3. **Frontend (MapViewer.vue)**:
   - ✅ Iconos SVG embebidos medievales (5 tipos: city, town, village, fort, monastery)
   - ✅ Etiquetas con halo blanco potente (4 capas de text-shadow)
   - ✅ Popups con coordenadas lat/lng formato 5 decimales
   - ✅ Menú lateral con validación de respuesta exitosa (200 OK)

4. **Setup Histórico (setup_history.py)**:
   - ✅ ON CONFLICT (h3_index) DO UPDATE implementado (línea 578)
   - ✅ Retry logic para Overpass API (3 intentos con delays progresivos)
   - ✅ Fallback a `generate_demo_roads()` si Overpass falla
   - ✅ Validación de hexágonos existentes antes de insertar settlements

### 🔧 PENDIENTE DE EJECUTAR

1. **Script SQL de Reparación**: `sql/005_fix_constraints_and_views.sql`
   - Elimina constraint restrictivo de population_rank
   - Asegura UNIQUE constraint en settlements.h3_index
   - Crea vista `v_map_display` para consultas optimizadas
   - Verifica columna `has_road` en h3_map

---

## 🚀 PASOS DE EJECUCIÓN

### Paso 1: Reparar Base de Datos

Ejecuta el script SQL para arreglar constraints y crear la vista:

```bash
# Opción A: Usando psql (recomendado)
psql -h ep-green-bonus-a9t2tlwd-pooler.gwc.azure.neon.tech \
     -p 5432 \
     -U neondb_owner \
     -d neondb \
     -f sql/005_fix_constraints_and_views.sql

# Opción B: Usando Python
python -c "
import psycopg2
from tools.terrain_extractor.config import DB_CONFIG

conn = psycopg2.connect(**DB_CONFIG)
with open('sql/005_fix_constraints_and_views.sql', 'r', encoding='utf-8') as f:
    sql = f.read()
    cursor = conn.cursor()
    cursor.execute(sql)
    conn.commit()
    cursor.close()
    conn.close()
print('✓ Base de datos reparada exitosamente')
"
```

**Verificación:**
```sql
-- Verificar que settlements acepta population_rank > 10
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' AND constraint_name LIKE 'settlements_%';

-- Verificar que la vista existe
SELECT COUNT(*) FROM v_map_display LIMIT 1;

-- Verificar settlements con datos
SELECT settlement_name, settlement_type, has_road
FROM v_map_display
WHERE settlement_name IS NOT NULL
LIMIT 10;
```

---

### Paso 2: Ejecutar Setup de Infraestructura Histórica

Este paso carga settlements y caminos históricos en la base de datos:

```bash
cd tools/terrain_extractor
python setup_history.py
```

**Salida Esperada:**
```
============================================================
SETUP DE INFRAESTRUCTURA HISTÓRICA
============================================================

Cargando settlements.csv existente: D:\claude\mediev-h3-game\data\vectors\settlements.csv
Cargados 20 asentamientos desde CSV

Cargando roman_roads.shp existente: D:\claude\mediev-h3-game\data\vectors\roman_roads.shp
Vías romanas en región: X segmentos
Procesando resolución 8: X hexágonos
Procesando resolución 10: X hexágonos

✓ Actualizados X hexágonos con has_road=TRUE (res 8)

Verificando hexágonos existentes en h3_map...
Asentamientos historicos inyectados: 20
Distribución de asentamientos por tipo:
  city: X
  town: X
  village: X
  fort: X
  monastery: X

Distribución de asentamientos por periodo:
  roman: X
  medieval: X

============================================================
SETUP COMPLETADO
============================================================
```

**Nota sobre Overpass API:**
Si Overpass API falla (504 Gateway Timeout), el script automáticamente:
1. Reintenta 3 veces con delays de 5s, 10s, 20s
2. Si todos los intentos fallan, genera "caminos sintéticos" conectando las ciudades del CSV

---

### Paso 3: Re-extraer Terreno (OPCIONAL - Solo si necesitas regenerar el mapa)

**⚠️ ADVERTENCIA**: Este paso tarda ~30-60 minutos y sobrescribe el mapa existente.

Solo ejecuta si:
- Necesitas limpiar ciudades modernas del mapa actual
- Has añadido nuevos rasters o cambiado la región
- Quieres regenerar el mapa desde cero

```bash
cd tools/terrain_extractor
python extractor.py
```

**Flujo del Extractor:**
```
FASE 1: Detección de Mar (ID 1)
FASE 2: Detección de Costa (ID 2)
FASE 3: Detección de Agua/Ríos (IDs 3, 4, 5)
FASE 4: Detección de Montaña (ID 13)
FASE 5: Clasificación Resto (TIF=50 -> ID 0)

POST-PROCESADO:
  1. Renaturalización de ciudades modernas (ID 0 -> ID 2 o moda)
  2. Overlay de asentamientos históricos (tabla -> ID 14)

INSERCIÓN EN BASE DE DATOS:
  Batch size: 5000 hexágonos
  Total insertado: ~X hexágonos
```

---

### Paso 4: Reiniciar Backend para Cargar Cambios

```bash
# En terminal separada
cd server
npm start
```

**Salida Esperada:**
```
🚀 Server running on http://localhost:3000
📍 API endpoint: http://localhost:3000/api/map/region
✓ Connected to PostgreSQL database
```

---

### Paso 5: Verificar Frontend

1. Abrir navegador en `http://localhost:5173` (o puerto de Vite)
2. Navegar por el mapa (zoom >= 12 para ver settlements)
3. Verificar:
   - ✅ Iconos SVG medievales visibles
   - ✅ Etiquetas con nombres en fuente Cinzel
   - ✅ Halo blanco alrededor de nombres (legible sobre cualquier terreno)
   - ✅ Menú lateral derecho con 16-20 asentamientos
   - ✅ Click en settlement abre popup con coordenadas
   - ✅ Navegación desde menú lateral funciona con animación

---

## 🔍 VERIFICACIÓN COMPLETA

### Test 1: API Settlements

```bash
curl http://localhost:3000/api/settlements | python -m json.tool
```

**Esperado**: Array con 16-20 settlements, cada uno con:
- `name`: Nombre histórico
- `lat`, `lng`: Coordenadas precisas
- `type`: city/town/village/fort/monastery
- `period`: roman/medieval
- `population_rank`: 1-20

### Test 2: API Map Region (con settlements)

```bash
curl "http://localhost:3000/api/map/region?minLat=42.5&maxLat=42.7&minLng=-5.7&minLng=-5.5&res=8" | python -m json.tool
```

**Esperado**: Array de hexágonos con algunos que incluyen `settlement` object:
```json
{
  "h3_index": "...",
  "name": "Bosque",
  "color": "#2d5a27",
  "has_road": false,
  "settlement": {
    "name": "Legio VII Gemina (León)",
    "type": "city",
    "population_rank": 1,
    "period": "roman"
  }
}
```

### Test 3: Vista v_map_display

```sql
-- Contar hexágonos con settlements
SELECT
    COUNT(*) FILTER (WHERE settlement_name IS NOT NULL) AS hexagons_with_settlements,
    COUNT(*) FILTER (WHERE has_road = TRUE) AS hexagons_with_roads,
    COUNT(*) AS total_hexagons
FROM v_map_display;
```

**Esperado**:
- `hexagons_with_settlements`: 16-20
- `hexagons_with_roads`: Varios cientos (según roman_roads.shp)
- `total_hexagons`: Todos los hexágonos del mapa

### Test 4: Renaturalización Exitosa

```sql
-- Verificar que NO hay hexágonos con terrain_type_id = 0
SELECT COUNT(*) FROM h3_map WHERE terrain_type_id = 0;
```

**Esperado**: `0` (todas las ciudades modernas fueron renaturalizadas)

```sql
-- Verificar que ID 14 solo está en settlements
SELECT
    COUNT(*) AS total_id_14_in_map,
    (SELECT COUNT(*) FROM settlements) AS total_settlements
FROM h3_map
WHERE terrain_type_id = 14;
```

**Esperado**: `total_id_14_in_map` ≈ `total_settlements` (pequeñas diferencias OK si settlements fuera del bounding box)

---

## 📊 RESUMEN DE CAMBIOS

### Base de Datos
- ✅ Constraint `population_rank` flexible (>= 1, sin límite superior)
- ✅ Vista `v_map_display` para consultas optimizadas
- ✅ Columna `has_road` en h3_map con índice

### Extractor
- ✅ TIF=50 no asigna directamente ID 14
- ✅ Renaturalización automática: costa si toca mar, moda si interior
- ✅ ID 14 exclusivo para asentamientos históricos de la tabla

### API & Frontend
- ✅ Iconos SVG medievales de alta calidad
- ✅ Halo blanco potente (4 capas) para legibilidad máxima
- ✅ Coordenadas lat/lng en todos los popups
- ✅ Menú lateral validado (solo puebla con 200 OK)
- ✅ Manejo robusto de errores con logging UTF-8

### Infraestructura Histórica
- ✅ ON CONFLICT para actualizaciones idempotentes
- ✅ Retry logic para APIs externas (Overpass)
- ✅ Fallback a caminos sintéticos si falla descarga
- ✅ Validación de FK antes de insertar settlements

---

## 🎯 RESULTADO FINAL

Después de esta intervención, el mapa medieval tendrá:

1. **Limpieza Completa**:
   - ❌ Sin ciudades modernas (Barcelona, Madrid, etc.)
   - ✅ Terreno naturalizado (costa o vegetación según vecinos)

2. **Infraestructura Histórica Visible**:
   - ✅ 16-20 asentamientos históricos con iconos SVG
   - ✅ Vías romanas marcadas (has_road=true, bordes dorados)
   - ✅ Nombres legibles con halo blanco sobre cualquier terreno

3. **Datos Históricos Precisos**:
   - ✅ León (Legio VII Gemina) - capital romana
   - ✅ Santiago (Compostela) - centro medieval
   - ✅ Oviedo, Lugo, Astorga, etc.
   - ✅ Periodo identificado (roman/medieval)
   - ✅ Ranking de población (1-20)

4. **UX Mejorada**:
   - ✅ Navegación rápida desde menú lateral
   - ✅ Coordenadas precisas en popups
   - ✅ Animaciones suaves (2 segundos flyTo)
   - ✅ Zoom automático a nivel 14 al seleccionar settlement

---

## 🐛 TROUBLESHOOTING

### Error: "column has_road does not exist"
**Solución**: Ejecutar Paso 1 (script SQL) que crea la columna

### Error: "duplicate key value violates unique constraint"
**Solución**: El constraint UNIQUE ya existe, ignorar error o modificar script SQL

### API devuelve settlements vacío
**Solución**: Ejecutar Paso 2 (setup_history.py) para cargar settlements

### No se ven iconos en el mapa
**Solución**: Verificar zoom >= 12 (settlements solo visibles en zoom alto)

### Overpass API timeout persistente
**Solución**: El script automáticamente genera caminos sintéticos (no requiere acción)

---

## 📞 SOPORTE

Para más información, revisar:
- `sql/005_fix_constraints_and_views.sql` - Script de reparación SQL
- `tools/terrain_extractor/extractor.py` - Lógica de renaturalización
- `tools/terrain_extractor/setup_history.py` - Setup de infraestructura
- `server/index.js` - Endpoints API
- `client/src/components/MapViewer.vue` - Frontend con SVG

---

**Última actualización**: 2026-02-02
**Estado**: ✅ Código completo, listo para ejecución
