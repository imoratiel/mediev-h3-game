<template>
  <div class="eco-panel">

    <!-- Resource Summary -->
    <section class="eco-section">
      <h4 class="eco-section-title">📦 Recursos Totales</h4>
      <div v-if="loading" class="eco-loading">Cargando...</div>
      <div v-else-if="error" class="eco-error">❌ {{ error }}</div>
      <template v-else>
        <div class="eco-resources-grid">
          <div class="eco-res-item">
            <span class="eco-res-icon">🌾</span>
            <span class="eco-res-label">Comida</span>
            <span class="eco-res-val">{{ fmt(summary.total_food) }}</span>
          </div>
          <div class="eco-res-item">
            <span class="eco-res-icon">🌲</span>
            <span class="eco-res-label">Madera</span>
            <span class="eco-res-val">{{ fmt(summary.total_wood) }}</span>
          </div>
          <div class="eco-res-item">
            <span class="eco-res-icon">⛰️</span>
            <span class="eco-res-label">Piedra</span>
            <span class="eco-res-val">{{ fmt(summary.total_stone) }}</span>
          </div>
          <div class="eco-res-item">
            <span class="eco-res-icon">⛏️</span>
            <span class="eco-res-label">Hierro</span>
            <span class="eco-res-val">{{ fmt(summary.total_iron) }}</span>
          </div>
          <div class="eco-res-item">
            <span class="eco-res-icon">💰</span>
            <span class="eco-res-label">Oro (feudos)</span>
            <span class="eco-res-val eco-gold">{{ fmt(summary.total_gold) }}</span>
          </div>
          <div class="eco-res-item">
            <span class="eco-res-icon">👥</span>
            <span class="eco-res-label">Población</span>
            <span class="eco-res-val">{{ fmt(summary.total_population) }}</span>
          </div>
        </div>
        <p class="eco-fiefs-note">{{ summary.fief_count }} feudo{{ summary.fief_count !== 1 ? 's' : '' }} bajo tu dominio</p>
      </template>
    </section>

    <!-- Tax Settings -->
    <section class="eco-section">
      <h4 class="eco-section-title">💰 Impuesto Fiscal</h4>
      <p class="eco-hint">
        Cada turno, el <strong>{{ localTaxRate }}%</strong> del oro almacenado en cada feudo
        pasa al tesoro real.
      </p>
      <div class="eco-slider-row">
        <span class="eco-slider-label">1%</span>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          v-model.number="localTaxRate"
          class="eco-slider"
          :style="{ '--pct': sliderPct }"
          :disabled="saving"
        />
        <span class="eco-slider-label">10%</span>
      </div>
      <div class="eco-slider-value">Tasa actual: <strong>{{ localTaxRate }}%</strong></div>
      <div v-if="!loading && !error" class="eco-estimate">
        Recaudación estimada próximo turno:
        <strong class="eco-gold">+{{ fmt(estimatedTax) }} 💰</strong>
      </div>
    </section>

    <!-- Tithe Settings -->
    <section class="eco-section">
      <h4 class="eco-section-title">⛪ Diezmo</h4>
      <p class="eco-hint">
        Cuando está activo, el <strong>10%</strong> de todos los recursos
        de los feudos secundarios se transfiere automáticamente a la capital cada turno.
      </p>
      <label class="eco-toggle-row">
        <span class="eco-toggle-label">{{ localTitheActive ? 'Diezmo activo' : 'Diezmo inactivo' }}</span>
        <div
          class="eco-toggle"
          :class="{ 'eco-toggle--on': localTitheActive }"
          @click="!saving && (localTitheActive = !localTitheActive)"
          :title="saving ? '' : (localTitheActive ? 'Desactivar diezmo' : 'Activar diezmo')"
        >
          <div class="eco-toggle-thumb"></div>
        </div>
      </label>
    </section>

    <!-- Save Button -->
    <div class="eco-actions">
      <button
        class="eco-save-btn"
        :disabled="saving || !isDirty"
        @click="saveSettings"
      >
        <span v-if="saving">⏳ Guardando...</span>
        <span v-else-if="saveOk">✅ Guardado</span>
        <span v-else>💾 Guardar Configuración</span>
      </button>
    </div>

    <div v-if="saveError" class="eco-save-error">❌ {{ saveError }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getEconomySummary, updateEconomySettings } from '../services/mapApi.js';

// ── State ────────────────────────────────────────────────
const loading = ref(true);
const error   = ref('');
const summary  = ref({
  fief_count: 0,
  total_food: 0, total_wood: 0, total_stone: 0,
  total_iron: 0, total_gold: 0, total_population: 0,
});

// Settings loaded from server
const serverTaxRate     = ref(10);
const serverTitheActive = ref(false);

// Local editable copies
const localTaxRate     = ref(10);
const localTitheActive = ref(false);

const saving   = ref(false);
const saveOk   = ref(false);
const saveError = ref('');

// ── Computed ──────────────────────────────────────────────
const estimatedTax = computed(() =>
  Math.floor(summary.value.total_gold * localTaxRate.value / 100)
);

// Slider fill: maps range [1,10] → [0%,100%]
const sliderPct = computed(() => `${((localTaxRate.value - 1) / 9 * 100).toFixed(1)}%`);

const isDirty = computed(() =>
  localTaxRate.value !== serverTaxRate.value ||
  localTitheActive.value !== serverTitheActive.value
);

// ── Methods ───────────────────────────────────────────────
const fmt = (n) => Number(n ?? 0).toLocaleString('es-ES');

async function fetchSummary() {
  loading.value = true;
  error.value   = '';
  try {
    const data = await getEconomySummary();
    if (data.success) {
      summary.value          = data.summary;
      serverTaxRate.value    = data.settings.tax_rate;
      serverTitheActive.value = data.settings.tithe_active;
      localTaxRate.value     = data.settings.tax_rate;
      localTitheActive.value = data.settings.tithe_active;
    } else {
      error.value = data.message || 'Error al cargar datos';
    }
  } catch (err) {
    error.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  if (!isDirty.value || saving.value) return;
  saving.value   = true;
  saveOk.value   = false;
  saveError.value = '';
  try {
    const payload = {};
    if (localTaxRate.value !== serverTaxRate.value)
      payload.tax_rate = localTaxRate.value;
    if (localTitheActive.value !== serverTitheActive.value)
      payload.tithe_active = localTitheActive.value;

    const data = await updateEconomySettings(payload);
    if (data.success) {
      serverTaxRate.value    = localTaxRate.value;
      serverTitheActive.value = localTitheActive.value;
      saveOk.value = true;
      setTimeout(() => { saveOk.value = false; }, 2500);
    } else {
      saveError.value = data.message || 'Error al guardar';
    }
  } catch (err) {
    saveError.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    saving.value = false;
  }
}

// Reset saveOk if user edits again
watch([localTaxRate, localTitheActive], () => { saveOk.value = false; });

onMounted(fetchSummary);
</script>

<style scoped>
.eco-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  color: #e8d5b5;
  font-family: 'Georgia', serif;
  font-size: 0.85rem;
}

/* Section */
.eco-section {
  padding: 14px 16px;
  border-bottom: 1px solid #3d2e1a;
}
.eco-section:last-of-type { border-bottom: none; }

.eco-section-title {
  margin: 0 0 10px;
  font-size: 0.72rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #8b7355;
  font-weight: 700;
  font-family: sans-serif;
}

/* Loading / error */
.eco-loading { color: #8b7355; font-style: italic; font-size: 0.82rem; }
.eco-error   { color: #ef4444; font-size: 0.82rem; }

/* Resources grid */
.eco-resources-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.eco-res-item {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(0,0,0,0.25);
  border: 1px solid #3d2e1a;
  border-radius: 6px;
  padding: 8px 10px;
}
.eco-res-icon  { font-size: 1rem; flex-shrink: 0; }
.eco-res-label { font-size: 0.72rem; color: #8b7355; flex: 1; font-family: sans-serif; }
.eco-res-val   { font-size: 0.9rem; font-weight: 700; color: #e8d5b5; }
.eco-gold      { color: #fbbf24 !important; }

.eco-fiefs-note {
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: #8b7355;
  font-style: italic;
  font-family: sans-serif;
}

/* Hint text */
.eco-hint {
  margin: 0 0 10px;
  font-size: 0.78rem;
  color: #a89070;
  line-height: 1.5;
  font-family: sans-serif;
}

/* Slider */
.eco-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.eco-slider-label {
  font-size: 0.75rem;
  color: #8b7355;
  font-family: sans-serif;
  min-width: 20px;
  text-align: center;
}
.eco-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, #c9a84c 0%, #c9a84c calc(var(--pct, 44%) ), #3d2e1a calc(var(--pct, 44%)));
  outline: none;
  cursor: pointer;
}
.eco-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #fbbf24;
  border: 2px solid #1a1208;
  cursor: pointer;
}
.eco-slider:disabled { opacity: 0.5; cursor: not-allowed; }

.eco-slider-value {
  margin-top: 6px;
  font-size: 0.8rem;
  color: #a89070;
  font-family: sans-serif;
}

.eco-estimate {
  margin-top: 8px;
  font-size: 0.82rem;
  color: #a89070;
  font-family: sans-serif;
}

/* Toggle */
.eco-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}
.eco-toggle-label {
  font-size: 0.82rem;
  color: #a89070;
  font-family: sans-serif;
}
.eco-toggle {
  width: 44px;
  height: 24px;
  border-radius: 12px;
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
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #8b7355;
  transition: left 0.2s, background 0.2s;
}
.eco-toggle--on .eco-toggle-thumb {
  left: 23px;
  background: #fbbf24;
}

/* Actions */
.eco-actions {
  padding: 14px 16px 6px;
}
.eco-save-btn {
  width: 100%;
  padding: 10px;
  background: #2d1f0a;
  border: 1px solid #c9a84c;
  border-radius: 6px;
  color: #fbbf24;
  font-size: 0.82rem;
  font-family: 'Georgia', serif;
  letter-spacing: 1px;
  cursor: pointer;
  transition: background 0.15s;
}
.eco-save-btn:hover:not(:disabled) { background: #3d2d10; }
.eco-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.eco-save-error {
  padding: 0 16px 12px;
  font-size: 0.8rem;
  color: #f87171;
  font-family: sans-serif;
}
</style>
