<template>
  <div class="app-container">
    <!-- Sidebar Panel -->
    <div class="sidebar">
      <!-- Legend -->
      <div class="legend" :class="{ 'legend-collapsed': legendCollapsed }">
        <div class="legend-header">
          <h3>Leyenda de Terrenos</h3>
          <button
            id="toggle-legend"
            @click="toggleLegend"
            class="btn-toggle"
            :title="legendCollapsed ? 'Expandir leyenda' : 'Colapsar leyenda'"
          >
            {{ legendCollapsed ? '▼' : '▲' }}
          </button>
        </div>
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

      <!-- Time Control Panel - Medieval Style -->
      <div id="time-control" class="time-control">
        <div class="time-info">
          <div class="time-row">
            <span class="time-icon">📅</span>
            <span class="time-label">Fecha:</span>
            <span class="time-value date-display">{{ formattedDate }}</span>
          </div>
          <div class="time-row">
            <span class="time-icon">⚔️</span>
            <span class="time-label">Turno:</span>
            <span class="time-value">{{ currentTurn }}</span>
          </div>
          <div class="time-row harvest-info">
            <span class="time-icon">🌾</span>
            <span class="harvest-label">{{ nextHarvestLabel }}</span>
          </div>
        </div>

        <!-- Server Time Info -->
        <div class="server-time-info">
          <div class="sync-status">
            <span class="sync-icon">🔄</span>
            <span class="sync-text">Sincronizando con servidor...</span>
          </div>
        </div>
      </div>

      <!-- Fiefs Monitoring Panel -->
      <div id="fiefs-panel" class="fiefs-panel">
        <div class="fiefs-header">
          <h3>🏰 Mis Feudos</h3>
          <span class="fiefs-count">{{ myFiefs.length }}</span>
        </div>
        <div id="fiefs-list" class="fiefs-list">
          <div
            v-if="loadingFiefs"
            class="fiefs-empty"
          >
            Cargando feudos...
          </div>
          <div
            v-else-if="myFiefs.length === 0"
            class="fiefs-empty"
          >
            No tienes feudos aún. ¡Coloniza territorios para comenzar!
          </div>
          <div
            v-for="fief in myFiefs"
            :key="fief.h3_index"
            class="fief-card"
            :class="{ 'fief-low-food': Number(fief.food_stored || 0) < 5.0 }"
            @click="focusOnFief(fief.h3_index)"
          >
            <div class="fief-name">
              {{ fief.location_name || fief.h3_index?.substring(0, 8) || 'Territorio' }}
            </div>
            <div class="fief-terrain">{{ fief.terrain_name || 'Desconocido' }}</div>
            <div class="fief-stats">
              <span class="fief-stat">
                <span class="fief-icon">👥</span>
                <span class="fief-value">{{ Math.floor(Number(fief.population || 0)) }}</span>
              </span>
              <span class="fief-stat">
                <span class="fief-icon">🌾</span>
                <span
                  class="fief-value fief-food"
                  :data-h3="fief.h3_index"
                >{{ Number(fief.food_stored || 0).toFixed(1) }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Messages Panel -->
      <div id="messages-panel" class="messages-panel">
        <div class="messages-header">
          <h3>📜 Mensajes</h3>
          <span class="messages-count">{{ unreadCount }}</span>
        </div>
        <div id="messages-list" class="messages-list">
          <div
            v-if="loadingMessages"
            class="messages-empty"
          >
            Cargando mensajes...
          </div>
          <div
            v-else-if="myMessages.length === 0"
            class="messages-empty"
          >
            No tienes mensajes.
          </div>
          <div
            v-for="message in myMessages"
            :key="message.id"
            class="message-card"
            :class="{ 'message-unread': !message.is_read }"
            @click="readMessage(message)"
          >
            <div class="message-header">
              <span class="message-sender">
                {{ message.sender_name || '🏰 Sistema' }}
              </span>
              <span class="message-date">{{ formatMessageDate(message.sent_at) }}</span>
            </div>
            <div class="message-subject">{{ message.subject }}</div>
            <div class="message-preview">{{ message.body.substring(0, 80) }}...</div>
          </div>
        </div>
      </div>

      <!-- Admin Link (only visible for admins) -->
      <div
        v-if="currentUser && currentUser.role === 'admin'"
        class="admin-link-container"
      >
        <a href="/admin.html" class="admin-link">
          ⚙️ Panel de Administración
        </a>
      </div>

      <!-- Logout Button -->
      <div
        v-if="currentUser"
        class="logout-container"
      >
        <button class="logout-button" @click="handleLogout">
          <span class="logout-icon">🚪</span>
          <span class="logout-text">Cerrar Sesión</span>
        </button>
        <div class="user-info">{{ currentUser.username }}</div>
      </div>

      <!-- Message Detail Panel -->
      <div
        v-if="selectedMessage"
        id="message-detail"
        class="message-detail-panel"
      >
        <div class="message-detail-header">
          <h3>📜 Detalle del Mensaje</h3>
          <button class="close-button" @click="closeMessageDetail">✕</button>
        </div>
        <div class="message-detail-body">
          <div class="message-detail-meta">
            <span class="message-detail-sender">
              De: {{ selectedMessage.sender_name || '🏰 Sistema' }}
            </span>
            <span class="message-detail-date">
              {{ formatMessageDate(selectedMessage.sent_at) }}
            </span>
          </div>
          <h4 class="message-detail-subject">{{ selectedMessage.subject }}</h4>
          <div class="message-detail-content">
            {{ selectedMessage.body }}
          </div>
          <button
            v-if="selectedMessage.h3_index"
            class="message-detail-map-button"
            @click="focusOnHexFromMessage(selectedMessage.h3_index)"
          >
            🗺️ Ver en Mapa
          </button>
        </div>
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import { cellToBoundary, cellToLatLng, gridDisk } from 'h3-js';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

// Configure axios to send credentials (cookies) with all requests
axios.defaults.withCredentials = true;

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

// Player state (from session)
const currentUser = ref(null); // Current logged-in user { player_id, username, role }
const playerId = computed(() => currentUser.value?.player_id || 1); // Player ID from session
const playerGold = ref(0); // Oro inicial (se carga del servidor)
const playerHexes = ref(new Set()); // Track player's owned hexagons for adjacency checks

// World state (turn and date)
const currentTurn = ref(1);
const gameDate = ref(new Date('1039-03-01'));
const formattedDate = ref('1 de marzo de 1039');
const dayOfYear = ref(1);

// Computed property for next harvest information
const nextHarvestLabel = computed(() => {
  const day = dayOfYear.value;

  if (day < 75) {
    // Before spring harvest
    const daysUntil = 75 - day;
    return `Próxima Cosecha: Primavera (15 de Mayo) - ${daysUntil} días`;
  } else if (day >= 75 && day < 180) {
    // Before summer harvest
    const daysUntil = 180 - day;
    return `Próxima Cosecha: Verano (31 de Agosto) - ${daysUntil} días`;
  } else {
    // After summer harvest, next is spring of next year
    const daysUntil = (365 - day) + 75;
    return `Próxima Cosecha: Primavera (Año siguiente) - ${daysUntil} días`;
  }
});

// Fiefs monitoring
const myFiefs = ref([]);
const loadingFiefs = ref(false);
let previousFoodValues = {}; // Track food values for highlight animation

// Messages state
const myMessages = ref([]);
const loadingMessages = ref(false);
const selectedMessage = ref(null); // Currently selected message for detail view
const unreadCount = computed(() => myMessages.value.filter(m => !m.is_read).length);

// Server synchronization state
const SYNC_INTERVAL = 30000; // Poll server every 30 seconds
let syncIntervalId = null;
let lastSyncTime = null;

// Action panel state
const showActionPanel = ref(false);
const selectedHexData = ref(null);
const actionPanelPosition = ref({ x: 0, y: 0 });

// Navigation search state
const searchH3Input = ref('');
const capitalH3Index = ref(null); // Cache capital location

// Legend toggle state
const legendCollapsed = ref(true); // Collapsed by default

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
 * Priority: 1) Player capital, 2) URL params, 3) León default
 */
const initMap = () => {
  // Try to get player's capital from localStorage (set on login)
  const capitalH3 = localStorage.getItem('capitalH3');
  let center = LEON_CENTER;
  let zoom = INITIAL_ZOOM;

  if (capitalH3) {
    try {
      // Convert H3 index to lat/lng
      const [lat, lng] = cellToLatLng(capitalH3);
      center = [lat, lng];
      zoom = 11; // Close zoom to see the capital clearly
      console.log(`[Map Init] Centering on player's capital: ${capitalH3}`);

      // Clear the capital from localStorage after using it once
      localStorage.removeItem('capitalH3');
    } catch (error) {
      console.warn('[Map Init] Could not parse capital H3 index:', error);
    }
  }

  // Leer parámetros de la URL (override capital if URL params exist)
  const urlParams = getURLParams();
  if (urlParams) {
    center = [urlParams.lat, urlParams.lng];
    zoom = urlParams.zoom;
  }

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

  // Create custom Panes to ensure correct stacking order
  // Territory Pane (Fill) - Bottom
  map.createPane('territoryPane');
  map.getPane('territoryPane').style.zIndex = 400;
  
  // Border Pane (Lines) - Middle
  map.createPane('borderPane');
  map.getPane('borderPane').style.zIndex = 450;
  
  // Star Pane (Icons) - Top
  map.createPane('starPane');
  map.getPane('starPane').style.zIndex = 650;

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
 * Fetch world state (turn and date)
 */
const fetchWorldState = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/game/world-state`);
    if (response.data.success) {
      currentTurn.value = response.data.turn;
      gameDate.value = new Date(response.data.date);
      formattedDate.value = formatDate(gameDate.value);
      dayOfYear.value = currentTurn.value % 365;
      console.log(`✓ World state loaded: Turn ${currentTurn.value}, Day ${dayOfYear.value}/365, Date ${formattedDate.value}`);
    }
  } catch (err) {
    console.error('Failed to fetch world state:', err);
  }
};

/**
 * Format date to Spanish format: "1 de marzo de 1039"
 */
const formatDate = (date) => {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} de ${month}, ${year}`;
};

/**
 * Advance to next turn
 * Processes turn advancement and updates UI
 */
/**
 * Sync game state with server
 * Polls the server to check for turn updates and refreshes UI accordingly
 */
const syncWithServer = async () => {
  try {
    console.log('[Sync] Checking server for game state updates...');
    const response = await axios.get(`${API_URL}/api/game/world-state`);

    if (response.data.success) {
      const serverTurn = response.data.turn;
      const serverDate = new Date(response.data.date);

      // Check if turn has changed
      if (serverTurn !== currentTurn.value) {
        console.log(`[Sync] 🔄 Turn changed! ${currentTurn.value} → ${serverTurn}`);

        // Update world state
        const oldTurn = currentTurn.value;
        currentTurn.value = serverTurn;
        gameDate.value = serverDate;
        formattedDate.value = formatDate(serverDate);
        dayOfYear.value = serverTurn % 365;

        console.log(`[Sync] ✓ Updated to Turn ${serverTurn}, Day ${dayOfYear.value}/365`);

        // Check if it's a harvest day
        if (dayOfYear.value === 75 || dayOfYear.value === 180) {
          const harvestSeason = dayOfYear.value === 75 ? 'PRIMAVERA' : 'VERANO';
          showToast(`🌾 ¡Cosecha de ${harvestSeason} completada por el servidor!`, 'success');
          showHarvestBanner(harvestSeason);
        }

        // Reload map data to reflect changes
        if (currentZoom.value >= MIN_ZOOM) {
          await loadHexagonsIfZoomValid();
        }

        // Update fiefs list
        await updateFiefsUI();

        // Reload messages (new harvest messages may have been generated)
        await loadMessages();

        lastSyncTime = Date.now();
      } else {
        console.log(`[Sync] ✓ No changes (Turn ${currentTurn.value})`);
      }
    }
  } catch (err) {
    console.error('[Sync] Error syncing with server:', err);
  }
};

/**
 * Start server synchronization polling
 */
const startSync = () => {
  console.log(`[Sync] Starting server sync (polling every ${SYNC_INTERVAL / 1000}s)`);

  // Clear any existing interval
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  // Immediate first sync
  syncWithServer();

  // Poll server at regular intervals
  syncIntervalId = setInterval(syncWithServer, SYNC_INTERVAL);
};

/**
 * Stop server synchronization
 */
const stopSync = () => {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[Sync] Stopped server synchronization');
  }
};

/**
 * Update fiefs list from server
 * Fetches all territories owned by the current player
 */
const updateFiefsUI = async () => {
  try {
    loadingFiefs.value = true;
    console.log(`[Fiefs] Updating fiefs list for player ${playerId.value}...`);
    console.log(`[Fiefs] API URL: ${API_URL}/api/game/my-fiefs`);

    const response = await axios.get(`${API_URL}/api/game/my-fiefs`);

    console.log('[Fiefs] ===== RAW SERVER RESPONSE =====');
    console.log('[Fiefs] Full response:', response.data);
    console.log('[Fiefs] Success:', response.data.success);
    console.log('[Fiefs] Fiefs array:', response.data.fiefs);
    console.log('[Fiefs] Fiefs count:', response.data.fiefs?.length);

    if (response.data.success) {
      const receivedFiefs = response.data.fiefs;

      // Debug: Log first fief structure if exists
      if (receivedFiefs && receivedFiefs.length > 0) {
        console.log('[Fiefs] First fief structure:', receivedFiefs[0]);
        console.log('[Fiefs] Fields:', Object.keys(receivedFiefs[0]));
      } else {
        console.warn('[Fiefs] ⚠️ No fiefs returned from server (array is empty)');
      }

      // Store previous food values for animation
      previousFoodValues = {};
      myFiefs.value.forEach(fief => {
        previousFoodValues[fief.h3_index] = fief.food_stored;
      });

      // CRITICAL: Clear and update fiefs array
      myFiefs.value = [];
      console.log('[Fiefs] Cleared myFiefs array');

      // Use nextTick to ensure Vue processes the clear
      await new Promise(resolve => setTimeout(resolve, 0));

      myFiefs.value = receivedFiefs || [];
      console.log(`[Fiefs] ✓ Updated myFiefs.value with ${myFiefs.value.length} fiefs`);
      console.log('[Fiefs] myFiefs.value contents:', JSON.stringify(myFiefs.value, null, 2));

      // Verify the assignment worked
      if (myFiefs.value.length > 0) {
        console.log('[Fiefs] ✓ Fiefs successfully loaded and assigned');
      } else {
        console.warn('[Fiefs] ⚠️ myFiefs.value is still empty after assignment');
      }

      // Highlight food changes (green if increased)
      setTimeout(() => {
        myFiefs.value.forEach(fief => {
          const prevValue = previousFoodValues[fief.h3_index];
          if (prevValue !== undefined && fief.food_stored > prevValue) {
            const foodElement = document.querySelector(`.fief-food[data-h3="${fief.h3_index}"]`);
            if (foodElement) {
              foodElement.classList.add('food-increased');
              setTimeout(() => {
                foodElement.classList.remove('food-increased');
              }, 2000);
            }
          }
        });
      }, 100);
    } else {
      console.error('[Fiefs] Server returned success=false:', response.data);
      myFiefs.value = [];
    }
  } catch (err) {
    console.error('[Fiefs] ❌ Error fetching fiefs:', err);
    console.error('[Fiefs] Error details:', err.response?.data || err.message);
    myFiefs.value = [];
  } finally {
    loadingFiefs.value = false;
  }
};

/**
 * Focus map on a specific fief
 * @param {string} h3_index - The H3 index to focus on
 */
const focusOnFief = (h3_index) => {
  try {
    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, {
      duration: 1.0
    });
    console.log(`[Fiefs] Focused on ${h3_index}`);
  } catch (err) {
    console.error('[Fiefs] Error focusing on fief:', err);
    showToast('Error al enfocar el feudo', 'error');
  }
};

/**
 * Load messages from server
 * Fetches all messages for the current player
 */
const loadMessages = async () => {
  try {
    loadingMessages.value = true;
    console.log(`[Messages] Loading messages for player ${playerId.value}...`);

    const response = await axios.get(`${API_URL}/api/messages`, {
      params: {
        unread_only: false  // Load all messages, not just unread
      }
    });

    console.log('[Messages] Response:', response.data);

    if (response.data.success) {
      myMessages.value = response.data.messages || [];
      console.log(`[Messages] ✓ Loaded ${myMessages.value.length} messages (${unreadCount.value} unread)`);
    } else {
      console.error('[Messages] Server returned success=false:', response.data);
      myMessages.value = [];
    }
  } catch (err) {
    console.error('[Messages] ❌ Error loading messages:', err);
    console.error('[Messages] Error details:', err.response?.data || err.message);
    myMessages.value = [];
  } finally {
    loadingMessages.value = false;
  }
};

/**
 * Mark message as read and show full content
 * @param {Object} message - The message to mark as read
 */
const readMessage = async (message) => {
  try {
    console.log('[Messages] Opening message:', message.id);
    console.log('[Messages] Message data:', {
      id: message.id,
      subject: message.subject,
      bodyLength: message.body?.length || 0,
      hasBody: !!message.body
    });

    // Show message detail immediately
    selectedMessage.value = message;

    // Mark as read on server if not already read
    if (!message.is_read) {
      console.log(`[Messages] Marking message ${message.id} as read...`);
      const response = await axios.put(`${API_URL}/api/messages/${message.id}/read`);

      if (response.data.success) {
        // Update local state
        message.is_read = true;
        console.log(`[Messages] ✓ Message ${message.id} marked as read`);
      } else {
        console.error('[Messages] Failed to mark message as read:', response.data);
      }
    }
  } catch (err) {
    console.error('[Messages] ❌ Error with message:', err);
    showToast('Error al abrir mensaje', 'error');
  }
};

/**
 * Close message detail view
 */
const closeMessageDetail = () => {
  selectedMessage.value = null;
};

/**
 * Focus map on hex from message
 * @param {string} h3_index - The H3 index to focus on
 */
const focusOnHexFromMessage = (h3_index) => {
  if (!h3_index) return;

  try {
    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, {
      duration: 1.0
    });
    console.log(`[Messages] Focused map on ${h3_index}`);
    showToast('Mapa enfocado en territorio', 'success');

    // Close message detail after focusing
    closeMessageDetail();
  } catch (err) {
    console.error('[Messages] Error focusing on hex:', err);
    showToast('Error al enfocar en el mapa', 'error');
  }
};

/**
 * Format message date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted relative time
 */
const formatMessageDate = (dateString) => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;

    // Format as date if older than a week
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${day}/${month}`;
  } catch (err) {
    console.error('[Messages] Error formatting date:', err);
    return '';
  }
};

/**
 * Show central harvest banner
 * @param {string} season - The harvest season (PRIMAVERA or VERANO)
 */
const showHarvestBanner = (season) => {
  // Create banner element
  const banner = document.createElement('div');
  banner.className = 'harvest-banner';
  banner.innerHTML = `
    <div class="harvest-banner-content">
      <div class="harvest-wheat">🌾</div>
      <div class="harvest-text">
        ✨ ¡COSECHA DE ${season} FINALIZADA! ✨
        <div class="harvest-subtext">Se han recolectado suministros en todo el reino</div>
      </div>
      <div class="harvest-wheat">🌾</div>
    </div>
  `;

  // Add to document
  document.body.appendChild(banner);

  // Trigger animation
  setTimeout(() => {
    banner.classList.add('harvest-banner-show');
  }, 10);

  // Remove after 4 seconds
  setTimeout(() => {
    banner.classList.remove('harvest-banner-show');
    setTimeout(() => {
      document.body.removeChild(banner);
    }, 500);
  }, 4000);
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
  // const baseBorderWeight = isHighRes ? 0.5 : 1; // Unused in new design logic but kept for reference
  
  // New Rendering Logic with Panes
  hexagons.forEach((hex, index) => {
    try {
      // Get boundary coordinates for this H3 cell
      const boundary = cellToBoundary(hex.h3_index);

      // --- CONFIGURATION ---
      // Estilos especiales
      const hasRoad = hex.has_road || false;
      const isCapital = hex.is_capital === true;
      const isMyTerritory = hex.player_id === playerId.value;
      const playerColor = hex.player_color || null;
      const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

      // --- 1. FILL SETUP (territoryPane) ---
      let fillColor = terrainColor;
      let fillOpacity = 0.3; // Default requested
      
      // Override fill logic based on priorities
      if (isCapital && isMyTerritory) {
         fillColor = '#ff0000';
         fillOpacity = 0.5;
      } else if (isMyTerritory) {
         fillColor = '#ff0000';
         fillOpacity = 0.3;
      } else if (isPoliticalView.value && hex.player_id) {
         fillOpacity = 0.05; // Enemy territory faint fill
      } else if (playerColor) {
         fillOpacity = 0.05;
      }

      // --- 2. BORDER SETUP (borderPane) ---
      // Default: color red, weight 3 (from requirements: "color: '#d32f2f', weight: 3")
      let borderColor = '#d32f2f'; 
      let borderWeight = 3;
      
      // Logic from requirements for CAPITAL
      if (isCapital) {
          borderColor = '#ff0000';
          borderWeight = 6;
      } 
      // Logic for other cases (Roads, Enemies) - maintaining some existing logic mixed with new requirements
      else if (isMyTerritory) {
          borderColor = '#d32f2f';
          borderWeight = 3;
      } else if (isPoliticalView.value && playerColor) {
           borderColor = playerColor; // Enemy border color
           borderWeight = 3;
      } else if (hasRoad) {
           borderColor = '#d4af37'; // Gold road
      } else {
          // Standard terrain border?
          // If we want to follow the "Two Elements" strict rule for *player* hexagons:
          // The prompt says: "Cada hexágono del jugador debe tener DOS elementos"
          // It implies logic mainly for player/capital. But we should render the map consistently.
          // Using terrain color for neutral borders or keeping red theme?
          // Assuming neutral hexes just use terrain color or minimal border
          if (!hex.player_id && !hasRoad) {
             borderColor = terrainColor;
             borderWeight = isHighRes ? 0.5 : 1;
          }
      }

      // --- LAYER 1: FILL (territoryPane) ---
      // "A) El RELLENO: L.polygon con fill: true, fillColor: '#ff0000', fillOpacity: 0.3, stroke: false y pane: 'territoryPane'."
      const fillPolygon = L.polygon(boundary, {
        pane: 'territoryPane',
        stroke: false,
        fill: true,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
        // Make this the interactive layer
        interactive: true 
      });

      // Hover effects on Fill
      fillPolygon.on('mouseover', function () {
        this.setStyle({
          fillOpacity: Math.min(fillOpacity + 0.2, 1.0)
        });
      });
      fillPolygon.on('mouseout', function () {
        this.setStyle({
          fillOpacity: fillOpacity
        });
      });

      // Click interaction
      const [lat, lng] = cellToLatLng(hex.h3_index);
      fillPolygon.on('click', async function () {
        await showCellDetailsPopup(hex.h3_index, [lat, lng]);
      });

      fillPolygon.addTo(hexagonLayer);


      // --- LAYER 2: BORDER (borderPane) ---
      // "B) El BORDE: L.polygon con fill: false, color: '#d32f2f', weight: 3, y pane: 'borderPane'."
      const borderPolygon = L.polygon(boundary, {
        pane: 'borderPane',
        fill: false,
        color: borderColor,
        weight: borderWeight,
        opacity: 1.0, // Assuming solid borders unless specified
        interactive: false, // Click-through to fill
        className: isCapital ? 'capital-hexagon' : '' // Keep class for possible CSS overrides
      });

      borderPolygon.addTo(hexagonLayer);


      // --- LAYER 3: STAR MARKER (starPane) ---
      if (isCapital) {
        // "3. ICONO DE LA ESTRELLA (⭐)" - REFACTORIZADO A SVG STRICTO - MOVED TO RENDER HEXAGONS
        const [lat, lng] = cellToLatLng(hex.h3_index);
        
        console.warn('RENDER ESTRELLA:', [lat, lng]); // Verification log requested
        
        const capitalIcon = L.divIcon({
            className: 'capital-star-marker',
            html: `
              <svg viewBox="0 0 24 24" width="32" height="32" style="filter: drop-shadow(0 0 3px rgba(0,0,0,0.8));">
                <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.335 3.869 1.4-8.168-5.934-5.787 8.2-1.192z" 
                      fill="#FFD700" stroke="#8B4513" stroke-width="1.5"/>
              </svg>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        L.marker([lat, lng], {
            icon: capitalIcon,
            pane: 'starPane',
            interactive: false,
            zIndexOffset: 1000 // Ultra high priority
        }).addTo(hexagonLayer);
        
        console.log(`✓ Rendered capital star at ${hex.h3_index}`);
      }

    } catch (err) {
      console.error(`Error rendering hexagon ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Finished rendering ${hexagons.length} hexagons at resolution ${currentResolution.value}`);

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

      // --- LAYER 3: STAR MARKER (starPane) ---
      // Capital markers handled in renderHexagons now

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
 * Toggle legend collapsed/expanded state
 */
const toggleLegend = () => {
  legendCollapsed.value = !legendCollapsed.value;
  console.log(`✓ Leyenda ${legendCollapsed.value ? 'colapsada' : 'expandida'}`);
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

    // Fetch capital from game/capital endpoint (uses is_capital flag in h3_map)
    const response = await axios.get(`${API_URL}/api/game/capital`);

    if (!response.data.success) {
      showToast(response.data.message, 'warning');
      return;
    }

    // Cache the capital location
    capitalH3Index.value = response.data.h3_index;

    await focusOnHex(response.data.h3_index);
    showToast('Navegando a tu capital ⭐', 'success');
  } catch (err) {
    console.error('Error navigating to capital:', err);

    // Handle 404 specifically (no capital yet)
    if (err.response?.status === 404) {
      showToast('Aún no has colonizado tu primer territorio', 'warning');
    } else {
      showToast('Error al buscar la capital', 'error');
    }
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

    // CAPITAL BADGE - Show if this is the capital
    if (cell.is_capital) {
      popupContent += '<div class="capital-header">🏰 SEDE DEL REINO</div>';
    }

    // TITLE - Settlement name or "Territorio Salvaje"
    const title = cell.settlement_name || (cell.player_id ? `Territorio de ${cell.player_name}` : 'Territorio Salvaje');
    const titleIcon = cell.is_capital ? '👑' : (cell.settlement_name ? '🏛️' : '🗺️');
    const titleColor = cell.is_capital ? '#8B6914' : '#2c1810';
    const titleBorder = cell.is_capital ? '#FFD700' : '#8b7355';
    popupContent += `<h3 style="margin: 0 0 10px 0; color: ${titleColor}; font-size: 16px; border-bottom: 2px solid ${titleBorder}; padding-bottom: 8px;">${titleIcon} ${title}</h3>`;

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

      // Update fiefs list to include new territory
      await updateFiefsUI();

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

/**
 * Check authentication status
 * Loads user session from server
 */
const checkAuth = async () => {
  try {
    console.log('[Auth] Checking authentication...');

    // Try to get user from localStorage first (faster)
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      currentUser.value = JSON.parse(storedUser);
      console.log(`[Auth] ✓ User loaded from localStorage: ${currentUser.value.username} (${currentUser.value.role})`);
    }

    // Verify session with server
    const response = await axios.get(`${API_URL}/api/auth/me`, {
      withCredentials: true
    });

    if (response.data.success) {
      currentUser.value = response.data.user;
      localStorage.setItem('user', JSON.stringify(response.data.user));
      console.log(`[Auth] ✓ Session verified: ${currentUser.value.username} (${currentUser.value.role})`);
    } else {
      // No session, clear user data
      currentUser.value = null;
      localStorage.removeItem('user');
      console.log('[Auth] ⚠️ No active session');

      // Redirect to login
      showToast('Por favor inicia sesión', 'error');
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 2000);
    }
  } catch (err) {
    console.error('[Auth] Error checking authentication:', err);
    currentUser.value = null;
    localStorage.removeItem('user');

    // Redirect to login
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 2000);
  }
};

/**
 * Handle user logout
 * Calls logout API, clears local storage, and redirects to login
 */
const handleLogout = async () => {
  try {
    console.log('[Auth] Logging out...');

    // Call logout endpoint to destroy session
    const response = await axios.post(`${API_URL}/api/auth/logout`, {}, {
      withCredentials: true
    });

    if (response.data.success) {
      console.log('[Auth] ✓ Logout successful');
    }
  } catch (err) {
    console.error('[Auth] Error during logout:', err);
    // Continue with logout even if API call fails
  } finally {
    // Clear all local storage data
    localStorage.removeItem('user');
    localStorage.removeItem('capitalH3');
    console.log('[Auth] ✓ Local storage cleared');

    // Clear current user state
    currentUser.value = null;

    // Show toast notification
    showToast('Sesión cerrada. ¡Hasta pronto!', 'success');

    // Redirect to login page
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 1000);
  }
};

// Lifecycle hooks
onMounted(() => {
  checkAuth(); // Check authentication first
  initMap();
  fetchTerrainTypes();
  fetchWorldState();
  updateFiefsUI(); // Load initial fiefs list
  loadMessages(); // Load initial messages
  startSync(); // Start server synchronization (polls every 30 seconds)
});

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  stopSync(); // Stop server synchronization
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
  transition: all 0.3s ease;
}

.legend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 2px solid #3498db;
  padding-bottom: 8px;
}

.legend h3 {
  margin: 0;
  font-size: 18px;
  font-weight: bold;
  color: #333;
}

.btn-toggle {
  background: transparent;
  border: 1px solid #3498db;
  color: #3498db;
  font-size: 14px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: bold;
}

.btn-toggle:hover {
  background: #3498db;
  color: white;
  transform: scale(1.05);
}

.btn-toggle:active {
  transform: scale(0.95);
}

/* Collapsed state - hide legend items */
.legend-collapsed .legend-items {
  display: none;
}

.legend-collapsed .legend-loading {
  display: none;
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
  gap: 4px;
  margin-bottom: 6px;
}

.search-input {
  flex: 1;
  padding: 4px 8px;
  height: 26px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: #4CAF50;
}

.search-input::placeholder {
  font-size: 11px;
  color: #999;
}

.search-button {
  padding: 4px 10px;
  height: 26px;
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  border: none;
  border-radius: 3px;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
  padding: 6px 12px;
  height: 30px;
  background: linear-gradient(135deg, #FFD700 0%, #FFC107 100%);
  border: 2px solid #FF8F00;
  border-radius: 3px;
  color: #5D4E37;
  font-size: 12px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
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

/* Import Google Font - Moved to style.css */

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

}

/* Player Gold Indicator - Top Left Corner */
.player-gold-indicator {
  position: fixed;
  top: 20px;
  left: 20px; /* Moved to left edge */
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

/* Time Control Panel - Medieval Stone Style */
.time-control {
  position: fixed;
  top: 20px;
  right: 200px; /* Positioned left of gold indicator */
  background: linear-gradient(135deg, #3e3e3e 0%, #2a2a2a 100%);
  border: 3px solid #5d5d5d;
  border-radius: 8px;
  padding: 12px 15px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  z-index: 1001;
  font-family: 'Cinzel', 'Georgia', serif;
  min-width: 200px;
}

.time-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f4e4bc;
}

.time-icon {
  font-size: 16px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.time-label {
  font-size: 12px;
  font-weight: 600;
  color: #b8a882;
  min-width: 45px;
}

.time-value {
  font-size: 13px;
  font-weight: 700;
  color: #f4e4bc;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}

.date-display {
  font-size: 14px;
  font-weight: 700;
  color: #FFD700;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.7);
  letter-spacing: 0.3px;
}

/* Harvest Info Row */
.harvest-info {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.harvest-label {
  font-size: 11px;
  font-style: italic;
  color: #c9a668;
  line-height: 1.4;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
  font-family: 'Georgia', serif;
}

/* Server Sync Info */
.server-time-info {
  padding: 8px 12px;
  background: rgba(76, 175, 80, 0.1);
  border: 1px solid rgba(76, 175, 80, 0.3);
  border-radius: 4px;
  margin-top: 10px;
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #4CAF50;
}

.sync-icon {
  font-size: 14px;
  animation: rotate-sync 2s linear infinite;
}

@keyframes rotate-sync {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.sync-text {
  font-weight: 500;
  font-family: 'Cinzel', 'Georgia', serif;
}

/* Fiefs Monitoring Panel */
.fiefs-panel {
  position: fixed;
  top: 100px; /* Moved below gold indicator */
  left: 20px; /* Aligned with gold indicator on left side */
  background: linear-gradient(135deg, #3e3e3e 0%, #2a2a2a 100%);
  border: 3px solid #5d5d5d;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  z-index: 1001;
  font-family: 'Cinzel', 'Georgia', serif;
  width: 240px;
  max-height: 500px;
  overflow-y: auto;
}

.fiefs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid #5d5d5d;
}

.fiefs-header h3 {
  margin: 0;
  font-size: 14px;
  color: #f4e4bc;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}

.fiefs-count {
  background: #8B0000;
  color: #f4e4bc;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: bold;
}

.fiefs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 50px; /* Ensure list is visible even when empty */
}

.fiefs-empty {
  text-align: center;
  color: #b8a882;
  font-size: 11px;
  padding: 20px 10px;
  font-style: italic;
}

.fief-card {
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid #4a4a4a;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.fief-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #7d7d7d;
  transform: translateX(-3px);
  box-shadow: 3px 0 8px rgba(0, 0, 0, 0.3);
}

.fief-name {
  font-size: 12px;
  font-weight: bold;
  color: #f4e4bc;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fief-terrain {
  font-size: 10px;
  color: #b8a882;
  margin-bottom: 6px;
  font-style: italic;
}

.fief-stats {
  display: flex;
  justify-content: space-around;
  gap: 8px;
}

.fief-stat {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fief-icon {
  font-size: 14px;
}

.fief-value {
  font-size: 11px;
  font-weight: bold;
  color: #f4e4bc;
}

/* Food alert - red text when low */
.fief-low-food .fief-food {
  color: #ff4444 !important;
  animation: pulse-warning 1.5s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Food increase highlight */
.fief-food.food-increased {
  color: #7FFF00 !important;
  animation: glow-green 2s ease-out;
}

@keyframes glow-green {
  0% {
    text-shadow: 0 0 10px rgba(127, 255, 0, 1);
    transform: scale(1.2);
  }
  100% {
    text-shadow: 0 0 0 rgba(127, 255, 0, 0);
    transform: scale(1);
  }
}

/* Messages Panel */
.messages-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  max-height: 400px;
  background: rgba(30, 30, 40, 0.95);
  border: 2px solid rgba(200, 180, 130, 0.6);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  z-index: 999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(200, 180, 130, 0.3);
}

.messages-header h3 {
  margin: 0;
  font-size: 14px;
  color: #f4e4bc;
  font-weight: bold;
}

.messages-count {
  background: #e74c3c;
  color: white;
  font-size: 11px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 12px;
  min-width: 20px;
  text-align: center;
}

.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.messages-empty {
  text-align: center;
  color: #b8a882;
  font-size: 12px;
  padding: 20px 10px;
  font-style: italic;
}

.message-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(200, 180, 130, 0.3);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.message-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(200, 180, 130, 0.6);
  transform: translateX(-3px);
  box-shadow: 3px 0 8px rgba(0, 0, 0, 0.3);
}

.message-unread {
  border-left: 3px solid #3498db;
  background: rgba(52, 152, 219, 0.1);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.message-sender {
  font-size: 11px;
  font-weight: bold;
  color: #f39c12;
}

.message-date {
  font-size: 10px;
  color: #95a5a6;
}

.message-subject {
  font-size: 12px;
  font-weight: bold;
  color: #f4e4bc;
  margin-bottom: 4px;
}

.message-preview {
  font-size: 11px;
  color: #b8a882;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Scrollbar styling for messages list */
.messages-list::-webkit-scrollbar {
  width: 6px;
}

.messages-list::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.messages-list::-webkit-scrollbar-thumb {
  background: rgba(200, 180, 130, 0.4);
  border-radius: 3px;
}

.messages-list::-webkit-scrollbar-thumb:hover {
  background: rgba(200, 180, 130, 0.6);
}

/* Admin Link Container */
.admin-link-container {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
}

.admin-link {
  display: inline-block;
  padding: 12px 20px;
  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
  border: 2px solid rgba(231, 76, 60, 0.6);
  border-radius: 8px;
  color: white;
  text-decoration: none;
  font-size: 14px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  box-shadow: 0 4px 15px rgba(231, 76, 60, 0.4);
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.admin-link:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(231, 76, 60, 0.6);
  background: linear-gradient(135deg, #c0392b 0%, #a93226 100%);
}

.admin-link:active {
  transform: translateY(-1px);
}

/* Logout Container */
.logout-container {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* If admin link exists, position logout below it */
.admin-link-container + .logout-container {
  bottom: 80px; /* Position above admin link */
}

.logout-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: rgba(44, 62, 80, 0.85);
  border: 2px solid rgba(149, 165, 166, 0.4);
  border-radius: 8px;
  color: #ecf0f1;
  font-size: 13px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}

.logout-button:hover {
  background: rgba(192, 57, 43, 0.85);
  border-color: rgba(231, 76, 60, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(231, 76, 60, 0.4);
}

.logout-button:active {
  transform: translateY(0);
}

.logout-icon {
  font-size: 16px;
}

.logout-text {
  letter-spacing: 0.5px;
}

.user-info {
  font-size: 11px;
  color: #95a5a6;
  text-align: center;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-family: 'Georgia', serif;
}

/* Message Detail Panel */
.message-detail-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600px;
  max-width: 90vw;
  max-height: 80vh;
  background: rgba(30, 30, 40, 0.98);
  border: 3px solid rgba(200, 180, 130, 0.8);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(15px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideInScale 0.3s ease-out;
}

@keyframes slideInScale {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.message-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 2px solid rgba(200, 180, 130, 0.4);
}

.message-detail-header h3 {
  margin: 0;
  font-size: 16px;
  color: #f39c12;
  font-weight: bold;
}

.message-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message-detail-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(200, 180, 130, 0.2);
}

.message-detail-sender {
  font-size: 13px;
  font-weight: bold;
  color: #f39c12;
}

.message-detail-date {
  font-size: 12px;
  color: #95a5a6;
}

.message-detail-subject {
  font-size: 18px;
  color: #f4e4bc;
  margin: 0 0 15px 0;
  font-weight: bold;
}

.message-detail-content {
  font-size: 14px;
  color: #d4c4a4;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin-bottom: 20px;
}

.message-detail-map-button {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s;
  font-family: 'Cinzel', 'Georgia', serif;
}

.message-detail-map-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

.close-button {
  background: rgba(231, 76, 60, 0.8);
  border: none;
  color: white;
  font-size: 18px;
  width: 30px;
  height: 30px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.close-button:hover {
  background: rgba(231, 76, 60, 1);
  transform: scale(1.1);
}

/* Scrollbar for message detail */
.message-detail-body::-webkit-scrollbar {
  width: 8px;
}

.message-detail-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.message-detail-body::-webkit-scrollbar-thumb {
  background: rgba(200, 180, 130, 0.5);
  border-radius: 4px;
}

.message-detail-body::-webkit-scrollbar-thumb:hover {
  background: rgba(200, 180, 130, 0.7);
}

/* Harvest Banner - Central Floating Message */
.harvest-banner {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.5);
  background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
  border: 4px solid #8B4513;
  border-radius: 12px;
  padding: 30px 40px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  z-index: 10000;
  opacity: 0;
  transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.harvest-banner-show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.harvest-banner-content {
  display: flex;
  align-items: center;
  gap: 20px;
}

.harvest-wheat {
  font-size: 48px;
  animation: wheat-bounce 0.8s ease-in-out infinite;
}

@keyframes wheat-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.harvest-text {
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 24px;
  font-weight: bold;
  color: #5d4e37;
  text-shadow: 2px 2px 4px rgba(255, 255, 255, 0.5);
  text-align: center;
}

.harvest-subtext {
  font-size: 14px;
  font-weight: normal;
  margin-top: 8px;
  color: #6d5a47;
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
    left: 10px; /* Keep on left side for mobile */
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

  .time-control {
    top: auto;
    bottom: 20px;
    right: 10px;
    left: 10px;
    padding: 10px 12px;
    min-width: auto;
  }

  .time-row {
    gap: 4px;
  }

  .time-icon {
    font-size: 14px;
  }

  .time-label {
    font-size: 11px;
    min-width: 40px;
  }

  .time-value {
    font-size: 12px;
  }

  .btn-next-turn {
    font-size: 11px;
    padding: 6px 10px;
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

/* Capital Badge - Highlighted banner in popup */
.capital-badge {
  background: linear-gradient(45deg, #ffd700, #ff8c00);
  color: #000;
  text-align: center;
  font-weight: bold;
  padding: 6px 4px;
  border-radius: 4px;
  margin-bottom: 8px;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  font-size: 11px;
  letter-spacing: 1px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  animation: pulse-gold 2s ease-in-out infinite;
}

@keyframes pulse-gold {
  0%, 100% {
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  50% {
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
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

/* Capital star marker styling - Moved to style.css */

/* Legacy support for old class name */
:deep(.capital-star-label) {
  font-size: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  line-height: 30px;
  filter: drop-shadow(0 0 3px gold) drop-shadow(0 0 6px rgba(255, 215, 0, 0.8));
  pointer-events: none;
  z-index: 10000 !important;
}
</style>
