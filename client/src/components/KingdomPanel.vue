<template>
  <div class="fiefs-management">
    <div class="fiefs-table-container">
      <table class="kingdom-table">
        <thead>
          <tr>
            <th class="col-feudo">Centuria</th>
            <th class="col-terreno">Terreno</th>
            <th class="col-number">💰</th>
            <th class="col-number">👥</th>
            <th class="col-number">😊</th>
            <th class="col-number">🌾</th>
            <th class="col-number">Auton.</th>
            <th class="col-farm">Nivel Granja</th>
            <th class="col-division">Pagus</th>
            <th class="col-number">⚔️</th>
            <th class="col-edificio">🏛️</th>
            <th class="col-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="fief in fiefs" :key="fief.h3_index" :class="{ 'capital-row': fief.is_capital }">
            <td class="fief-name-cell">
              <span v-if="fief.is_capital" class="capital-icon" title="Capital del Reino">👑 </span>{{ cellToLatLng(fief.h3_index).map(v => v.toFixed(3)).join(', ') }} ({{ fief.h3_index }})
              <span v-if="fief.grace_turns > 0" class="occupation-badge" :title="`Bajo ocupación militar — ${fief.grace_turns} turno${fief.grace_turns !== 1 ? 's' : ''} restante${fief.grace_turns !== 1 ? 's' : ''}`">⚔️ ({{ fief.grace_turns }})</span>
            </td>
            <td class="terrain-cell">{{ fief.terrain }}</td>
            <td class="text-gold text-right">{{ formatGold(fief.gold) }}</td>
            <td class="text-right pop-cell">{{ formatNumber(fief.population) }}</td>
            <td class="text-right" :class="{ 'happiness-low': fief.happiness < 30 }">
              <span
                :title="fief.happiness_delta !== 0 ? `${fief.happiness_delta > 0 ? '+' : ''}${fief.happiness_delta} en el último mes` : 'Sin cambios este mes'"
                class="happiness-value"
              >{{ fief.happiness }}%<span
                  v-if="fief.happiness_delta !== 0"
                  class="happiness-delta"
                  :class="fief.happiness_delta > 0 ? 'delta-positive' : 'delta-negative'"
                > ({{ fief.happiness_delta > 0 ? '+' : '' }}{{ fief.happiness_delta }})</span></span>
            </td>
            <td class="text-right">{{ formatNumber(fief.food) }}</td>
            <td :class="['text-right', {
              'text-danger': fief.autonomy < 30,
              'text-success': fief.autonomy > 365
            }]">
              {{ fief.autonomy === Infinity ? '∞' : fief.autonomy }}
            </td>
            <td class="farm-cell">
              <span class="farm-lvl" :class="{ 'farm-max': fief.farm_level >= 5 }">
                {{ fief.farm_level }}/5
              </span>
              <button
                v-if="fief.farm_level < 5 && fief.food_output > 0"
                class="btn-micro btn-farm-micro"
                :disabled="upgradingFarm === fief.h3_index || props.playerGold < farmCost(fief.farm_level)"
                :title="`Mejorar granja: ${farmCost(fief.farm_level).toLocaleString()} 💰`"
                @click="doUpgradeFarm(fief)"
              >
                <span v-if="upgradingFarm === fief.h3_index">⏳</span>
                <span v-else>Mejorar</span>
              </button>
              <span v-else-if="fief.farm_level >= 5" class="farm-max-text">Máx</span>
            </td>
            <td class="division-cell">
              <span v-if="fief.division_name" class="division-badge" :title="fief.division_name">
                ⚜️ {{ fief.division_name }}
              </span>
              <span v-else class="dimmed-dash">—</span>
            </td>
            <td class="text-right troops-cell">{{ fief.total_troops || 0 }}</td>
            <td class="text-center building-cell">
              <template v-if="fief.fief_building">
                <span
                  v-if="fief.fief_building.is_under_construction"
                  class="building-badge building-badge-wip"
                  :title="`En construcción: ${fief.fief_building.name} (${fief.fief_building.turns_left ?? '?'}t)`"
                >🏗️ {{ fief.fief_building.turns_left ?? '?' }}t</span>
                <span
                  v-else
                  class="building-badge building-badge-done"
                  :title="fief.fief_building.name"
                >🏛️ {{ fief.fief_building.name }}</span>
              </template>
              <template v-else>
                <span class="dimmed-dash">—</span>
              </template>
            </td>
            <td class="table-actions">
              <button class="btn-micro" @click="$emit('focusOnFief', fief.h3_index)" title="Ver en el mapa">🗺️</button>
              <!-- DISABLED: exploration button hidden
              <button
                v-if="fief.explorationStatus === 'pending'"
                class="btn-micro btn-explore-micro"
                @click="$emit('exploreFief', fief.h3_index)"
                :disabled="playerGold < explorationConfig.gold_cost"
                :title="`Explorar (${explorationConfig.gold_cost} 💰)`"
              >⛏️</button>
              -->
              <button
                v-if="fief.can_recruit"
                class="btn-micro btn-recruit-micro"
                @click="$emit('openRecruitment', fief)"
                title="Reclutar tropas"
              >⚔️</button>
              <button
                v-if="!fief.fief_building"
                class="btn-micro btn-build-micro"
                @click="$emit('openConstruction', fief.h3_index)"
                title="Construir edificio"
              >🏗️</button>
              <button
                v-if="fief.fief_building && !fief.fief_building.is_under_construction && fief.fief_building.upgrade"
                class="btn-micro btn-upgrade-micro"
                @click="$emit('openUpgrade', { h3_index: fief.h3_index, upgrade: fief.fief_building.upgrade })"
                :title="`Ampliar a ${fief.fief_building.upgrade.name} (${fief.fief_building.upgrade.gold_cost}💰, ${fief.fief_building.upgrade.turns}t)`"
              >🏰</button>
              <!-- Worker hire button: visible on Capital or fief with completed Mercado -->
              <button
                v-if="canBuyWorkers(fief) && workerTypes.length > 0"
                class="btn-micro btn-worker-micro"
                @click="openWorkerPanel(fief)"
                title="Contratar trabajador"
              >👷</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="fiefs.length === 0" class="empty-state">
        <p>No se encontraron feudos.</p>
      </div>
    </div>

    <!-- Pagination bar (controlled by parent) -->
    <div v-if="total > 0" class="pagination-bar">
      <span class="pagination-info">
        {{ rangeStart }}–{{ rangeEnd }} de {{ total }} feudos
      </span>
      <div class="pagination-controls">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="$emit('change-page', page - 1)"
          title="Página anterior"
        >‹</button>
        <span class="page-indicator">{{ page }} / {{ totalPages }}</span>
        <button
          class="page-btn"
          :disabled="page >= totalPages"
          @click="$emit('change-page', page + 1)"
          title="Página siguiente"
        >›</button>
      </div>
      <div class="page-size-row">
        <span class="page-size-label">Filas:</span>
        <select
          :value="limit"
          class="page-size-select"
          @change="$emit('change-limit', parseInt($event.target.value))"
        >
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
      </div>
    </div>

    <!-- ── Worker Buy Panel ─────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="workerPanel.show" class="worker-panel-backdrop" @click.self="closeWorkerPanel">
        <div class="worker-panel">
          <div class="worker-panel-header">
            <span class="worker-panel-title">👷 Contratar Trabajador</span>
            <button class="worker-panel-close" @click="closeWorkerPanel">✕</button>
          </div>

          <div class="worker-panel-body">
            <p class="worker-panel-fief">
              <span v-if="workerPanel.fief?.is_capital">👑</span>
              <span v-else>🏛️</span>
              {{ workerPanel.fief?.name }}
            </p>

            <div class="worker-type-list">
              <label
                v-for="wt in workerTypes"
                :key="wt.id"
                class="worker-type-option"
                :class="{ selected: workerPanel.selectedTypeId === wt.id }"
              >
                <input
                  type="radio"
                  :value="wt.id"
                  v-model="workerPanel.selectedTypeId"
                  class="worker-type-radio"
                />
                <div class="worker-type-info">
                  <span class="worker-type-name">⛏️ {{ wt.name }}</span>
                  <span class="worker-type-stats">HP {{ wt.hp }} · Vel {{ wt.speed }} · Det {{ wt.detection_range }}</span>
                </div>
                <span class="worker-type-cost" :class="{ 'cost-unaffordable': playerGold < wt.cost }">
                  {{ wt.cost.toLocaleString() }} 💰
                </span>
              </label>
            </div>

            <p v-if="selectedWorkerType && playerGold < selectedWorkerType.cost" class="worker-gold-warning">
              ⚠️ Oro insuficiente (tienes {{ Math.floor(playerGold).toLocaleString() }} 💰)
            </p>
          </div>

          <div class="worker-panel-footer">
            <button class="worker-btn-cancel" @click="closeWorkerPanel">Cancelar</button>
            <button
              class="worker-btn-hire"
              :disabled="!workerPanel.selectedTypeId || (selectedWorkerType && playerGold < selectedWorkerType.cost)"
              @click="confirmHire"
            >
              ⛏️ Contratar
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { cellToLatLng } from 'h3-js';

const props = defineProps({
  fiefs:             { type: Array,  default: () => [] },
  total:             { type: Number, default: 0 },
  page:              { type: Number, default: 1 },
  limit:             { type: Number, default: 10 },
  playerGold:        { type: Number, default: 0 },
  explorationConfig: { type: Object, default: () => ({ gold_cost: 0 }) },
  workerTypes:       { type: Array,  default: () => [] },
});

const emit = defineEmits([
  'focusOnFief', 'exploreFief', 'openRecruitment', 'openConstruction', 'openUpgrade',
  'change-page', 'change-limit',
  'buyWorker', 'upgradeFarm',
]);

const upgradingFarm = ref(null);

const farmCost = (level) => 3000 * Math.pow(2, level);

const doUpgradeFarm = async (fief) => {
  if (upgradingFarm.value) return;
  upgradingFarm.value = fief.h3_index;
  try {
    emit('upgradeFarm', { h3_index: fief.h3_index, cost: farmCost(fief.farm_level) });
  } finally {
    upgradingFarm.value = null;
  }
};

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
const rangeStart = computed(() => props.total === 0 ? 0 : (props.page - 1) * props.limit + 1);
const rangeEnd   = computed(() => Math.min(props.page * props.limit, props.total));

// ── Worker panel state ──────────────────────────────────────────────────────
const workerPanel = reactive({
  show:           false,
  fief:           null,
  selectedTypeId: null,
});

const selectedWorkerType = computed(() =>
  props.workerTypes.find(t => t.id === workerPanel.selectedTypeId) ?? null
);

/** Returns true if a fief is a valid worker hire location */
const canBuyWorkers = (fief) =>
  fief.is_capital ||
  (fief.fief_building?.name === 'Mercado' && !fief.fief_building.is_under_construction);

const openWorkerPanel = (fief) => {
  workerPanel.fief = fief;
  workerPanel.selectedTypeId = props.workerTypes[0]?.id ?? null;
  workerPanel.show = true;
};

const closeWorkerPanel = () => {
  workerPanel.show = false;
  workerPanel.fief = null;
  workerPanel.selectedTypeId = null;
};

const confirmHire = () => {
  if (!workerPanel.fief || !workerPanel.selectedTypeId) return;
  emit('buyWorker', {
    h3_index:       workerPanel.fief.h3_index,
    worker_type_id: workerPanel.selectedTypeId,
    cost:           selectedWorkerType.value?.cost ?? 0,
  });
  closeWorkerPanel();
};

// ── Formatters ──────────────────────────────────────────────────────────────
const formatNumber = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
  return Math.round(val).toString();
};

const formatGold = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return Number(val).toLocaleString('es-ES');
};
</script>

<style scoped>
.kingdom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  color: #e8d5b5;
  table-layout: fixed;
  border: 1px solid #5d4e37;
}

/* Column widths */
.col-feudo { width: 160px; }
.col-farm  { width: 120px; }
.col-terreno { width: 110px; }
.col-number { width: 70px; }
.col-division { width: 130px; }
.col-edificio { width: 130px; }
.col-actions { width: 160px; }

.kingdom-table th {
  background: rgba(26, 22, 18, 0.9);
  padding: 10px 12px;
  text-align: center !important;
  border: 1px solid #5d4e37;
  border-bottom: 3px solid #c5a059;
  color: #ffd700;
  font-family: 'Cinzel', serif;
  text-transform: uppercase;
  font-size: 0.8rem;
  font-weight: bold;
  position: sticky;
  top: 0;
  z-index: 10;
}

.kingdom-table td {
  padding: 10px 12px;
  border-right: 1px solid rgba(93, 78, 55, 0.4);
  border-bottom: 1px solid rgba(93, 78, 55, 0.3);
  vertical-align: middle;
}

.kingdom-table td:last-child {
  border-right: none;
}

.kingdom-table tbody tr {
  transition: background-color 0.2s;
  border-bottom: 1px solid rgba(93, 78, 55, 0.3);
}

.kingdom-table tbody tr:hover {
  background: rgba(197, 160, 89, 0.15);
}

.kingdom-table tbody tr:nth-child(even) {
  background: rgba(0, 0, 0, 0.2);
}

.kingdom-table tbody tr:nth-child(even):hover {
  background: rgba(197, 160, 89, 0.2);
}

/* Capital row highlight */
.capital-row {
  background: rgba(255, 215, 0, 0.08) !important;
  border-left: 3px solid #ffd700;
}

.capital-row:hover {
  background: rgba(255, 215, 0, 0.15) !important;
}

.capital-icon {
  font-size: 1.1rem;
  color: #ffd700;
  margin-right: 4px;
  animation: pulse-gold 2s ease-in-out infinite;
}

@keyframes pulse-gold {
  0%, 100% {
    opacity: 1;
    text-shadow: 0 0 8px rgba(255, 215, 0, 0.6);
  }
  50% {
    opacity: 0.85;
    text-shadow: 0 0 12px rgba(255, 215, 0, 0.8);
  }
}

.occupation-badge {
  display: inline-block;
  margin-left: 5px;
  font-size: 0.68rem;
  color: #ff6b35;
  background: rgba(255, 107, 53, 0.12);
  border: 1px solid rgba(255, 107, 53, 0.4);
  border-radius: 3px;
  padding: 1px 4px;
  vertical-align: middle;
  cursor: help;
}

.text-right { text-align: right; }

/* Population cap display */
.pop-cell { white-space: nowrap; }
.pop-sep { color: rgba(255,255,255,0.25); font-size: 0.75rem; margin: 0 1px; }
.pop-cap-val { color: rgba(255,255,255,0.35); font-size: 0.78rem; }
.pop-at-cap { color: #f97316; font-weight: 700; }
.text-center { text-align: center; }
.text-gold { color: #ffd700; }
.happiness-low { color: #ff4444; font-weight: 600; }
.happiness-value { white-space: nowrap; cursor: default; }
.happiness-delta { font-size: 0.8em; opacity: 0.85; }
.delta-positive { color: #4caf50; }
.delta-negative { color: #ff6b6b; }
.text-danger { color: #ff6b6b; }
.text-success { color: #4caf50; }

.fief-name-cell {
  font-weight: 600;
  color: #f4e4bc;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left !important;
}

.terrain-cell {
  color: #d4c5a0;
  font-size: 0.9rem;
  text-align: left !important;
}

.troops-cell {
  font-weight: bold;
  color: #ff9800;
}

.dimmed-dash {
  color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}

.table-actions {
  display: flex;
  gap: 5px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}

.btn-micro {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid #5d4e37;
  color: #f4e4bc;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
}

.btn-micro:hover:not(:disabled) {
  background: rgba(197, 160, 89, 0.3);
  border-color: #c5a059;
  transform: scale(1.1);
}

.btn-micro:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.farm-cell    { white-space: nowrap; display: flex; align-items: center; gap: 6px; padding: 4px 6px; }
.farm-lvl     { font-weight: 600; color: #c5a059; min-width: 28px; }
.farm-lvl.farm-max { color: #4caf50; }
.farm-max-text { font-size: 0.75rem; color: #4caf50; }
.btn-farm-micro { font-size: 0.7rem; padding: 2px 6px; white-space: nowrap; }

.btn-explore-micro {
  background: rgba(26, 22, 18, 0.6);
}

.btn-recruit-micro {
  background: rgba(255, 215, 0, 0.1);
  color: #ffd700;
  border-color: rgba(255, 215, 0, 0.3);
}

.btn-recruit-micro:hover:not(:disabled) {
  background: rgba(255, 215, 0, 0.2);
  border-color: #ffd700;
}

.btn-worker-micro {
  background: rgba(180, 83, 9, 0.18);
  color: #fbbf24;
  border-color: rgba(180, 83, 9, 0.5);
}

.btn-worker-micro:hover:not(:disabled) {
  background: rgba(180, 83, 9, 0.35);
  border-color: #fbbf24;
}

.exploration-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
  display: inline-block;
}

.exploration-badge-completed {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
  border: 1px solid #4caf50;
}

.exploration-badge-exploring {
  background: rgba(243, 156, 18, 0.2);
  color: #f39c12;
  border: 1px solid #f39c12;
}

.building-cell {
  font-size: 0.75rem;
}

.building-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: bold;
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.building-badge-wip {
  background: rgba(197, 160, 89, 0.18);
  color: #c5a059;
  border: 1px solid rgba(197, 160, 89, 0.5);
}

.building-badge-done {
  background: rgba(76, 175, 80, 0.15);
  color: #81c784;
  border: 1px solid rgba(76, 175, 80, 0.4);
}

.btn-build-micro {
  background: rgba(45, 122, 79, 0.2);
  color: #81c784;
  border-color: rgba(76, 175, 80, 0.4);
}

.btn-build-micro:hover:not(:disabled) {
  background: rgba(45, 122, 79, 0.4);
  border-color: #81c784;
}

.btn-upgrade-micro {
  background: rgba(93, 63, 211, 0.2);
  color: #b39ddb;
  border-color: rgba(93, 63, 211, 0.4);
}

.btn-upgrade-micro:hover:not(:disabled) {
  background: rgba(93, 63, 211, 0.35);
  border-color: #b39ddb;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #a89875;
  font-style: italic;
}

/* ── Pagination bar ─────────────────────────────────────────────────────────── */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(93, 78, 55, 0.4);
  background: rgba(0, 0, 0, 0.25);
  flex-wrap: wrap;
  gap: 8px;
}

.pagination-info {
  font-size: 0.75rem;
  color: #a89875;
  min-width: 120px;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-btn {
  background: rgba(197, 160, 89, 0.1);
  border: 1px solid rgba(197, 160, 89, 0.3);
  color: #c5a059;
  font-size: 1rem;
  font-weight: 700;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  line-height: 1;
}
.page-btn:hover:not(:disabled) { background: rgba(197, 160, 89, 0.25); }
.page-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.page-indicator {
  font-size: 0.78rem;
  color: #e8d5b5;
  font-family: monospace;
  min-width: 48px;
  text-align: center;
}

.page-size-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.page-size-label {
  font-size: 0.75rem;
  color: #a89875;
}

.page-size-select {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(197, 160, 89, 0.35);
  border-radius: 5px;
  color: #e8d5b5;
  font-size: 0.8rem;
  padding: 3px 6px;
  cursor: pointer;
}
.page-size-select:focus { outline: none; border-color: rgba(197, 160, 89, 0.7); }

/* ── Worker Buy Panel ─────────────────────────────────────────────────────── */
.worker-panel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.worker-panel {
  background: #1a1612;
  border: 2px solid #c5a059;
  border-radius: 8px;
  min-width: 340px;
  max-width: 420px;
  width: 90vw;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(197, 160, 89, 0.15);
  display: flex;
  flex-direction: column;
}

.worker-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(197, 160, 89, 0.3);
}

.worker-panel-title {
  font-family: 'Cinzel', serif;
  font-size: 1rem;
  font-weight: bold;
  color: #ffd700;
  letter-spacing: 0.5px;
}

.worker-panel-close {
  background: none;
  border: none;
  color: #a89875;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  transition: color 0.2s;
}
.worker-panel-close:hover { color: #e8d5b5; }

.worker-panel-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.worker-panel-fief {
  font-size: 0.9rem;
  color: #c5a059;
  font-weight: 600;
  margin: 0;
}

.worker-type-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.worker-type-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(93, 78, 55, 0.5);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  background: rgba(0, 0, 0, 0.25);
}

.worker-type-option:hover {
  border-color: rgba(197, 160, 89, 0.5);
  background: rgba(197, 160, 89, 0.08);
}

.worker-type-option.selected {
  border-color: #c5a059;
  background: rgba(197, 160, 89, 0.12);
}

.worker-type-radio {
  accent-color: #c5a059;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.worker-type-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 2px;
}

.worker-type-name {
  font-size: 0.9rem;
  color: #e8d5b5;
  font-weight: 600;
  text-transform: capitalize;
}

.worker-type-stats {
  font-size: 0.72rem;
  color: #7a6a50;
}

.worker-type-cost {
  font-size: 0.88rem;
  color: #ffd700;
  font-weight: bold;
  white-space: nowrap;
}

.worker-type-cost.cost-unaffordable {
  color: #ff6b6b;
}

.worker-gold-warning {
  font-size: 0.8rem;
  color: #ff6b6b;
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 0;
}

.worker-panel-footer {
  display: flex;
  gap: 10px;
  padding: 12px 18px 16px;
  border-top: 1px solid rgba(93, 78, 55, 0.3);
  justify-content: flex-end;
}

.worker-btn-cancel {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(93, 78, 55, 0.6);
  color: #a89875;
  padding: 8px 18px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.15s;
}
.worker-btn-cancel:hover { background: rgba(255, 255, 255, 0.1); color: #e8d5b5; }

.worker-btn-hire {
  background: #b45309;
  border: 1px solid #92400e;
  color: #fef3c7;
  padding: 8px 22px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: bold;
  font-family: 'Cinzel', serif;
  letter-spacing: 0.5px;
  transition: all 0.15s;
  box-shadow: 0 2px 8px rgba(180, 83, 9, 0.4);
}
.worker-btn-hire:hover:not(:disabled) {
  background: #d97706;
  box-shadow: 0 3px 12px rgba(180, 83, 9, 0.6);
}
.worker-btn-hire:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
