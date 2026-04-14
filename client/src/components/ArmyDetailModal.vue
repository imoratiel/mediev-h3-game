<template>
  <Teleport to="body">
    <Transition name="adm-fade">
      <div v-if="show" class="adm-backdrop" @click.self="$emit('close')">
        <div class="adm-box" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="adm-header">
            <div class="adm-title-row">
              <span class="adm-icon">{{ armyDetail?.is_garrison ? '🏰' : '⚔️' }}</span>
              <h2 class="adm-title">{{ army?.name ?? '—' }}</h2>
              <span v-if="armyDetail?.is_garrison" class="adm-garrison-badge">GUARNICIÓN</span>
            </div>
            <button class="adm-close" @click="$emit('close')" title="Cerrar (Escape)">✕</button>
          </div>

          <!-- Loading -->
          <div v-if="loading" class="adm-loading">Cargando datos del ejército...</div>

          <!-- Error -->
          <div v-else-if="error" class="adm-error">❌ {{ error }}</div>

          <template v-else>
            <!-- Comandante -->
            <template v-if="commander">
              <div class="adm-section-label">👑 COMANDANTE</div>
              <div class="adm-commander-card">
                <div class="adm-commander-avatar">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </div>
                <div class="adm-commander-info">
                  <div class="adm-commander-name">{{ commander.full_title }}</div>
                  <div class="adm-commander-meta">
                    <span class="adm-commander-level">Nivel {{ commander.level }}</span>
                    <span class="adm-commander-buff">⚔️ +{{ commander.combat_buff_pct }}% combate</span>
                    <span v-if="commander.is_captive" class="adm-commander-captive">⛓️ Cautivo</span>
                  </div>
                  <div class="adm-commander-guard-row">
                    <span class="adm-commander-guard-label">Guardia personal</span>
                    <div class="adm-commander-guard-bar-wrap">
                      <div class="adm-commander-guard-bar-fill"
                           :style="{ width: Math.round(commander.personal_guard / 25 * 100) + '%',
                                     background: barColor(Math.round(commander.personal_guard / 25 * 100)) }">
                      </div>
                    </div>
                    <span class="adm-commander-guard-count">{{ commander.personal_guard }}/25</span>
                  </div>
                </div>
              </div>
            </template>

          <!-- Tabla de tropas -->
            <div class="adm-section-label">🗡 COMPOSICIÓN DE TROPAS</div>
            <div class="adm-table-wrap">
              <table v-if="troops.length > 0" class="adm-table">
                <thead>
                  <tr>
                    <th class="adm-th-name">Unidad</th>
                    <th class="adm-th-num">Cant.</th>
                    <th class="adm-th-bar">Exp.</th>
                    <th class="adm-th-bar">Moral</th>
                    <th class="adm-th-bar">Estamina</th>
                    <th class="adm-th-num">Atq.</th>
                    <th class="adm-th-num">Estado</th>
                    <th class="adm-th-dismiss">Licenciar</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in troops" :key="t.unit_name" class="adm-tr">
                    <td class="adm-td-name">
                      <span class="adm-unit-icon" :title="t.unit_class">{{ unitClassIcon(t.unit_class) }}</span>
                      {{ t.unit_name }}
                    </td>
                    <td class="adm-td-num">{{ t.quantity }}</td>
                    <td class="adm-td-bar">
                      <div class="adm-bar-wrap">
                        <div class="adm-bar-fill adm-bar-exp" :style="{ width: Math.min(t.experience, 100) + '%' }"></div>
                        <span class="adm-bar-label adm-gold">{{ t.experience }}%</span>
                      </div>
                    </td>
                    <td class="adm-td-bar">
                      <div class="adm-bar-wrap">
                        <div class="adm-bar-fill" :style="{ width: t.morale + '%', background: barColor(t.morale) }"></div>
                        <span class="adm-bar-label">{{ t.morale }}%</span>
                      </div>
                    </td>
                    <td class="adm-td-bar">
                      <div class="adm-bar-wrap">
                        <div class="adm-bar-fill" :style="{ width: t.stamina + '%', background: barColor(t.stamina) }"></div>
                        <span class="adm-bar-label">{{ t.stamina }}%</span>
                      </div>
                    </td>
                    <td class="adm-td-num">{{ t.attack }}</td>
                    <td class="adm-td-num">
                      <span v-if="t.force_rest" class="adm-badge adm-badge-rest">😴 Descanso</span>
                      <span v-else class="adm-badge adm-badge-ok">✅ Listo</span>
                    </td>
                    <td class="adm-td-dismiss">
                      <div class="adm-dismiss-ctrl">
                        <input
                          v-model.number="dismissQty[t.unit_type_id]"
                          type="number" min="1" :max="t.quantity"
                          class="adm-dismiss-input"
                        />
                        <button
                          class="adm-dismiss-btn"
                          :disabled="dismissing.has(t.unit_type_id)"
                          @click="handleDismiss(t)"
                        >{{ dismissing.has(t.unit_type_id) ? '⏳' : 'Licenciar' }}</button>
                      </div>
                      <div v-if="dismissSurplus[t.unit_type_id] > 0" class="adm-dismiss-warn">
                        ⚠️ Se perderán {{ dismissSurplus[t.unit_type_id] }} personas
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="adm-empty">Sin tropas reclutadas.</p>
            </div>

            <!-- Recursos / Provisiones -->
            <div class="adm-section-label">🎒 PROVISIONES DEL EJÉRCITO</div>
            <div class="adm-provisions">
              <div class="adm-prov-item">
                <span class="adm-prov-icon">💰</span>
                <span class="adm-prov-label">Oro</span>
                <span class="adm-prov-val" :class="{ 'adm-zero': !armyDetail?.gold_provisions }">
                  {{ armyDetail?.gold_provisions ?? 0 }}
                </span>
              </div>
              <div class="adm-prov-item">
                <span class="adm-prov-icon">🌾</span>
                <span class="adm-prov-label">Comida</span>
                <span class="adm-prov-val" :class="{ 'adm-zero': !armyDetail?.food_provisions }">
                  {{ armyDetail?.food_provisions ?? 0 }}
                </span>
              </div>
              <!-- DISABLED: wood provisions hidden
              <div class="adm-prov-item">
                <span class="adm-prov-icon">🌲</span>
                <span class="adm-prov-label">Madera</span>
                <span class="adm-prov-val">{{ armyDetail?.wood_provisions ?? 0 }}</span>
              </div>
              -->
            </div>
          <!-- Refuerzo (solo cuando el ejército está en territorio propio) -->
          <template v-if="armyDetail?.is_own_fief">
            <div class="adm-section-label" style="display:flex; align-items:center; justify-content:space-between; padding-right:20px;">
              <span>🗡️ REFORZAR EJÉRCITO</span>
              <button class="adm-toggle-btn" @click="toggleReinforce">
                {{ showReinforce ? '▲ Ocultar' : '▼ Mostrar' }}
              </button>
            </div>

            <!-- Bloqueado: territorio en período de gracia -->
            <div v-if="armyDetail.fief_grace_turns > 0" class="adm-reinforce-blocked">
              🏚️ Territorio en período de ocupación ({{ armyDetail.fief_grace_turns }} turnos restantes).<br>
              No se puede reclutar hasta que el territorio se estabilice.
            </div>

            <!-- Bloqueado: sin edificio militar -->
            <div
              v-else-if="armyDetail.h3_index !== armyDetail.capital_h3 && !armyDetail.fief_has_military"
              class="adm-reinforce-blocked"
            >
              🏗️ Este territorio no tiene un edificio militar completado.<br>
              Solo puedes reforzar en tu Capital o en territorios con un Cuartel o Fortaleza.
            </div>

            <!-- Formulario de refuerzo -->
            <template v-else-if="showReinforce">
              <div class="adm-reinforce-wrap">
                <!-- Recursos disponibles -->
                <div class="adm-reinforce-resources">
                  <span>👥 Pob. disponible: <b>{{ reinforcePool !== null ? reinforcePool : '...' }}</b></span>
                  <!-- DISABLED: <span>🌲 Madera: <b>{{ armyDetail.fief_wood }}</b></span> -->
                  <!-- DISABLED: <span>⛰️ Piedra: <b>{{ armyDetail.fief_stone }}</b></span> -->
                  <!-- DISABLED: <span>⛏️ Hierro: <b>{{ armyDetail.fief_iron }}</b></span> -->
                </div>

                <table class="adm-table" v-if="availableUnitTypes.length > 0">
                  <thead>
                    <tr>
                      <th class="adm-th-name">Unidad</th>
                      <th class="adm-th-num">Coste/u</th>
                      <th class="adm-th-num">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="ut in availableUnitTypes" :key="ut.unit_type_id" class="adm-tr">
                      <td class="adm-td-name">
                        <span class="adm-unit-icon" :title="ut.unit_class">{{ unitClassIcon(ut.unit_class) }}</span>
                        {{ ut.name }}
                      </td>
                      <td class="adm-td-num adm-gold" style="font-size:0.75rem; white-space:nowrap;">
                        <span v-for="req in (ut.requirements || [])" :key="req.resource_type">
                          {{ req.resource_type === 'gold' ? '💰' : req.resource_type === 'wood_stored' ? '🌲' : req.resource_type === 'stone_stored' ? '⛰️' : '⛏️' }}{{ req.amount }}
                        </span>
                        <span v-if="!(ut.requirements && ut.requirements.length)">—</span>
                      </td>
                      <td class="adm-td-num">
                        <input
                          v-model.number="reinforceQty[ut.unit_type_id]"
                          type="number" min="0" placeholder="0"
                          class="adm-dismiss-input"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="adm-empty">Cargando tipos de unidad...</p>

                <!-- Resumen de costes -->
                <div class="adm-reinforce-summary" v-if="totalReinforceQty > 0">
                  <span>Total: <b>{{ totalReinforceQty }}</b> tropas</span>
                  <span v-if="totalReinforceCost.gold  > 0">💰 {{ totalReinforceCost.gold }}</span>
                  <!-- DISABLED: <span v-if="totalReinforceCost.wood  > 0">🌲 {{ totalReinforceCost.wood }}</span> -->
                  <!-- DISABLED: <span v-if="totalReinforceCost.stone > 0">⛰️ {{ totalReinforceCost.stone }}</span> -->
                  <!-- DISABLED: <span v-if="totalReinforceCost.iron  > 0">⛏️ {{ totalReinforceCost.iron }}</span> -->
                  <span>👥 -{{ totalReinforceQty }}</span>
                </div>

                <div v-if="reinforceError" class="adm-reinforce-err">❌ {{ reinforceError }}</div>

                <button
                  class="adm-reinforce-btn"
                  :disabled="reinforcing || totalReinforceQty === 0"
                  @click="handleReinforce"
                >
                  {{ reinforcing ? '⏳ Reforzando...' : `⚔️ Reforzar (+${totalReinforceQty})` }}
                </button>
              </div>
            </template>

            <!-- Mensaje de éxito post-refuerzo -->
            <div v-if="reinforceMsg && !showReinforce" class="adm-reinforce-ok">✅ {{ reinforceMsg }}</div>
          </template>

          </template>

          <button class="adm-btn-close" @click="$emit('close')">Cerrar</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import axios from 'axios';
import { dismissTroops, reinforceArmy, getRecruitablePool } from '../services/mapApi.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const props = defineProps({
  show:            { type: Boolean, default: false },
  army:            { type: Object,  default: null  },  // datos básicos del panel (name, army_id, …)
  autoReinforce:   { type: Boolean, default: false },  // auto-abre la sección de refuerzo
  playerCultureId: { type: Number,  default: null  },
});
const emit = defineEmits(['close', 'dismissed']);

const loading    = ref(false);
const error      = ref('');
const armyDetail = ref(null);  // army con provisiones
const troops     = ref([]);
const commander  = ref(null);  // personaje comandante del ejército
const dismissQty  = ref({});   // { [unit_type_id]: quantity }
const dismissing  = ref(new Set());

// ── Reinforcement state ──────────────────────────────────────────────────────
const showReinforce   = ref(false);
const unitTypes       = ref([]);
const reinforceQty    = ref({});   // { [unit_type_id]: quantity }
const reinforcing     = ref(false);
const reinforceError  = ref('');
const reinforceMsg    = ref('');
const reinforcePool   = ref(null); // reclutas disponibles vía red de comarca

// Unit types filtered by player culture
const availableUnitTypes = computed(() => {
  if (!props.playerCultureId) return unitTypes.value;
  return unitTypes.value.filter(u => u.culture_id === props.playerCultureId);
});

// Calculates how many people would be lost per unit type if dismissed (cap overflow)
const dismissSurplus = computed(() => {
  const fiefPop = parseInt(armyDetail.value?.fief_population) || 0;
  const fiefCap = parseInt(armyDetail.value?.fief_pop_cap) || 1000;
  const result = {};
  for (const t of troops.value) {
    const qty = dismissQty.value[t.unit_type_id] ?? 1;
    result[t.unit_type_id] = Math.max(0, fiefPop + qty - fiefCap);
  }
  return result;
});

// Total gold cost for current reinforce inputs
const totalReinforceCost = computed(() => {
  const costs = { gold: 0, wood: 0, stone: 0, iron: 0 };
  for (const ut of availableUnitTypes.value) {
    const qty = parseInt(reinforceQty.value[ut.unit_type_id]) || 0;
    if (qty <= 0) continue;
    for (const req of (ut.requirements || [])) {
      if (req.resource_type === 'gold')         costs.gold  += req.amount * qty;
      else if (req.resource_type === 'wood_stored')  costs.wood  += req.amount * qty;
      else if (req.resource_type === 'stone_stored') costs.stone += req.amount * qty;
      else if (req.resource_type === 'iron_stored')  costs.iron  += req.amount * qty;
    }
  }
  return costs;
});

// Total troops being added in reinforce form
const totalReinforceQty = computed(() =>
  availableUnitTypes.value.reduce((s, ut) => s + (parseInt(reinforceQty.value[ut.unit_type_id]) || 0), 0)
);

const handleDismiss = async (troop) => {
  const qty = dismissQty.value[troop.unit_type_id] ?? 1;
  if (!qty || qty <= 0 || qty > troop.quantity) {
    alert('Cantidad inválida');
    return;
  }
  if (!confirm(`Esta acción no puede deshacerse. ${qty} ${troop.unit_name} volverán a ser población civil. ¿Confirmar?`)) return;

  dismissing.value = new Set([...dismissing.value, troop.unit_type_id]);
  try {
    const result = await dismissTroops(props.army.army_id, troop.unit_type_id, qty);
    emit('dismissed', { message: result.message, armyDissolved: result.army_dissolved });
    if (result.army_dissolved) {
      emit('close');
    } else {
      await fetchDetail(props.army.army_id); // refresca la tabla
    }
  } catch (err) {
    alert(err?.response?.data?.message || 'Error al licenciar tropas');
  } finally {
    const next = new Set(dismissing.value);
    next.delete(troop.unit_type_id);
    dismissing.value = next;
  }
};

const handleReinforce = async () => {
  const units = availableUnitTypes.value
    .map(ut => ({ unit_type_id: ut.unit_type_id, quantity: parseInt(reinforceQty.value[ut.unit_type_id]) || 0 }))
    .filter(u => u.quantity > 0);

  if (units.length === 0) {
    reinforceError.value = 'Introduce al menos una unidad a reforzar.';
    return;
  }

  reinforcing.value = true;
  reinforceError.value = '';
  reinforceMsg.value = '';
  try {
    const result = await reinforceArmy(props.army.army_id, units);
    reinforceMsg.value = result.message;
    reinforceQty.value = {};
    showReinforce.value = false;
    await fetchDetail(props.army.army_id); // refresh troops table
  } catch (err) {
    reinforceError.value = err?.response?.data?.message || 'Error al reforzar el ejército';
  } finally {
    reinforcing.value = false;
  }
};

const fetchUnitTypes = async () => {
  if (unitTypes.value.length > 0) return; // already loaded
  try {
    const { data } = await axios.get(`${API_URL}/api/military/unit-types`, { withCredentials: true });
    if (data.success) {
      unitTypes.value = data.unit_types || data.unitTypes || data.units || [];
      reinforceQty.value = {};
    }
  } catch (_) { /* silent */ }
};

const toggleReinforce = () => {
  showReinforce.value = !showReinforce.value;
  reinforceError.value = '';
  reinforceMsg.value = '';
  if (showReinforce.value) {
    fetchUnitTypes();
    fetchReinforcePool();
  }
};

const fetchReinforcePool = async () => {
  const h3 = armyDetail.value?.h3_index;
  if (!h3) return;
  reinforcePool.value = null;
  try {
    const data = await getRecruitablePool(h3);
    if (data?.success) reinforcePool.value = data.recruitable;
  } catch (_) { /* silent */ }
};

const barColor = (val) => {
  const n = parseFloat(val);
  if (n >= 70) return '#22c55e';
  if (n >= 40) return '#f59e0b';
  return '#ef4444';
};

const UNIT_CLASS_ICON = {
  INFANTRY_1:     '🛡',
  INFANTRY_2:     '⚔',
  INFANTRY_ELITE: '⭐',
  ARCHER_1:       '🏹',
  ARCHER_2:       '🏹',
  CAVALRY_1:      '🐎',
  CAVALRY_2:      '🐎',
  SIEGE:          '🪨',
};
const unitClassIcon = (unit_class) => UNIT_CLASS_ICON[unit_class] || '⚔';

const fetchDetail = async (armyId) => {
  loading.value = true;
  error.value   = '';
  try {
    const { data } = await axios.get(`${API_URL}/api/military/armies/${armyId}`, { withCredentials: true });
    if (data.success) {
      armyDetail.value = data.army;
      troops.value     = data.troops;
      commander.value  = data.commander ?? null;
      // Init dismiss inputs to 1 for each unit type
      dismissQty.value = Object.fromEntries(data.troops.map(t => [t.unit_type_id, 1]));
      // Auto-expand reinforce section if requested and conditions met
      if (props.autoReinforce && data.army.is_own_fief && data.army.fief_grace_turns === 0) {
        showReinforce.value = true;
        fetchUnitTypes();
        fetchReinforcePool();
      }
    } else {
      error.value = data.message || 'Error al cargar datos';
    }
  } catch (err) {
    error.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    loading.value = false;
  }
};

// Fetch cuando se abre el modal
watch(() => props.show, (val) => {
  if (val && props.army?.army_id) {
    fetchDetail(props.army.army_id);
    document.addEventListener('keydown', handleEsc);
  } else {
    document.removeEventListener('keydown', handleEsc);
    // Limpiar al cerrar
    armyDetail.value  = null;
    troops.value      = [];
    commander.value   = null;
    error.value       = '';
    showReinforce.value = false;
    reinforceMsg.value  = '';
    reinforceError.value = '';
  }
});

const handleEsc = (e) => { if (e.key === 'Escape') emit('close'); };
onUnmounted(() => document.removeEventListener('keydown', handleEsc));
</script>

<style scoped>
.adm-fade-enter-active, .adm-fade-leave-active { transition: opacity 0.2s ease; }
.adm-fade-enter-from, .adm-fade-leave-to { opacity: 0; }

.adm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.adm-box {
  background: #111827;
  border: 1px solid #374151;
  border-radius: 10px;
  width: 100%;
  max-width: 900px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.8);
  font-family: sans-serif;
}

/* Header */
.adm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #1f2937;
  background: #0d1117;
  flex-shrink: 0;
}
.adm-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.adm-icon { font-size: 1.4rem; }
.adm-garrison-badge {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 1.5px;
  padding: 2px 8px;
  background: rgba(100, 160, 255, 0.15);
  border: 1px solid rgba(100, 160, 255, 0.4);
  border-radius: 4px;
  color: #90b8ff;
  text-transform: uppercase;
}
.adm-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #fbbf24;
  letter-spacing: 1px;
  font-family: 'Georgia', serif;
}
.adm-close {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s;
}
.adm-close:hover { color: #e5e7eb; }

/* Loading / error */
.adm-loading, .adm-error { padding: 40px; text-align: center; color: #9ca3af; font-size: 0.9rem; }
.adm-error { color: #f87171; }

/* Section label */
.adm-section-label {
  padding: 12px 20px 6px;
  font-size: 0.68rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #4b5563;
  font-weight: 700;
  flex-shrink: 0;
}

/* Tabla de tropas */
.adm-table-wrap {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 300px;
  padding: 0 20px 8px;
  flex-shrink: 0;
}
.adm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  min-width: 660px;
}
.adm-table thead th {
  padding: 7px 10px;
  color: #4b5563;
  font-size: 0.68rem;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  border-bottom: 1px solid #1f2937;
  font-weight: 600;
  white-space: nowrap;
}
.adm-th-name { text-align: left; }
.adm-th-num, .adm-th-bar { text-align: center; }

.adm-tr { border-bottom: 1px solid #0d1117; }
.adm-tr:hover { background: rgba(255,255,255,0.02); }

.adm-td-name { padding: 9px 10px; color: #e2e8f0; font-weight: 600; white-space: nowrap; }
.adm-unit-icon { font-size: 13px; margin-right: 5px; }
.adm-td-num { padding: 9px 10px; text-align: center; color: #9ca3af; }
.adm-td-bar { padding: 9px 10px; min-width: 100px; }
.adm-gold { color: #fbbf24 !important; }

/* Barra de progreso */
.adm-bar-wrap {
  position: relative;
  height: 16px;
  background: #1f2937;
  border-radius: 4px;
  overflow: hidden;
}
.adm-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 0.3s;
  border-radius: 4px;
}
.adm-bar-exp { background: #d97706; }
.adm-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}

/* Badges estado */
.adm-badge {
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}
.adm-badge-rest { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.adm-badge-ok   { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25); }

/* Sin tropas */
.adm-empty { padding: 20px; text-align: center; color: #4b5563; font-style: italic; font-size: 0.85rem; }

/* Columna licenciar */
.adm-th-dismiss { text-align: center; white-space: nowrap; }
.adm-td-dismiss { padding: 6px 10px; }
.adm-dismiss-ctrl { display: flex; align-items: center; gap: 5px; justify-content: center; }
.adm-dismiss-input {
  width: 48px; padding: 3px 5px; text-align: center;
  background: #1f2937; color: #e2e8f0; border: 1px solid #374151;
  border-radius: 4px; font-size: 0.8rem;
}
.adm-dismiss-btn {
  padding: 3px 8px; font-size: 0.75rem; white-space: nowrap; cursor: pointer;
  background: #3d1515; color: #f87171; border: 1px solid #6b2a2a; border-radius: 4px;
  transition: background 0.15s;
}
.adm-dismiss-btn:hover:not(:disabled) { background: #5c1c1c; }
.adm-dismiss-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.adm-dismiss-warn {
  margin-top: 4px;
  font-size: 0.68rem;
  color: #f97316;
  text-align: center;
  white-space: nowrap;
}

/* Provisiones */
.adm-provisions {
  display: flex;
  gap: 12px;
  padding: 6px 20px 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.adm-prov-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 10px 16px;
  min-width: 130px;
}
.adm-prov-icon { font-size: 1.2rem; }
.adm-prov-label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
.adm-prov-val { font-size: 1rem; font-weight: 700; color: #e2e8f0; margin-left: auto; }
.adm-zero { color: #374151 !important; }

/* Botón cerrar */
.adm-btn-close {
  margin: 0 20px 16px;
  padding: 10px;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  color: #9ca3af;
  font-size: 0.82rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.adm-btn-close:hover { background: #374151; color: #e5e7eb; }

/* Refuerzo */
.adm-toggle-btn {
  background: none; border: 1px solid #374151; color: #9ca3af;
  font-size: 0.72rem; padding: 3px 10px; border-radius: 4px; cursor: pointer;
  transition: background 0.15s;
}
.adm-toggle-btn:hover { background: #1f2937; color: #e5e7eb; }

.adm-reinforce-blocked {
  margin: 0 20px 12px;
  padding: 10px 14px;
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.3);
  border-radius: 6px;
  color: #fbbf24;
  font-size: 0.82rem;
  line-height: 1.5;
}

.adm-reinforce-wrap {
  padding: 0 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.adm-reinforce-resources {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: #9ca3af;
  padding: 6px 0;
}
.adm-reinforce-resources b { color: #e2e8f0; }

.adm-reinforce-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.82rem;
  color: #9ca3af;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 8px 12px;
}
.adm-reinforce-summary b { color: #fbbf24; }

.adm-reinforce-err {
  font-size: 0.8rem;
  color: #f87171;
  padding: 4px 0;
}

.adm-reinforce-ok {
  margin: 0 20px 10px;
  padding: 8px 12px;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.25);
  border-radius: 6px;
  color: #4ade80;
  font-size: 0.82rem;
}

.adm-reinforce-btn {
  padding: 8px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: #1a3a1a;
  color: #4ade80;
  border: 1px solid #2d5a2d;
  border-radius: 6px;
  transition: background 0.15s;
  align-self: flex-start;
}
.adm-reinforce-btn:hover:not(:disabled) { background: #1e4a1e; }
.adm-reinforce-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Comandante */
.adm-commander-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 20px 14px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(31,41,55,0.9) 100%);
  border: 1px solid rgba(251,191,36,0.3);
  border-radius: 8px;
}
.adm-commander-avatar {
  width: 44px;
  height: 44px;
  background: rgba(251,191,36,0.15);
  border: 1px solid rgba(251,191,36,0.4);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fbbf24;
  flex-shrink: 0;
}
.adm-commander-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.adm-commander-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: #fbbf24;
  font-family: 'Georgia', serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.adm-commander-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.adm-commander-level {
  font-size: 0.75rem;
  color: #9ca3af;
  background: #1f2937;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #374151;
}
.adm-commander-buff {
  font-size: 0.75rem;
  color: #4ade80;
  background: rgba(34,197,94,0.1);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(34,197,94,0.25);
}
.adm-commander-captive {
  font-size: 0.75rem;
  color: #f87171;
  background: rgba(239,68,68,0.1);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(239,68,68,0.25);
}
.adm-commander-guard-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.adm-commander-guard-label {
  font-size: 0.72rem;
  color: #6b7280;
  white-space: nowrap;
}
.adm-commander-guard-bar-wrap {
  flex: 1;
  height: 6px;
  background: #1f2937;
  border-radius: 3px;
  overflow: hidden;
  max-width: 120px;
}
.adm-commander-guard-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}
.adm-commander-guard-count {
  font-size: 0.72rem;
  color: #9ca3af;
  white-space: nowrap;
}
</style>
