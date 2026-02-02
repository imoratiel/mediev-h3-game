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
            <span class="settlement-period">{{ settlement.period }}</span>
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import { cellToBoundary, cellToLatLng } from 'h3-js';
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
const settlements = ref([]);

let map = null;
let hexagonLayer = null;
let settlementMarkersLayer = null;
let settlementMarkersMap = {}; // Map: settlement name -> marker
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

  // Create a separate layer for settlement markers
  settlementMarkersLayer = L.layerGroup().addTo(map);

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
      const borderColor = hasRoad ? '#d4af37' : hex.color; // Dorado para caminos

      // Create Leaflet polygon with estilos ajustados
      const polygon = L.polygon(boundary, {
        color: borderColor,
        fillColor: hex.color,
        fillOpacity: hexagonOpacity.value / 100,
        weight: borderWeight,
        opacity: hasRoad ? 0.9 : borderOpacity,
      });

      // Add hover effect
      polygon.on('mouseover', function () {
        this.setStyle({
          weight: hasRoad ? borderWeight * 1.5 : hoverWeight,
          fillOpacity: Math.min(hexagonOpacity.value / 100 + 0.2, 1.0),
        });
      });

      polygon.on('mouseout', function () {
        this.setStyle({
          weight: borderWeight,
          fillOpacity: hexagonOpacity.value / 100,
        });
      });

      // Get center coordinates of hexagon
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Build popup content con información histórica y coordenadas
      let popupContent = `<strong>${hex.name}</strong><br>`;
      popupContent += `<span style="color: #666; font-size: 12px;">Coordenadas: [${lat.toFixed(5)}, ${lng.toFixed(5)}]</span><br>`;
      popupContent += `H3: ${hex.h3_index}<br>Resolución: ${currentResolution.value}`;

      if (hasRoad) {
        popupContent += '<br><span style="color: #d4af37;">🛤️ Vía Romana</span>';
      }

      if (hex.settlement) {
        const settlementTypeIcons = {
          city: '🏛️',
          town: '🏘️',
          village: '🏡',
          fort: '⚔️',
          monastery: '⛪'
        };
        const icon = settlementTypeIcons[hex.settlement.type] || '📍';
        popupContent += `<br><br><strong>${icon} ${hex.settlement.name}</strong>`;
        popupContent += `<br>Tipo: ${hex.settlement.type}`;
        popupContent += `<br>Periodo: ${hex.settlement.period}`;
        if (hex.settlement.population_rank) {
          popupContent += `<br>Rango: ${hex.settlement.population_rank}/10`;
        }
      }

      polygon.bindPopup(popupContent);

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

  // Render settlement markers if zoom is sufficient
  if (currentZoom.value >= MIN_ZOOM_SETTLEMENTS) {
    renderSettlementMarkers(hexagons);
  } else {
    clearSettlementMarkers();
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
      popupContent += `<strong>Periodo:</strong> ${hex.settlement.period}<br>`;
      if (hex.settlement.population_rank) {
        popupContent += `<strong>Rango:</strong> ${hex.settlement.population_rank}/10`;
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

.settlement-period {
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
</style>
