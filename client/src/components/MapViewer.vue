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

      <!-- H3 Layer Toggle -->
      <div class="h3-toggle-control">
        <h4>Visualización</h4>
        <div class="toggle-container">
          <label class="toggle-label">
            <input
              type="checkbox"
              v-model="showH3Layer"
              @change="toggleH3Layer"
              class="toggle-checkbox"
            />
            <span class="toggle-slider"></span>
            <span class="toggle-text">Mostrar Malla H3</span>
          </label>
        </div>
        <div class="toggle-container">
          <label class="toggle-label">
            <input
              id="toggle-political-view"
              type="checkbox"
              v-model="isPoliticalView"
              @change="togglePoliticalView"
              class="toggle-checkbox"
            />
            <span class="toggle-slider"></span>
            <span class="toggle-text">Vista Política</span>
          </label>
        </div>
      </div>

      <!-- Map Info -->
      <div class="map-info">
        <h4>Información</h4>
        <p><strong>Hexágonos:</strong> {{ hexagonCount }}</p>
        <p><strong>Zoom:</strong> {{ currentZoom }}</p>
        <p><strong>Resolución H3:</strong> {{ currentResolution }}</p>
        <p v-if="currentZoom < MIN_ZOOM" class="warning">
          ⚠️ Zoom mínimo: {{ MIN_ZOOM }}
        </p>
      </div>

      <!-- Navigation Section -->
      <div class="navigation-control">
        <h4>Navegación</h4>
        <div class="search-container">
          <input
            id="search-h3-input"
            type="text"
            v-model="searchH3Input"
            placeholder="Índice H3..."
            @keyup.enter="goToH3Index"
            class="search-input"
          />
          <button
            id="btn-go-to-h3"
            @click="goToH3Index"
            class="search-button"
          >
            🔍
          </button>
        </div>
        <button
          id="link-to-capital"
          @click="goToCapital"
          class="capital-link"
        >
          Ir a la Capital ⭐
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

      <!-- Player Gold Indicator - Top Right -->
      <div class="player-gold-indicator">
        <div class="gold-icon">💰</div>
        <div class="gold-amount">{{ playerGold }}</div>
        <div class="gold-label">Oro</div>
      </div>

      <!-- Action Panel - Medieval Style -->
      <div
        v-if="showActionPanel && selectedHexData"
        class="action-panel"
        :style="{ left: actionPanelPosition.x + 'px', top: actionPanelPosition.y + 'px' }"
      >
        <div class="action-panel-header">
          <h3>⚔️ Territorio</h3>
          <button class="close-button" @click="closeActionPanel">✕</button>
        </div>
        <div class="action-panel-body">
          <!-- Hex Info -->
          <div class="hex-info">
            <p><strong>Terreno:</strong> {{ selectedHexData.terrain_name || 'Desconocido' }}</p>
            <p v-if="selectedHexData.location_name">
              <strong>Nombre:</strong> {{ selectedHexData.location_name }}
            </p>
            <p v-if="selectedHexData.owner_name">
              <strong>Dueño:</strong>
              <span :style="{ color: selectedHexData.player_color }">
                {{ selectedHexData.owner_name }}
              </span>
            </p>
          </div>

          <!-- Actions -->
          <div class="actions">
            <!-- Colonize button if unclaimed -->
            <button
              v-if="!selectedHexData.player_id"
              class="action-button colonize-button"
              @click="colonizeTerritory"
              :disabled="playerGold < 100"
            >
              🏰 Colonizar (100 💰)
            </button>

            <!-- If already owned -->
            <div v-else class="owned-message">
              <p v-if="selectedHexData.player_id === playerId">✅ Este territorio es tuyo</p>
              <p v-else>🛡️ Territorio enemigo</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Toast Notifications Container -->
      <div class="toast-container">
        <div
          v-for="(toast, index) in toasts"
          :key="toast.id"
          :class="['toast', `toast-${toast.type}`, toast.isLeaving ? 'toast-leaving' : '']"
        >
          <span class="toast-icon">{{ getToastIcon(toast.type) }}</span>
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      </div>

      <!-- Settlements Navigation Panel - Medieval Style -->
      <div class="settlements-sidebar">
        <div class="settlements-header">
          <h3>Asentamientos Históricos</h3>
          <p class="subtitle">Galicia, Asturias y León</p>
        </div>
        <div class="settlements-list">
          <div v-if="settlements.length === 0" class="settlements-loading">
            Cargando asentamientos...
          </div>
          <a
            v-for="settlement in settlements"
            :key="settlement.name"
            href="#"
            class="settlement-link"
            :data-type="settlement.type"
            @click.prevent="navigateToSettlement(settlement)"
          >
            <span class="settlement-icon">{{ getSettlementIcon(settlement.type) }}</span>
            <span class="settlement-name">{{ settlement.name }}</span>
            <span class="settlement-type-label">{{ settlement.type }}</span>
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import { cellToBoundary, cellToLatLng, gridDisk } from 'h3-js';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

const mapContainer = ref(null);
const loading = ref(false);
const error = ref(null);
const hexagonCount = ref(0);
const hexagonOpacity = ref(60);
const currentZoom = ref(13);
const currentResolution = ref(8); // H3 resolution (8 or 10)
const terrainTypes = ref([]);
const showH3Layer = ref(true);
const isPoliticalView = ref(true); // Vista política para resaltar territorios de jugadores (activada por defecto)
const settlements = ref([]);

// Player state (hardcoded for testing)
const playerId = ref(1); // Simular que somos el jugador 1
const playerGold = ref(0); // Oro inicial (se carga del servidor)
const playerHexes = ref(new Set()); // Track player's owned hexagons for adjacency checks

// Action panel state
const showActionPanel = ref(false);
const selectedHexData = ref(null);
const actionPanelPosition = ref({ x: 0, y: 0 });

// Navigation search state
const searchH3Input = ref('');
const capitalH3Index = ref(null); // Cache capital location

// Toast notifications state
const toasts = ref([]);
let toastIdCounter = 0;

let map = null;
let hexagonLayer = null;
let settlementMarkersLayer = null;
let settlementMarkersMap = {}; // Map: settlement name -> marker
let buildingMarkersLayer = null; // Layer for building icons (farms, castles, etc.)
let highlightLayer = null; // Temporary highlight polygon for navigation
let debounceTimer = null;

// Configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const MIN_ZOOM = 9;
const MIN_ZOOM_SETTLEMENTS = 12; // Mostrar asentamientos solo a partir de zoom 12
const LEON_CENTER = [42.599, -5.573];
const INITIAL_ZOOM = 13;
const DEBOUNCE_DELAY = 500; // ms
const ZOOM_THRESHOLD_RES_10 = 14; // Zoom >= 14 -> res 10, < 14 -> res 8

/**
 * Leer parámetros de la URL (lat, lng, zoom, res)
 * Retorna objeto con las coordenadas, zoom y resolución, o null si no existen
 */
const getURLParams = () => {
  const params = new URLSearchParams(window.location.search);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');
  const res = params.get('res');

  if (lat && lng && zoom) {
    return {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      zoom: parseInt(zoom, 10),
      res: res ? parseInt(res, 10) : null // Resolución opcional
    };
  }
  return null;
};

/**
 * Actualizar la URL del navegador con las coordenadas, zoom y resolución actuales
 * Usa history.replaceState para no crear entradas en el historial
 */
const updateURLParams = () => {
  if (!map) return;

  const center = map.getCenter();
  const zoom = map.getZoom();

  // Redondear coordenadas a 5 decimales
  const lat = center.lat.toFixed(5);
  const lng = center.lng.toFixed(5);

  // Construir nueva URL incluyendo resolución
  const newURL = `${window.location.pathname}?lat=${lat}&lng=${lng}&zoom=${zoom}&res=${currentResolution.value}`;

  // Actualizar URL sin recargar la página
  window.history.replaceState({}, '', newURL);
};

// Base map layers
let osmLayer = null;
let satelliteLayer = null;
let terrainLayer = null;

/**
 * Initialize Leaflet map
 * Usa parámetros de URL si existen, caso contrario usa valores por defecto (León)
 */
const initMap = () => {
  // Leer parámetros de la URL
  const urlParams = getURLParams();
  const center = urlParams ? [urlParams.lat, urlParams.lng] : LEON_CENTER;
  const zoom = urlParams ? urlParams.zoom : INITIAL_ZOOM;

  // Inicializar resolución desde URL o determinar automáticamente según zoom
  if (urlParams && urlParams.res) {
    currentResolution.value = urlParams.res;
  } else {
    currentResolution.value = zoom >= ZOOM_THRESHOLD_RES_10 ? 10 : 8;
  }

  console.log(`Initializing map at [${center[0]}, ${center[1]}], zoom ${zoom}, resolution ${currentResolution.value}`);

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

  // Terrain layer (OpenTopoMap - muestra relieve topográfico)
  terrainLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    {
      attribution: '© OpenTopoMap contributors',
      maxZoom: 17,
    }
  );

  // Add Terrain layer as default
  terrainLayer.addTo(map);

  // Layer control
  const baseMaps = {
    'OpenStreetMap': osmLayer,
    'Satélite': satelliteLayer,
    'Relieve': terrainLayer,
  };
  L.control.layers(baseMaps).addTo(map);

  // Create a layer group for hexagons with canvas renderer for better performance
  hexagonLayer = L.layerGroup({ renderer: L.canvas() }).addTo(map);

  // Create separate layers for markers
  settlementMarkersLayer = L.layerGroup().addTo(map);
  buildingMarkersLayer = L.layerGroup().addTo(map);

  // Track zoom level
  currentZoom.value = map.getZoom();

  // Event listeners
  map.on('moveend', handleMapMove);
  map.on('zoomend', handleZoomChange);

  // Clean up highlight when popup closes
  map.on('popupclose', () => {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
  });

  // Initial load
  loadHexagonsIfZoomValid();
  fetchPlayerData();
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
    // Solo cargar hexágonos si la capa H3 está visible
    if (showH3Layer.value) {
      loadHexagonsIfZoomValid();
    }
    updateURLParams(); // Actualizar URL con nueva posición
  }, DEBOUNCE_DELAY);
};

/**
 * Handle zoom change
 * Cambia automáticamente la resolución según el nivel de zoom:
 * - Zoom < 14: Resolución 8 (hexágonos más grandes)
 * - Zoom >= 14: Resolución 10 (hexágonos más pequeños)
 * - Zoom < 12: Oculta asentamientos
 * - Zoom >= 12: Muestra asentamientos
 */
const handleZoomChange = () => {
  const previousZoom = currentZoom.value;
  currentZoom.value = map.getZoom();

  // Determinar nueva resolución según zoom
  const newResolution = currentZoom.value >= ZOOM_THRESHOLD_RES_10 ? 10 : 8;

  // Verificar si cruzamos el umbral de visualización de asentamientos
  const wasShowingSettlements = previousZoom >= MIN_ZOOM_SETTLEMENTS;
  const shouldShowSettlements = currentZoom.value >= MIN_ZOOM_SETTLEMENTS;

  // Si la resolución cambió, actualizar y recargar hexágonos
  if (newResolution !== currentResolution.value) {
    console.log(`Zoom ${currentZoom.value}: Changing resolution from ${currentResolution.value} to ${newResolution}`);
    currentResolution.value = newResolution;
    loadHexagonsIfZoomValid();
  } else {
    // Solo recargar si el zoom es válido (sin cambio de resolución)
    loadHexagonsIfZoomValid();
  }

  // Manejar visibilidad de asentamientos según zoom
  if (wasShowingSettlements !== shouldShowSettlements) {
    if (!shouldShowSettlements) {
      console.log(`Zoom ${currentZoom.value}: Hiding settlements (zoom < ${MIN_ZOOM_SETTLEMENTS})`);
      clearSettlementMarkers();
    } else {
      console.log(`Zoom ${currentZoom.value}: Showing settlements (zoom >= ${MIN_ZOOM_SETTLEMENTS})`);
      // Los asentamientos se renderizarán en loadHexagonsIfZoomValid
    }
  }
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
 * Fetch hexagon data from backend API based on current map bounds and resolution
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
      res: currentResolution.value, // Pasar resolución a la API
    };

    console.log(`Fetching hexagons at resolution ${currentResolution.value}...`);
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
 * Fetch player data (gold, color, etc)
 */
const fetchPlayerData = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/players/${playerId.value}`);
    if (response.data) {
      playerGold.value = response.data.gold;
      console.log(`✓ Player data loaded: ${response.data.username} has ${playerGold.value} gold`);
    }
  } catch (err) {
    console.error('Failed to fetch player data:', err);
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
 * Fetch settlements list for navigation panel
 * Solo puebla el menú si la respuesta es exitosa (200 OK)
 */
const fetchSettlements = async () => {
  try {
    console.log('Fetching settlements from API...');
    const response = await axios.get(`${API_URL}/api/settlements`);

    // Verificar que la respuesta sea exitosa (status 200)
    if (response.status === 200 && Array.isArray(response.data)) {
      settlements.value = response.data; // Already sorted alphabetically by backend
      console.log(`✓ Loaded ${settlements.value.length} settlements for navigation`);

      if (settlements.value.length === 0) {
        console.warn('⚠️ API returned empty array - no settlements in database');
      }
    } else {
      console.error('❌ Unexpected API response format:', response);
      settlements.value = [];
    }
  } catch (err) {
    console.error('❌ Failed to fetch settlements:', err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data:', err.response.data);
    }
    settlements.value = []; // Ensure menu stays empty on error
  }
};

/**
 * Get icon for settlement type
 */
const getSettlementIcon = (type) => {
  const icons = {
    city: '🏛️',
    town: '🏘️',
    village: '🏡',
    fort: '⚔️',
    monastery: '⛪'
  };
  return icons[type] || '📍';
};

/**
 * Navigate to a settlement with smooth animation
 * @param {Object} settlement - Settlement with name, lat, lng
 */
const navigateToSettlement = (settlement) => {
  if (!map) return;

  console.log(`Navigating to settlement: ${settlement.name} at [${settlement.lat}, ${settlement.lng}]`);

  // Fly to settlement with smooth animation (2 seconds)
  map.flyTo([settlement.lat, settlement.lng], 14, {
    duration: 2,
    easeLinearity: 0.25
  });

  // Wait for animation to complete, then try to open popup
  setTimeout(() => {
    // Find the marker for this settlement and open its popup
    const marker = settlementMarkersMap[settlement.name];
    if (marker) {
      marker.openPopup();
      console.log(`✓ Opened popup for ${settlement.name}`);
    } else {
      // If marker not found (zoom < 12), just log
      console.log(`Marker for ${settlement.name} not visible (zoom < ${MIN_ZOOM_SETTLEMENTS})`);
    }
  }, 2100); // Slightly after animation completes
};

/**
 * Render H3 hexagons on the map
 * Ajusta estilos dinámicamente según la resolución:
 * - Res 8: weight 1, opacity 0.8 (hexágonos más grandes, bordes normales)
 * - Res 10: weight 0.5, opacity 0.6 (hexágonos más pequeños, bordes más finos)
 * - has_road: Borde más grueso y color dorado para indicar vías romanas
 * @param {Array} hexagons - Array of {h3_index, name, color, has_road, settlement}
 */
const renderHexagons = (hexagons) => {
  // Clear existing hexagons
  hexagonLayer.clearLayers();

  // Update player's owned hexagons for adjacency checks
  const newPlayerHexes = new Set();
  hexagons.forEach(hex => {
    if (hex.player_id === playerId.value) {
      newPlayerHexes.add(hex.h3_index);
    }
  });
  playerHexes.value = newPlayerHexes;
  console.log(`Player owns ${playerHexes.value.size} territories`);

  console.log(`Rendering ${hexagons.length} hexagons at resolution ${currentResolution.value}...`);

  // Ajustar estilos según resolución
  const isHighRes = currentResolution.value >= 10;
  const baseBorderWeight = isHighRes ? 0.5 : 1;
  const borderOpacity = isHighRes ? 0.6 : 0.8;
  const hoverWeight = isHighRes ? 2 : 3;

  hexagons.forEach((hex, index) => {
    try {
      // Get boundary coordinates for this H3 cell
      const boundary = cellToBoundary(hex.h3_index);

      // Estilos especiales para caminos históricos
      const hasRoad = hex.has_road || false;
      const borderWeight = hasRoad ? baseBorderWeight * 2.5 : baseBorderWeight;
      const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

      // CAPA JUGADOR: Si player_color existe, usar como borde (prioridad alta)
      const playerColor = hex.player_color || null;
      const isCapital = hex.is_capital === true;
      let borderColor = terrainColor;
      let finalBorderWeight = borderWeight;
      let finalFillOpacity = hexagonOpacity.value / 100;
      let borderOpacityValue = borderOpacity;

      // PRIORITY 1: CAPITAL - Estilo ultra prominente
      if (isCapital) {
        // Borde ROJO PURO y GRUESO para la capital (máxima prominencia)
        borderColor = '#ff0000';  // Rojo puro brillante
        finalBorderWeight = 6;     // Doble que territorios normales
        finalFillOpacity = 0.8;    // Más sólido
        borderOpacityValue = 1.0;  // Totalmente opaco
      }
      // PRIORITY 2: VISTA POLÍTICA - Resaltar territorios de jugadores
      else if (isPoliticalView.value && hex.player_id) {
        // Modo político: borde rojo intenso para territorios controlados
        borderColor = '#d32f2f';
        finalBorderWeight = 3;
        finalFillOpacity = 0.7;
        borderOpacityValue = 1.0;
      }
      // PRIORITY 3: Vista normal con dueño
      else if (playerColor) {
        // Vista normal: borde grueso con color del reino
        borderColor = playerColor;
        finalBorderWeight = baseBorderWeight * 3;
        borderOpacityValue = 0.95;
      }
      // PRIORITY 4: Camino histórico
      else if (hasRoad) {
        // Sin dueño pero con camino: borde dorado
        borderColor = '#d4af37';
        borderOpacityValue = 0.9;
      }

      // Create Leaflet polygon with estilos ajustados
      const polygon = L.polygon(boundary, {
        color: borderColor,
        fillColor: terrainColor,
        fillOpacity: finalFillOpacity,
        weight: finalBorderWeight,
        opacity: borderOpacityValue,
        // zIndexOffset for capitals to render on top
        ...(isCapital && { className: 'capital-hexagon' })
      });

      // Add hover effect
      polygon.on('mouseover', function () {
        this.setStyle({
          weight: finalBorderWeight * 1.5,
          fillOpacity: Math.min(hexagonOpacity.value / 100 + 0.2, 1.0),
        });
      });

      polygon.on('mouseout', function () {
        this.setStyle({
          weight: finalBorderWeight,
          fillOpacity: hexagonOpacity.value / 100,
        });
      });

      // Get center coordinates of hexagon
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Add click event to show detailed popup
      polygon.on('click', async function () {
        await showCellDetailsPopup(hex.h3_index, [lat, lng]);
      });

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

  console.log(`✓ Finished rendering ${hexagons.length} hexagons at resolution ${currentResolution.value}`);

  // Render capital star markers
  hexagons.forEach(hex => {
    if (hex.is_capital === true) {
      try {
        // Calculate center of hexagon
        const [lat, lng] = cellToLatLng(hex.h3_index);

        // Create star icon using divIcon
        const starIcon = L.divIcon({
          className: 'capital-star-label',
          html: '⭐',
          iconSize: [30, 30],
          iconAnchor: [15, 15] // Center the icon perfectly
        });

        // Add marker to map with high z-index
        L.marker([lat, lng], {
          icon: starIcon,
          interactive: false, // Don't block clicks to hexagon below
          zIndexOffset: 1000
        }).addTo(hexagonLayer);

        console.log(`✓ Rendered capital star at ${hex.h3_index}`);
      } catch (err) {
        console.error(`Error rendering capital marker for ${hex.h3_index}:`, err);
      }
    }
  });

  // Render building and settlement markers if zoom is sufficient
  if (currentZoom.value >= MIN_ZOOM_SETTLEMENTS) {
    renderBuildingMarkers(hexagons);
    renderSettlementMarkers(hexagons);
  } else {
    clearSettlementMarkers();
    clearBuildingMarkers();
  }
};

/**
 * Get SVG icon for settlement type
 * Returns embedded SVG string for better rendering quality
 */
const getSettlementSVG = (type) => {
  const svgIcons = {
    city: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <rect x="8" y="14" width="6" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="18" y="14" width="6" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="11" y="8" width="10" height="20" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="16,3 10,10 22,10" fill="#CD853F" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="13" y="16" width="3" height="4" fill="#4A4A4A"/>
        <rect x="17" y="16" width="2" height="3" fill="#4A4A4A"/>
        <circle cx="16" cy="8" r="1.5" fill="#FFD700"/>
      </g>
    </svg>`,
    town: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="6" y="12" width="7" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="15" y="12" width="7" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="9.5,6 5,12 14,12" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="18.5,6 14,12 23,12" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="8" y="16" width="2" height="3" fill="#4A4A4A"/>
        <rect x="17" y="16" width="2" height="3" fill="#4A4A4A"/>
      </g>
    </svg>`,
    village: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="6" y="10" width="12" height="12" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="12,3 4,10 20,10" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="10" y="14" width="4" height="8" fill="#4A4A4A"/>
        <circle cx="9" cy="14" r="1" fill="#FFD700"/>
      </g>
    </svg>`,
    fort: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <rect x="4" y="12" width="24" height="16" fill="#696969" stroke="#2F2F2F" stroke-width="1.5"/>
        <rect x="12" y="6" width="8" height="22" fill="#808080" stroke="#2F2F2F" stroke-width="1.5"/>
        <rect x="6" y="12" width="4" height="4" fill="#505050"/>
        <rect x="22" y="12" width="4" height="4" fill="#505050"/>
        <rect x="14" y="18" width="4" height="10" fill="#4A4A4A"/>
        <polygon points="16,2 13,6 19,6" fill="#696969" stroke="#2F2F2F" stroke-width="1"/>
        <rect x="15" y="4" width="2" height="4" fill="#DC143C"/>
      </g>
    </svg>`,
    monastery: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="8" y="10" width="12" height="16" fill="#8B7355" stroke="#5D4E37" stroke-width="1"/>
        <polygon points="14,3 7,10 21,10" fill="#A0826D" stroke="#5D4E37" stroke-width="1"/>
        <rect x="12" y="14" width="4" height="6" fill="#4A4A4A"/>
        <rect x="13" y="5" width="2" height="7" fill="#8B7355"/>
        <line x1="11" y1="6" x2="17" y2="6" stroke="#8B7355" stroke-width="2"/>
        <circle cx="14" cy="10" r="1.5" fill="#FFD700"/>
      </g>
    </svg>`
  };
  return svgIcons[type] || svgIcons['city'];
};

/**
 * Render settlement markers with custom medieval icons and halo labels
 * Solo se renderizan si el zoom es >= MIN_ZOOM_SETTLEMENTS
 * @param {Array} hexagons - Array of hexagons with settlement data
 */
const renderSettlementMarkers = (hexagons) => {
  // Clear existing settlement markers and map
  settlementMarkersLayer.clearLayers();
  settlementMarkersMap = {};

  // Filter hexagons that have settlements
  const settlementsToRender = hexagons.filter(hex => hex.settlement);

  if (settlementsToRender.length === 0) {
    return;
  }

  console.log(`Rendering ${settlementsToRender.length} settlement markers...`);

  settlementsToRender.forEach((hex) => {
    try {
      // Get center coordinates
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Get SVG icon for settlement type
      const svgIcon = getSettlementSVG(hex.settlement.type);

      // Create custom divIcon with embedded SVG
      const settlementIcon = L.divIcon({
        className: 'settlement-marker',
        html: `<div class="settlement-icon-svg">${svgIcon}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      // Create marker
      const marker = L.marker([lat, lng], {
        icon: settlementIcon,
        zIndexOffset: 1000, // Ensure markers are on top
      });

      // Add permanent tooltip with enhanced halo effect
      const tooltipContent = `<span class="settlement-label">${hex.settlement.name}</span>`;
      marker.bindTooltip(tooltipContent, {
        permanent: true,
        direction: 'top',
        className: 'settlement-tooltip',
        offset: [0, -20],
      });

      // Add detailed popup on click with coordinates
      let popupContent = `<div style="font-family: 'Cinzel', Georgia, serif;">`;
      popupContent += `<strong style="font-size: 16px; color: #2c1810;">${hex.settlement.name}</strong><br>`;
      popupContent += `<div style="color: #666; font-size: 11px; margin: 5px 0; padding: 3px; background: #f0f0f0; border-radius: 3px;">`;
      popupContent += `📍 Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
      popupContent += `</div>`;
      popupContent += `<strong>Tipo:</strong> ${hex.settlement.type}<br>`;
      if (hex.settlement.population_rank) {
        popupContent += `<strong>Rango:</strong> ${hex.settlement.population_rank}/10<br>`;
      }
      popupContent += `</div>`;

      marker.bindPopup(popupContent);

      // Add to layer
      marker.addTo(settlementMarkersLayer);

      // Store marker in map for navigation
      settlementMarkersMap[hex.settlement.name] = marker;
    } catch (err) {
      console.error(`Error rendering settlement marker for ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Rendered ${settlementsToRender.length} settlement markers`);
};

/**
 * Clear all settlement markers from the map
 */
const clearSettlementMarkers = () => {
  if (settlementMarkersLayer) {
    settlementMarkersLayer.clearLayers();
  }
};

/**
 * Render building markers (farms, castles, mines, etc.)
 * Only shows buildings that DON'T have a settlement marker (to avoid overlap)
 * Also renders CAPITAL markers (crown icon) for player capitals
 * @param {Array} hexagons - Array of hexagons with building data
 */
const renderBuildingMarkers = (hexagons) => {
  // Clear existing building markers
  if (buildingMarkersLayer) {
    buildingMarkersLayer.clearLayers();
  }

  // Filter hexagons that have buildings but NO settlement name (avoid overlap)
  const buildingsToRender = hexagons.filter(hex =>
    hex.icon_slug &&
    hex.building_type_id > 0 &&
    !hex.location_name  // Only show if no settlement/custom name
  );

  // Filter capital hexagons (for crown markers)
  const capitalsToRender = hexagons.filter(hex => hex.is_capital === true);

  if (buildingsToRender.length === 0 && capitalsToRender.length === 0) {
    return;
  }

  console.log(`Rendering ${buildingsToRender.length} building markers and ${capitalsToRender.length} capital markers...`);

  // Render regular building markers
  buildingsToRender.forEach((hex) => {
    try {
      // Get center coordinates
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Map icon_slug to emoji icons
      const buildingIcons = {
        village: '🏘️',
        town: '🏛️',
        city: '🏰',
        castle: '🏰',
        farm: '🌾',
        mine: '⛏️',
        port: '⚓'
      };
      const icon = buildingIcons[hex.icon_slug] || '🏗️';

      // Create simple divIcon with emoji
      const buildingIcon = L.divIcon({
        className: 'building-marker',
        html: `<div class="building-icon-emoji">${icon}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      // Create marker
      const marker = L.marker([lat, lng], {
        icon: buildingIcon,
        zIndexOffset: 500, // Below settlements (1000) but above hexagons
      });

      // Add simple tooltip
      marker.bindTooltip(hex.icon_slug, {
        permanent: false,
        direction: 'top',
        className: 'building-tooltip',
        offset: [0, -10],
      });

      // Add to layer
      marker.addTo(buildingMarkersLayer);
    } catch (err) {
      console.error(`Error rendering building marker for ${hex.h3_index}:`, err);
    }
  });

  // Render CAPITAL markers (crown icon)
  capitalsToRender.forEach((hex) => {
    try {
      // Get center coordinates
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Create crown divIcon (larger and more prominent)
      const crownIcon = L.divIcon({
        className: 'capital-marker',
        html: `<div class="capital-icon-emoji">👑</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      // Create marker
      const marker = L.marker([lat, lng], {
        icon: crownIcon,
        zIndexOffset: 600, // Above regular buildings (500)
      });

      // Add tooltip
      marker.bindTooltip('Capital', {
        permanent: false,
        direction: 'top',
        className: 'capital-tooltip',
        offset: [0, -15],
      });

      // Add to layer
      marker.addTo(buildingMarkersLayer);
    } catch (err) {
      console.error(`Error rendering capital marker for ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Rendered ${buildingsToRender.length} building markers and ${capitalsToRender.length} capital markers`);
};

/**
 * Clear all building markers from the map
 */
const clearBuildingMarkers = () => {
  if (buildingMarkersLayer) {
    buildingMarkersLayer.clearLayers();
  }
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
 * Close the action panel
 */
const closeActionPanel = () => {
  showActionPanel.value = false;
  selectedHexData.value = null;
};

/**
 * Open the action panel at mouse position with hex data
 * @param {Object} hexData - Hexagon data from API
 * @param {Object} event - Leaflet mouse event
 */
const openActionPanel = (hexData, event) => {
  selectedHexData.value = hexData;

  // Get mouse position relative to the viewport
  const mouseX = event.originalEvent.clientX;
  const mouseY = event.originalEvent.clientY;

  // Position panel near the click, with offset to avoid covering the hex
  actionPanelPosition.value = {
    x: Math.min(mouseX + 10, window.innerWidth - 320), // 320px = panel width
    y: Math.min(mouseY + 10, window.innerHeight - 250)  // 250px = approx panel height
  };

  showActionPanel.value = true;
};

/**
 * Colonize territory (claim hexagon for player)
 * Calls POST /api/game/claim and updates UI on success
 * NOTE: This is the old action panel version, now replaced by colonizeFromPopup
 */
const colonizeTerritory = async () => {
  if (!selectedHexData.value) return;

  try {
    const hexToColonize = selectedHexData.value.h3_index;

    console.log(`[Colonize] Attempting to claim ${hexToColonize} for player ${playerId.value}`);

    // Call API
    const response = await axios.post(`${API_URL}/api/game/claim`, {
      player_id: playerId.value,
      h3_index: hexToColonize
    });

    if (response.data.success) {
      // Update player gold
      playerGold.value = response.data.new_gold;

      // Close action panel
      closeActionPanel();

      // Refresh the map to show the new territory
      console.log(`✓ Territory claimed successfully! New gold: ${playerGold.value}`);
      await fetchHexagonData();

      // Show success toast
      const message = response.data.is_capital
        ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
        : '🏰 ¡Territorio colonizado! Recursos añadidos.';
      showToast(message, 'success');
    } else {
      showToast(response.data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error colonizing territory:', err);

    // Show error message from server or generic error
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  }
};

/**
 * Toggle H3 layer visibility
 */
const toggleH3Layer = () => {
  if (!map || !hexagonLayer) return;

  if (showH3Layer.value) {
    // Mostrar capa H3
    map.addLayer(hexagonLayer);
    // Cargar hexágonos si el zoom es válido
    loadHexagonsIfZoomValid();
    console.log('✓ Malla H3 activada');
  } else {
    // Ocultar capa H3
    map.removeLayer(hexagonLayer);
    // Limpiar hexágonos de memoria
    clearHexagons();
    console.log('✓ Malla H3 desactivada');
  }
};

/**
 * Toggle Political View - Resalta territorios controlados por jugadores
 * Redibuja el mapa sin hacer un nuevo fetch
 */
const togglePoliticalView = () => {
  if (!map) return;

  if (isPoliticalView.value) {
    console.log('✓ Vista Política activada: resaltando territorios de jugadores');
  } else {
    console.log('✓ Vista Política desactivada: mostrando vista normal');
  }

  // Redibujar el mapa con los nuevos estilos
  loadHexagonsIfZoomValid();
};

/**
 * Focus on a specific hexagon with highlight
 * @param {string} h3Index - H3 index to focus on
 */
const focusOnHex = async (h3Index) => {
  if (!map || !h3Index) return;

  try {
    // Get coordinates of the hexagon
    const [lat, lng] = cellToLatLng(h3Index);

    // Center map on hexagon with smooth animation
    map.setView([lat, lng], 12, {
      animate: true,
      duration: 1
    });

    // Remove previous highlight if exists
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }

    // Create highlight polygon
    const boundary = cellToBoundary(h3Index);
    highlightLayer = L.polygon(boundary, {
      color: '#FFFF00',      // Bright yellow
      weight: 8,
      fillOpacity: 0,        // No fill
      opacity: 1,
      interactive: false     // Don't block clicks
    });

    highlightLayer.addTo(map);

    // Show cell details popup
    await showCellDetailsPopup(h3Index, [lat, lng]);

    console.log(`✓ Focused on hexagon: ${h3Index}`);
  } catch (err) {
    console.error(`Error focusing on hex ${h3Index}:`, err);
    showToast('Error: Índice H3 inválido', 'error');
  }
};

/**
 * Navigate to H3 index from search input
 */
const goToH3Index = async () => {
  const h3Index = searchH3Input.value.trim();

  if (!h3Index) {
    showToast('Por favor introduce un índice H3', 'warning');
    return;
  }

  // Validate H3 index format (basic check - should be 15 character hex string)
  if (!/^[0-9a-f]{15}$/i.test(h3Index)) {
    showToast('Formato de índice H3 inválido', 'error');
    return;
  }

  await focusOnHex(h3Index);
};

/**
 * Navigate to player's capital
 */
const goToCapital = async () => {
  try {
    // Use cached capital if available
    if (capitalH3Index.value) {
      await focusOnHex(capitalH3Index.value);
      showToast('Navegando a tu capital ⭐', 'success');
      return;
    }

    // Fetch capital from settlements endpoint
    const response = await axios.get(`${API_URL}/api/settlements`);
    const settlements = response.data;

    // Find player's capital
    const capital = settlements.find(s =>
      s.player_id === playerId.value && s.is_capital === true
    );

    if (!capital) {
      showToast('No tienes una capital establecida aún. Coloniza tu primer territorio.', 'warning');
      return;
    }

    // Cache the capital location
    capitalH3Index.value = capital.h3_index;

    await focusOnHex(capital.h3_index);
    showToast('Navegando a tu capital ⭐', 'success');
  } catch (err) {
    console.error('Error navigating to capital:', err);
    showToast('Error al buscar la capital', 'error');
  }
};

/**
 * Get toast icon based on type
 */
const getToastIcon = (type) => {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  return icons[type] || 'ℹ️';
};

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast (success, error, warning, info)
 */
const showToast = (message, type = 'info') => {
  const id = toastIdCounter++;
  const toast = {
    id,
    message,
    type,
    isLeaving: false
  };

  toasts.value.push(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    // Start leave animation
    const toastIndex = toasts.value.findIndex(t => t.id === id);
    if (toastIndex !== -1) {
      toasts.value[toastIndex].isLeaving = true;

      // Remove from array after animation completes
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 300); // Match CSS animation duration
    }
  }, 3000);
};

/**
 * Show detailed cell information popup
 * Fetches full cell details from API and displays in Leaflet popup
 */
const showCellDetailsPopup = async (h3_index, latLng) => {
  try {
    // Fetch detailed cell information from API
    const response = await axios.get(`${API_URL}/api/map/cell-details/${h3_index}`);
    const cell = response.data;

    // Build popup HTML content
    let popupContent = '<div class="cell-inspector" style="font-family: \'Cinzel\', Georgia, serif; min-width: 250px;">';

    // TITLE - Settlement name or "Territorio Salvaje"
    const title = cell.settlement_name || (cell.player_id ? `Territorio de ${cell.player_name}` : 'Territorio Salvaje');
    const titleIcon = cell.is_capital ? '👑' : (cell.settlement_name ? '🏛️' : '🗺️');
    popupContent += `<h3 style="margin: 0 0 10px 0; color: #2c1810; font-size: 16px; border-bottom: 2px solid #8b7355; padding-bottom: 8px;">${titleIcon} ${title}</h3>`;

    // OWNER - Player name or "Sin reclamar"
    const ownerText = cell.player_name
      ? `<span style="color: ${cell.player_color}; font-weight: bold;">⚔️ ${cell.player_name}</span>`
      : '<span style="color: #888;">🌿 Sin reclamar</span>';
    popupContent += `<p style="margin: 5px 0;"><strong>Dueño:</strong> ${ownerText}</p>`;

    // TERRAIN TYPE
    popupContent += `<p style="margin: 5px 0;"><strong>Terreno:</strong> ${cell.terrain_type}</p>`;

    // BUILDING (if any)
    if (cell.building_type) {
      popupContent += `<p style="margin: 5px 0;"><strong>Edificio:</strong> ${cell.building_type}</p>`;
    }

    // TERRITORY DETAILS (only if owned and has territory data)
    if (cell.territory && cell.player_id === playerId.value) {
      popupContent += '<div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.5); border-radius: 5px;">';
      popupContent += '<p style="margin: 5px 0; font-weight: bold; color: #5d4e37;">📊 Detalles del Territorio</p>';

      // Population & Happiness
      popupContent += `<p style="margin: 3px 0; font-size: 13px;">👥 Población: ${cell.territory.population} habitantes</p>`;
      popupContent += `<p style="margin: 3px 0; font-size: 13px;">😊 Felicidad: ${cell.territory.happiness}%</p>`;

      // Resources
      popupContent += '<p style="margin: 8px 0 3px 0; font-weight: bold; font-size: 12px;">Recursos Almacenados:</p>';
      popupContent += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 12px;">`;
      popupContent += `<span>🌾 Comida: ${cell.territory.food}</span>`;
      popupContent += `<span>🌲 Madera: ${cell.territory.wood}</span>`;
      popupContent += `<span>⛰️ Piedra: ${cell.territory.stone}</span>`;
      popupContent += `<span>⛏️ Hierro: ${cell.territory.iron}</span>`;
      popupContent += `</div>`;

      popupContent += '</div>';
    } else if (cell.territory && cell.player_id) {
      // Territory owned by someone else
      popupContent += '<p style="margin: 10px 0; font-size: 12px; color: #888; font-style: italic;">🔒 Información detallada requiere espionaje</p>';
    }

    // ACTIONS
    popupContent += '<div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">';

    if (!cell.player_id) {
      // Colonize button - check gold AND adjacency
      const hasEnoughGold = playerGold.value >= 100;
      let isAdjacent = false;
      let disabledReason = '';

      // Check adjacency
      if (playerHexes.value.size === 0) {
        // First territory - always allowed
        isAdjacent = true;
      } else {
        // Get neighbors of clicked hex (6 adjacent hexes)
        const neighbors = gridDisk(h3_index, 1); // Returns array including center + 6 neighbors
        // Check if ANY neighbor is owned by player
        isAdjacent = neighbors.some(neighborHex =>
          neighborHex !== h3_index && playerHexes.value.has(neighborHex)
        );
      }

      const canColonize = hasEnoughGold && isAdjacent;

      if (!hasEnoughGold) {
        disabledReason = 'Oro insuficiente';
      } else if (!isAdjacent) {
        disabledReason = 'Debe ser contiguo a tu territorio';
      }

      const buttonStyle = canColonize
        ? 'background: linear-gradient(135deg, #8b6914 0%, #b8860b 100%); color: white; cursor: pointer;'
        : 'background: #999; color: #666; cursor: not-allowed;';

      popupContent += `<button
        id="colonize-btn-${h3_index}"
        style="padding: 10px 15px; border: 2px solid #5d4e37; border-radius: 5px; font-family: 'Cinzel', Georgia, serif; font-size: 13px; font-weight: 600; ${buttonStyle}"
        ${!canColonize ? 'disabled' : ''}
        title="${disabledReason}"
      >
        🏰 Colonizar (100 💰)
      </button>`;
    } else if (cell.player_id === playerId.value) {
      // Manage button (disabled for now)
      popupContent += `<button
        style="padding: 10px 15px; border: 2px solid #5d4e37; border-radius: 5px; font-family: 'Cinzel', Georgia, serif; font-size: 13px; font-weight: 600; background: #999; color: #666; cursor: not-allowed;"
        disabled
      >
        ⚙️ Gestionar (Próximamente)
      </button>`;
    }

    popupContent += '</div>';
    popupContent += '</div>';

    // Create and show popup
    const popup = L.popup({
      maxWidth: 350,
      className: 'cell-details-popup'
    })
      .setLatLng(latLng)
      .setContent(popupContent)
      .openOn(map);

    // Add event listener to colonize button (if exists)
    if (!cell.player_id) {
      setTimeout(() => {
        const colonizeBtn = document.getElementById(`colonize-btn-${h3_index}`);
        if (colonizeBtn) {
          colonizeBtn.addEventListener('click', () => {
            colonizeFromPopup(h3_index);
          });
        }
      }, 100);
    }

  } catch (error) {
    console.error('Error fetching cell details:', error);
    showToast('Error al cargar información del territorio', 'error');
  }
};

/**
 * Colonize territory from popup
 */
const colonizeFromPopup = async (h3_index) => {
  try {
    console.log(`[Colonize] Attempting to claim ${h3_index} for player ${playerId.value}`);

    // Call API
    const response = await axios.post(`${API_URL}/api/game/claim`, {
      player_id: playerId.value,
      h3_index: h3_index
    });

    if (response.data.success) {
      // Update player gold
      playerGold.value = response.data.new_gold_balance || response.data.new_gold;

      // CRITICAL: Immediately add this hex to player's territories for adjacency checks
      playerHexes.value.add(h3_index);
      console.log(`✓ Territory claimed successfully! Player now owns ${playerHexes.value.size} territories`);

      // Close popup
      map.closePopup();

      // Refresh the map to show the new territory
      await fetchHexagonData();

      // Show success toast (including iron vein message if found)
      let message = response.data.is_capital
        ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
        : '🏰 ¡Territorio colonizado!';

      if (response.data.iron_vein_found && response.data.iron_message) {
        message += ' ' + response.data.iron_message;
      }

      showToast(message, 'success');
    } else {
      showToast(response.data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error colonizing territory:', err);
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  }
};

// Lifecycle hooks
onMounted(() => {
  initMap();
  fetchTerrainTypes();
  fetchSettlements();
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

/* H3 Layer Toggle Control */
.h3-toggle-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.h3-toggle-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.toggle-container {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.toggle-container:last-child {
  margin-bottom: 0;
}

.toggle-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  position: relative;
  user-select: none;
}

.toggle-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 26px;
  background-color: #ccc;
  border-radius: 26px;
  transition: background-color 0.3s;
  margin-right: 12px;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  top: 3px;
  background-color: white;
  border-radius: 50%;
  transition: transform 0.3s;
}

.toggle-checkbox:checked + .toggle-slider {
  background-color: #3498db;
}

.toggle-checkbox:checked + .toggle-slider::before {
  transform: translateX(24px);
}

.toggle-text {
  font-size: 14px;
  color: #555;
  font-weight: 500;
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

/* Navigation Control */
.navigation-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 15px;
}

.navigation-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.search-container {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 2px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  font-family: monospace;
  transition: border-color 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #4CAF50;
}

.search-button {
  padding: 8px 15px;
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.search-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.search-button:active {
  transform: translateY(0);
}

.capital-link {
  width: 100%;
  padding: 10px 15px;
  background: linear-gradient(135deg, #FFD700 0%, #FFC107 100%);
  border: 2px solid #FF8F00;
  border-radius: 4px;
  color: #5D4E37;
  font-size: 14px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.capital-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.4);
  background: linear-gradient(135deg, #FFE44D 0%, #FFD54F 100%);
}

.capital-link:active {
  transform: translateY(0);
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

/* Building Markers - Game Buildings (Farms, Castles, Mines, etc.) */
:deep(.building-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.building-icon-emoji) {
  font-size: 20px;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  transition: transform 0.2s ease;
}

:deep(.building-marker:hover .building-icon-emoji) {
  transform: scale(1.3);
  cursor: pointer;
  filter: drop-shadow(0 0 3px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
}

:deep(.building-tooltip) {
  background: rgba(255, 255, 255, 0.9) !important;
  border: 1px solid #666 !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
  padding: 4px 8px !important;
  font-size: 12px;
  font-weight: bold;
  text-transform: capitalize;
}

/* Capital Markers - Crown Icon for Player Capitals */
:deep(.capital-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.capital-icon-emoji) {
  font-size: 28px; /* Larger than regular buildings */
  filter: drop-shadow(0 0 3px #ffd700) drop-shadow(0 2px 5px rgba(0, 0, 0, 0.6));
  transition: transform 0.2s ease;
  animation: pulse-crown 2s ease-in-out infinite;
}

@keyframes pulse-crown {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

:deep(.capital-marker:hover .capital-icon-emoji) {
  transform: scale(1.4);
  cursor: pointer;
  filter: drop-shadow(0 0 5px #ffd700) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8));
}

:deep(.capital-tooltip) {
  background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%) !important;
  border: 2px solid #daa520 !important;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4) !important;
  padding: 6px 12px !important;
  font-size: 13px;
  font-weight: bold;
  color: #2c1810;
  font-family: 'Cinzel', 'Georgia', serif;
  letter-spacing: 0.5px;
}

/* Settlement Markers - Medieval Style with SVG */
:deep(.settlement-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.settlement-icon-svg) {
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.2s ease;
}

:deep(.settlement-icon-svg svg) {
  width: 32px;
  height: 32px;
}

:deep(.settlement-marker:hover .settlement-icon-svg) {
  transform: scale(1.3);
  cursor: pointer;
  filter: drop-shadow(0 0 4px white) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.7));
}

/* Fallback for emoji icons (if SVG fails) */
:deep(.settlement-icon) {
  font-size: 28px;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
  transition: transform 0.2s ease;
}

:deep(.settlement-marker:hover .settlement-icon) {
  transform: scale(1.2);
  cursor: pointer;
}

/* Settlement Tooltip - Medieval Font with Halo */
:deep(.settlement-tooltip) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
  text-align: center;
}

:deep(.settlement-tooltip::before) {
  display: none !important;
}

:deep(.settlement-label) {
  font-family: 'Cinzel', 'Georgia', 'Times New Roman', serif;
  font-size: 15px;
  font-weight: 700;
  color: #1a0d00;
  /* Halo blanco potente para máxima legibilidad sobre cualquier terreno */
  text-shadow:
    /* Capa 1: Halo blanco grueso en 8 direcciones */
    3px 3px 0 #fff,
    -3px -3px 0 #fff,
    3px -3px 0 #fff,
    -3px 3px 0 #fff,
    /* Capa 2: Halo blanco medio en 8 direcciones */
    2px 2px 0 #fff,
    -2px -2px 0 #fff,
    2px -2px 0 #fff,
    -2px 2px 0 #fff,
    /* Capa 3: Halo blanco fino en 8 direcciones */
    1px 1px 0 #fff,
    -1px -1px 0 #fff,
    1px -1px 0 #fff,
    -1px 1px 0 #fff,
    /* Capa 4: Halo en ejes cardinales */
    3px 0 0 #fff,
    -3px 0 0 #fff,
    0 3px 0 #fff,
    0 -3px 0 #fff,
    2px 0 0 #fff,
    -2px 0 0 #fff,
    0 2px 0 #fff,
    0 -2px 0 #fff,
    /* Sombra suave para profundidad */
    0 3px 5px rgba(0, 0, 0, 0.4);
  letter-spacing: 0.5px;
  white-space: nowrap;
  pointer-events: none;
}

/* Import Google Font - Cinzel (Medieval/Roman Style) */
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');

/* Settlements Navigation Sidebar - Medieval Parchment Style */
.settlements-sidebar {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 320px;
  max-height: calc(100vh - 40px);
  background: #f4e4bc; /* Parchment color */
  border: 3px solid #5d4e37; /* Dark brown border */
  border-radius: 8px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settlements-header {
  background: linear-gradient(to bottom, #8b7355, #6d5a47);
  color: #f4e4bc;
  padding: 15px 20px;
  border-bottom: 2px solid #5d4e37;
  text-align: center;
}

.settlements-header h3 {
  margin: 0;
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}

.settlements-header .subtitle {
  margin: 5px 0 0 0;
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.9;
  font-style: italic;
}

.settlements-list {
  overflow-y: auto;
  padding: 10px 0;
  flex: 1;
}

.settlements-loading {
  padding: 20px;
  text-align: center;
  font-family: 'Cinzel', 'Georgia', serif;
  color: #5d4e37;
  font-size: 14px;
}

.settlement-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  text-decoration: none;
  color: #2c1810;
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 14px;
  border-bottom: 1px solid #d4c4a8;
  transition: all 0.3s ease;
  cursor: pointer;
}

.settlement-link:hover {
  background: #e8d4a8;
  padding-left: 25px;
  border-left: 4px solid #8b7355;
}

.settlement-link:active {
  background: #d4c4a8;
}

.settlement-icon {
  font-size: 20px;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.settlement-name {
  flex: 1;
  font-weight: 600;
  line-height: 1.3;
}

.settlement-type-label {
  font-size: 11px;
  color: #6d5a47;
  font-style: italic;
  text-transform: capitalize;
  flex-shrink: 0;
}

/* Scrollbar styling for settlements list */
.settlements-list::-webkit-scrollbar {
  width: 8px;
}

.settlements-list::-webkit-scrollbar-track {
  background: #e8d4a8;
}

.settlements-list::-webkit-scrollbar-thumb {
  background: #8b7355;
  border-radius: 4px;
}

.settlements-list::-webkit-scrollbar-thumb:hover {
  background: #6d5a47;
}

/* Adjust Leaflet zoom controls position to avoid overlap */
:deep(.leaflet-top.leaflet-left) {
  left: 300px; /* Move zoom controls away from settlements sidebar */
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

  /* Adjust settlement labels for mobile */
  :deep(.settlement-label) {
    font-size: 12px;
  }

  :deep(.settlement-icon) {
    font-size: 24px;
  }

  /* Settlements sidebar for mobile */
  .settlements-sidebar {
    top: auto;
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    max-height: 40vh;
    border-radius: 8px 8px 0 0;
    border-bottom: none;
  }

  .settlements-header h3 {
    font-size: 16px;
  }

  .settlements-header .subtitle {
    font-size: 11px;
  }

  .settlement-link {
    font-size: 13px;
    padding: 10px 15px;
  }

  /* Reset zoom controls position */
  :deep(.leaflet-top.leaflet-left) {
    left: 10px;
  }
}

/* Player Gold Indicator - Top Right Corner */
.player-gold-indicator {
  position: fixed;
  top: 20px;
  right: 360px; /* Offset to avoid settlements sidebar */
  background: linear-gradient(135deg, #f4e4bc 0%, #e8d4a8 100%);
  border: 3px solid #8b7355;
  border-radius: 12px;
  padding: 12px 20px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Cinzel', 'Georgia', serif;
  min-width: 150px;
}

.gold-icon {
  font-size: 28px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.gold-amount {
  font-size: 24px;
  font-weight: 700;
  color: #8b6914;
  text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.8);
}

.gold-label {
  font-size: 12px;
  color: #5d4e37;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

/* Action Panel - Medieval Floating Panel */
.action-panel {
  position: fixed;
  width: 300px;
  background: linear-gradient(135deg, #f4e4bc 0%, #e8d4a8 100%);
  border: 3px solid #5d4e37;
  border-radius: 8px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
  z-index: 1002;
  font-family: 'Cinzel', 'Georgia', serif;
  overflow: hidden;
}

.action-panel-header {
  background: linear-gradient(to bottom, #8b7355, #6d5a47);
  color: #f4e4bc;
  padding: 12px 15px;
  border-bottom: 2px solid #5d4e37;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.action-panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}

.close-button {
  background: transparent;
  border: none;
  color: #f4e4bc;
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-button:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

.action-panel-body {
  padding: 15px;
}

.hex-info {
  margin-bottom: 15px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 5px;
  border: 1px solid #d4c4a8;
}

.hex-info p {
  margin: 5px 0;
  font-size: 13px;
  color: #2c1810;
}

.hex-info strong {
  color: #5d4e37;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  padding: 12px 20px;
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 14px;
  font-weight: 600;
  border: 2px solid #5d4e37;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2);
  letter-spacing: 0.5px;
}

.colonize-button {
  background: linear-gradient(135deg, #8b6914 0%, #b8860b 100%);
  color: #fff;
}

.colonize-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #b8860b 0%, #daa520 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.colonize-button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.colonize-button:disabled {
  background: #999;
  border-color: #666;
  cursor: not-allowed;
  opacity: 0.6;
}

.owned-message {
  padding: 10px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 5px;
  text-align: center;
  font-size: 13px;
  color: #2c1810;
}

.owned-message p {
  margin: 5px 0;
}

/* Mobile adjustments for gold indicator and action panel */
@media (max-width: 768px) {
  .player-gold-indicator {
    top: 10px;
    right: 10px;
    padding: 8px 15px;
    min-width: 120px;
  }

  .gold-icon {
    font-size: 24px;
  }

  .gold-amount {
    font-size: 20px;
  }

  .gold-label {
    font-size: 10px;
  }

  .action-panel {
    width: calc(100% - 40px);
    max-width: 300px;
    left: 50% !important;
    transform: translateX(-50%);
  }
}

/* Toast Notifications - Bottom Right Corner */
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 400px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 14px;
  font-weight: 600;
  animation: toast-slide-in 0.3s ease-out;
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.toast-leaving {
  opacity: 0;
  transform: translateX(400px);
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateX(400px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.toast-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  color: white;
  line-height: 1.4;
}

.toast-success {
  background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%);
  border: 2px solid #1b5e20;
}

.toast-error {
  background: linear-gradient(135deg, #c62828 0%, #e53935 100%);
  border: 2px solid #b71c1c;
}

.toast-warning {
  background: linear-gradient(135deg, #f57c00 0%, #fb8c00 100%);
  border: 2px solid #e65100;
}

.toast-info {
  background: linear-gradient(135deg, #1976d2 0%, #2196f3 100%);
  border: 2px solid #0d47a1;
}

/* Cell Details Popup - Enhanced Styling */
:deep(.cell-details-popup .leaflet-popup-content-wrapper) {
  background: linear-gradient(135deg, #f4e4bc 0%, #e8d4a8 100%);
  border: 3px solid #5d4e37;
  border-radius: 8px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
  padding: 0;
}

:deep(.cell-details-popup .leaflet-popup-content) {
  margin: 0;
  font-family: 'Cinzel', 'Georgia', serif;
}

:deep(.cell-details-popup .leaflet-popup-tip) {
  background: #e8d4a8;
  border: 3px solid #5d4e37;
  border-top: none;
  border-right: none;
}

/* Mobile adjustments for toasts */
@media (max-width: 768px) {
  .toast-container {
    bottom: 10px;
    right: 10px;
    left: 10px;
    max-width: none;
  }

  .toast {
    padding: 12px 15px;
    font-size: 13px;
  }

  .toast-icon {
    font-size: 18px;
  }
}

/* Capital hexagon styling - render on top with higher z-index */
:deep(.capital-hexagon) {
  z-index: 1000 !important;
}

:deep(.capital-hexagon path) {
  stroke-width: 6 !important;
  stroke: #ff0000 !important;
  stroke-opacity: 1.0 !important;
  filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.6));
}

/* Capital star marker styling */
:deep(.capital-star-label) {
  font-size: 30px;
  text-align: center;
  line-height: 30px;
  filter: drop-shadow(0px 0px 4px black);
  pointer-events: none; /* Allow clicks to pass through to hexagon below */
}
</style>
