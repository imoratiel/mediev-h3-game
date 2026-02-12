/**
 * mapApi.js
 * Servicio centralizado para todas las llamadas a la API del juego
 */

import axios from 'axios';

// API Base URL from environment or default to localhost
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Configure axios to send credentials (cookies) with all requests
// This is CRITICAL for JWT authentication via HttpOnly cookies
axios.defaults.withCredentials = true;

// ============================================
// MAP ENDPOINTS
// ============================================

/**
 * Get map region data with hexagons
 * @param {Object} params - { minLat, maxLat, minLng, maxLng }
 */
export async function getMapRegion(params) {
  const response = await axios.get(`${API_URL}/api/map/region`, { params });
  return response.data;
}

/**
 * Get army markers for map
 * @param {Object} params - { minLat, maxLat, minLng, maxLng }
 */
export async function getMapArmies(params) {
  const response = await axios.get(`${API_URL}/api/map/armies`, { params });
  return response.data;
}

/**
 * Get detailed cell information
 * @param {string} h3_index - H3 index of the cell
 */
export async function getCellDetails(h3_index) {
  const response = await axios.get(`${API_URL}/api/map/cell-details/${h3_index}`);
  return response.data;
}

/**
 * Get detailed army information for a specific hex
 * @param {string} h3_index - H3 index of the hex with armies
 */
export async function getArmyDetails(h3_index) {
  const response = await axios.get(`${API_URL}/api/map/army-details/${h3_index}`);
  return response.data;
}

// ============================================
// PLAYER ENDPOINTS
// ============================================

/**
 * Get player information
 * @param {number} playerId - Player ID
 */
export async function getPlayer(playerId) {
  const response = await axios.get(`${API_URL}/api/players/${playerId}`);
  return response.data;
}

// ============================================
// TERRAIN ENDPOINTS
// ============================================

/**
 * Get all terrain types
 */
export async function getTerrainTypes() {
  const response = await axios.get(`${API_URL}/api/terrain-types`);
  return response.data;
}

// ============================================
// GAME STATE ENDPOINTS
// ============================================

/**
 * Get world state (current turn, date, etc.)
 */
export async function getWorldState() {
  const response = await axios.get(`${API_URL}/api/game/world-state`);
  return response.data;
}

/**
 * Get game configuration
 */
export async function getGameConfig() {
  const response = await axios.get(`${API_URL}/api/admin/game-config`, {
    params: { group: 'exploration' }
  });
  return response.data;
}

// ============================================
// FIEF ENDPOINTS
// ============================================

/**
 * Get user's fiefs/territories
 */
export async function getMyFiefs() {
  const response = await axios.get(`${API_URL}/api/game/my-fiefs`);
  return response.data;
}

/**
 * Get capital information
 */
export async function getCapital() {
  const response = await axios.get(`${API_URL}/api/game/capital`);
  return response.data;
}

// ============================================
// TERRITORY ACTIONS
// ============================================

/**
 * Claim/colonize a territory
 * @param {string} h3_index - H3 index to claim
 */
export async function claimTerritory(h3_index) {
  const response = await axios.post(`${API_URL}/api/game/claim`, {
    h3_index
  });
  return response.data;
}

/**
 * Start exploration on a territory
 * @param {string} h3_index - H3 index to explore
 */
export async function exploreTerritory(h3_index) {
  const response = await axios.post(`${API_URL}/api/territory/explore`, {
    h3_index
  });
  return response.data;
}

/**
 * Upgrade a building in a territory
 * @param {string} h3_index - H3 index
 * @param {string} buildingType - Type of building to upgrade
 */
export async function upgradeBuilding(h3_index, buildingType) {
  const response = await axios.post(`${API_URL}/api/territory/upgrade`, {
    h3_index,
    building_type: buildingType
  });
  return response.data;
}

// ============================================
// MESSAGE ENDPOINTS
// ============================================

/**
 * Get all messages
 * @param {Object} params - Query parameters (e.g., { type: 'system' })
 */
export async function getMessages(params = {}) {
  const response = await axios.get(`${API_URL}/api/messages`, { params });
  return response.data;
}

/**
 * Get message thread
 * @param {number} threadId - Thread ID
 */
export async function getMessageThread(threadId) {
  const response = await axios.get(`${API_URL}/api/messages/thread/${threadId}`);
  return response.data;
}

/**
 * Mark message as read
 * @param {number} messageId - Message ID
 */
export async function markMessageAsRead(messageId) {
  const response = await axios.put(`${API_URL}/api/messages/${messageId}/read`);
  return response.data;
}

/**
 * Send a message
 * @param {Object} payload - { recipient_username, subject, body, thread_id? }
 */
export async function sendMessage(payload) {
  const response = await axios.post(`${API_URL}/api/messages`, payload);
  return response.data;
}

// ============================================
// MILITARY ENDPOINTS
// ============================================

/**
 * Get all unit types
 */
export async function getUnitTypes() {
  const response = await axios.get(`${API_URL}/api/military/unit-types`, {
    params: { available_only: true }
  });
  return response.data;
}

/**
 * Get troops for a player
 * @param {number} playerId - Player ID
 */
export async function getTroops(playerId) {
  const response = await axios.get(`${API_URL}/api/military/troops`, {
    params: { player_id: playerId }
  });
  return response.data;
}

/**
 * Recruit troops
 * @param {Object} payload - { h3_index, unit_type_id, quantity, army_name?, army_id? }
 */
export async function recruitTroops(payload) {
  const response = await axios.post(`${API_URL}/api/military/recruit`, payload);
  return response.data;
}

/**
 * Move army to a destination
 * @param {number} armyId - Army ID
 * @param {string} targetH3 - Target H3 index
 */
export async function moveArmy(armyId, targetH3) {
  const response = await axios.post(`${API_URL}/api/military/move-army`, {
    army_id: armyId,
    target_h3: targetH3
  });
  return response.data;
}

// ============================================
// AUTH ENDPOINTS
// ============================================

/**
 * Get current authenticated user info
 */
export async function getAuthMe() {
  const response = await axios.get(`${API_URL}/api/auth/me`);
  return response.data;
}

/**
 * Logout current user
 */
export async function logout() {
  const response = await axios.post(`${API_URL}/api/auth/logout`);
  return response.data;
}
