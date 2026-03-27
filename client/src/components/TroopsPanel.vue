<template>
  <div class="troops-panel">
    <div v-if="loading" class="loading-text">Cargando ejércitos...</div>

    <div v-else-if="armies.length === 0" class="empty-state">
      <p>No tienes ejércitos activos.</p>
      <p class="empty-hint">Ve a la lista de feudos para reclutar tu primera unidad.</p>
    </div>

    <div v-else class="troops-content">
      <!-- Summary Row -->
      <div class="troops-summary" style="grid-template-columns: repeat(6, 1fr)">
        <div class="summary-card">
          <div class="card-icon">⚔️</div>
          <div class="card-content">
            <span class="card-label">Ejércitos</span>
            <span class="card-value">{{ fieldArmiesCount }}</span>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon">🏰</div>
          <div class="card-content">
            <span class="card-label">Guarniciones</span>
            <span class="card-value">{{ garrisonCount }}</span>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon">⚔️</div>
          <div class="card-content">
            <span class="card-label">Tropas Totales</span>
            <span class="card-value">{{ totalUnits }}</span>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon">💪</div>
          <div class="card-content">
            <span class="card-label">Poder de Combate</span>
            <span class="card-value">{{ totalCombatPower }}</span>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon">😊</div>
          <div class="card-content">
            <span class="card-label">Moral Promedio</span>
            <span class="card-value">{{ averageMorale }}%</span>
          </div>
        </div>
        <div class="summary-card">
          <div class="card-icon">⚡</div>
          <div class="card-content">
            <span class="card-label">Estamina Promedio Global</span>
            <span class="card-value">{{ averageMinStamina }}%</span>
          </div>
        </div>
      </div>

      <!-- Armies Table -->
      <div class="troops-table-container">
        <table class="troops-table">
          <thead>
            <tr>
              <th class="th-unit">Nombre</th>
              <th class="th-quantity">Tropas</th>
              <th class="th-quantity">Fuerza</th>
              <th class="th-status">Estado</th>
              <th class="th-location">Ubicación</th>
              <th class="th-actions">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="army in armies" :key="army.army_id" class="troop-row">
              <td class="unit-cell">
                <div class="unit-name">
                  <span v-if="army.is_garrison" class="garrison-badge" title="Tropas acuarteladas — no pueden moverse">🏰</span>
                  {{ army.name }}
                </div>
              </td>
              <td class="quantity-cell">
                <span class="quantity-badge">{{ army.total_troops }}</span>
              </td>
              <td class="quantity-cell">
                <span class="quantity-badge">{{ army.total_combat_power }}</span>
              </td>
              <td class="status-cell">
                <div style="display: flex; flex-direction: column; gap: 5px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 80px; font-size: 10px; color: #a89875; font-weight: 600; text-transform: uppercase;">Moral</span>
                    <div style="position: relative; flex: 1; height: 14px; background: #1a1a1a; border: 1px solid #444; border-radius: 3px; overflow: hidden;">
                      <div :style="{ width: army.average_moral + '%', height: '100%', background: getMoraleColor(army.average_moral) }"></div>
                      <span style="position: absolute; width: 100%; text-align: center; font-size: 9px; top: 1px; color: #fff; font-weight: bold; text-shadow: 1px 1px 2px #000; line-height: 14px;">{{ army.average_moral }}%</span>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 80px; font-size: 10px; color: #a89875; font-weight: 600; text-transform: uppercase;">Estamina</span>
                    <div style="position: relative; flex: 1; height: 14px; background: #1a1a1a; border: 1px solid #444; border-radius: 3px; overflow: hidden;">
                      <div :style="{ width: (army.min_stamina || 0) + '%', height: '100%', background: getStaminaColor(army.min_stamina || 0) }"></div>
                      <span style="position: absolute; width: 100%; text-align: center; font-size: 9px; top: 1px; color: #fff; font-weight: bold; text-shadow: 1px 1px 2px #000; line-height: 14px;">{{ army.min_stamina || 0 }}%</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="location-cell">
                <div class="location-info">
                  <div v-if="army.location_name" class="army-name">{{ army.location_name }}</div>
                  <div class="h3-index">{{ cellToLatLng(army.h3_index).map(v => v.toFixed(3)).join(', ') }} ({{ army.h3_index }})</div>
                </div>
              </td>
              <td class="actions-cell">
                <div class="action-buttons">
                  <button
                    class="btn-icon btn-icon-inspect"
                    @click="openInspect(army)"
                    title="Detalles"
                  >👁</button>
                  <button
                    class="btn-icon btn-icon-locate"
                    @click="handleLocate(army)"
                    title="Localizar"
                  >🔍</button>
                  <button
                    v-if="army.destination"
                    class="btn-icon btn-icon-stop"
                    @click="handleStop(army)"
                    :disabled="stoppingArmies.has(army.army_id)"
                    title="Detener movimiento"
                  >{{ stoppingArmies.has(army.army_id) ? '⏳' : '⏹' }}</button>
                  <button
                    v-if="army.enemy_count > 0"
                    class="btn-icon btn-icon-attack"
                    @click="handleAttack(army)"
                    :disabled="attackingArmies.has(army.army_id)"
                    :title="`Atacar (${army.enemy_count} ejército(s) enemigo(s))`"
                  >{{ attackingArmies.has(army.army_id) ? '⏳' : '⚔️' }}</button>
                  <button
                    class="btn-icon btn-icon-reinforce"
                    :disabled="!army.is_own_fief || army.fief_grace_turns > 0"
                    :title="getReinforceTooltip(army)"
                    @click="openReinforce(army)"
                  >➕</button>
                  <button
                    v-if="coLocatedCount(army) > 0 && !army.destination"
                    class="btn-icon btn-icon-transfer"
                    :title="`Unir con ${coLocatedCount(army)} ejército(s) co-ubicado(s)`"
                    @click="openTransfer(army)"
                  >🔗</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Army Detail Modal (inspect + optional auto-reinforce) -->
  <ArmyDetailModal
    :show="inspectModalVisible"
    :army="inspectArmy"
    :autoReinforce="inspectAutoReinforce"
    :playerCultureId="props.playerCultureId"
    @close="inspectModalVisible = false; inspectAutoReinforce = false"
    @dismissed="(payload) => emit('armyDismissed', payload)"
  />

  <!-- Army Transfer Panel -->
  <ArmyTransferPanel
    :show="transferPanelVisible"
    :armyAId="transferArmyA?.army_id"
    :armyBId="transferArmyB"
    :h3_index="transferArmyA?.h3_index"
    :fiefName="transferArmyA?.location_name"
    @close="transferPanelVisible = false"
    @done="emit('armiesTransferred')"
  />
</template>

<script setup>
import { ref, computed } from 'vue';
import { cellToLatLng } from 'h3-js';
import { stopArmy, attackArmy } from '../services/mapApi.js';
import ArmyDetailModal from './ArmyDetailModal.vue';
import ArmyTransferPanel from './ArmyTransferPanel.vue';

const props = defineProps({
  armies: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  playerCultureId: { type: Number, default: null },
});

const emit = defineEmits(['locate', 'armyStopped', 'armyStopFailed', 'armyAttacked', 'armyAttackFailed', 'armyDismissed', 'armiesTransferred']);

const stoppingArmies = ref(new Set());
const attackingArmies = ref(new Set());

// Army detail modal
const inspectModalVisible   = ref(false);
const inspectArmy           = ref(null);
const inspectAutoReinforce  = ref(false);
const openInspect   = (army) => { inspectArmy.value = army; inspectAutoReinforce.value = false; inspectModalVisible.value = true; };
const openReinforce = (army) => { inspectArmy.value = army; inspectAutoReinforce.value = true;  inspectModalVisible.value = true; };

// Transfer panel
const transferPanelVisible = ref(false);
const transferArmyA        = ref(null);
const transferArmyB        = ref(null);

// Group armies by h3_index for co-location detection
const armiesByHex = computed(() => {
  const map = {};
  for (const a of props.armies) {
    if (!map[a.h3_index]) map[a.h3_index] = [];
    map[a.h3_index].push(a);
  }
  return map;
});

const coLocatedCount = (army) => {
  const group = armiesByHex.value[army.h3_index] || [];
  return group.filter(a => a.army_id !== army.army_id && !a.destination).length;
};

const openTransfer = (army) => {
  const group = armiesByHex.value[army.h3_index] || [];
  const others = group.filter(a => a.army_id !== army.army_id && !a.destination);
  transferArmyA.value = army;
  transferArmyB.value = others.length === 1 ? others[0].army_id : null;
  transferPanelVisible.value = true;
};

const getReinforceTooltip = (army) => {
  if (!army.is_own_fief)       return 'El ejército no está estacionado en un feudo propio';
  if (army.fief_grace_turns > 0) return `Feudo en período de ocupación (${army.fief_grace_turns} turnos restantes)`;
  return 'Reforzar ejército con nuevas tropas';
};

const fieldArmiesCount = computed(() => props.armies.filter(a => !a.is_garrison).length);
const garrisonCount    = computed(() => props.armies.filter(a =>  a.is_garrison).length);

const totalUnits = computed(() => {
  return props.armies.reduce((sum, a) => sum + (a.total_troops || 0), 0);
});

const totalCombatPower = computed(() => {
  return props.armies.reduce((sum, a) => sum + (a.total_combat_power || 0), 0);
});

const averageMorale = computed(() => {
  if (props.armies.length === 0) return 0;
  const total = props.armies.reduce((sum, a) => sum + (a.average_moral || 0), 0);
  return Math.round(total / props.armies.length);
});

const averageMinStamina = computed(() => {
  if (props.armies.length === 0) return 0;
  const total = props.armies.reduce((sum, a) => sum + (a.min_stamina || 0), 0);
  return Math.round(total / props.armies.length);
});

const getMoraleColor = (morale) => {
  if (morale >= 70) return '#4caf50';
  if (morale >= 40) return '#ff9800';
  return '#f44336';
};

const getStaminaColor = (stamina) => {
  if (stamina > 60) return '#4caf50';
  if (stamina >= 25) return '#ff9800';
  return '#f44336';
};

const handleLocate = (army) => {
  emit('locate', {
    h3_index: army.h3_index,
    army_name: army.name,
    army_id: army.army_id
  });
};

const handleStop = async (army) => {
  if (stoppingArmies.value.has(army.army_id)) return;
  stoppingArmies.value = new Set([...stoppingArmies.value, army.army_id]);
  try {
    await stopArmy(army.army_id);
    emit('armyStopped', army.army_id);
  } catch (err) {
    console.error('Error al detener ejército:', err);
    const msg = err?.response?.data?.message || 'Error al procesar la orden de detención';
    emit('armyStopFailed', msg);
  } finally {
    const next = new Set(stoppingArmies.value);
    next.delete(army.army_id);
    stoppingArmies.value = next;
  }
};

const handleAttack = async (army) => {
  if (attackingArmies.value.has(army.army_id)) return;
  attackingArmies.value = new Set([...attackingArmies.value, army.army_id]);
  try {
    const result = await attackArmy(army.army_id);
    emit('armyAttacked', result.battle);
  } catch (err) {
    console.error('Error al atacar:', err);
    const msg = err?.response?.data?.message || 'Error al procesar el ataque';
    emit('armyAttackFailed', msg);
  } finally {
    const next = new Set(attackingArmies.value);
    next.delete(army.army_id);
    attackingArmies.value = next;
  }
};
</script>

<style scoped>
.troops-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: #e8d5b5;
  gap: 25px;
  padding: 0;
}

.loading-text {
  text-align: center;
  padding: 60px;
  font-size: 1.5rem;
  color: #a89875;
}

.empty-state {
  text-align: center;
  padding: 80px 40px;
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid rgba(197, 160, 89, 0.3);
  border-radius: 12px;
  margin: 40px;
}

.empty-state p {
  font-size: 1.3rem;
  color: #a89875;
  margin: 15px 0;
}

.empty-hint {
  font-size: 1.1rem;
  font-style: italic;
  opacity: 0.7;
}

.troops-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 25px;
}

/* Summary Grid */
.troops-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  padding: 0 25px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 20px;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 215, 0, 0.3);
  border-radius: 12px;
  padding: 25px;
  transition: all 0.3s;
}

.summary-card:hover {
  border-color: rgba(255, 215, 0, 0.6);
  background: rgba(0, 0, 0, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
}

.card-icon {
  font-size: 3rem;
  line-height: 1;
  opacity: 0.8;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}

.card-label {
  font-size: 0.9rem;
  color: #a89875;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  font-weight: 500;
}

.card-value {
  font-size: 2.5rem;
  font-weight: bold;
  color: #ffd700;
  font-family: 'Cinzel', serif;
  line-height: 1;
}

/* Table Container */
.troops-table-container {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid rgba(197, 160, 89, 0.3);
  border-radius: 12px;
  margin: 0 25px 25px 25px;
  padding: 20px;
  overflow: auto;
  min-height: 0;
}

.troops-table {
  width: 100%;
  border-collapse: collapse;
}

.troops-table thead th {
  position: sticky;
  top: 0;
  background: rgba(0, 0, 0, 0.8);
  color: #ffd700;
  padding: 18px 15px;
  text-align: left;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  border-bottom: 3px solid #c5a059;
  font-family: 'Cinzel', serif;
  font-weight: 600;
  z-index: 10;
}

.troop-row {
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.2s;
}

.troop-row:hover {
  background: rgba(197, 160, 89, 0.15);
}

.troops-table td {
  padding: 18px 15px;
  font-size: 1rem;
  vertical-align: middle;
}

/* Unit Column */
.unit-cell {
  font-weight: 600;
  color: #ffd700;
}

.unit-name {
  font-size: 1.2rem;
  font-family: 'Cinzel', serif;
  display: flex;
  align-items: center;
  gap: 6px;
}
.garrison-badge {
  font-size: 1rem;
  line-height: 1;
}

/* Quantity Column */
.quantity-cell {
  text-align: center;
}

.quantity-badge {
  background: rgba(255, 215, 0, 0.2);
  border: 2px solid #ffd700;
  padding: 8px 20px;
  border-radius: 16px;
  font-weight: bold;
  color: #ffd700;
  font-size: 1.1rem;
  display: inline-block;
}

/* Stats Column */
.stats-cell {
  white-space: nowrap;
}

.stats-grid {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px 12px;
}

.stat-icon {
  font-size: 1.1rem;
}

.stat-value {
  font-size: 1rem;
  font-weight: 600;
  color: #e8d5b5;
}

/* Status Column */
.status-cell {
  min-width: 250px;
}

.status-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-label {
  font-size: 0.85rem;
  color: #a89875;
  min-width: 62px;
  font-weight: 600;
  text-transform: uppercase;
}

.progress-bar {
  position: relative;
  flex: 1;
  height: 24px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  transition: width 0.3s;
}

.progress-fill.morale {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
}

.progress-fill.morale.low {
  background: linear-gradient(90deg, #f44336, #ff5722);
}

.progress-fill.morale.medium {
  background: linear-gradient(90deg, #ff9800, #ffc107);
}

.progress-fill.morale.high {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
}

.progress-fill.stamina {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
}

.progress-fill.stamina.low {
  background: linear-gradient(90deg, #f44336, #ff5722);
}

.progress-fill.stamina.medium {
  background: linear-gradient(90deg, #ff9800, #ffc107);
}

.progress-fill.stamina.high {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
}

.progress-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.8rem;
  font-weight: bold;
  color: white;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9);
}

/* Location Column */
.location-cell {
  min-width: 220px;
}

.location-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.army-name {
  font-weight: 600;
  color: #ffd700;
  font-size: 1.1rem;
  font-family: 'Cinzel', serif;
}

.h3-index {
  font-size: 0.85rem;
  color: #a89875;
  font-family: monospace;
  opacity: 0.8;
}

.rest-level {
  font-size: 0.85rem;
  padding: 4px 10px;
  border-radius: 4px;
  display: inline-block;
  font-weight: 600;
}

.rest-level.rested {
  color: #4caf50;
  background: rgba(76, 175, 80, 0.2);
  border: 1px solid rgba(76, 175, 80, 0.4);
}

.rest-level.tired {
  color: #ff9800;
  background: rgba(255, 152, 0, 0.2);
  border: 1px solid rgba(255, 152, 0, 0.4);
}

.rest-level.exhausted {
  color: #f44336;
  background: rgba(244, 67, 54, 0.2);
  border: 1px solid rgba(244, 67, 54, 0.4);
}

/* Actions Column */
.actions-cell {
  text-align: center;
  white-space: nowrap;
}

.action-buttons {
  display: flex;
  gap: 5px;
  justify-content: center;
  align-items: center;
}

.btn-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
  background: transparent;
  flex-shrink: 0;
}

.btn-icon-inspect {
  border: 1px solid #4b7bbf;
  color: #7eb3f5;
}
.btn-icon-inspect:hover {
  background: rgba(75, 123, 191, 0.25);
  border-color: #7eb3f5;
}

.btn-icon-locate {
  border: 1px solid #c5a059;
  color: #c5a059;
}
.btn-icon-locate:hover {
  background: rgba(197, 160, 89, 0.2);
  border-color: #ffd700;
  color: #ffd700;
}

.btn-icon-stop {
  border: 1px solid #e53935;
  color: #e53935;
}
.btn-icon-stop:hover:not(:disabled) {
  background: #e53935;
  color: #fff;
}
.btn-icon-stop:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-icon-attack {
  border: 1px solid #e53935;
  color: #e53935;
  animation: pulse-border 1.5s infinite;
}
.btn-icon-attack:hover:not(:disabled) {
  background: #e53935;
  color: #fff;
  animation: none;
}
.btn-icon-attack:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  animation: none;
}

@keyframes pulse-border {
  0%, 100% { border-color: #e53935; box-shadow: none; }
  50%       { border-color: #ff6b6b; box-shadow: 0 0 6px rgba(229, 57, 53, 0.5); }
}

.btn-icon-reinforce {
  border: 1px solid #2d6a2d;
  color: #4ade80;
}
.btn-icon-reinforce:hover:not(:disabled) {
  background: rgba(74, 222, 128, 0.2);
  border-color: #4ade80;
}
.btn-icon-reinforce:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  border-color: #444;
  color: #555;
}
.btn-icon-transfer {
  border: 1px solid #4a3f6b;
  color: #c8b8f0;
}
.btn-icon-transfer:hover {
  background: rgba(200, 184, 240, 0.2);
  border-color: #c8b8f0;
}
</style>
