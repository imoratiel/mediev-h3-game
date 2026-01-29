<template>
  <div class="map-container">
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <p>Cargando mapa de Mallorca...</p>
    </div>
    <div v-if="error" class="error-message">
      <p>❌ Error: {{ error }}</p>
    </div>
    <div id="map" ref="mapContainer"></div>
    <div class="map-info">
      <p>Hexágonos: {{ hexagonCount }}</p>
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
const loading = ref(true);
const error = ref(null);
const hexagonCount = ref(0);
let map = null;
let hexagonLayer = null;

// API configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Initialize Leaflet map centered on Mallorca
 */
const initMap = () => {
  // Mallorca coordinates (approximate center)
  const mallorcaCenter = [39.6, 2.9];

  map = L.map('map', {
    center: mallorcaCenter,
    zoom: 10,
    zoomControl: true,
  });

  // Add OpenStreetMap tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  // Create a layer group for hexagons
  hexagonLayer = L.layerGroup().addTo(map);
};

/**
 * Fetch hexagon data from backend API
 */
const fetchHexagonData = async () => {
  try {
    loading.value = true;
    error.value = null;

    const response = await axios.get(`${API_URL}/api/map/region`);
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
 * Render H3 hexagons on the map
 * @param {Array} hexagons - Array of {h3_index, name, color}
 */
const renderHexagons = (hexagons) => {
  console.log(`Rendering ${hexagons.length} hexagons...`);

  hexagons.forEach((hex, index) => {
    try {
      // Get boundary coordinates for this H3 cell
      // cellToBoundary returns array of [lat, lng] pairs
      const boundary = cellToBoundary(hex.h3_index);

      // Create Leaflet polygon
      const polygon = L.polygon(boundary, {
        color: hex.color,
        fillColor: hex.color,
        fillOpacity: 0.6,
        weight: 1,
        opacity: 0.8,
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

// Lifecycle hooks
onMounted(() => {
  initMap();
  fetchHexagonData();
});

onBeforeUnmount(() => {
  if (map) {
    map.remove();
  }
});
</script>

<style scoped>
.map-container {
  position: relative;
  width: 100%;
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
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
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

.map-info {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: white;
  padding: 10px 15px;
  border-radius: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  font-size: 14px;
}

.map-info p {
  margin: 0;
  font-weight: bold;
}
</style>
