<template>
  <div class="eco-overlay">
    <div class="eco-container">

      <!-- Header -->
      <div class="eco-header">
        <h1 class="eco-title">💰 Panel de Economía</h1>
        <button class="eco-close" @click="$emit('close')" title="Cerrar">✕</button>
      </div>

      <!-- Content -->
      <div class="eco-content">

        <!-- Left Sidebar -->
        <div class="eco-sidebar">

          <!-- Resource Summary -->
          <div class="eco-card">
            <h4 class="eco-card-title">📦 Recursos Totales</h4>
            <div v-if="loadingSummary" class="eco-loading">Cargando...</div>
            <div v-else-if="summaryError" class="eco-error">{{ summaryError }}</div>
            <template v-else>
              <div class="res-list">
                <div class="res-row"><span>🌾 Comida</span><strong>{{ fmt(summary.total_food) }}</strong></div>
                <!-- DISABLED: wood/stone/iron hidden
                <div class="res-row"><span>🌲 Madera</span><strong>{{ fmt(summary.total_wood) }}</strong></div>
                <div class="res-row"><span>⛰️ Piedra</span><strong>{{ fmt(summary.total_stone) }}</strong></div>
                <div class="res-row"><span>⛏️ Hierro</span><strong>{{ fmt(summary.total_iron) }}</strong></div>
                -->
                <div class="res-row eco-gold-row"><span>💰 Oro (territorios)</span><strong class="gold">{{ fmt(summary.total_gold) }}</strong></div>
                <div class="res-row"><span>👥 Población</span><strong>{{ summary.total_population ?? 0 }}</strong></div>
              </div>
              <p class="eco-fiefs-note">{{ summary.fief_count }} territorio{{ summary.fief_count !== 1 ? 's' : '' }} bajo tu dominio</p>
            </template>
          </div>

          <!-- Global Tax Rate -->
          <div class="eco-card">
            <h4 class="eco-card-title">📊 Impuesto Global</h4>
            <p class="eco-hint">Se aplica a todas las comarcas.</p>
            <div class="eco-tax-row">
              <input type="range" min="1" max="15" step="1"
                v-model.number="localTaxRate" class="eco-tax-slider" />
              <span class="eco-tax-value">{{ localTaxRate }}%</span>
            </div>
            <div class="eco-tax-marks">
              <span>1%</span><span>5%</span><span>10%</span><span>15%</span>
            </div>
            <button class="eco-save-btn" style="margin-top:10px"
              :disabled="savingTax || !isDirtyTax" @click="saveTax">
              <span v-if="savingTax">⏳ Emitiendo...</span>
              <span v-else-if="saveOkTax">✅ Edicto emitido</span>
              <span v-else>📜 Edicto Fiscal</span>
            </button>
            <div v-if="saveErrTax" class="eco-save-error">❌ {{ saveErrTax }}</div>
          </div>

          <!-- Tithe Settings -->
          <div class="eco-card">
            <h4 class="eco-card-title">⛪ {{ titheLabel }}</h4>
            <p class="eco-hint">
              El <strong>10%</strong> de la comida de cada centuria
              se transfiere a la capital cada mes.
            </p>
            <label class="eco-toggle-row">
              <span class="eco-toggle-label">{{ localTitheActive ? `${titheLabel} activo` : `${titheLabel} inactivo` }}</span>
              <div class="eco-toggle" :class="{ 'eco-toggle--on': localTitheActive }"
                @click="!savingTithe && (localTitheActive = !localTitheActive)">
                <div class="eco-toggle-thumb"></div>
              </div>
            </label>
            <button class="eco-save-btn" style="margin-top:10px"
              :disabled="savingTithe || !isDirtyTithe" @click="saveTithe">
              <span v-if="savingTithe">⏳ Emitiendo...</span>
              <span v-else-if="saveOkTithe">✅ Edicto emitido</span>
              <span v-else>⛪ Edicto del Diezmo</span>
            </button>
            <div v-if="saveErrTithe" class="eco-save-error">❌ {{ saveErrTithe }}</div>
          </div>

        </div>

        <!-- Comarcas List -->
        <div class="eco-main">
          <div class="eco-table-header">
            <h3 class="eco-table-title">🏛️ Tus Comarcas</h3>
            <p class="eco-table-hint">
              Gestiona la recaudación de cada Comarca de forma independiente.
            </p>
          </div>

          <div v-if="loadingDivisions" class="eco-loading eco-loading-center">Cargando comarcas...</div>
          <div v-else-if="divisionsError" class="eco-error eco-error-center">{{ divisionsError }}</div>
          <div v-else-if="divisions.length === 0" class="eco-empty">
            Aún no has proclamado ninguna Comarca.
          </div>
          <div v-else class="pagus-list">
            <div
              v-for="div in divisions"
              :key="div.id"
              class="pagus-card"
            >
              <!-- Card header -->
              <div class="pagus-header">
                <div class="pagus-rank-badge">{{ div.territory_name }}</div>
                <h4 class="pagus-name">{{ div.name }}</h4>
                <span class="pagus-title">{{ div.rank_title_male }}</span>
              </div>

              <!-- Stats row -->
              <div class="pagus-stats">
                <div class="pagus-stat">
                  <span class="pstat-label">🏰 Territorios</span>
                  <span class="pstat-value">{{ div.fief_count }}</span>
                </div>
                <div class="pagus-stat">
                  <span class="pstat-label">👥 Población</span>
                  <span class="pstat-value">{{ div.total_population ?? 0 }}</span>
                </div>
                <div class="pagus-stat">
                  <span class="pstat-label">💰 Oro</span>
                  <span class="pstat-value gold">{{ fmt(div.total_gold) }}</span>
                </div>
                <div class="pagus-stat">
                  <span class="pstat-label">🌾 Comida</span>
                  <span class="pstat-value">{{ fmt(div.total_food) }}</span>
                </div>
              </div>

              <!-- Tax slider -->
              <div class="pagus-tax">
                <div class="pagus-tax-header">
                  <span class="pagus-tax-label">{{ taxLabelFor(div.rank_culture_id) }} <span class="pagus-tax-hint">(Impuestos)</span></span>
                  <span class="pagus-tax-rate">{{ divTaxRates[div.id] ?? div.tax_rate }}%</span>
                </div>
                <input
                  type="range" min="1" max="15" step="1"
                  :value="divTaxRates[div.id] ?? div.tax_rate"
                  @input="divTaxRates[div.id] = Number($event.target.value)"
                  class="pagus-tax-slider"
                />
                <div class="pagus-tax-hints"><span>1%</span><span>15%</span></div>
                <div v-if="divTaxMsg[div.id]" class="pagus-tax-msg" :class="divTaxMsg[div.id].type">
                  {{ divTaxMsg[div.id].text }}
                </div>
                <button
                  class="pagus-tax-btn"
                  :disabled="divTaxSaving[div.id] || (divTaxRates[div.id] ?? div.tax_rate) == div.tax_rate"
                  @click="saveDivisionTax(div)"
                >
                  {{ divTaxSaving[div.id] ? 'Guardando...' : `Aplicar ${taxLabelFor(div.rank_culture_id)}` }}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue';
import { getEconomySummary, updateEconomySettings, getPlayerDivisions, updateDivisionTax } from '../services/mapApi.js';
import { getTaxLabel, getTitheLabel } from '../utils/culturalLabels.js';

const props = defineProps({
  playerCultureId: { type: Number, default: null },
});

const taxLabelFor   = (cultureId) => getTaxLabel(cultureId);
const titheLabel    = computed(() => getTitheLabel(props.playerCultureId));

const emit = defineEmits(['close', 'gold-updated']);

// ── Summary state ─────────────────────────────────────────
const loadingSummary = ref(true);
const summaryError   = ref('');
const summary = ref({
  fief_count: 0,
  total_food: 0, total_wood: 0, total_stone: 0,
  total_iron: 0, total_gold: 0, total_population: 0,
});

const serverTitheActive = ref(false);
const localTitheActive  = ref(false);
const serverTaxRate     = ref(10);
const localTaxRate      = ref(10);

const savingTax   = ref(false);
const saveOkTax   = ref(false);
const saveErrTax  = ref('');
const savingTithe = ref(false);
const saveOkTithe = ref(false);
const saveErrTithe = ref('');

// ── Divisions (Pagus) state ────────────────────────────────
const loadingDivisions = ref(true);
const divisionsError   = ref('');
const divisions        = ref([]);
const playerGold       = ref(0);

// Per-division tax editing: { [id]: rate }
const divTaxRates  = reactive({});
const divTaxSaving = reactive({});
const divTaxMsg    = reactive({});

// ── Computed ──────────────────────────────────────────────
const isDirtyTax   = computed(() => localTaxRate.value !== serverTaxRate.value);
const isDirtyTithe = computed(() => localTitheActive.value !== serverTitheActive.value);
// ── Helpers ───────────────────────────────────────────────
const fmt = (n) => Number(n ?? 0).toLocaleString('es-ES');

// ── Methods ───────────────────────────────────────────────
async function fetchSummary() {
  loadingSummary.value = true;
  summaryError.value   = '';
  try {
    const data = await getEconomySummary();
    if (data.success) {
      summary.value           = data.summary;
      playerGold.value        = data.player_gold ?? 0;
      serverTitheActive.value = data.settings.tithe_active;
      localTitheActive.value  = data.settings.tithe_active;
      serverTaxRate.value     = data.settings.tax_rate ?? 10;
      localTaxRate.value      = data.settings.tax_rate ?? 10;
    } else {
      summaryError.value = data.message || 'Error al cargar datos';
    }
  } catch (err) {
    summaryError.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    loadingSummary.value = false;
  }
}

async function fetchDivisions() {
  loadingDivisions.value = true;
  divisionsError.value   = '';
  try {
    const data = await getPlayerDivisions();
    if (data.success) {
      divisions.value = data.divisions ?? [];
    } else {
      divisionsError.value = data.message || 'Error al cargar comarcas';
    }
  } catch (err) {
    divisionsError.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    loadingDivisions.value = false;
  }
}

async function saveDivisionTax(div) {
  const rate = divTaxRates[div.id] ?? div.tax_rate;
  divTaxSaving[div.id] = true;
  divTaxMsg[div.id]    = null;
  try {
    await updateDivisionTax(div.id, rate);
    div.tax_rate         = rate;
    divTaxMsg[div.id]    = { type: 'success', text: `${taxLabelFor(div.rank_culture_id)} actualizado: ${rate}%` };
    setTimeout(() => { divTaxMsg[div.id] = null; }, 2500);
  } catch (err) {
    divTaxMsg[div.id] = { type: 'error', text: err?.response?.data?.message || 'Error al guardar.' };
  } finally {
    divTaxSaving[div.id] = false;
  }
}

async function saveTax() {
  if (!isDirtyTax.value || savingTax.value) return;
  savingTax.value  = true;
  saveOkTax.value  = false;
  saveErrTax.value = '';
  try {
    const data = await updateEconomySettings({ tax_rate: localTaxRate.value });
    if (data.success) {
      serverTaxRate.value = localTaxRate.value;
      // Sincronizar sliders de cada pagus en la UI
      divisions.value.forEach(div => {
        div.tax_rate = localTaxRate.value;
        divTaxRates[div.id] = localTaxRate.value;
      });
      saveOkTax.value = true;
      setTimeout(() => { saveOkTax.value = false; }, 2500);
    } else {
      saveErrTax.value = data.message || 'Error al guardar';
    }
  } catch (err) {
    saveErrTax.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    savingTax.value = false;
  }
}

async function saveTithe() {
  if (!isDirtyTithe.value || savingTithe.value) return;
  savingTithe.value  = true;
  saveOkTithe.value  = false;
  saveErrTithe.value = '';
  try {
    const data = await updateEconomySettings({ tithe_active: localTitheActive.value });
    if (data.success) {
      serverTitheActive.value = localTitheActive.value;
      saveOkTithe.value = true;
      setTimeout(() => { saveOkTithe.value = false; }, 2500);
    } else {
      saveErrTithe.value = data.message || 'Error al guardar';
    }
  } catch (err) {
    saveErrTithe.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    savingTithe.value = false;
  }
}

watch(localTitheActive, () => { saveOkTithe.value = false; });
watch(localTaxRate,     () => { saveOkTax.value   = false; });

onMounted(() => {
  fetchSummary();
  fetchDivisions();
});
</script>

<style scoped>
/* ── Overlay ─────────────────────────────────────────────── */
.eco-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(5, 3, 1, 0.88);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 20px;
}

.eco-container {
  background: radial-gradient(ellipse at top left, #1e1508 0%, #120d05 100%);
  border: 1px solid #5d4e37;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1200px;
  overflow: hidden;
  box-shadow: 0 0 60px rgba(0,0,0,0.8), 0 0 0 1px #3d2e1a;
}

/* ── Header ──────────────────────────────────────────────── */
.eco-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #3d2e1a;
  background: rgba(0,0,0,0.3);
  flex-shrink: 0;
}

.eco-title {
  font-family: 'Georgia', serif;
  font-size: 1.3rem;
  color: #c9a84c;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin: 0;
  text-shadow: 0 0 20px rgba(201,168,76,0.3);
}

.eco-close {
  background: none;
  border: 1px solid #5d4e37;
  border-radius: 6px;
  color: #8b7355;
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.eco-close:hover { background: rgba(255,255,255,0.05); color: #c9a84c; border-color: #c9a84c; }

/* ── Layout ──────────────────────────────────────────────── */
.eco-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── Sidebar ─────────────────────────────────────────────── */
.eco-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid #3d2e1a;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.eco-card {
  padding: 16px;
  border-bottom: 1px solid #2a1f0e;
}
.eco-card:last-child { border-bottom: none; }

.eco-card-title {
  font-family: sans-serif;
  font-size: 0.68rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #7c5c1e;
  font-weight: 700;
  margin: 0 0 12px;
}

/* Resources list */
.res-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.res-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
  color: #a89070;
  font-family: sans-serif;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.res-row strong { color: #e8d5b5; font-size: 0.85rem; }
.eco-gold-row strong.gold { color: #fbbf24; }

.eco-fiefs-note {
  margin: 10px 0 0;
  font-size: 0.72rem;
  color: #5d4e37;
  font-style: italic;
  font-family: sans-serif;
}

/* Hint text */
.eco-hint {
  font-size: 0.77rem;
  color: #8b7355;
  line-height: 1.5;
  font-family: sans-serif;
  margin: 0 0 10px;
}
.eco-hint strong { color: #c9a84c; }

/* Slider */
.eco-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.eco-slider-label {
  font-size: 0.72rem;
  color: #5d4e37;
  font-family: sans-serif;
  min-width: 20px;
  text-align: center;
}
.eco-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 5px;
  border-radius: 3px;
  background: linear-gradient(to right, #c9a84c 0%, #c9a84c calc(var(--pct, 44%)), #3d2e1a calc(var(--pct, 44%)));
  outline: none;
  cursor: pointer;
}
.eco-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fbbf24;
  border: 2px solid #120d05;
  cursor: pointer;
}
.eco-slider:disabled { opacity: 0.5; cursor: not-allowed; }

.eco-slider-value {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #8b7355;
  font-family: sans-serif;
}
.eco-estimate {
  margin-top: 6px;
  font-size: 0.78rem;
  color: #8b7355;
  font-family: sans-serif;
}
.eco-estimate .gold { color: #fbbf24; }

/* Toggle */
.eco-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}
.eco-toggle-label {
  font-size: 0.80rem;
  color: #a89070;
  font-family: sans-serif;
}
.eco-toggle {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #3d2e1a;
  border: 1px solid #5d4e37;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.eco-toggle--on { background: #7c5c1e; border-color: #c9a84c; }
.eco-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #8b7355;
  transition: left 0.2s, background 0.2s;
}
.eco-toggle--on .eco-toggle-thumb { left: 21px; background: #fbbf24; }

/* Actions card */
.eco-actions-card { padding-top: 12px; }
.eco-save-btn {
  width: 100%;
  padding: 9px;
  background: #2d1f0a;
  border: 1px solid #c9a84c;
  border-radius: 6px;
  color: #fbbf24;
  font-size: 0.80rem;
  font-family: 'Georgia', serif;
  letter-spacing: 1px;
  cursor: pointer;
  transition: background 0.15s;
}
.eco-save-btn:hover:not(:disabled) { background: #3d2d10; }
.eco-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.eco-save-error {
  margin-top: 8px;
  font-size: 0.78rem;
  color: #f87171;
  font-family: sans-serif;
}

/* ── Main table area ─────────────────────────────────────── */
.eco-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 12px;
}

.eco-table-header {}
.eco-table-title {
  font-family: 'Georgia', serif;
  font-size: 1rem;
  color: #c9a84c;
  margin: 0 0 4px;
  letter-spacing: 1px;
}
.eco-table-hint {
  font-family: sans-serif;
  font-size: 0.78rem;
  color: #8b7355;
  margin: 0;
}
.eco-table-hint strong { color: #c9a84c; }

.eco-table-wrap {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #3d2e1a;
  border-radius: 8px;
}

.eco-table {
  width: 100%;
  border-collapse: collapse;
  font-family: sans-serif;
  table-layout: fixed;
}

/* Column widths */
.col-feudo   { width: 180px; }
.col-terreno  { width: 110px; }
.col-pop      { width: 80px; }
.col-food     { width: 90px; }
.col-autonomy { width: 90px; }
.col-farm     { width: 90px; }
.col-cost     { width: 110px; }
.col-action   { width: 110px; }

.autonomy-val      { font-weight: 600; }
.autonomy-val.autonomy-ok  { color: #4caf50; }
.autonomy-val.autonomy-low { color: #ff6b6b; }

.eco-table thead th {
  background: #1a1208;
  color: #7c5c1e;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 700;
  padding: 10px 12px;
  border-bottom: 1px solid #3d2e1a;
  border-right: 1px solid #2a1f0e;
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 1;
}
.eco-table thead th:last-child { border-right: none; }

.eco-table tbody tr {
  border-bottom: 1px solid #2a1f0e;
  transition: background 0.1s;
}
.eco-table tbody tr:hover { background: rgba(201,168,76,0.04); }
.eco-table tbody tr.row-capital { background: rgba(201,168,76,0.06); }
.eco-table tbody tr.row-capital:hover { background: rgba(201,168,76,0.10); }

.eco-table tbody td {
  padding: 9px 12px;
  border-right: 1px solid #2a1f0e;
  color: #c8b898;
  font-size: 0.82rem;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eco-table tbody td:last-child { border-right: none; }

.td-feudo { color: #e8d5b5; }
.td-terrain { color: #a89070; font-size: 0.78rem; }
.td-number { text-align: right; color: #a89070; font-variant-numeric: tabular-nums; }

.capital-badge { margin-right: 4px; }
.feudo-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.farm-level { font-weight: 700; color: #c8b898; }
.farm-level.level-max { color: #fbbf24; }

.level-max-text { font-size: 0.75rem; color: #5d4e37; }
.no-farm-text { font-size: 0.75rem; color: #5d4e37; }
.cost-val { font-variant-numeric: tabular-nums; color: #a89070; }

/* Upgrade button */
.upgrade-btn {
  padding: 5px 10px;
  background: #2d1f0a;
  border: 1px solid #c9a84c;
  border-radius: 5px;
  color: #fbbf24;
  font-size: 0.75rem;
  font-family: sans-serif;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.upgrade-btn:hover:not(:disabled) { background: #3d2d10; }
.upgrade-btn:disabled, .upgrade-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: #5d4e37;
  color: #8b7355;
}

/* Gold bar */
.eco-gold-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(0,0,0,0.25);
  border: 1px solid #3d2e1a;
  border-radius: 6px;
  flex-shrink: 0;
}
.eco-gold-label {
  font-family: sans-serif;
  font-size: 0.78rem;
  color: #8b7355;
}
.eco-gold-val {
  font-family: sans-serif;
  font-size: 0.95rem;
  font-weight: 700;
  color: #fbbf24;
}

/* Feedback messages */
.eco-upgrade-error {
  font-family: sans-serif;
  font-size: 0.80rem;
  color: #f87171;
  padding: 6px 10px;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 5px;
  flex-shrink: 0;
}
.eco-upgrade-ok {
  font-family: sans-serif;
  font-size: 0.80rem;
  color: #86efac;
  padding: 6px 10px;
  background: rgba(134,239,172,0.08);
  border: 1px solid rgba(134,239,172,0.2);
  border-radius: 5px;
  flex-shrink: 0;
}

.eco-loading { color: #8b7355; font-style: italic; font-size: 0.82rem; font-family: sans-serif; }
.eco-error   { color: #f87171; font-size: 0.82rem; font-family: sans-serif; }
.eco-loading-center, .eco-error-center {
  text-align: center;
  padding: 40px;
  flex: 1;
}

/* Terrain filter */
.terrain-filter-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.terrain-btn {
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid #3d2e1a;
  border-radius: 5px;
  color: #8b7355;
  font-family: sans-serif;
  font-size: 0.80rem;
  cursor: pointer;
  transition: all 0.12s;
}
.terrain-btn:hover { background: rgba(255,255,255,0.04); color: #c8b898; }
.terrain-btn.active {
  background: rgba(201,168,76,0.12);
  border-color: #c9a84c;
  color: #fbbf24;
  font-weight: 600;
}

/* ── Pagus cards ─────────────────────────────────────────── */
.pagus-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 4px;
}

.pagus-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid #3d2e1a;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pagus-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pagus-rank-badge {
  background: rgba(201,168,76,0.15);
  border: 1px solid #c9a84c55;
  border-radius: 4px;
  color: #c9a84c;
  font-size: 0.72rem;
  font-family: sans-serif;
  letter-spacing: 0.5px;
  padding: 2px 7px;
  text-transform: uppercase;
}
.pagus-name {
  font-family: 'Georgia', serif;
  font-size: 1rem;
  color: #e8d5a3;
  margin: 0;
  flex: 1;
}
.pagus-title {
  font-size: 0.75rem;
  color: #8b7355;
  font-style: italic;
}

.pagus-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.pagus-stat {
  background: rgba(0,0,0,0.2);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pstat-label {
  font-size: 0.70rem;
  color: #7a6a50;
  font-family: sans-serif;
}
.pstat-value {
  font-size: 0.88rem;
  color: #c8b898;
  font-weight: 600;
  font-family: 'Georgia', serif;
}
.pstat-value.gold { color: #f4c430; }

.pagus-tax {
  border-top: 1px solid #2a2010;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pagus-tax-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pagus-tax-label {
  font-size: 0.78rem;
  color: #a0916e;
  font-family: sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pagus-tax-hint {
  font-size: 0.70rem;
  color: #5a4a30;
  text-transform: none;
  letter-spacing: 0;
  font-style: italic;
}
.pagus-tax-rate {
  font-size: 0.95rem;
  color: #f4c430;
  font-weight: 700;
  font-family: 'Georgia', serif;
}
.pagus-tax-slider {
  width: 100%;
  accent-color: #c9a84c;
  cursor: pointer;
}
.pagus-tax-hints {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: #5a4a30;
  font-family: sans-serif;
}
.pagus-tax-msg {
  font-size: 0.76rem;
  font-family: sans-serif;
  padding: 4px 8px;
  border-radius: 4px;
}
.pagus-tax-msg.success { color: #6fcf97; background: rgba(111,207,151,0.08); }
.pagus-tax-msg.error   { color: #f87171; background: rgba(248,113,113,0.08); }

.pagus-tax-btn {
  align-self: flex-start;
  padding: 5px 14px;
  background: rgba(201,168,76,0.12);
  border: 1px solid #c9a84c55;
  border-radius: 5px;
  color: #c9a84c;
  font-size: 0.78rem;
  font-family: sans-serif;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: background 0.15s;
}
.pagus-tax-btn:hover:not(:disabled) { background: rgba(201,168,76,0.22); }
.pagus-tax-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.eco-empty {
  text-align: center;
  color: #5a4a30;
  font-style: italic;
  font-family: sans-serif;
  margin-top: 40px;
}

.eco-tax-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.eco-tax-slider {
  flex: 1;
  accent-color: #c5a059;
  cursor: pointer;
}
.eco-tax-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #c5a059;
  min-width: 38px;
  text-align: right;
}
.eco-tax-marks {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: rgba(197,160,89,0.5);
  margin-top: 2px;
}

/* ── Mobile ─────────────────────────────────────────────── */
@media (max-width: 768px), (max-height: 480px) and (orientation: landscape) {
  .eco-overlay {
    padding: 0;
    top: 48px;
  }

  .eco-container {
    border-radius: 0;
    border: none;
    max-width: 100%;
  }

  .eco-header {
    padding: 8px 12px;
  }

  .eco-title {
    font-size: 0.85rem;
    letter-spacing: 1px;
  }

  .eco-content {
    flex-direction: column;
    overflow-y: auto;
  }

  .eco-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #3d2e1a;
    overflow-y: visible;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0;
  }

  /* Ocultar recursos totales en móvil — prioridad al impuesto y diezmo */
  .eco-sidebar .eco-card:first-child {
    display: none;
  }

  /* Cards de impuesto y diezmo en horizontal */
  .eco-sidebar .eco-card {
    flex: 1 1 160px;
    padding: 10px 12px;
    border-right: 1px solid #3d2e1a;
  }

  .eco-card-title {
    font-size: 0.78rem;
    margin-bottom: 6px;
  }

  .eco-main {
    overflow-y: visible;
    padding: 12px;
    gap: 8px;
  }
}
</style>
