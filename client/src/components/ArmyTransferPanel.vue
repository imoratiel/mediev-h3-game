<template>
  <Teleport to="body">
    <Transition name="atp-fade">
      <div v-if="show" class="atp-backdrop" @click.self="$emit('close')">
        <div class="atp-box" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="atp-header">
            <div class="atp-header-left">
              <span class="atp-icon">🔗</span>
              <div>
                <h2 class="atp-title">Unir Ejércitos</h2>
                <span class="atp-subtitle">{{ fiefName || h3_index }}</span>
              </div>
            </div>
            <button class="atp-close" @click="$emit('close')">✕</button>
          </div>

          <!-- Army B selector (when >2 armies at hex) -->
          <div v-if="coLocated.length > 1" class="atp-selector-row">
            <label class="atp-selector-label">Ejército B:</label>
            <select class="atp-selector" v-model="selectedBId" @change="onSelectB">
              <option v-for="a in coLocated" :key="a.army_id" :value="a.army_id">
                {{ a.is_garrison ? '🏰' : '⚔️' }} {{ a.name }}
              </option>
            </select>
          </div>

          <!-- Loading / Error -->
          <div v-if="loading" class="atp-loading">Cargando ejércitos...</div>
          <div v-else-if="errorMsg" class="atp-error">❌ {{ errorMsg }}</div>

          <template v-else-if="armyA && armyB">

            <!-- Army name headers -->
            <div class="atp-army-headers">
              <div class="atp-army-label army-a">
                {{ armyA.army.is_garrison ? '🏰' : '⚔️' }}
                {{ armyA.army.name }}
                <span v-if="armyA.army.is_garrison" class="atp-garrison-tag">GUARNICIÓN</span>
              </div>
              <div class="atp-army-label army-b">
                {{ armyB.army.is_garrison ? '🏰' : '⚔️' }}
                {{ armyB.army.name }}
                <span v-if="armyB.army.is_garrison" class="atp-garrison-tag">GUARNICIÓN</span>
              </div>
            </div>

            <!-- Troops section -->
            <div class="atp-section-label">🗡 TROPAS</div>
            <div v-if="allUnitTypes.length === 0" class="atp-empty">Ningún ejército tiene tropas.</div>
            <div v-else class="atp-rows">
              <div v-for="ut in allUnitTypes" :key="ut.unit_type_id" class="atp-row">
                <div class="atp-row-title">
                  <span class="atp-row-name">{{ ut.unit_name }}</span>
                  <span class="atp-row-total">Total: {{ troopTotal(ut.unit_type_id) }}</span>
                </div>
                <div class="atp-slider-row">
                  <span class="atp-val army-a">{{ troopAllocA(ut.unit_type_id) }}</span>
                  <div class="atp-slider-wrap">
                    <input
                      type="range"
                      class="atp-slider"
                      :min="0"
                      :max="troopTotal(ut.unit_type_id)"
                      :value="troopAllocA(ut.unit_type_id)"
                      :disabled="troopTotal(ut.unit_type_id) === 0"
                      :style="sliderStyle(troopAllocA(ut.unit_type_id), troopTotal(ut.unit_type_id))"
                      @input="onTroopSlider(ut.unit_type_id, $event)"
                    />
                  </div>
                  <span class="atp-val army-b">{{ troopTotal(ut.unit_type_id) - troopAllocA(ut.unit_type_id) }}</span>
                </div>
                <div class="atp-input-row">
                  <label class="atp-input-label">{{ armyA.army.name }}:</label>
                  <input
                    type="number"
                    class="atp-num-input"
                    :min="0"
                    :max="troopTotal(ut.unit_type_id)"
                    :value="troopAllocA(ut.unit_type_id)"
                    @change="onTroopInput(ut.unit_type_id, $event)"
                  />
                </div>
              </div>
            </div>

            <!-- Provisions section -->
            <div class="atp-section-label">📦 SUMINISTROS</div>
            <div class="atp-rows">
              <div v-for="p in PROVISIONS" :key="p.key" class="atp-row">
                <div class="atp-row-title">
                  <span class="atp-row-name">{{ p.icon }} {{ p.label }}</span>
                  <span class="atp-row-total">Total: {{ provTotal(p.key) }}</span>
                </div>
                <div class="atp-slider-row">
                  <span class="atp-val army-a">{{ provAllocA(p.key) }}</span>
                  <div class="atp-slider-wrap">
                    <input
                      type="range"
                      class="atp-slider"
                      :min="0"
                      :max="provTotal(p.key)"
                      step="1"
                      :value="provAllocA(p.key)"
                      :disabled="provTotal(p.key) === 0"
                      :style="sliderStyle(provAllocA(p.key), provTotal(p.key))"
                      @input="onProvSlider(p.key, $event)"
                    />
                  </div>
                  <span class="atp-val army-b">{{ provTotal(p.key) - provAllocA(p.key) }}</span>
                </div>
                <div class="atp-input-row">
                  <label class="atp-input-label">{{ armyA.army.name }}:</label>
                  <input
                    type="number"
                    class="atp-num-input"
                    :min="0"
                    :max="provTotal(p.key)"
                    step="1"
                    :value="provAllocA(p.key)"
                    @change="onProvInput(p.key, $event)"
                  />
                </div>
              </div>
            </div>

            <!-- Error -->
            <div v-if="applyError" class="atp-apply-error">❌ {{ applyError }}</div>

            <!-- Footer -->
            <div class="atp-footer">
              <button class="atp-btn atp-btn-reset" @click="resetAllocations" :disabled="applying">
                🔄 Restablecer
              </button>
              <button class="atp-btn atp-btn-merge" @click="mergeAll" :disabled="applying || merging">
                {{ merging ? 'Fusionando...' : '⚔️ Fusionar todo' }}
              </button>
              <button
                class="atp-btn atp-btn-apply"
                @click="applyTransfers"
                :disabled="applying || !hasChanges"
              >
                {{ applying ? 'Aplicando...' : '✔ Aplicar' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import * as mapApi from '@/services/mapApi.js';

const props = defineProps({
  show:     { type: Boolean, default: false },
  armyAId:  { type: Number, required: true },
  armyBId:  { type: Number, default: null },
  h3_index: { type: String, required: true },
  fiefName: { type: String, default: '' },
});

const emit = defineEmits(['close', 'done']);

// ── State ──────────────────────────────────────────────────────────────────
const loading    = ref(false);
const applying   = ref(false);
const merging    = ref(false);
const errorMsg   = ref('');
const applyError = ref('');

const armyA     = ref(null);  // { army: {}, troops: [] }
const armyB     = ref(null);
const coLocated = ref([]);
const selectedBId = ref(null);

// allocationsA[uid] = quantity assigned to Army A  (0..total)
const allocationsA    = ref({});  // troops
const provAllocationsA = ref({}); // provisions (rounded integers for slider)

const PROVISIONS = [
  { key: 'gold',  icon: '🥇', label: 'Oro'    },
  { key: 'food',  icon: '🍖', label: 'Comida' },
  { key: 'wood',  icon: '🌲', label: 'Madera' },
  { key: 'stone', icon: '⛰️', label: 'Piedra' },
  { key: 'iron',  icon: '⛏️', label: 'Hierro' },
];

// ── Raw data helpers ───────────────────────────────────────────────────────
function rawQtyA(uid) {
  if (!armyA.value) return 0;
  const row = armyA.value.troops.find(t => t.unit_type_id === uid);
  return row ? parseInt(row.quantity) : 0;
}
function rawQtyB(uid) {
  if (!armyB.value) return 0;
  const row = armyB.value.troops.find(t => t.unit_type_id === uid);
  return row ? parseInt(row.quantity) : 0;
}
function rawProvA(key) {
  if (!armyA.value) return 0;
  return Math.round(parseFloat(armyA.value.army[`${key}_provisions`] || 0));
}
function rawProvB(key) {
  if (!armyB.value) return 0;
  return Math.round(parseFloat(armyB.value.army[`${key}_provisions`] || 0));
}

// ── Derived values ─────────────────────────────────────────────────────────
const allUnitTypes = computed(() => {
  const map = {};
  for (const t of (armyA.value?.troops || []))
    map[t.unit_type_id] = { unit_type_id: t.unit_type_id, unit_name: t.unit_name };
  for (const t of (armyB.value?.troops || []))
    map[t.unit_type_id] = { unit_type_id: t.unit_type_id, unit_name: t.unit_name };
  return Object.values(map).sort((a, b) => a.unit_name.localeCompare(b.unit_name));
});

function troopTotal(uid) { return rawQtyA(uid) + rawQtyB(uid); }
function troopAllocA(uid) { return allocationsA.value[uid] ?? rawQtyA(uid); }

function provTotal(key) { return rawProvA(key) + rawProvB(key); }
function provAllocA(key) { return provAllocationsA.value[key] ?? rawProvA(key); }

const hasChanges = computed(() => {
  for (const ut of allUnitTypes.value) {
    if (troopAllocA(ut.unit_type_id) !== rawQtyA(ut.unit_type_id)) return true;
  }
  for (const p of PROVISIONS) {
    if (provAllocA(p.key) !== rawProvA(p.key)) return true;
  }
  return false;
});

// ── Slider style (dual-color track: blue left = A, red right = B) ──────────
function sliderStyle(value, max) {
  if (max === 0) return '';
  const pct = Math.round((value / max) * 100);
  return `background: linear-gradient(to right, #2a6ab5 0%, #3d8ae0 ${pct}%, #7a2020 ${pct}%, #b03030 100%);`;
}

// ── Controls ───────────────────────────────────────────────────────────────
function onTroopSlider(uid, event) {
  allocationsA.value = { ...allocationsA.value, [uid]: parseInt(event.target.value) };
}
function onTroopInput(uid, event) {
  const val = Math.min(Math.max(parseInt(event.target.value) || 0, 0), troopTotal(uid));
  allocationsA.value = { ...allocationsA.value, [uid]: val };
  event.target.value = val;
}

function onProvSlider(key, event) {
  provAllocationsA.value = { ...provAllocationsA.value, [key]: parseInt(event.target.value) };
}
function onProvInput(key, event) {
  const val = Math.min(Math.max(parseInt(event.target.value) || 0, 0), provTotal(key));
  provAllocationsA.value = { ...provAllocationsA.value, [key]: val };
  event.target.value = val;
}

function resetAllocations() {
  allocationsA.value     = {};
  provAllocationsA.value = {};
  applyError.value       = '';
}

function setMergeAllocations() {
  const ta = {};
  for (const ut of allUnitTypes.value) ta[ut.unit_type_id] = troopTotal(ut.unit_type_id);
  allocationsA.value = ta;
  const pa = {};
  for (const p of PROVISIONS) pa[p.key] = provTotal(p.key);
  provAllocationsA.value = pa;
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadData() {
  if (!props.show) return;
  loading.value    = true;
  errorMsg.value   = '';
  applyError.value = '';
  try {
    const targetBId = selectedBId.value;
    const [detailA, detailB, hexRes] = await Promise.all([
      mapApi.getArmyDetail(props.armyAId),
      targetBId ? mapApi.getArmyDetail(targetBId) : Promise.resolve(null),
      mapApi.getArmiesAtHex(props.h3_index),
    ]);

    armyA.value = detailA?.success ? { army: detailA.army, troops: detailA.troops } : null;
    armyB.value = detailB?.success ? { army: detailB.army, troops: detailB.troops } : null;

    coLocated.value = (hexRes?.armies || []).filter(a => a.army_id !== props.armyAId);

    if (!selectedBId.value && coLocated.value.length > 0) {
      const preferred = props.armyBId
        ? coLocated.value.find(a => a.army_id === props.armyBId)
        : null;
      selectedBId.value = preferred?.army_id ?? coLocated.value[0].army_id;
      if (!armyB.value) {
        const d = await mapApi.getArmyDetail(selectedBId.value);
        armyB.value = d?.success ? { army: d.army, troops: d.troops } : null;
      }
    }

    resetAllocations();
    if (!armyA.value) errorMsg.value = 'No se pudo cargar el Ejército A.';
    if (!armyB.value) errorMsg.value = (errorMsg.value ? errorMsg.value + ' ' : '') + 'No se pudo cargar el Ejército B.';
  } catch {
    errorMsg.value = 'Error al cargar los ejércitos.';
  } finally {
    loading.value = false;
  }
}

async function onSelectB() {
  armyB.value = null;
  resetAllocations();
  loading.value = true;
  try {
    const d = await mapApi.getArmyDetail(selectedBId.value);
    armyB.value = d?.success ? { army: d.army, troops: d.troops } : null;
  } finally {
    loading.value = false;
  }
}

// ── Apply ──────────────────────────────────────────────────────────────────
async function applyTransfers() {
  applyError.value = '';
  applying.value   = true;
  const bId = parseInt(selectedBId.value || props.armyBId);
  try {
    // Troops: compare allocation vs original
    const troopsAtoB = [];
    const troopsBtoA = [];
    for (const ut of allUnitTypes.value) {
      const uid   = ut.unit_type_id;
      const delta = troopAllocA(uid) - rawQtyA(uid); // positive = B→A, negative = A→B
      if (delta > 0) troopsBtoA.push({ unit_type_id: uid, quantity:  delta });
      if (delta < 0) troopsAtoB.push({ unit_type_id: uid, quantity: -delta });
    }

    // Provisions
    const provAtoBFields = {};
    const provBtoAFields = {};
    for (const p of PROVISIONS) {
      const delta = provAllocA(p.key) - rawProvA(p.key);
      if (delta > 0) provBtoAFields[p.key] =  delta;
      if (delta < 0) provAtoBFields[p.key] = -delta;
    }

    const hasAtoB = troopsAtoB.length > 0 || Object.keys(provAtoBFields).length > 0;
    const hasBtoA = troopsBtoA.length > 0 || Object.keys(provBtoAFields).length > 0;

    if (!hasAtoB && !hasBtoA) { applyError.value = 'Sin cambios que aplicar.'; return; }

    let dissolved = false;
    if (hasAtoB) {
      const res = await mapApi.transferArmy(props.armyAId, bId, troopsAtoB, provAtoBFields);
      if (!res.success) { applyError.value = res.message; return; }
      if (res.dissolved_army_id) dissolved = true;
    }
    if (hasBtoA && !dissolved) {
      const res = await mapApi.transferArmy(bId, props.armyAId, troopsBtoA, provBtoAFields);
      if (!res.success) { applyError.value = res.message; return; }
      if (res.dissolved_army_id) dissolved = true;
    }

    emit('done');
    if (dissolved) {
      emit('close');
    } else {
      resetAllocations();
      await loadData();
    }
  } catch (e) {
    applyError.value = e?.response?.data?.message || 'Error al aplicar la transferencia.';
  } finally {
    applying.value = false;
  }
}

async function mergeAll() {
  // Set sliders to max then apply — uses existing /merge endpoint for clean dissolution
  merging.value    = true;
  applyError.value = '';
  try {
    const res = await mapApi.mergeArmies(props.armyAId, props.h3_index);
    if (!res.success) {
      applyError.value = res.message;
    } else {
      emit('done');
      emit('close');
    }
  } catch (e) {
    applyError.value = e?.response?.data?.message || 'Error al fusionar ejércitos.';
  } finally {
    merging.value = false;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
watch(() => props.show, (val) => {
  if (val) {
    selectedBId.value = props.armyBId || null;
    resetAllocations();
    loadData();
  }
}, { immediate: true });

function onKeydown(e) { if (e.key === 'Escape' && props.show) emit('close'); }
onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.atp-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.72);
  z-index: 3000;
  display: flex; align-items: center; justify-content: center;
}
.atp-box {
  background: #1a1a2e;
  border: 1.5px solid #4a3f6b;
  border-radius: 8px;
  width: min(620px, 96vw);
  max-height: 88vh;
  overflow-y: auto;
  display: flex; flex-direction: column;
  color: #e0d9f0; font-size: 13px;
}

/* ── Header ── */
.atp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 18px 10px;
  border-bottom: 1px solid #2e2550;
  background: #16122a; flex-shrink: 0;
}
.atp-header-left { display: flex; align-items: center; gap: 10px; }
.atp-icon { font-size: 19px; }
.atp-title { font-size: 15px; font-weight: 700; color: #c8b8f0; margin: 0; }
.atp-subtitle { font-size: 11px; color: #777; }
.atp-close {
  background: none; border: none; color: #777; font-size: 17px;
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
}
.atp-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

/* ── Army B selector ── */
.atp-selector-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 18px; background: rgba(255,255,255,0.03);
  border-bottom: 1px solid #2e2550;
}
.atp-selector-label { font-size: 12px; color: #999; }
.atp-selector {
  background: #0d0b1e; border: 1px solid #4a3f6b; color: #e0d9f0;
  border-radius: 4px; padding: 4px 8px; font-size: 12px;
}

/* ── Status ── */
.atp-loading, .atp-error { padding: 20px; text-align: center; color: #999; }
.atp-error { color: #ef9a9a; }
.atp-empty { padding: 8px 18px; color: #666; font-style: italic; font-size: 12px; }

/* ── Army name headers ── */
.atp-army-headers {
  display: flex; justify-content: space-between;
  padding: 9px 18px 7px;
  border-bottom: 1px solid #2e2550;
}
.atp-army-label {
  font-weight: 700; font-size: 13px;
  display: flex; align-items: center; gap: 5px;
}
.atp-army-label.army-a { color: #7eb8f7; }
.atp-army-label.army-b { color: #f78787; }
.atp-garrison-tag {
  font-size: 9px; background: #2a3f5f; border: 1px solid #607d9e;
  color: #9ecaff; border-radius: 3px; padding: 1px 4px; letter-spacing: 0.5px;
}

/* ── Section label ── */
.atp-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: 1px;
  color: #555; padding: 9px 18px 3px; text-transform: uppercase;
}

/* ── Rows ── */
.atp-rows { padding: 0 18px 8px; display: flex; flex-direction: column; gap: 10px; }

.atp-row {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex; flex-direction: column; gap: 6px;
}

.atp-row-title {
  display: flex; justify-content: space-between; align-items: baseline;
}
.atp-row-name { font-size: 12px; font-weight: 600; color: #d0c8e8; }
.atp-row-total { font-size: 10px; color: #666; }

/* ── Slider row ── */
.atp-slider-row {
  display: flex; align-items: center; gap: 10px;
}
.atp-val {
  font-size: 13px; font-weight: 700; min-width: 38px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.atp-val.army-a { color: #7eb8f7; text-align: left; }
.atp-val.army-b { color: #f78787; text-align: right; }

.atp-slider-wrap { flex: 1; }

.atp-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 7px;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.atp-slider:disabled { opacity: 0.3; cursor: not-allowed; }

/* Thumb — Webkit */
.atp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #e0d9f0;
  border: 2px solid #8870d0;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.atp-slider::-webkit-slider-thumb:hover { background: #fff; }

/* Thumb — Firefox */
.atp-slider::-moz-range-thumb {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #e0d9f0;
  border: 2px solid #8870d0;
  cursor: pointer;
}

/* ── Textbox row ── */
.atp-input-row {
  display: flex; align-items: center; gap: 8px;
}
.atp-input-label { font-size: 11px; color: #7eb8f7; white-space: nowrap; }
.atp-num-input {
  width: 72px;
  background: #0d0b1e; border: 1px solid #4a3f6b; color: #e0d9f0;
  border-radius: 4px; padding: 3px 6px; font-size: 12px; text-align: center;
}
.atp-num-input:focus { outline: none; border-color: #8870d0; }

/* ── Error / Footer ── */
.atp-apply-error {
  margin: 0 18px 8px;
  padding: 6px 10px;
  background: rgba(183,28,28,0.2); border: 1px solid #b71c1c;
  border-radius: 4px; color: #ef9a9a; font-size: 12px;
}
.atp-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 11px 18px;
  border-top: 1px solid #2e2550;
  background: #16122a; flex-shrink: 0;
}
.atp-btn {
  padding: 6px 13px; border: none; border-radius: 5px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.atp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.atp-btn-reset { background: #2d2450; color: #c8b8f0; border: 1px solid #5040a0; }
.atp-btn-reset:hover:not(:disabled) { background: #3d3460; }
.atp-btn-merge { background: #5a2a2a; color: #ffb3b3; border: 1px solid #8b3a3a; }
.atp-btn-merge:hover:not(:disabled) { background: #6e3333; }
.atp-btn-apply { background: #1e4d2e; color: #a5d6b3; border: 1px solid #2e7d50; }
.atp-btn-apply:hover:not(:disabled) { background: #265d38; }

/* ── Transition ── */
.atp-fade-enter-active, .atp-fade-leave-active { transition: opacity 0.2s; }
.atp-fade-enter-from, .atp-fade-leave-to { opacity: 0; }
</style>
