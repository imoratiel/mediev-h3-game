# 🔄 SERVIDOR Y CLIENTE REESCRITOS - Resumen Completo

**Fecha**: 2026-02-02
**Estado**: ✅ Completado y Verificado

## 📋 PROBLEMA IDENTIFICADO

La base de datos fue reseteada con el esquema de `001_initial.sql`, pero el servidor y cliente seguían usando la estructura antigua:
- **Error**: `column "settlement_type" does not exist`
- **Causa**: La columna se llama `type`, no `settlement_type`
- **Estructura incorrecta**: Código intentaba consultar `lat`/`lng` directamente de la BD (no existen)

---

## 🔧 CAMBIOS REALIZADOS

### 1. SERVIDOR REESCRITO (`server/index.js`)

**Archivo**: [server/index.js](server/index.js)

#### **Cambios Clave**:

✅ **Uso de h3-js en el Backend**:
```javascript
// ANTES: Se esperaba que la BD tuviera lat/lng
// AHORA: Generamos índices H3 desde el bounding box

const h3CellsSet = h3.polygonToCells(polygon, H3_RESOLUTION);
const h3IndexValues = cellsToQuery.map(hexStr => BigInt('0x' + hexStr).toString());
```

✅ **Consulta Correcta a la Vista**:
```sql
-- Usa la vista v_map_display que combina h3_map + terrain_types + settlements
SELECT h3_index, terrain_name, terrain_color, has_road,
       settlement_name, settlement_type, population_rank
FROM v_map_display
WHERE h3_index = ANY($1::text[])
```

✅ **Endpoints Actualizados**:
- **GET /api/map/region**: Devuelve `terrain_name`, `terrain_color`, `settlement` (object)
- **GET /api/settlements**: Devuelve `type` (no `settlement_type`), con `lat`/`lng` calculadas usando h3-js
- **GET /api/terrain-types**: Sin cambios
- **GET /health**: Añadido indicador de conexión a BD

---

### 2. CLIENTE ACTUALIZADO (`client/src/components/MapViewer.vue`)

**Archivo**: [client/src/components/MapViewer.vue](client/src/components/MapViewer.vue)

#### **Cambios Clave**:

✅ **Nombres de Campo Correctos**:
```javascript
// ANTES:
const terrainName = hex.name;
const terrainColor = hex.color;

// AHORA:
const terrainName = hex.terrain_name || hex.name || 'Desconocido';
const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';
```

✅ **Settlement sin Period en Popup** (ya que el endpoint /api/map/region no lo incluye):
```javascript
// ANTES:
popupContent += `<br>Periodo: ${hex.settlement.period}`;

// AHORA: (eliminado)
// Solo se muestra: nombre, tipo, population_rank
```

✅ **Compatibilidad Backwards**:
- Código soporta tanto `terrain_name` como `name` (fallback)
- Soporta tanto `terrain_color` como `color` (fallback)

---

## 🗄️ ESQUEMA ACTUAL DE LA BASE DE DATOS

### Tabla: `h3_map`
```sql
CREATE TABLE h3_map (
    id SERIAL PRIMARY KEY,
    h3_index BIGINT NOT NULL UNIQUE,
    terrain_type_id INT NOT NULL REFERENCES terrain_types,
    has_road BOOLEAN DEFAULT FALSE,
    infrastructure_level INT DEFAULT 0,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla: `settlements`
```sql
CREATE TABLE settlements (
    settlement_id SERIAL PRIMARY KEY,
    h3_index TEXT NOT NULL UNIQUE,  -- ⚠️ TEXTO, no BIGINT
    name TEXT NOT NULL,
    type TEXT,                       -- ⚠️ "type", no "settlement_type"
    population_rank INTEGER,
    period TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT settlements_population_rank_positive CHECK (population_rank >= 0)
);
```

### Vista: `v_map_display`
```sql
CREATE OR REPLACE VIEW v_map_display AS
SELECT
    m.id,
    m.h3_index::TEXT as h3_index,   -- Cast a TEXT para JSON
    m.terrain_type_id,
    m.has_road,
    t.name as terrain_name,          -- ⚠️ Alias: terrain_name
    t.color as terrain_color,        -- ⚠️ Alias: terrain_color
    s.name AS settlement_name,       -- ⚠️ Alias: settlement_name
    s.type AS settlement_type,       -- ⚠️ Alias: settlement_type
    s.population_rank
FROM h3_map m
JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
LEFT JOIN settlements s ON m.h3_index::TEXT = s.h3_index;
```

**⚠️ IMPORTANTE**:
- `settlements.h3_index` es **TEXT**
- `h3_map.h3_index` es **BIGINT**
- La vista hace el cast: `m.h3_index::TEXT`

---

## ✅ VERIFICACIÓN DE FUNCIONAMIENTO

### Test 1: Health Check
```bash
curl http://localhost:3000/health
```

**Salida Esperada**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-02T14:16:57.707Z",
  "database": "connected"
}
```

**✅ RESULTADO**: Funcionando correctamente

---

### Test 2: Settlements Endpoint
```bash
curl http://localhost:3000/api/settlements
```

**Salida Actual**:
```json
[]
```

**Explicación**: Array vacío porque la tabla `settlements` está vacía después del reset.

**Próximo Paso**: Ejecutar `tools/terrain_extractor/setup_history.py` para poblar la tabla.

---

### Test 3: Map Region Endpoint
```bash
curl "http://localhost:3000/api/map/region?minLat=42.5&maxLat=42.7&minLng=-5.7&maxLng=-5.5&res=8"
```

**Salida Esperada**: Array de hexágonos con:
```json
[
  {
    "h3_index": "...",
    "terrain_name": "Bosque",
    "terrain_color": "#558b2f",
    "has_road": false,
    "settlement": null
  }
]
```

**Estado**: ⏳ Pendiente de verificar (requiere datos en h3_map)

---

## 📊 ESTRUCTURA DE RESPUESTAS API

### GET /api/map/region
```json
[
  {
    "h3_index": "8c2a100c0892bff",
    "terrain_name": "Bosque",
    "terrain_color": "#558b2f",
    "has_road": false,
    "settlement": {
      "name": "Legio VII Gemina (León)",
      "type": "city",
      "population_rank": 1
    }
  }
]
```

**Campos**:
- `h3_index`: String hexadecimal
- `terrain_name`: Nombre del tipo de terreno (antes `name`)
- `terrain_color`: Color hex del terreno (antes `color`)
- `has_road`: Boolean
- `settlement`: Object o null
  - `name`: Nombre del asentamiento
  - `type`: Tipo (city/town/village/fort/monastery)
  - `population_rank`: Ranking de población (1-20)
  - **NO incluye `period`** (solo disponible en /api/settlements)

---

### GET /api/settlements
```json
[
  {
    "name": "Legio VII Gemina (León)",
    "h3_index": "8c2a100c0892bff",
    "lat": 42.59677,
    "lng": -5.56881,
    "type": "city",
    "population_rank": 1,
    "period": "roman"
  }
]
```

**Campos**:
- `name`: Nombre del asentamiento
- `h3_index`: String hexadecimal
- `lat`, `lng`: Coordenadas calculadas con h3-js
- `type`: Tipo (city/town/village/fort/monastery)
- `population_rank`: Ranking (1-20)
- `period`: Periodo (roman/medieval)

---

## 🚀 PRÓXIMOS PASOS

### Paso 1: Poblar la Tabla `settlements`

```bash
cd tools/terrain_extractor
python setup_history.py
```

**Lo que hace**:
1. Genera o carga `data/vectors/settlements.csv` (20 ciudades históricas)
2. Convierte coordenadas lat/lng a índices H3
3. Inserta settlements en la tabla usando `ON CONFLICT (h3_index) DO UPDATE`
4. Descarga vías romanas de Overpass API (o genera caminos sintéticos)
5. Marca hexágonos con `has_road=TRUE`

**Salida Esperada**:
```
============================================================
SETUP DE INFRAESTRUCTURA HISTÓRICA
============================================================
Cargados 20 asentamientos desde CSV
Asentamientos historicos inyectados: 20
Distribución por tipo:
  city: 10
  town: 6
  village: 2
  fort: 2
  monastery: 1
============================================================
SETUP COMPLETADO
============================================================
```

---

### Paso 2: (Opcional) Regenerar Mapa Base

**⚠️ ADVERTENCIA**: Solo si necesitas regenerar el mapa completo (30-60 min)

```bash
cd tools/terrain_extractor
python extractor.py
```

**Lo que hace**:
1. Procesa rasters GeoTIFF (elevación, cobertura)
2. Genera hexágonos H3 para la región
3. Asigna terrain_type_id según reglas (mar, costa, bosque, etc.)
4. Renaturaliza ciudades modernas (TIF=50 → terreno natural)
5. Inserta en tabla `h3_map`

---

### Paso 3: Verificar Frontend

1. Abrir navegador en `http://localhost:5173` (Vite dev server)
2. Verificar:
   - ✅ Hexágonos se renderizan correctamente
   - ✅ Colores de terreno correctos
   - ✅ Popups muestran coordenadas lat/lng
   - ✅ Menú lateral derecho con asentamientos (si hay datos)
   - ✅ Click en menú → navegación con flyTo animation
   - ✅ Iconos SVG medievales visibles (zoom >= 12)
   - ✅ Etiquetas con halo blanco legibles

---

## 🔍 TROUBLESHOOTING

### Error: "column 'settlement_type' does not exist"
**Solución**: ✅ Ya resuelto. El servidor ahora usa `type` correctamente.

### Error: "column 'lat' does not exist"
**Solución**: ✅ Ya resuelto. El servidor calcula lat/lng usando h3-js, no consulta la BD.

### Settlements endpoint devuelve array vacío
**Causa**: La tabla `settlements` está vacía después del reset.
**Solución**: Ejecutar `python setup_history.py` (Paso 1)

### Map region endpoint devuelve array vacío
**Causa**: La tabla `h3_map` está vacía o no tiene datos para el bounding box solicitado.
**Solución**:
1. Verificar que hay datos: `SELECT COUNT(*) FROM h3_map;`
2. Si está vacío, ejecutar `python extractor.py` (Paso 2)

### Frontend no muestra hexágonos
**Causa**: Problema de CORS o servidor no está corriendo.
**Solución**:
1. Verificar que el servidor está corriendo: `curl http://localhost:3000/health`
2. Abrir consola del navegador (F12) y revisar errores
3. Verificar que Vite dev server está corriendo: `npm run dev` en carpeta `client`

---

## 📁 ARCHIVOS MODIFICADOS

1. **[server/index.js](server/index.js)** - Servidor reescrito desde cero
2. **[client/src/components/MapViewer.vue](client/src/components/MapViewer.vue)** - Cliente actualizado para usar nuevos campos

---

## 📊 RESUMEN EJECUTIVO

### ✅ COMPLETADO

1. ✅ Servidor reescrito con h3-js integrado
2. ✅ Endpoints API adaptados al nuevo esquema
3. ✅ Cliente actualizado para usar `terrain_name` / `terrain_color`
4. ✅ Servidor iniciado y verificado (health check OK)
5. ✅ Documentación completa generada

### ⏳ PENDIENTE

1. ⏳ Ejecutar `setup_history.py` para poblar settlements
2. ⏳ (Opcional) Ejecutar `extractor.py` si se necesita regenerar mapa
3. ⏳ Verificar frontend con datos reales

---

## 🎯 RESULTADO FINAL ESPERADO

Después de ejecutar los pasos pendientes, el mapa medieval tendrá:

1. **Mapa Base**:
   - Hexágonos H3 con tipos de terreno realistas
   - Colores medievales (bosques, ríos, montañas, etc.)
   - Sin ciudades modernas (Barcelona, Madrid renaturalizadas)

2. **Infraestructura Histórica**:
   - 20 asentamientos históricos con iconos SVG
   - Vías romanas marcadas (bordes dorados)
   - Nombres legibles con halo blanco

3. **Interfaz Funcional**:
   - Navegación fluida con zoom adaptativo
   - Menú lateral con lista de ciudades
   - Popups con coordenadas precisas
   - Animaciones suaves (flyTo)

---

**Última actualización**: 2026-02-02 14:20 UTC
**Estado del servidor**: ✅ Running on http://localhost:3000
**Próximo paso**: Ejecutar `python setup_history.py`
