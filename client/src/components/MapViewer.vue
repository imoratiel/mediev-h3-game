<template>
  <div class="app-container">
    <!-- Sidebar Panel -->
    <div class="sidebar">
      <!-- Legend -->
      <div class="legend">
        <h3>Leyenda de Terrenos</h3>
        <div v-if="terrainTypes.length === 0" class="legend-loading">
          Cargando tipos de terreno...
        </div>
        <div v-else class="legend-items">
          <div
            v-for="terrain in terrainTypes"
            :key="terrain.terrain_type_id"
            class="legend-item"
          >
            <div
              class="legend-color"
              :style="{ backgroundColor: terrain.color }"
            ></div>
            <span class="legend-name">{{ terrain.name }}</span>
          </div>
        </div>
      </div>

      <!-- Transparency Control -->
      <div class="transparency-control">
        <h4>Transparencia</h4>
        <div class="slider-container">
          <input
            id="opacity-slider"
            type="range"
            min="10"
            max="100"
            v-model="hexagonOpacity"
            @input="updateHexagonOpacity"
          />
          <span class="opacity-value">{{ hexagonOpacity }}%</span>
        </div>
      </div>

      <!-- Map Info -->
      <div class="map-info">
        <h4>Información</h4>
        <p><strong>Hexágonos:</strong> {{ hexagonCount }}</p>
        <p><strong>Zoom:</strong> {{ currentZoom }}</p>
        <p v-if="currentZoom < MIN_ZOOM" class="warning">
          ⚠️ Zoom mínimo: {{ MIN_ZOOM }}
        </p>
      </div>

      <!-- Share Link Button -->
      <div class="share-link">
        <button @click="copyLinkToClipboard" class="copy-link-btn">
          <span v-if="!copyLinkSuccess">📋 Copiar enlace</span>
          <span v-else class="success">✓ ¡Copiado!</span>
        </button>
      </div>
    </div>

    <!-- Map Container -->
    <div class="map-container">
      <div v-if="loading" class="loading-overlay">
        <div class="spinner"></div>
        <p>Cargando mapa...</p>
      </div>
      <div v-if="error" class="error-message">
        <p>❌ Error: {{ error }}</p>
      </div>
      <div id="map" ref="mapContainer"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import { cellToBoundary } from 'h3-js';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

const mapContainer = ref(null);
const loading = ref(false);
const error = ref(null);
const hexagonCount = ref(0);
const hexagonOpacity = ref(60);
const currentZoom = ref(13);
const terrainTypes = ref([]);
const copyLinkSuccess = ref(false);

let map = null;
let hexagonLayer = null;
let debounceTimer = null;

// Configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const MIN_ZOOM = 11;
const LEON_CENTER = [42.599, -5.573];
const INITIAL_ZOOM = 13;
const DEBOUNCE_DELAY = 500; // ms

/**
 * Leer parámetros de la URL (lat, lng, zoom)
 * Retorna objeto con las coordenadas y zoom, o null si no existen
 */
const getURLParams = () => {
  const params = new URLSearchParams(window.location.search);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');

  if (lat && lng && zoom) {
    return {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      zoom: parseInt(zoom, 10)
    };
  }
  return null;
};

/**
 * Actualizar la URL del navegador con las coordenadas y zoom actuales
 * Usa history.replaceState para no crear entradas en el historial
 */
const updateURLParams = () => {
  if (!map) return;

  const center = map.getCenter();
  const zoom = map.getZoom();

  // Redondear coordenadas a 5 decimales
  const lat = center.lat.toFixed(5);
  const lng = center.lng.toFixed(5);

  // Construir nueva URL
  const newURL = `${window.location.pathname}?lat=${lat}&lng=${lng}&zoom=${zoom}`;

  // Actualizar URL sin recargar la página
  window.history.replaceState({}, '', newURL);
};

// Base map layers
let osmLayer = null;
let satelliteLayer = null;

/**
 * Initialize Leaflet map
 * Usa parámetros de URL si existen, caso contrario usa valores por defecto (León)
 */
const initMap = () => {
  // Leer parámetros de la URL
  const urlParams = getURLParams();
  const center = urlParams ? [urlParams.lat, urlParams.lng] : LEON_CENTER;
  const zoom = urlParams ? urlParams.zoom : INITIAL_ZOOM;

  console.log(`Initializing map at [${center[0]}, ${center[1]}], zoom ${zoom}`);

  map = L.map('map', {
    center: center,
    zoom: zoom,
    zoomControl: true,
  });

  // OpenStreetMap layer
  osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  });

  // Satellite layer (Esri World Imagery)
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '© Esri',
      maxZoom: 18,
    }
  );

  // Add OSM as default
  osmLayer.addTo(map);

  // Layer control
  const baseMaps = {
    'OpenStreetMap': osmLayer,
    'Satélite': satelliteLayer,
  };
  L.control.layers(baseMaps).addTo(map);

  // Create a layer group for hexagons
  hexagonLayer = L.layerGroup().addTo(map);

  // Track zoom level
  currentZoom.value = map.getZoom();

  // Event listeners
  map.on('moveend', handleMapMove);
  map.on('zoomend', handleZoomChange);

  // Initial load
  loadHexagonsIfZoomValid();
};

/**
 * Handle map movement (with debouncing)
 * Actualiza hexágonos y URL del navegador
 */
const handleMapMove = () => {
  // Clear previous timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set new timer
  debounceTimer = setTimeout(() => {
    loadHexagonsIfZoomValid();
    updateURLParams(); // Actualizar URL con nueva posición
  }, DEBOUNCE_DELAY);
};

/**
 * Handle zoom change
 */
const handleZoomChange = () => {
  currentZoom.value = map.getZoom();
  loadHexagonsIfZoomValid();
};

/**
 * Load hexagons only if zoom is valid (>= MIN_ZOOM)
 */
const loadHexagonsIfZoomValid = () => {
  if (map.getZoom() >= MIN_ZOOM) {
    fetchHexagonData();
  } else {
    // Clear hexagons if zoom is too low
    clearHexagons();
  }
};

/**
 * Clear all hexagons from the map
 */
const clearHexagons = () => {
  if (hexagonLayer) {
    hexagonLayer.clearLayers();
    hexagonCount.value = 0;
  }
};

/**
 * Fetch hexagon data from backend API based on current map bounds
 */
const fetchHexagonData = async () => {
  try {
    loading.value = true;
    error.value = null;

    // Get current map bounds
    const bounds = map.getBounds();
    const params = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
    };

    const response = await axios.get(`${API_URL}/api/map/region`, { params });
    const hexagons = response.data;

    hexagonCount.value = hexagons.length;
    renderHexagons(hexagons);

    loading.value = false;
  } catch (err) {
    console.error('Failed to fetch hexagon data:', err);
    error.value = err.message || 'Failed to load map data';
    loading.value = false;
  }
};

/**
 * Fetch terrain types for the legend
 */
const fetchTerrainTypes = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/terrain-types`);
    // Sort alphabetically by name
    terrainTypes.value = response.data.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    console.log(`✓ Loaded ${terrainTypes.value.length} terrain types (sorted alphabetically)`);
  } catch (err) {
    console.error('Failed to fetch terrain types:', err);
  }
};

/**
 * Render H3 hexagons on the map
 * @param {Array} hexagons - Array of {h3_index, name, color}
 */
const renderHexagons = (hexagons) => {
  // Clear existing hexagons
  hexagonLayer.clearLayers();

  console.log(`Rendering ${hexagons.length} hexagons...`);

  hexagons.forEach((hex, index) => {
    try {
      // Get boundary coordinates for this H3 cell
      const boundary = cellToBoundary(hex.h3_index);

      // Create Leaflet polygon
      const polygon = L.polygon(boundary, {
        color: hex.color,
        fillColor: hex.color,
        fillOpacity: hexagonOpacity.value / 100,
        weight: 1,
        opacity: 0.8,
      });

      // Add hover effect
      polygon.on('mouseover', function () {
        this.setStyle({
          weight: 3,
          fillOpacity: Math.min(hexagonOpacity.value / 100 + 0.2, 1.0),
        });
      });

      polygon.on('mouseout', function () {
        this.setStyle({
          weight: 1,
          fillOpacity: hexagonOpacity.value / 100,
        });
      });

      // Add popup with terrain name
      polygon.bindPopup(`
        <strong>${hex.name}</strong><br>
        H3: ${hex.h3_index}
      `);

      // Add to layer group
      polygon.addTo(hexagonLayer);

      // Log progress every 500 hexagons
      if ((index + 1) % 500 === 0) {
        console.log(`Rendered ${index + 1} hexagons...`);
      }
    } catch (err) {
      console.error(`Error rendering hexagon ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Finished rendering ${hexagons.length} hexagons`);
};

/**
 * Update opacity of all hexagons
 */
const updateHexagonOpacity = () => {
  hexagonLayer.eachLayer((layer) => {
    if (layer.setStyle) {
      layer.setStyle({
        fillOpacity: hexagonOpacity.value / 100,
      });
    }
  });
};

/**
 * Copiar enlace actual al portapapeles
 */
const copyLinkToClipboard = async () => {
  try {
    // Asegurarse de que la URL esté actualizada
    updateURLParams();

    // Copiar URL completa al portapapeles
    const url = window.location.href;
    await navigator.clipboard.writeText(url);

    // Mostrar feedback visual
    copyLinkSuccess.value = true;
    console.log('✓ Link copied to clipboard:', url);

    // Reset feedback después de 2 segundos
    setTimeout(() => {
      copyLinkSuccess.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy link:', err);
    error.value = 'No se pudo copiar el enlace';
  }
};

// Lifecycle hooks
onMounted(() => {
  initMap();
  fetchTerrainTypes();
});

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  if (map) {
    map.remove();
  }
});
</script>

<style scoped>
.app-container {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  width: 280px;
  background: #f5f5f5;
  border-right: 2px solid #ddd;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Legend */
.legend {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.legend h3 {
  margin: 0 0 15px 0;
  font-size: 18px;
  font-weight: bold;
  color: #333;
  border-bottom: 2px solid #3498db;
  padding-bottom: 8px;
}

.legend-loading {
  font-size: 13px;
  color: #666;
  text-align: center;
  padding: 10px;
}

.legend-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px;
  border-radius: 4px;
  transition: background 0.2s;
}

.legend-item:hover {
  background: #f9f9f9;
}

.legend-color {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid #333;
  flex-shrink: 0;
}

.legend-name {
  font-size: 14px;
  line-height: 1.3;
  color: #555;
}

/* Transparency Control */
.transparency-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.transparency-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.slider-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transparency-control input[type='range'] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #ddd;
  outline: none;
  -webkit-appearance: none;
}

.transparency-control input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3498db;
  cursor: pointer;
}

.transparency-control input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3498db;
  cursor: pointer;
  border: none;
}

.opacity-value {
  font-size: 14px;
  font-weight: bold;
  color: #3498db;
  text-align: center;
}

/* Map Info */
.map-info {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.map-info h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.map-info p {
  margin: 8px 0;
  font-size: 14px;
  color: #555;
}

.map-info .warning {
  color: #f44336;
  font-weight: bold;
  margin-top: 10px;
}

/* Map Container */
.map-container {
  position: relative;
  flex: 1;
  height: 100vh;
}

#map {
  width: 100%;
  height: 100%;
  z-index: 1;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.error-message {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #f44336;
  color: white;
  padding: 15px 25px;
  border-radius: 5px;
  z-index: 1001;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

/* Share Link Button */
.share-link {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.copy-link-btn {
  width: 100%;
  padding: 12px 16px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.3s, transform 0.1s;
  box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);
}

.copy-link-btn:hover {
  background: #2980b9;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(52, 152, 219, 0.4);
}

.copy-link-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(52, 152, 219, 0.3);
}

.copy-link-btn .success {
  color: #2ecc71;
  font-weight: bold;
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Responsive Design */
@media (max-width: 768px) {
  .sidebar {
    width: 100%;
    height: auto;
    max-height: 40vh;
    border-right: none;
    border-bottom: 2px solid #ddd;
  }

  .app-container {
    flex-direction: column;
  }

  .map-container {
    height: 60vh;
  }
}
</style>
