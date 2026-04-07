<template>
  <div class="divisions-tab">

    <!-- Loading -->
    <div v-if="loading" class="dt-loading">
      <div class="dt-spinner"></div>
      <p>Consultando los registros nobiliarios...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="dt-error">
      <p>⚠️ {{ error }}</p>
      <button class="dt-btn dt-btn-secondary" @click="fetchDivisions">Reintentar</button>
    </div>

    <template v-else-if="data">

      <!-- Noble rank card -->
      <div class="dt-noble-card">
        <div class="dt-noble-crest">⚜️</div>
        <div class="dt-noble-info">
          <p class="dt-noble-name">{{ fullName }}</p>
          <p class="dt-noble-title">{{ data.player.title }} de {{ data.player.territory_name || 'las Tierras' }}</p>
        </div>
        <div class="dt-fiefs-badge">
          <span class="dt-fiefs-num">{{ data.player.total_fiefs }}</span>
          <span class="dt-fiefs-label">territorios</span>
        </div>
      </div>

      <!-- Promotion progress -->
      <div v-if="data.next_rank" class="dt-promo-card">
        <div class="dt-promo-header">
          <span>Progreso hacia <strong>{{ data.next_rank.title_male }}</strong></span>
          <span class="dt-promo-pct">{{ promoPercent }}%</span>
        </div>
        <div class="dt-progress-track">
          <div class="dt-progress-fill" :style="{ width: promoPercent + '%' }"></div>
        </div>
        <p class="dt-promo-sub">
          {{ data.player.total_fiefs }} / {{ data.next_rank.min_fiefs_required }} territorios requeridos
          <span v-if="data.next_rank.required_count > 0">
            · {{ divisionsOfCurrentRank }} / {{ data.next_rank.required_count }} {{ currentRankTitle }}{{ data.next_rank.required_count > 1 ? 's' : '' }}
          </span>
        </p>
      </div>
      <div v-else class="dt-max-rank">
        <span>👑</span> Rango maximo alcanzado
      </div>

      <!-- Divisions list -->
      <div class="dt-section-title">Mis Divisiones ({{ data.divisions.length }})</div>

      <div v-if="data.divisions.length === 0" class="dt-empty">
        <p>Aun no has proclamado ninguna division politica.</p>
        <p class="dt-empty-hint">Abre el popup de un territorio con <strong>Fortaleza</strong> y pulsa <em>Edictos</em> para fundar tu primer Pagus.</p>
      </div>

      <div v-else class="dt-divisions-list">
        <div v-for="div in data.divisions" :key="div.id" class="dt-div-card">
          <div class="dt-div-rank-tag">{{ div.territory_name }}</div>
          <div class="dt-div-body">
            <h4 class="dt-div-name">{{ div.name }}</h4>
            <div class="dt-div-meta">
              <span>🏰 Capital: <span class="dt-mono">{{ div.capital_h3?.slice(-6) ?? '—' }}</span></span>
              <span>📦 {{ div.fief_count }} territorios</span>
            </div>
          </div>
          <div class="dt-div-titles">
            <span class="dt-div-title-m">{{ div.rank_title_male }}</span>
            <span class="dt-div-title-f">/ {{ div.rank_title_female }}</span>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getPlayerDivisions } from '@/services/mapApi.js';

const loading = ref(true);
const error   = ref(null);
const data    = ref(null);

const fullName = computed(() => {
  if (!data.value) return '';
  const { first_name, last_name } = data.value.player;
  return [first_name, last_name].filter(Boolean).join(' ') || 'Jugador';
});

const promoPercent = computed(() => {
  if (!data.value?.next_rank) return 100;
  const needed = data.value.next_rank.min_fiefs_required;
  if (!needed) return 100;
  return Math.min(100, Math.round((data.value.player.total_fiefs / needed) * 100));
});

const divisionsOfCurrentRank = computed(() => {
  if (!data.value) return 0;
  return data.value.divisions.length;
});

const currentRankTitle = computed(() => {
  if (!data.value) return '';
  return data.value.player.territory_name ?? '';
});

async function fetchDivisions() {
  loading.value = true;
  error.value   = null;
  try {
    const result = await getPlayerDivisions();
    data.value = result;
  } catch (err) {
    error.value = err?.response?.data?.message || 'Error al cargar los datos nobiliarios.';
  } finally {
    loading.value = false;
  }
}

onMounted(fetchDivisions);
</script>

<style scoped>
.divisions-tab {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  overflow-y: auto;
}

/* Loading */
.dt-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #8a7a5a;
  padding: 48px 0;
}

.dt-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(197,160,89,0.2);
  border-top-color: #c5a059;
  border-radius: 50%;
  animation: dt-spin 0.8s linear infinite;
}

@keyframes dt-spin { to { transform: rotate(360deg); } }

/* Error */
.dt-error {
  text-align: center;
  color: #f87171;
  padding: 24px;
}

/* Noble card */
.dt-noble-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(197,160,89,0.08);
  border: 1px solid rgba(197,160,89,0.3);
  border-radius: 10px;
  padding: 18px 20px;
}

.dt-noble-crest {
  font-size: 2.2rem;
  flex-shrink: 0;
}

.dt-noble-info {
  flex: 1;
}

.dt-noble-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: #e8d5b5;
  margin: 0 0 4px;
}

.dt-noble-title {
  font-size: 0.83rem;
  color: #c5a059;
  margin: 0;
  font-style: italic;
}

.dt-fiefs-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(197,160,89,0.15);
  border: 1px solid rgba(197,160,89,0.4);
  border-radius: 8px;
  padding: 8px 14px;
  flex-shrink: 0;
}

.dt-fiefs-num {
  font-size: 1.5rem;
  font-weight: 700;
  color: #e8d5b5;
  line-height: 1;
}

.dt-fiefs-label {
  font-size: 0.7rem;
  color: #8a7a5a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Promotion card */
.dt-promo-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 14px 16px;
}

.dt-promo-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  color: #9a8a6a;
  margin-bottom: 8px;
}

.dt-promo-pct {
  font-weight: 700;
  color: #c5a059;
}

.dt-progress-track {
  background: rgba(255,255,255,0.08);
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
  margin-bottom: 8px;
}

.dt-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #c5a059, #e8d5b5);
  border-radius: 4px;
  transition: width 0.6s ease;
}

.dt-promo-sub {
  font-size: 0.76rem;
  color: #5a4a3a;
  margin: 0;
}

.dt-max-rank {
  text-align: center;
  color: #c5a059;
  font-size: 0.9rem;
  padding: 10px;
  background: rgba(197,160,89,0.07);
  border-radius: 8px;
}

/* Section title */
.dt-section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5a4a3a;
  border-bottom: 1px solid rgba(197,160,89,0.15);
  padding-bottom: 8px;
}

/* Empty */
.dt-empty {
  text-align: center;
  color: #5a4a3a;
  font-size: 0.88rem;
  padding: 24px;
}

.dt-empty-hint {
  margin-top: 10px;
  font-size: 0.8rem;
  color: #4a3a2a;
}

/* Divisions list */
.dt-divisions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dt-div-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(197,160,89,0.2);
  border-radius: 8px;
  padding: 14px 16px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
}

.dt-div-rank-tag {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #c5a059;
  background: rgba(197,160,89,0.15);
  border-radius: 4px;
  padding: 6px 4px;
}

.dt-div-body {
  min-width: 0;
}

.dt-div-name {
  font-size: 1rem;
  font-weight: 700;
  color: #e8d5b5;
  margin: 0 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dt-div-meta {
  display: flex;
  gap: 16px;
  font-size: 0.78rem;
  color: #7a6a4a;
}

.dt-mono {
  font-family: monospace;
}

.dt-div-titles {
  text-align: right;
  flex-shrink: 0;
}

.dt-div-title-m {
  display: block;
  font-size: 0.8rem;
  color: #9a8a6a;
}

.dt-div-title-f {
  font-size: 0.72rem;
  color: #5a4a3a;
}

/* Buttons */
.dt-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.dt-btn-secondary {
  background: rgba(197,160,89,0.12);
  border: 1px solid rgba(197,160,89,0.35);
  color: #c5a059;
}

.dt-btn-secondary:hover {
  background: rgba(197,160,89,0.22);
}
</style>
