/**
 * mapApi.js
 * Servicio centralizado para todas las llamadas a la API del juego
 */

import axios from 'axios';

// API Base URL:
//   - Docker / producción: VITE_API_URL no definida → '' (URL relativa, Nginx hace el proxy)
//   - Dev local con Vite:  VITE_API_URL no definida → '' (Vite proxy reenvía /api a :3000)
//   - Override explícito:  define VITE_API_URL=http://host:puerto en client/.env
// Se usa ?? en lugar de || para que '' (vacío) sea un valor válido y no active el fallback.
const API_URL = import.meta.env.VITE_API_URL ?? '';

// Configure axios to send credentials (cookies) with all requests
// This is CRITICAL for JWT authentication via HttpOnly cookies
axios.defaults.withCredentials = true;

// Global 401 interceptor: redirect to login on any expired/invalid session
let _redirectingToLogin = false;
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !_redirectingToLogin) {
      _redirectingToLogin = true;
      localStorage.removeItem('user');
      window.location.replace('/login.html');
    }
    return Promise.reject(err);
  }
);

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
 * Get worker markers for map
 * @param {Object} params - { minLat, maxLat, minLng, maxLng }
 */
export async function getMapWorkers(params) {
  const response = await axios.get(`${API_URL}/api/map/workers`, { params });
  return response.data;
}

/**
 * Get active construction markers (bridges in progress) for map rendering
 * @param {Object} params - { minLat, maxLat, minLng, maxLng }
 */
export async function getMapConstructions(params) {
  const response = await axios.get(`${API_URL}/api/map/constructions`, { params });
  return response.data;
}

/**
 * Get all worker type definitions (cost, stats)
 */
export async function getWorkerTypes() {
  const response = await axios.get(`${API_URL}/api/workers/types`);
  return response.data;
}

/**
 * Hire a worker at the specified hex
 * @param {{ h3_index: string, worker_type_id: number }} params
 */
export async function buyWorker({ h3_index, worker_type_id }) {
  const response = await axios.post(`${API_URL}/api/workers/buy`, { h3_index, worker_type_id });
  return response.data;
}

/**
 * Get all workers owned by the authenticated player
 */
export async function getMyWorkers() {
  const response = await axios.get(`${API_URL}/api/workers/my`);
  return response.data;
}

/**
 * Start a bridge construction at h3_index.
 * Terrain must be Río or Agua. Workers at the hex are consumed.
 * @param {string} h3_index
 */
export async function startBridgeConstruction(h3_index) {
  const response = await axios.post(`${API_URL}/api/workers/start-construction`, { h3_index });
  return response.data;
}

/**
 * Set movement destination for all player workers at from_h3.
 * The turn engine will advance them toward destination_h3 each turn.
 * @param {string} fromH3 - Current hex of the workers
 * @param {string} destinationH3 - Target hex
 */
export async function setWorkerHexDestination(workerId, destinationH3) {
  const response = await axios.post(`${API_URL}/api/workers/set-hex-destination`, {
    worker_id: workerId,
    destination_h3: destinationH3,
  });
  return response.data;
}

/**
 * Get completed buildings in visible map extent (for map icons)
 * @param {Object} params - { minLat, maxLat, minLng, maxLng }
 */
export async function getMapBuildings(params) {
  const response = await axios.get(`${API_URL}/api/map/buildings`, { params });
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
 * Get user's fiefs/territories (server-side paginated)
 * @param {Object} opts - { page, limit, filter_name, filter_maxpop }
 */
export async function getMyFiefs({ page = 1, limit = 10, filter_name = '', filter_maxpop = null, filter_division = '' } = {}) {
  const params = { page, limit };
  if (filter_name)     params.filter_name = filter_name;
  if (filter_maxpop != null) params.filter_maxpop = filter_maxpop;
  if (filter_division) params.filter_division = filter_division;
  const response = await axios.get(`${API_URL}/api/game/my-fiefs`, { params });
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
 * Trigger Epic Initialization for a new player (first-time setup).
 * Idempotent — safe to call multiple times; returns 409 if already initialized.
 */
export async function initializePlayer(cultureId = null, randomBonus = false, linaje = '') {
  const params = {};
  if (cultureId !== null) params.culture_id = cultureId;
  if (randomBonus) params.random_bonus = true;
  if (linaje) params.linaje = linaje;
  const response = await axios.post(`${API_URL}/api/game/initialize`, null, { params });
  return response.data;
}

/**
 * Upgrade farm level in a fief
 * @param {string} h3_index - H3 index of the fief
 */
export async function upgradeFarm(h3_index) {
  const response = await axios.post(`${API_URL}/api/fiefs/${h3_index}/upgrade-farm`);
  return response.data;
}

/**
 * Get fiefs data for economy panel (all fiefs, no pagination)
 */
export async function getEconomyFiefs() {
  const response = await axios.get(`${API_URL}/api/game/my-fiefs`, { params: { page: 1, limit: 999 } });
  return response.data;
}

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
 * Get all available buildings catalog
 */
export async function getBuildings() {
  const response = await axios.get(`${API_URL}/api/territory/buildings`);
  return response.data;
}

/**
 * Start construction of a building in a territory
 * @param {string} h3_index - H3 index of the fief
 * @param {number} building_id - ID of the building to construct
 */
export async function constructBuilding(h3_index, building_id) {
  const response = await axios.post(`${API_URL}/api/territory/construct`, { h3_index, building_id });
  return response.data;
}

/**
 * Upgrade a building in a territory
 * @param {string} h3_index - H3 index
 * @param {string} buildingType - Type of building to upgrade
 */
export async function upgradeFiefBuilding(h3_index) {
  const response = await axios.post(`${API_URL}/api/territory/upgrade-building`, { h3_index });
  return response.data;
}

export async function repairBuilding({ h3_index }) {
  const response = await axios.post(`${API_URL}/api/territory/repair-building`, { h3_index });
  return response.data;
}

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

export async function getArmies() {
  const response = await axios.get(`${API_URL}/api/military/armies`);
  return response.data;
}

export async function getArmyDetail(armyId) {
  const response = await axios.get(`${API_URL}/api/military/armies/${armyId}`);
  return response.data;
}

export async function getNotifications() {
  const response = await axios.get(`${API_URL}/api/notifications`);
  return response.data;
}

export async function markNotificationRead(id) {
  const response = await axios.put(`${API_URL}/api/notifications/${id}/read`);
  return response.data;
}

export async function markAllNotificationsRead() {
  const response = await axios.put(`${API_URL}/api/notifications/read-all`);
  return response.data;
}

export async function markAllNotificationsUnread() {
  const response = await axios.put(`${API_URL}/api/notifications/unread-all`);
  return response.data;
}

export async function markNotificationsTypeRead(type) {
  const response = await axios.put(`${API_URL}/api/notifications/read-type`, { type });
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
 * Bulk recruit multiple unit types in one transaction
 * @param {Object} payload - { h3_index, army_name?, units: [{unit_type_id, quantity}] }
 */
export async function bulkRecruit(payload) {
  const response = await axios.post(`${API_URL}/api/military/bulk-recruit`, payload);
  return response.data;
}

export async function getArmyCapacity() {
  const response = await axios.get(`${API_URL}/api/military/capacity`);
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

export async function stopArmy(armyId) {
  const response = await axios.post(`${API_URL}/api/military/stop`, { army_id: armyId });
  return response.data;
}

export async function dismissTroops(armyId, unitTypeId, quantity) {
  const response = await axios.post(`${API_URL}/api/military/dismiss`, { army_id: armyId, unit_type_id: unitTypeId, quantity });
  return response.data;
}

/**
 * Reinforce an existing army with additional troops.
 * @param {number} armyId - Army to reinforce
 * @param {Array}  units  - [{ unit_type_id, quantity }, ...]
 */
export async function reinforceArmy(armyId, units) {
  const response = await axios.post(`${API_URL}/api/military/reinforce`, { armyId, units });
  return response.data;
}

export async function attackArmy(armyId) {
  const response = await axios.post(`${API_URL}/api/military/attack`, { armyId });
  return response.data;
}

export async function attackSpecificArmy(attackerArmyId, targetArmyId) {
  const response = await axios.post(`${API_URL}/api/military/attack-army`, { attackerArmyId, targetArmyId });
  return response.data;
}

export async function conquerTerritory(armyId, h3_index) {
  const response = await axios.post(`${API_URL}/api/military/conquer`, { armyId, h3_index });
  return response.data;
}

export async function conquerFief(armyId, h3_index) {
  const response = await axios.post(`${API_URL}/api/military/conquer-fief`, { armyId, h3_index });
  return response.data;
}

export async function mergeArmies(armyId, h3_index) {
  const response = await axios.post(`${API_URL}/api/military/merge`, { army_id: armyId, h3_index });
  return response.data;
}

export async function getArmiesAtHex(h3_index) {
  const response = await axios.get(`${API_URL}/api/military/armies-at-hex/${h3_index}`);
  return response.data;
}

export async function getRecruitablePool(h3_index) {
  const response = await axios.get(`${API_URL}/api/military/recruitable-pool?h3_index=${h3_index}`);
  return response.data;
}

export async function transferArmy(fromArmyId, toArmyId, troops, provisions) {
  const response = await axios.post(`${API_URL}/api/military/transfer`, {
    from_army_id: fromArmyId,
    to_army_id: toArmyId,
    troops,
    provisions,
  });
  return response.data;
}

export async function scoutArmy(armyId, targetArmyId) {
  const response = await axios.post(`${API_URL}/api/military/scout`, {
    attacker_army_id: armyId,
    target_army_id: targetArmyId
  });
  return response.data;
}

/**
 * Get active routes for all own armies (for route visualization)
 * Returns: { success, routes: [{army_id, name, h3_index, destination, path}] }
 */
export async function getMyRoutes() {
  const response = await axios.get(`${API_URL}/api/military/my-routes`);
  return response.data;
}

// ============================================
// ECONOMY ENDPOINTS
// ============================================

/**
 * Get aggregated resource summary and player's individual economy settings
 */
export async function getEconomySummary() {
  const response = await axios.get(`${API_URL}/api/economy/summary`);
  return response.data;
}

/**
 * Update player's individual economy settings (tax_rate, tithe_active)
 * @param {Object} payload - { tax_rate?: number, tithe_active?: boolean }
 */
export async function updateEconomySettings(payload) {
  const response = await axios.patch(`${API_URL}/api/economy/settings`, payload);
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

export async function updateProfile(display_name) {
  const response = await axios.put(`${API_URL}/api/auth/profile`, { display_name });
  return response.data;
}

// ============================================
// ADMIN ENGINE CONTROL
// ============================================

export async function getAdminProcessStatus() {
  const response = await axios.get(`${API_URL}/api/admin/process-status`);
  return response.data;
}

export async function updateAdminGameConfig(group, key, value) {
  const response = await axios.put(`${API_URL}/api/admin/game-config`, { group, key, value });
  return response.data;
}

export async function startEngine() {
  const response = await axios.post(`${API_URL}/api/admin/engine/start`);
  return response.data;
}

export async function stopEngine() {
  const response = await axios.post(`${API_URL}/api/admin/engine/stop`);
  return response.data;
}

export async function pauseGame() {
  const response = await axios.post(`${API_URL}/api/admin/engine/pause`);
  return response.data;
}

export async function resumeGame() {
  const response = await axios.post(`${API_URL}/api/admin/engine/resume`);
  return response.data;
}

export async function forceTurn() {
  const response = await axios.post(`${API_URL}/api/admin/engine/force-turn`);
  return response.data;
}

export async function forceHarvest() {
  const response = await axios.post(`${API_URL}/api/admin/engine/force-harvest`);
  return response.data;
}

export async function forceExploration() {
  const response = await axios.post(`${API_URL}/api/admin/engine/force-exploration`);
  return response.data;
}

export async function createAdminPagus(player_id = null) {
  const body = player_id ? { player_id } : {};
  const response = await axios.post(`${API_URL}/api/admin/create-pagus`, body);
  return response.data;
}

// ============================================
// ADMIN AI AGENTS
// ============================================

export async function getAIAgents() {
  const response = await axios.get(`${API_URL}/api/admin/ai/agents`);
  return response.data;
}

export async function spawnAIFarmer(count = 1) {
  const response = await axios.post(`${API_URL}/api/admin/ai/spawn-farmer`, { count });
  return response.data;
}

export async function spawnAIAgent(type = 'farmer', count = 1) {
  const response = await axios.post(`${API_URL}/api/admin/ai/spawn`, { type, count });
  return response.data;
}

export async function forceAITurn() {
  const response = await axios.post(`${API_URL}/api/admin/ai/force-turn`);
  return response.data;
}

export async function getAISettings() {
  const response = await axios.get(`${API_URL}/api/admin/ai/settings`);
  return response.data;
}

export async function updateAISetting(key, value) {
  const response = await axios.post(`${API_URL}/api/admin/ai/settings`, { key, value });
  return response.data;
}

export async function getAIUsageStats() {
  const response = await axios.get(`${API_URL}/api/admin/ai/usage-stats`);
  return response.data;
}

export async function resetAIUsageStats() {
  const response = await axios.delete(`${API_URL}/api/admin/ai/usage-stats`);
  return response.data;
}

export async function testAIConnection() {
  const response = await axios.post(`${API_URL}/api/admin/ai/test`);
  return response.data;
}

export async function deleteAIAgent(botId) {
  const response = await axios.delete(`${API_URL}/api/admin/bots/${botId}`);
  return response.data;
}

export async function resetGame() {
  const response = await axios.post(`${API_URL}/api/admin/reset-game`);
  return response.data;
}

export async function getAuditStatus() {
  const response = await axios.get(`${API_URL}/api/admin/audit/status`);
  return response.data;
}

export async function testKafkaEvent(channel) {
  const response = await axios.post(`${API_URL}/api/admin/audit/test`, { channel });
  return response.data;
}

// ============================================
// DIVISION ENDPOINTS
// ============================================

/**
 * Get laws/division data for a territory
 * @param {string} h3_index
 */
export async function getTerritoryLaws(h3_index) {
  const response = await axios.get(`${API_URL}/api/territory/${h3_index}/laws`);
  return response.data;
}

export async function proposeDivisionName(baseName) {
  const response = await axios.get(`${API_URL}/api/divisions/propose-name`, { params: { base_name: baseName } });
  return response.data;
}

export async function updateDivisionTax(divisionId, taxRate) {
  const response = await axios.patch(`${API_URL}/api/divisions/${divisionId}/tax`, { tax_rate: taxRate });
  return response.data;
}

/**
 * Proclaim a new political division
 * @param {Object} payload - { capital_h3, fiefs, name? }
 */
export async function proclaimDivision(payload) {
  const response = await axios.post(`${API_URL}/api/divisions/proclaim`, payload);
  return response.data;
}

/**
 * Get all political divisions of the current player
 */
export async function getPlayerDivisions() {
  const response = await axios.get(`${API_URL}/api/divisions/my`);
  return response.data;
}

/**
 * Get GeoJSON FeatureCollection of all active division boundaries
 */
export async function getDivisionBoundaries() {
  const response = await axios.get(`${API_URL}/api/divisions/boundaries`);
  return response.data;
}

// ─── Personajes y Dinastías ───────────────────────────────────────────────────

export async function getMyCharacters() {
  const response = await axios.get(`${API_URL}/api/characters`);
  return response.data;
}

export async function getVisibleEnemyCharacters() {
  const response = await axios.get(`${API_URL}/api/characters/visible`);
  return response.data;
}

export async function getCharacter(id) {
  const response = await axios.get(`${API_URL}/api/characters/${id}`);
  return response.data;
}

export async function captureCharacter(id) {
  const response = await axios.post(`${API_URL}/api/characters/${id}/capture`);
  return response.data;
}

export async function procreateCharacter(parentId, name) {
  const response = await axios.post(`${API_URL}/api/characters/${parentId}/procreate`, { name });
  return response.data;
}

export async function adoptCharacter(name = '') {
  const response = await axios.post(`${API_URL}/api/characters/adopt`, { name });
  return response.data;
}

export async function setCharacterHeir(characterId) {
  const response = await axios.patch(`${API_URL}/api/characters/${characterId}/heir`);
  return response.data;
}

export async function assignArmyCommander(armyId, characterId) {
  const response = await axios.put(`${API_URL}/api/armies/${armyId}/commander`, { character_id: characterId });
  return response.data;
}

export async function removeArmyCommander(armyId) {
  const response = await axios.put(`${API_URL}/api/armies/${armyId}/commander`, { character_id: null });
  return response.data;
}

export async function moveCharacter(characterId, targetH3) {
  const response = await axios.put(`${API_URL}/api/characters/${characterId}/move`, { h3_index: targetH3 });
  return response.data;
}

export async function stopCharacter(characterId) {
  const response = await axios.delete(`${API_URL}/api/characters/${characterId}/move`);
  return response.data;
}

// ============================================
// RELACIONES POLÍTICAS
// ============================================

export async function searchPlayers(q) {
  const response = await axios.get(`${API_URL}/api/players/search`, { params: { q } });
  return response.data;
}

export async function getRelationTypes() {
  const response = await axios.get(`${API_URL}/api/relations/types`);
  return response.data;
}

export async function getMyRelations() {
  const response = await axios.get(`${API_URL}/api/relations/my`);
  return response.data;
}

export async function getPendingRelations() {
  const response = await axios.get(`${API_URL}/api/relations/pending`);
  return response.data;
}

export async function getPlayerRelations(playerId) {
  const response = await axios.get(`${API_URL}/api/relations/${playerId}`);
  return response.data;
}

export async function proposeRelation(payload) {
  const response = await axios.post(`${API_URL}/api/relations/propose`, payload);
  return response.data;
}

export async function acceptRelation(relationId) {
  const response = await axios.post(`${API_URL}/api/relations/${relationId}/accept`);
  return response.data;
}

export async function breakRelation(relationId, reason = '') {
  const response = await axios.post(`${API_URL}/api/relations/${relationId}/break`, { reason });
  return response.data;
}

// ============================================
// NAVAL ENDPOINTS
// ============================================

export async function getShipTypes() {
  const response = await axios.get(`${API_URL}/api/naval/ship-types`);
  return response.data;
}

export async function getFleets() {
  const response = await axios.get(`${API_URL}/api/naval/fleets`);
  return response.data;
}

export async function getFleetDetail(fleetId) {
  const response = await axios.get(`${API_URL}/api/naval/fleets/${fleetId}`);
  return response.data;
}

export async function getNavalCapacity() {
  const response = await axios.get(`${API_URL}/api/naval/capacity`);
  return response.data;
}

export async function getEmbarkableArmies(fleetId) {
  const response = await axios.get(`${API_URL}/api/naval/embarkable/${fleetId}`);
  return response.data;
}

export async function createFleet(h3_index, name = '') {
  const response = await axios.post(`${API_URL}/api/naval/create-fleet`, { h3_index, name });
  return response.data;
}

export async function recruitShips(fleet_id, ship_type_id, quantity) {
  const response = await axios.post(`${API_URL}/api/naval/recruit-ships`, { fleet_id, ship_type_id, quantity });
  return response.data;
}

export async function embarkArmy(fleet_id, army_id) {
  const response = await axios.post(`${API_URL}/api/naval/embark`, { fleet_id, army_id });
  return response.data;
}

export async function embarkCharacter(fleet_id, char_id) {
  const response = await axios.post(`${API_URL}/api/naval/embark-character`, { fleet_id, char_id });
  return response.data;
}

export async function embarkWorker(fleet_id, worker_id) {
  const response = await axios.post(`${API_URL}/api/naval/embark-worker`, { fleet_id, worker_id });
  return response.data;
}

export async function disembarkArmy(army_id, target_h3 = null) {
  const body = { army_id };
  if (target_h3) body.target_h3 = target_h3;
  const response = await axios.post(`${API_URL}/api/naval/disembark`, body);
  return response.data;
}

export async function disembarkCharacter(char_id, target_h3 = null) {
  const body = { char_id };
  if (target_h3) body.target_h3 = target_h3;
  const response = await axios.post(`${API_URL}/api/naval/disembark-character`, body);
  return response.data;
}

export async function disembarkWorker(worker_id, target_h3 = null) {
  const body = { worker_id };
  if (target_h3) body.target_h3 = target_h3;
  const response = await axios.post(`${API_URL}/api/naval/disembark-worker`, body);
  return response.data;
}

export async function getLandingHexes(fleet_id) {
  const response = await axios.get(`${API_URL}/api/naval/landing-hexes/${fleet_id}`);
  return response.data;
}

export async function moveFleet(fleet_id, target_h3) {
  const response = await axios.post(`${API_URL}/api/naval/move-fleet`, { fleet_id, target_h3 });
  return response.data;
}

export async function stopFleet(fleet_id) {
  const response = await axios.post(`${API_URL}/api/naval/stop-fleet`, { fleet_id });
  return response.data;
}

