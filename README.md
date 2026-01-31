# Mediev-H3 Game

Juego medieval basado en mapas hexagonales H3 con visualización de terrenos de la **Península Ibérica, Portugal e Islas Baleares** usando datos ESA WorldCover.

## 📋 Requisitos previos

- **Node.js** v18 o superior
- **Python** 3.8 o superior
- **PostgreSQL** 12 o superior (recomendado: [Neon.tech](https://neon.tech))
- **npm** o **yarn**

## ⚙️ Configuración

El proyecto utiliza un archivo de configuración centralizado que define parámetros del mapa, API y región.

### 1. Copiar plantilla de configuración

```bash
cp config.json.example config.json
```

### 2. Parámetros de configuración

El archivo `config.json` contiene los siguientes parámetros:

#### **MAP** - Configuración del mapa
| Parámetro | Valor por defecto | Descripción |
|-----------|-------------------|-------------|
| `DEFAULT_CENTER` | `[42.599, -5.573]` | Coordenadas del centro inicial (León, España) |
| `DEFAULT_ZOOM` | `13` | Nivel de zoom inicial |
| `H3_MIN_RENDER_ZOOM` | `11` | Zoom mínimo para renderizar hexágonos H3 |
| `OPACITY_DEFAULT` | `0.6` | Opacidad por defecto de los hexágonos (0.0 - 1.0) |

#### **API** - Configuración del servidor
| Parámetro | Valor por defecto | Descripción |
|-----------|-------------------|-------------|
| `MAX_RESULTS_LIMIT` | `20000` | Máximo de hexágonos devueltos por petición |
| `DEBOUNCE_MS` | `300` | Tiempo de debounce (ms) para peticiones al mover el mapa |

#### **REGION** - Región geográfica
| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `NAME` | `"Iberian Peninsula & Balearic Islands"` | Nombre de la región |
| `BOUNDING_BOX.min_lat` | `35.0` | Latitud mínima (sur) |
| `BOUNDING_BOX.max_lat` | `44.5` | Latitud máxima (norte) |
| `BOUNDING_BOX.min_lng` | `-10.0` | Longitud mínima (oeste) |
| `BOUNDING_BOX.max_lng` | `5.0` | Longitud máxima (este) |

#### **H3** - Configuración de la malla hexagonal
| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `RESOLUTION` | `8` | Resolución H3 (~0.461 km² por hexágono) |

### 3. Personalización

Puedes modificar estos valores según tus necesidades:

- **Cambiar región inicial**: Modifica `DEFAULT_CENTER` con las coordenadas `[lat, lng]` deseadas
- **Ajustar rendimiento**: Reduce `MAX_RESULTS_LIMIT` si el servidor es lento
- **Mejorar responsividad**: Ajusta `DEBOUNCE_MS` (valores más altos = menos peticiones)
- **Cambiar cobertura geográfica**: Modifica `BOUNDING_BOX` para otras regiones

## 🚀 Inicio rápido

### 1. Configuración inicial

#### Clonar el repositorio
```bash
git clone <repository-url>
cd mediev-h3-game
```

#### Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:
```env
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
```

### 2. Arrancar el servidor (Backend)

El servidor Node.js/Express proporciona la API REST para el mapa.

#### Instalación de dependencias
```bash
cd server
npm install
```

#### Iniciar el servidor
```bash
npm start
```

El servidor estará disponible en **http://localhost:3000**

**Endpoints disponibles:**
- `GET /api/map/region?minLat=X&maxLat=Y&minLng=Z&maxLng=W` - Obtiene hexágonos H3 dentro del bounding box
- `GET /api/terrain-types` - Obtiene todos los tipos de terreno con colores (para la leyenda)
- `GET /health` - Health check del servidor

#### Logs del servidor
```
🚀 Server running on http://localhost:3000
📍 API endpoint: http://localhost:3000/api/map/region
```

### 3. Arrancar el cliente (Frontend)

El cliente Vue.js + Vite renderiza el mapa interactivo con Leaflet.

#### Instalación de dependencias
```bash
cd client
npm install
```

#### Configurar URL del backend (opcional)
Crea un archivo `.env` en `/client` si necesitas cambiar la URL del API:

```env
VITE_API_URL=http://localhost:3000
```

#### Iniciar el cliente en modo desarrollo
```bash
npm run dev
```

El cliente estará disponible en **http://localhost:5173**

#### Build para producción
```bash
npm run build
npm run preview
```

## 📁 Estructura del proyecto

```
mediev-h3-game/
├── client/              # Frontend Vue.js + Vite
│   ├── src/
│   │   ├── components/
│   │   │   └── MapViewer.vue    # Componente del mapa
│   │   ├── App.vue
│   │   └── main.js
│   └── package.json
│
├── server/              # Backend Node.js + Express
│   ├── index.js         # Servidor principal
│   ├── db.js            # Configuración de PostgreSQL
│   └── package.json
│
├── sql/                 # Scripts SQL
│   ├── 001_initial.sql
│   ├── 002_terrain_types.sql
│   ├── 003_terrain_data.sql
│   └── 004_add_terrain_colors.sql
│
├── tools/               # Herramientas auxiliares
│   └── terrain_extractor/    # Extractor de datos GeoTIFF
│       ├── extractor.py
│       ├── config.example.py
│       └── README.md
│
├── data/                # Datos GeoTIFF (no versionado)
├── .env                 # Variables de entorno (no versionado)
└── README.md            # Este archivo
```

## 🗺️ Visualización del mapa

Una vez que tanto el servidor como el cliente estén ejecutándose:

1. Abre tu navegador en **http://localhost:5173**
2. Verás el mapa centrado en **León, España** con hexágonos H3 coloreados por tipo de terreno
3. Los hexágonos solo se cargan cuando el **zoom >= 11** para optimizar rendimiento
4. **Navega por la Península Ibérica** - los hexágonos se cargan dinámicamente al mover el mapa

### Controles del mapa

- **Selector de capa base** (superior izquierda): Alterna entre OpenStreetMap y vista Satélite
- **Leyenda** (panel lateral): Muestra todos los tipos de terreno con sus colores, **ordenados alfabéticamente**
- **Control de transparencia** (panel lateral): Ajusta la opacidad de los hexágonos (10-100%)
- **Información** (panel lateral): Contador de hexágonos visibles y nivel de zoom actual

### Interacción

- **Haz clic en un hexágono** para ver su tipo de terreno y código H3
- **Pasa el ratón** sobre un hexágono para resaltarlo
- **Mueve el mapa** - los hexágonos se cargan automáticamente (con debounce de 300ms)

### Tipos de terreno y colores

| Terreno | Color |
|---------|-------|
| Vegas Reales | 🟢 Verde fértil (#7db35d) |
| Tierras de Secano | 🟤 Marrón claro (#b8a170) |
| Yermos | ⚪ Gris piedra (#9e9e9e) |
| Picos de Granito | 🔵 Azul grisáceo (#546e7a) |
| Oteros | 🟤 Marrón colina (#a1887f) |
| Espesuras | 🌲 Verde bosque (#2d5a27) |
| Sotos | 🌳 Verde arboleda (#558b2f) |
| Albuferas | 💧 Azul agua (#4fc3f7) |
| Tremedales | 🟫 Marrón pantano (#4e342e) |
| Estepas | 💚 Verde amarillento (#d4e157) |

## 🛠️ Desarrollo

### Ejecutar ambos servicios en paralelo

**Terminal 1 - Servidor:**
```bash
cd server && npm start
```

**Terminal 2 - Cliente:**
```bash
cd client && npm run dev
```

### Hot reload

- **Frontend**: Vue + Vite tiene hot reload automático
- **Backend**: Usa `nodemon` para hot reload (opcional)
  ```bash
  npm install -g nodemon
  nodemon server/index.js
  ```

## 🏗️ Arquitectura y Optimizaciones

### Sistema Escalado para Península Ibérica

El sistema está diseñado para manejar **millones de hexágonos H3** cubriendo toda la Península Ibérica:

#### **Backend (Node.js + Express)**
- ✅ **Filtrado por Bounding Box**: Solo devuelve hexágonos visibles en el viewport
- ✅ **Límite de resultados**: Máximo 20,000 hexágonos por petición
- ✅ **Conversión eficiente**: BigInt → Hex string en memoria
- ✅ **Endpoint de tipos de terreno**: Caché de colores para la leyenda

#### **Frontend (Vue + Leaflet)**
- ✅ **Carga dinámica**: Peticiones solo cuando zoom >= 11
- ✅ **Debouncing**: 300ms de retraso al mover el mapa (evita saturar la API)
- ✅ **Limpieza de capas**: Remueve hexágonos antiguos antes de renderizar nuevos
- ✅ **Renderizado progresivo**: Logs cada 500 hexágonos para monitorear performance

#### **Extractor de Datos (Python)**
- ✅ **Caché de rásters**: Abre todos los .tif una sola vez y los mantiene en memoria
- ✅ **Muestreo inteligente**: Identifica dinámicamente qué tile cubre cada coordenada
- ✅ **Inserción en lotes**: `execute_values` con batches de 1000 registros
- ✅ **Manejo robusto**: Asigna terreno por defecto (Yermos) si coordenada fuera de cobertura
- ✅ **Máscara de tierra (Natural Earth)**: Detecta mar abierto antes de procesar TIF (optimización)
- ✅ **Costa Inteligente**: Post-procesamiento que reclasifica ríos/agua adyacentes al mar como costa
- ✅ **Detección de montaña**: Identifica alta montaña (ID 13) usando nieve (valor 70) y vecindad
- ✅ **Elevación SRTM**: Descarga automática de datos de elevación NASA SRTM 90m para detección de montañas/colinas

### Performance Esperada

| Métrica | Valor |
|---------|-------|
| Hexágonos H3 (resolución 8) | ~2-3 millones para toda la Península |
| Tiempo de extracción inicial | ~30-60 min (depende de velocidad de DB) |
| Hexágonos renderizados por vista | 100-5000 (según zoom) |
| Tiempo de respuesta API | 50-200ms |
| Renderizado cliente | 1-2s para 5000 hexágonos |

## 📊 Extracción de datos de terreno

### Proceso de Extracción

El extractor procesa archivos GeoTIFF de ESA WorldCover y genera la malla H3 completa:

```bash
cd tools/terrain_extractor
cp config.example.py config.py
# Editar config.py con tus credenciales de Neon
python extractor.py
```

### Qué hace el extractor:

1. **Genera malla H3** para el bounding box de la Península Ibérica (~2-3M celdas)
2. **Escanea archivos .tif** disponibles en `../../data/`
3. **Mapea coordenadas → tiles**: Cada celda H3 busca qué archivo la cubre
4. **Muestrea valores**: Lee el pixel del ráster en cada centro de celda
5. **Mapea a tipos de terreno**: ESA WorldCover → Tipos medievales usando 5 fases:
   - **FASE 1 (Mar)**: Celdas fuera de cobertura o en mar abierto (usando máscara Natural Earth)
   - **FASE 2 (Costa)**: Centro NoData pero vecinos tierra
   - **FASE 3 (Ríos/Pantanos)**: Valores 0, 80 (agua), 90, 95 (humedales)
   - **FASE 4 (Alta Montaña)**: Valor 70 (nieve) o valor 60 con vecinos nieve
   - **FASE 5 (Resto)**: Mapeo estándar según TERRAIN_MAPPING
6. **Post-procesamiento - Costa Inteligente**: Reclasifica celdas de Río/Agua que tocan el mar como Costa (ID 2)
7. **Inserta en DB**: Batches de 1000 con `TRUNCATE` inicial

### Mapeo de Terrenos ESA WorldCover

El extractor traduce los valores de ESA WorldCover a tipos de terreno medievales:

| Valor ESA | Tipo ESA WorldCover | Terrain Type ID | Nombre Medieval |
|-----------|---------------------|-----------------|-----------------|
| 10 | Tree cover | 6 | Espesuras (Bosque Frondoso) |
| 20 | Shrubland | 7 | Sotos (Arboledas) |
| 30 | Grassland | 10 | Estepas |
| 40 | Cropland | 1 | Vegas Reales (Tierras Fértiles) |
| 50 | Built-up | 5 | Oteros (Colinas/Ciudades) |
| 60 | Bare / sparse vegetation | 3 | Yermos (Páramos) |
| 70 | Snow and ice | 3 | Yermos (Páramo Helado) |
| **80** | **Permanent water bodies** | **8** | **Albuferas (Lagos)** |
| 90 | Herbaceous wetland | 9 | Tremedales (Pantanos) |
| 95 | Mangroves | 9 | Tremedales |
| 100 | Moss and lichen | 2 | Tierras de Secano |

**Nota importante sobre terrenos acuáticos:**
- El valor **80 (Permanent water bodies)** se mapea a **Albuferas (ID 8)**, representando lagos, ríos y embalses
- Los **pantanos y humedales** (valores 90 y 95) se mapean a **Tremedales (ID 9)**
- Asegúrate de que la tabla `terrain_types` en tu base de datos incluya estos IDs con sus colores correspondientes

### Lógicas Espaciales Avanzadas

#### 🏖️ **Costa Inteligente (Post-procesamiento)**

El extractor implementa detección automática de costa usando análisis de vecindad H3:

**Algoritmo:**
1. Identifica todas las celdas clasificadas como **Río (ID 4)** o **Agua (ID 3)**
2. Para cada celda, obtiene sus vecinos inmediatos usando `h3.grid_disk(h3_index, 1)`
3. Si al menos **un vecino es Mar (ID 1)**, reclasifica la celda como **Costa (ID 2)**
4. Esto detecta automáticamente estuarios, rías, bahías y desembocaduras de ríos

**Ventajas:**
- ✅ Detección precisa de zonas costeras sin necesidad de clasificación manual
- ✅ Distingue entre ríos interiores y agua costera
- ✅ Procesa ~1000 celdas/s usando diccionarios para búsqueda O(1)

#### ⛰️ **Detección de Alta Montaña**

Sistema multi-fase para identificar zonas de alta montaña:

**Criterios:**
- **Valor TIF 70 (Nieve/Hielo)** → Alta Montaña (ID 13) [Directo]
- **Valor TIF 60 (Suelo desnudo) + vecino con valor 70** → Alta Montaña (ID 13) [Transición]
- Muestrea 6 puntos circulares alrededor de cada celda para detectar vecinos con nieve

**Aplicación:**
- Detecta Pirineos, Sierra Nevada, Picos de Europa
- Identifica zonas de transición montañosa (rocas y praderas alpinas)

#### 🌊 **Refinamiento de Ríos**

Lógica especial para distinguir agua marina vs. agua dulce:

**Regla para TIF valor 80 (Permanent water bodies):**
- Si `is_on_land(lat, lng)` = **False** (fuera del polígono de tierra Natural Earth) → **Mar (ID 1)**
- Si `is_on_land(lat, lng)` = **True** (dentro de tierra firme) → **Río (ID 4)**
- Permite detectar lagos interiores vs. mar abierto

#### 🏔️ **Sistema de Elevación SRTM (NASA)**

El extractor integra datos de elevación SRTM (Shuttle Radar Topography Mission) de la NASA para detección precisa de relieve:

**Proceso automático:**
1. **Descarga automática**: Usa la librería `elevation` para descargar tiles SRTM 90m de resolución
2. **Caché local**: Almacena tiles en `data/srtm_cache/` para evitar redescargas
3. **Muestreo por celda**: Consulta elevación del centro de cada hexágono H3

**Reglas de relieve (FASE 4.5):**
- **Elevación > 1000m** → **Alta Montaña (ID 13)** [Sobreescribe clasificación TIF]
- **Elevación 400-1000m** → **Colinas (ID 12)** [Solo para terrenos "blandos": valores TIF 20, 30, 40, 60]
- **Elevación < 400m** → Mantiene clasificación ESA WorldCover original

**Ventajas:**
- ✅ Detecta montañas que ESA WorldCover clasifica como "bare soil" (valor 60)
- ✅ Identifica colinas en zonas de cultivo o matorral (valores 20, 30, 40)
- ✅ No interfiere con clasificaciones acuáticas (Mar, Costa, Río, Pantanos)
- ✅ Datos NASA SRTM de dominio público, sin restricciones

**Cobertura:**
- SRTM 90m: Latitudes entre 60°N y 56°S (cubre toda la Península Ibérica)
- Resolución vertical: ±16 metros de precisión

Ver [tools/terrain_extractor/README.md](tools/terrain_extractor/README.md) para más detalles.

## 🔧 Troubleshooting

### El servidor no conecta a la base de datos
- Verifica que `DATABASE_URL` en `.env` sea correcta
- Asegúrate de que PostgreSQL esté ejecutándose
- Verifica que la base de datos exista y tenga las tablas creadas

### El cliente no muestra hexágonos
- Verifica que el servidor esté ejecutándose en `http://localhost:3000`
- Abre la consola del navegador (F12) para ver errores
- Verifica que `/api/map/region` devuelva datos:
  ```bash
  curl http://localhost:3000/api/map/region
  ```

### Error "Cannot find module"
```bash
# En server/
cd server && npm install

# En client/
cd client && npm install
```

## 📝 Reglas del proyecto

Ver [CLAUDE_RULES.md](CLAUDE_RULES.md) para las convenciones de código y nomenclatura.

## 📄 Licencia

[Especificar licencia]

## 👥 Contribuir

[Especificar proceso de contribución]
