<template>
  <div class="game-overlay fuero-overlay" @click.self="$emit('close')">
    <div class="fuero-container">

      <!-- Header -->
      <div class="fuero-header">
        <div class="fuero-header-left">
          <span class="fuero-icon">📜</span>
          <div>
            <h2 class="fuero-title">Fueros y Leyes</h2>
            <p class="fuero-subtitle">{{ fiefName || h3_index }}</p>
          </div>
        </div>
        <button class="fuero-close" @click="$emit('close')" title="Cerrar">✕</button>
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="fuero-loading">
        <div class="fuero-spinner"></div>
        <p>Consultando los registros del feudo...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="fuero-error">
        <p>⚠️ {{ error }}</p>
        <button class="fuero-btn fuero-btn-secondary" @click="fetchLaws">Reintentar</button>
      </div>

      <!-- CASE A: Fief already belongs to a division -->
      <div v-else-if="lawsData && lawsData.has_division" class="fuero-body">
        <div class="fuero-division-card">
          <div class="division-rank-badge">{{ lawsData.division.rank.territory_name }}</div>
          <h3 class="division-name">{{ lawsData.division.name }}</h3>

          <div class="division-stats">
            <div class="division-stat">
              <span class="stat-label">Titulo nobiliario</span>
              <span class="stat-value">{{ lawsData.division.rank.title_male }}</span>
            </div>
            <div class="division-stat">
              <span class="stat-label">Capital</span>
              <span class="stat-value stat-mono">{{ lawsData.division.capital_h3 }}</span>
            </div>
            <div class="division-stat">
              <span class="stat-label">Feudos</span>
              <span class="stat-value">{{ lawsData.division.fief_count }} / {{ lawsData.division.rank.max_fiefs_limit }}</span>
            </div>
          </div>

        </div>

        <div class="fuero-info-note">
          <span>🏰</span>
          <span>Este feudo forma parte del <strong>{{ lawsData.division.name }}</strong>. Las leyes y fueros que rigen este territorio han sido proclamados por su senor.</span>
        </div>
      </div>

      <!-- CASE B: Free fief — can found a division -->
      <div v-else-if="lawsData && !lawsData.has_division" class="fuero-body">

        <!-- Not enough contiguous fiefs warning -->
        <div v-if="!lawsData.can_found" class="fuero-warn">
          <p>⚠️ Necesitas al menos <strong>{{ lawsData.rank.min_fiefs_required }}</strong> feudos contiguos libres para fundar un {{ lawsData.rank.territory_name }}. Tienes {{ lawsData.contiguous_fiefs.length }} disponibles.</p>
        </div>

        <template v-else>
          <!-- Rank info -->
          <div class="fuero-rank-banner">
            <div class="rank-banner-icon">⚜️</div>
            <div>
              <p class="rank-banner-title">Declarar fueros para el <strong>{{ lawsData.suggested_name }}</strong></p>
              <p class="rank-banner-sub">Maximo {{ lawsData.rank.max_fiefs_limit }} feudos por {{ lawsData.rank.territory_name }}</p>
            </div>
          </div>

          <!-- Fief count summary -->
          <div class="fuero-fiefs-summary">
            <span class="fiefs-count-badge">{{ selectedFiefs.size }}</span>
            <span>El nuevo {{ lawsData.rank.territory_name }} constara de <strong>{{ selectedFiefs.size }} feudos</strong></span>
          </div>

          <!-- Noble title preview -->
          <div class="fuero-name-preview">
            <span class="fuero-label">Tu titulo</span>
            <span class="fuero-name-value">Ahora seras {{ nobleArticle }} {{ nobleTitle }} {{ nameGenitivo }}</span>
          </div>

          <!-- Validation error -->
          <p v-if="selectedFiefs.size < lawsData.rank.min_fiefs_required" class="fuero-error-inline">
            ⚠️ No hay suficientes feudos contiguos ({{ selectedFiefs.size }}/{{ lawsData.rank.min_fiefs_required }}).
          </p>

          <!-- Result message -->
          <div v-if="resultMsg" class="fuero-result" :class="resultMsg.type">
            {{ resultMsg.text }}
          </div>

          <!-- Confirm button -->
          <div class="fuero-footer">
            <button
              class="fuero-btn fuero-btn-primary"
              :disabled="proclaiming || selectedFiefs.size < lawsData.rank.min_fiefs_required"
              @click="proclaim"
            >
              <span v-if="proclaiming">Proclamando...</span>
              <span v-else>⚜️ Proclamar {{ lawsData.rank.territory_name }} ({{ selectedFiefs.size }}/{{ lawsData.rank.min_fiefs_required }} feudos)</span>
            </button>
          </div>
        </template>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { getTerritoryLaws, proclaimDivision } from '@/services/mapApi.js';

const props = defineProps({
  h3_index: { type: String, required: true },
  fiefName: { type: String, default: '' },
  gender:   { type: String, default: 'M' },
});

const emit = defineEmits(['close', 'highlight-fiefs', 'clear-highlights', 'division-proclaimed']);

const loading = ref(true);
const error = ref(null);
const lawsData = ref(null);
const selectedFiefs = ref(new Set());
const proclaiming = ref(false);
const resultMsg = ref(null);

// ─── Computed ─────────────────────────────────────────────────────────────────

// Título nobiliario según género: "Señor" / "Señora"
const nobleTitle = computed(() => {
  const rank = lawsData.value?.rank;
  if (!rank) return '';
  return props.gender === 'F' ? rank.title_female : rank.title_male;
});

// Artículo según género: "el" / "la"
const nobleArticle = computed(() => props.gender === 'F' ? 'la' : 'el');

// Genitivo: "de los Llanos" (extrae la parte tras el territory_name)
const nameGenitivo = computed(() => {
  const suggested = lawsData.value?.suggested_name ?? '';
  const prefix    = (lawsData.value?.rank?.territory_name ?? '') + ' ';
  return suggested.startsWith(prefix) ? suggested.slice(prefix.length) : suggested;
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchLaws() {
  loading.value = true;
  error.value = null;
  lawsData.value = null;
  resultMsg.value = null;

  try {
    const data = await getTerritoryLaws(props.h3_index);
    lawsData.value = data;

    // Auto-select all contiguous fiefs if case B
    if (!data.has_division && data.can_found) {
      selectedFiefs.value = new Set(data.contiguous_fiefs);
      emitHighlights();
    }
  } catch (err) {
    error.value = err?.response?.data?.message || 'Error al consultar los registros del feudo.';
  } finally {
    loading.value = false;
  }
}

// ─── Highlights ───────────────────────────────────────────────────────────────

function emitHighlights() {
  emit('highlight-fiefs', Array.from(selectedFiefs.value));
}

// ─── Proclaim ─────────────────────────────────────────────────────────────────

async function proclaim() {
  if (selectedFiefs.value.size < (lawsData.value?.rank?.min_fiefs_required ?? 1)) return;

  proclaiming.value = true;
  resultMsg.value = null;

  try {
    const data = await proclaimDivision({
      capital_h3: props.h3_index,
      fiefs: Array.from(selectedFiefs.value),
    });

    resultMsg.value = {
      type: 'success',
      text: `¡${data.division.name} proclamado con ${data.division.fief_count} feudos!`,
    };

    emit('division-proclaimed', data.division);

    // Refresh to show Case A
    setTimeout(() => fetchLaws(), 1500);
  } catch (err) {
    resultMsg.value = {
      type: 'error',
      text: err?.response?.data?.message || 'Error al proclamar la division.',
    };
  } finally {
    proclaiming.value = false;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function onKeydown(e) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  fetchLaws();
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  emit('clear-highlights');
});
</script>

<style scoped>
.fuero-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fuero-container {
  background: linear-gradient(160deg, #1a1208 0%, #0f0a04 100%);
  border: 1px solid #c5a059;
  border-radius: 10px;
  width: min(640px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(197,160,89,0.15);
}

/* Header */
.fuero-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid rgba(197,160,89,0.3);
  background: rgba(197,160,89,0.06);
  flex-shrink: 0;
}

.fuero-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.fuero-icon {
  font-size: 2rem;
  line-height: 1;
}

.fuero-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #e8d5b5;
  margin: 0 0 2px;
}

.fuero-subtitle {
  font-size: 0.8rem;
  color: #8a7a5a;
  margin: 0;
  font-family: monospace;
}

.fuero-close {
  background: rgba(197,160,89,0.1);
  border: 1px solid rgba(197,160,89,0.3);
  color: #c5a059;
  border-radius: 6px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.fuero-close:hover {
  background: rgba(197,160,89,0.25);
}

/* Body */
.fuero-body {
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Loading */
.fuero-loading {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #8a7a5a;
}

.fuero-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(197,160,89,0.2);
  border-top-color: #c5a059;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Error */
.fuero-error {
  padding: 24px;
  text-align: center;
  color: #f87171;
}

.fuero-error-inline {
  color: #f87171;
  font-size: 0.85rem;
  margin: 0;
}

/* Division card (Case A) */
.fuero-division-card {
  background: rgba(197,160,89,0.07);
  border: 1px solid rgba(197,160,89,0.25);
  border-radius: 8px;
  padding: 20px;
}

.division-rank-badge {
  display: inline-block;
  background: rgba(197,160,89,0.2);
  border: 1px solid rgba(197,160,89,0.5);
  color: #c5a059;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border-radius: 20px;
  margin-bottom: 10px;
}

.division-name {
  font-size: 1.5rem;
  font-weight: 700;
  color: #e8d5b5;
  margin: 0 0 16px;
}

.division-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.division-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 0.72rem;
  color: #7a6a4a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 0.95rem;
  color: #e8d5b5;
  font-weight: 600;
}

.stat-mono {
  font-family: monospace;
  font-size: 0.8rem;
}

/* Info note */
.fuero-info-note {
  display: flex;
  gap: 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: #9a8a6a;
  line-height: 1.5;
}

/* Rank banner (Case B) */
.fuero-rank-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: rgba(197,160,89,0.08);
  border: 1px solid rgba(197,160,89,0.3);
  border-radius: 8px;
  padding: 14px 18px;
}

.rank-banner-icon {
  font-size: 1.6rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.rank-banner-title {
  margin: 0 0 4px;
  color: #e8d5b5;
  font-size: 0.95rem;
}

.rank-banner-sub {
  margin: 0;
  font-size: 0.8rem;
  color: #8a7a5a;
}

/* Fiefs summary */
.fuero-fiefs-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  color: #9a8a6a;
  background: rgba(197,160,89,0.06);
  border: 1px solid rgba(197,160,89,0.2);
  border-radius: 6px;
  padding: 10px 16px;
}

.fiefs-count-badge {
  background: #c5a059;
  color: #1a1208;
  font-weight: 700;
  font-size: 0.8rem;
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  padding: 0 6px;
  flex-shrink: 0;
}

.fiefs-min-note {
  font-size: 0.78rem;
  color: #5a4a3a;
}

/* Name preview */
.fuero-name-preview {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(197,160,89,0.06);
  border: 1px solid rgba(197,160,89,0.2);
  border-radius: 6px;
  padding: 10px 16px;
}

.fuero-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #5a4a3a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  flex-shrink: 0;
}

.fuero-name-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: #c5a059;
  font-style: italic;
}

/* Result message */
.fuero-result {
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 0.88rem;
}

.fuero-result.success {
  background: rgba(74,222,128,0.1);
  border: 1px solid rgba(74,222,128,0.3);
  color: #4ade80;
}

.fuero-result.error {
  background: rgba(248,113,113,0.1);
  border: 1px solid rgba(248,113,113,0.3);
  color: #f87171;
}

/* Warning */
.fuero-warn {
  background: rgba(251,191,36,0.08);
  border: 1px solid rgba(251,191,36,0.3);
  border-radius: 8px;
  padding: 16px;
  color: #fbbf24;
  font-size: 0.88rem;
}

/* Footer */
.fuero-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid rgba(197,160,89,0.15);
}

/* Buttons */
.fuero-btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.fuero-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fuero-btn-primary {
  background: linear-gradient(135deg, #c5a059, #a07030);
  color: #1a1208;
  border: 1px solid #a07030;
}

.fuero-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #d4b06a, #b08040);
}

.fuero-btn-secondary {
  background: rgba(197,160,89,0.12);
  border: 1px solid rgba(197,160,89,0.35);
  color: #c5a059;
}

.fuero-btn-secondary:hover:not(:disabled) {
  background: rgba(197,160,89,0.22);
}

.fuero-btn-sm {
  padding: 6px 12px;
  font-size: 0.78rem;
}
</style>
