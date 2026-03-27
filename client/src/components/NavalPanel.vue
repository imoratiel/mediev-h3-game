<template>
  <div class="naval-panel">

    <!-- ── Capacity bar ───────────────────────────────────────── -->
    <div class="naval-capacity-bar">
      <span class="cap-label">⛵ Flotas:</span>
      <span class="cap-value" :class="{ 'at-limit': fleetCount >= fleetLimit }">
        {{ fleetCount }}/{{ fleetLimit }}
      </span>
      <span v-if="fleetCount >= fleetLimit" class="cap-hint">— Necesitas más feudos</span>
    </div>

    <!-- ── Loading / empty ───────────────────────────────────── -->
    <div v-if="loading" class="naval-loading">Cargando flotas...</div>

    <div v-else-if="fleets.length === 0" class="naval-empty">
      <p>No tienes flotas activas.</p>
      <p class="empty-hint">Construye un Puerto (⛵) en un feudo costero para crear tu primera flota.</p>
    </div>

    <!-- ── Fleet list ─────────────────────────────────────────── -->
    <div v-else class="fleet-list">
      <div
        v-for="fleet in fleets"
        :key="fleet.army_id"
        class="fleet-card"
        :class="{ 'fleet-expanded': expandedFleet === fleet.army_id }"
      >
        <!-- Card header -->
        <div class="fleet-header" @click="toggleFleet(fleet.army_id)">
          <div class="fleet-header-left">
            <span class="fleet-icon">⛵</span>
            <div class="fleet-title-block">
              <span class="fleet-name">{{ fleet.name }}</span>
              <span class="fleet-pos">📍 {{ cellToLatLng(fleet.h3_index).map(v => v.toFixed(3)).join(', ') }} ({{ fleet.h3_index }})</span>
            </div>
          </div>
          <div class="fleet-header-right">
            <span class="fleet-stat" title="Barcos">🚢 {{ fleet.total_ships }}</span>
            <span class="fleet-stat" title="Capacidad de transporte">📦 {{ fleet.total_capacity }}</span>
            <span class="fleet-chevron">{{ expandedFleet === fleet.army_id ? '▲' : '▼' }}</span>
          </div>
        </div>

        <!-- Expanded detail -->
        <div v-if="expandedFleet === fleet.army_id" class="fleet-detail">
          <div v-if="loadingDetail" class="detail-loading">Cargando...</div>
          <template v-else-if="fleetDetail">

            <!-- Ships composition -->
            <div class="detail-section">
              <h4 class="detail-title">🚢 Composición de la Flota</h4>
              <div v-if="fleetDetail.ships && fleetDetail.ships.length > 0" class="ships-grid">
                <div v-for="s in fleetDetail.ships" :key="s.id" class="ship-row">
                  <span class="ship-icon">{{ s.category === 'transport' ? '🛶' : '⚔️' }}</span>
                  <span class="ship-name">{{ s.name }}</span>
                  <span class="ship-qty">× {{ s.quantity }}</span>
                  <span v-if="s.category === 'transport'" class="ship-cap">📦 {{ s.quantity * s.transport_capacity }}</span>
                </div>
              </div>
              <p v-else class="no-ships">Sin barcos. Recluta en un Puerto.</p>
            </div>

            <!-- Cargo / embarked armies -->
            <div v-if="fleetDetail.cargo" class="detail-section">
              <h4 class="detail-title">
                📦 Carga: {{ fleetDetail.cargo.used_capacity }}/{{ fleetDetail.cargo.max_capacity }} tropas
              </h4>
              <div v-if="fleetDetail.cargo.embarked_armies.length > 0" class="embarked-list">
                <div v-for="a in fleetDetail.cargo.embarked_armies" :key="a.army_id" class="embarked-row">
                  <span class="em-name">⚔️ {{ a.name }}</span>
                  <span class="em-troops">{{ a.troop_count }} tropas</span>
                  <button class="btn-disembark" :disabled="isActing" @click="doDisembark(a.army_id)">
                    Desembarcar
                  </button>
                </div>
              </div>
              <p v-else class="no-cargo">Sin tropas embarcadas.</p>
            </div>

            <!-- Recruit ships section -->
            <div class="detail-section">
              <h4 class="detail-title">⚒️ Reclutar Barcos</h4>
              <div v-if="shipTypes.length === 0" class="no-ships">Cargando tipos...</div>
              <div v-else class="recruit-ships-grid">
                <div v-for="st in shipTypes" :key="st.id" class="ship-recruit-card"
                  :class="{ 'cant-afford': playerGold < st.gold_cost }">
                  <div class="src-header">
                    <span class="src-icon">{{ st.category === 'transport' ? '🛶' : '⚔️' }}</span>
                    <span class="src-name">{{ st.name }}</span>
                    <span class="src-type-badge" :class="st.category">
                      {{ st.category === 'transport' ? 'Transporte' : 'Guerra' }}
                    </span>
                  </div>
                  <p class="src-desc">{{ st.description }}</p>
                  <div class="src-stats">
                    <span v-if="st.category === 'transport'">📦 {{ st.transport_capacity }}/barco</span>
                    <span v-else>⚔️ {{ st.attack }} DEF {{ st.defense }}</span>
                    <span>🏃 {{ st.speed }} hex/turno</span>
                    <span>💰 {{ formatNumber(st.gold_cost) }}</span>
                  </div>
                  <div class="src-recruit-row">
                    <input
                      v-model.number="recruitQty[st.id]"
                      type="number" min="1" max="99"
                      class="recruit-qty-input"
                    />
                    <button
                      class="btn-recruit-ship"
                      :disabled="isActing || playerGold < st.gold_cost * (recruitQty[st.id] || 1)"
                      @click="doRecruitShips(fleet.army_id, st)"
                    >
                      Reclutar
                    </button>
                  </div>
                  <p class="src-cost-total">
                    Total: 💰 {{ formatNumber(st.gold_cost * (recruitQty[st.id] || 1)) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Embark armies -->
            <div v-if="fleetDetail.cargo && fleetDetail.cargo.max_capacity > 0" class="detail-section">
              <h4 class="detail-title">🪖 Embarcar Ejércitos</h4>
              <div v-if="loadingEmbarkable" class="detail-loading">Buscando ejércitos...</div>
              <div v-else-if="embarkableArmies.length === 0" class="no-cargo">
                No hay ejércitos en este hex disponibles para embarcar.
              </div>
              <div v-else class="embarkable-list">
                <div v-for="a in embarkableArmies" :key="a.army_id" class="embarkable-row">
                  <span class="em-name">⚔️ {{ a.name }}</span>
                  <span class="em-troops">{{ a.troop_count }} tropas</span>
                  <span class="em-space" :class="{ 'no-space': fleetDetail.cargo.max_capacity - fleetDetail.cargo.used_capacity < a.troop_count }">
                    (espacio: {{ fleetDetail.cargo.max_capacity - fleetDetail.cargo.used_capacity }})
                  </span>
                  <button
                    class="btn-embark"
                    :disabled="isActing || fleetDetail.cargo.max_capacity - fleetDetail.cargo.used_capacity < a.troop_count"
                    @click="doEmbark(fleet.army_id, a.army_id)"
                  >
                    Embarcar
                  </button>
                </div>
              </div>
            </div>

          </template>
        </div>

      </div>
    </div>

    <!-- ── Create fleet banner ─────────────────────────────────── -->
    <div v-if="!loading && fleetCount < fleetLimit" class="create-fleet-hint">
      <p>Para crear una flota, ve a un feudo con Puerto y usa el botón "⛵ Nueva Flota" en el popup del hex.</p>
    </div>

  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { cellToLatLng } from 'h3-js';
import {
  getFleets, getFleetDetail, getNavalCapacity, getShipTypes,
  getEmbarkableArmies, recruitShips, embarkArmy, disembarkArmy,
} from '../services/mapApi.js';

const props = defineProps({
  playerGold: { type: Number, default: 0 },
  playerCultureId: { type: Number, default: null },
  preselectedFleetId: { type: Number, default: null },
});

const emit = defineEmits(['gold-updated', 'refresh']);

// ── state ──────────────────────────────────────────────────────
const loading        = ref(true);
const loadingDetail  = ref(false);
const loadingEmbarkable = ref(false);
const isActing       = ref(false);

const fleets         = ref([]);
const fleetCount     = ref(0);
const fleetLimit     = ref(1);
const shipTypes      = ref([]);
const fleetDetail    = ref(null);
const embarkableArmies = ref([]);
const expandedFleet  = ref(null);
const recruitQty     = ref({});

// ── init ───────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadFleets(), loadCapacity(), loadShipTypes()]);
  if (props.preselectedFleetId) {
    await toggleFleet(props.preselectedFleetId);
  }
});

async function loadFleets(silent = false) {
  if (!silent) loading.value = true;
  try {
    const data = await getFleets();
    fleets.value = data.fleets || [];
  } catch (e) {
    console.error('Error cargando flotas:', e);
  } finally {
    if (!silent) loading.value = false;
  }
}

async function loadCapacity() {
  try {
    const data = await getNavalCapacity();
    fleetCount.value = data.fleet_count;
    fleetLimit.value = data.fleet_limit;
  } catch (e) { /* silent */ }
}

async function loadShipTypes() {
  try {
    const data = await getShipTypes();
    shipTypes.value = data.ship_types || [];
    // init recruit qty
    for (const st of shipTypes.value) {
      recruitQty.value[st.id] = 1;
    }
  } catch (e) { /* silent */ }
}

async function toggleFleet(fleet_id) {
  if (expandedFleet.value === fleet_id) {
    expandedFleet.value = null;
    fleetDetail.value   = null;
    embarkableArmies.value = [];
    return;
  }
  expandedFleet.value = fleet_id;
  fleetDetail.value   = null;
  embarkableArmies.value = [];

  loadingDetail.value = true;
  try {
    const data = await getFleetDetail(fleet_id);
    fleetDetail.value = data.fleet;
    // also fetch embarkable
    await loadEmbarkable(fleet_id);
  } catch (e) {
    console.error('Error cargando detalle flota:', e);
  } finally {
    loadingDetail.value = false;
  }
}

async function loadEmbarkable(fleet_id) {
  loadingEmbarkable.value = true;
  try {
    const data = await getEmbarkableArmies(fleet_id);
    embarkableArmies.value = data.armies || [];
  } catch (e) { /* silent */ }
  finally { loadingEmbarkable.value = false; }
}

// ── actions ────────────────────────────────────────────────────

async function doRecruitShips(fleet_id, shipType) {
  const qty = recruitQty.value[shipType.id] || 1;
  isActing.value = true;
  try {
    await recruitShips(fleet_id, shipType.id, qty);
    emit('gold-updated', -(shipType.gold_cost * qty));
    // refresh detail without hiding the expanded card (silent fleet reload)
    const [detailData] = await Promise.all([
      getFleetDetail(fleet_id),
      loadFleets(true),
      loadCapacity(),
    ]);
    fleetDetail.value = detailData.fleet;
  } catch (e) {
    const msg = e.response?.data?.message || 'Error al reclutar barcos.';
    alert(msg);
  } finally {
    isActing.value = false;
  }
}

async function doEmbark(fleet_id, army_id) {
  isActing.value = true;
  try {
    await embarkArmy(fleet_id, army_id);
    const data = await getFleetDetail(fleet_id);
    fleetDetail.value = data.fleet;
    await loadEmbarkable(fleet_id);
    emit('refresh');
  } catch (e) {
    alert(e.response?.data?.message || 'Error al embarcar.');
  } finally {
    isActing.value = false;
  }
}

async function doDisembark(army_id) {
  isActing.value = true;
  try {
    await disembarkArmy(army_id);
    const data = await getFleetDetail(expandedFleet.value);
    fleetDetail.value = data.fleet;
    await loadEmbarkable(expandedFleet.value);
    emit('refresh');
  } catch (e) {
    alert(e.response?.data?.message || 'Error al desembarcar.');
  } finally {
    isActing.value = false;
  }
}

function formatNumber(n) {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('es-ES');
}
</script>

<style scoped>
.naval-panel {
  padding: 16px;
  color: #ccc;
  font-family: 'Cinzel', serif;
}

/* ── Capacity bar ── */
.naval-capacity-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0,40,80,0.6);
  border: 1px solid #2a5f8a;
  border-radius: 6px;
  padding: 8px 14px;
  margin-bottom: 16px;
  font-size: 13px;
}
.cap-label { color: #7ab8e8; }
.cap-value { font-weight: 700; color: #4fc3f7; font-size: 15px; }
.cap-value.at-limit { color: #ef5350; }
.cap-hint { color: #888; font-size: 11px; }

/* ── Loading / empty ── */
.naval-loading, .detail-loading { color: #888; text-align: center; padding: 20px; font-size: 13px; }
.naval-empty { text-align: center; padding: 30px; color: #888; }
.naval-empty .empty-hint { font-size: 12px; color: #555; margin-top: 6px; }
.no-ships, .no-cargo { color: #666; font-size: 12px; padding: 6px 0; }

/* ── Fleet cards ── */
.fleet-list { display: flex; flex-direction: column; gap: 10px; }

.fleet-card {
  background: rgba(0,30,60,0.7);
  border: 1px solid #1e4a6a;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.fleet-card.fleet-expanded { border-color: #2a7fc1; }

.fleet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: rgba(0,50,100,0.4);
  transition: background 0.15s;
}
.fleet-header:hover { background: rgba(0,70,140,0.5); }

.fleet-header-left { display: flex; align-items: center; gap: 10px; }
.fleet-icon { font-size: 20px; }
.fleet-title-block { display: flex; flex-direction: column; gap: 2px; }
.fleet-name { font-size: 14px; font-weight: 600; color: #e0e0e0; }
.fleet-pos { font-size: 10px; color: #7ab8e8; font-family: monospace; }

.fleet-header-right { display: flex; align-items: center; gap: 12px; }
.fleet-stat { font-size: 12px; color: #b0bec5; }
.fleet-chevron { font-size: 10px; color: #607d8b; margin-left: 4px; }

/* ── Expanded detail ── */
.fleet-detail { padding: 14px; border-top: 1px solid #1a3a5a; background: rgba(0,20,45,0.5); }

.detail-section { margin-bottom: 16px; }
.detail-section:last-child { margin-bottom: 0; }
.detail-title {
  font-size: 12px;
  font-weight: 600;
  color: #7ab8e8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #1a3a5a;
}

/* Ships grid */
.ships-grid { display: flex; flex-direction: column; gap: 4px; }
.ship-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(0,40,80,0.4);
  border-radius: 4px;
  font-size: 12px;
}
.ship-icon { font-size: 14px; }
.ship-name { flex: 1; color: #e0e0e0; }
.ship-qty { color: #4fc3f7; font-weight: 600; }
.ship-cap { color: #81c784; font-size: 11px; }

/* Embarked / embarkable lists */
.embarked-list, .embarkable-list { display: flex; flex-direction: column; gap: 4px; }
.embarked-row, .embarkable-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: rgba(0,40,80,0.4);
  border-radius: 4px;
  font-size: 12px;
}
.em-name { flex: 1; color: #e0e0e0; }
.em-troops { color: #b0bec5; min-width: 70px; }
.em-space { font-size: 11px; color: #81c784; }
.em-space.no-space { color: #ef5350; }

/* Recruit ships */
.recruit-ships-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.ship-recruit-card {
  background: rgba(0,40,80,0.5);
  border: 1px solid #1e4a6a;
  border-radius: 6px;
  padding: 10px;
}
.ship-recruit-card.cant-afford { opacity: 0.55; }

.src-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.src-icon { font-size: 16px; }
.src-name { flex: 1; font-size: 13px; font-weight: 600; color: #e0e0e0; }
.src-type-badge {
  font-size: 10px;
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 600;
}
.src-type-badge.transport { background: rgba(30,120,60,0.4); color: #81c784; border: 1px solid #2e7d32; }
.src-type-badge.warship   { background: rgba(120,30,30,0.4); color: #ef9a9a; border: 1px solid #b71c1c; }

.src-desc { font-size: 11px; color: #888; margin-bottom: 6px; line-height: 1.4; }
.src-stats { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: #7ab8e8; margin-bottom: 8px; }

.src-recruit-row { display: flex; align-items: center; gap: 6px; }
.recruit-qty-input {
  width: 50px;
  padding: 4px 6px;
  background: rgba(0,20,50,0.8);
  border: 1px solid #2a5f8a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 12px;
  text-align: center;
}
.src-cost-total { font-size: 11px; color: #f9a825; margin-top: 5px; }

/* Buttons */
.btn-recruit-ship, .btn-embark, .btn-disembark {
  padding: 4px 10px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-recruit-ship { background: #1565c0; color: #fff; }
.btn-recruit-ship:hover:not(:disabled) { background: #1976d2; }
.btn-embark { background: #2e7d32; color: #fff; }
.btn-embark:hover:not(:disabled) { background: #388e3c; }
.btn-disembark { background: #6d4c41; color: #fff; }
.btn-disembark:hover:not(:disabled) { background: #795548; }
.btn-recruit-ship:disabled, .btn-embark:disabled, .btn-disembark:disabled {
  opacity: 0.4; cursor: not-allowed;
}

/* Create fleet hint */
.create-fleet-hint {
  margin-top: 16px;
  padding: 12px;
  background: rgba(0,40,80,0.4);
  border: 1px dashed #2a5f8a;
  border-radius: 6px;
  font-size: 12px;
  color: #7ab8e8;
  text-align: center;
  line-height: 1.5;
}
</style>
