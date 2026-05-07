<template>
  <div class="cfm-backdrop" @click.self="$emit('cancel')">
    <div class="cfm-modal">

      <div class="cfm-header">
        <span class="cfm-title">⛵ Nueva Flota</span>
        <button class="cfm-close" @click="$emit('cancel')">✕</button>
      </div>

      <div class="cfm-gold-bar">
        <span>💰 Oro disponible:</span>
        <span class="cfm-gold-value" :class="{ 'cfm-gold-low': totalCost > playerGold }">
          {{ formatNumber(playerGold) }}
        </span>
        <span v-if="totalCost > 0" class="cfm-cost-preview">
          → coste: <strong :class="{ 'cfm-over': totalCost > playerGold }">{{ formatNumber(totalCost) }}</strong>
        </span>
      </div>

      <div v-if="loading" class="cfm-loading">Cargando barcos disponibles...</div>

      <div v-else-if="shipTypes.length === 0" class="cfm-empty">
        No hay barcos disponibles para tu cultura.
      </div>

      <div v-else class="cfm-ships-grid">
        <div
          v-for="st in shipTypes"
          :key="st.id"
          class="cfm-ship-card"
          :class="{ 'cfm-selected': (qty[st.id] || 0) > 0, 'cfm-cant-afford': playerGold < st.gold_cost }"
        >
          <div class="cfm-ship-header">
            <span class="cfm-ship-icon">{{ st.category === 'transport' ? '🛶' : '⚔️' }}</span>
            <span class="cfm-ship-name">{{ st.name }}</span>
            <span class="cfm-badge" :class="st.category">
              {{ st.category === 'transport' ? 'Transporte' : 'Guerra' }}
            </span>
          </div>
          <p class="cfm-ship-desc">{{ st.description }}</p>
          <div class="cfm-ship-stats">
            <span v-if="st.category === 'transport'">📦 {{ st.transport_capacity }}/barco</span>
            <span v-else>⚔️ {{ st.attack }} · 🛡️ {{ st.defense }}</span>
            <span>🏃 {{ st.speed }} hex/turno</span>
            <span>💰 {{ formatNumber(st.gold_cost) }} c/u</span>
          </div>
          <div class="cfm-ship-row">
            <button class="cfm-qty-btn" @click="decQty(st.id)">−</button>
            <input
              v-model.number="qty[st.id]"
              type="number" min="0" max="99"
              class="cfm-qty-input"
              @input="clampQty(st.id)"
            />
            <button class="cfm-qty-btn" @click="incQty(st.id)">+</button>
            <span class="cfm-subtotal" v-if="(qty[st.id] || 0) > 0">
              = 💰 {{ formatNumber(st.gold_cost * qty[st.id]) }}
            </span>
          </div>
        </div>
      </div>

      <div class="cfm-footer">
        <button class="cfm-btn-cancel" @click="$emit('cancel')">Cancelar</button>
        <button
          class="cfm-btn-confirm"
          :disabled="acting || !canCreate"
          @click="confirm"
        >
          {{ acting ? 'Creando...' : '⛵ Crear Flota' }}
        </button>
      </div>

      <p v-if="!canCreate && !loading && shipTypes.length > 0" class="cfm-hint">
        <span v-if="totalCost > playerGold">Oro insuficiente.</span>
        <span v-else>Selecciona al menos un barco.</span>
      </p>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getShipTypes, createFleet } from '../services/mapApi.js';

const props = defineProps({
  h3Index:    { type: String,  required: true },
  playerGold: { type: Number,  default: 0 },
});

const emit = defineEmits(['confirm', 'cancel']);

const loading   = ref(true);
const acting    = ref(false);
const shipTypes = ref([]);
const qty       = ref({});

onMounted(async () => {
  try {
    const data = await getShipTypes();
    shipTypes.value = data.ship_types ?? data ?? [];
    shipTypes.value.forEach(st => { qty.value[st.id] = 0; });
  } catch (e) {
    console.error('Error cargando tipos de barco:', e);
  } finally {
    loading.value = false;
  }
});

const totalCost = computed(() =>
  shipTypes.value.reduce((acc, st) => acc + st.gold_cost * (qty.value[st.id] || 0), 0)
);

const totalShips = computed(() =>
  shipTypes.value.reduce((acc, st) => acc + (qty.value[st.id] || 0), 0)
);

const canCreate = computed(() =>
  totalShips.value > 0 && totalCost.value <= props.playerGold
);

function incQty(id) { qty.value[id] = Math.min(99, (qty.value[id] || 0) + 1); }
function decQty(id) { qty.value[id] = Math.max(0,  (qty.value[id] || 0) - 1); }
function clampQty(id) {
  const v = qty.value[id];
  if (!v || v < 0) qty.value[id] = 0;
  else if (v > 99) qty.value[id] = 99;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('es-ES');
}

async function confirm() {
  if (!canCreate.value || acting.value) return;
  acting.value = true;
  try {
    const ships = shipTypes.value
      .filter(st => (qty.value[st.id] || 0) > 0)
      .map(st => ({ ship_type_id: st.id, quantity: qty.value[st.id] }));

    const result = await createFleet(props.h3Index, '', ships);
    emit('confirm', result);
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al crear la flota.';
    emit('confirm', { success: false, message: msg });
  } finally {
    acting.value = false;
  }
}
</script>

<style scoped>
.cfm-backdrop {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
}
.cfm-modal {
  background: #1e1408;
  border: 2px solid #8b6914;
  border-radius: 10px;
  width: min(560px, 96vw);
  max-height: 85vh;
  display: flex; flex-direction: column;
  color: #f5deb3;
  font-family: 'Cinzel', serif;
}
.cfm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #5c3317;
}
.cfm-title { font-size: 1.1rem; font-weight: 700; color: #d4af37; }
.cfm-close {
  background: none; border: none; color: #a0845c; cursor: pointer;
  font-size: 1rem; padding: 2px 6px;
}
.cfm-close:hover { color: #f5deb3; }

.cfm-gold-bar {
  padding: 8px 16px;
  background: #2a1c08;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: .88rem;
}
.cfm-gold-value { font-weight: 700; color: #d4af37; }
.cfm-gold-value.cfm-gold-low { color: #e05252; }
.cfm-cost-preview { color: #a0845c; }
.cfm-over { color: #e05252 !important; }

.cfm-loading, .cfm-empty {
  padding: 24px; text-align: center; color: #a0845c;
}

.cfm-ships-grid {
  overflow-y: auto;
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.cfm-ship-card {
  background: #2a1c08;
  border: 1px solid #5c3317;
  border-radius: 7px;
  padding: 10px 12px;
  transition: border-color .15s;
}
.cfm-ship-card.cfm-selected { border-color: #d4af37; }
.cfm-ship-card.cfm-cant-afford { opacity: .55; }

.cfm-ship-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.cfm-ship-icon { font-size: 1.1rem; }
.cfm-ship-name { font-weight: 600; color: #e8c97a; flex: 1; }
.cfm-badge {
  font-size: .7rem; padding: 2px 7px; border-radius: 10px; font-weight: 600;
}
.cfm-badge.transport { background: #1a4a6e; color: #7ec8e3; }
.cfm-badge.warship   { background: #5c1a1a; color: #e07070; }

.cfm-ship-desc {
  font-size: .78rem; color: #a0845c; margin: 0 0 6px;
  font-family: Georgia, serif;
}
.cfm-ship-stats {
  display: flex; flex-wrap: wrap; gap: 10px;
  font-size: .78rem; color: #c9a96e; margin-bottom: 8px;
}
.cfm-ship-row {
  display: flex; align-items: center; gap: 6px;
}
.cfm-qty-btn {
  width: 28px; height: 28px;
  background: #3d2608; border: 1px solid #8b6914;
  color: #f5deb3; border-radius: 4px; cursor: pointer;
  font-size: 1rem; line-height: 1;
}
.cfm-qty-btn:hover { background: #5c3a0f; }
.cfm-qty-input {
  width: 50px; text-align: center;
  background: #120d04; border: 1px solid #8b6914;
  color: #f5deb3; border-radius: 4px; padding: 3px 0;
  font-size: .9rem;
}
.cfm-subtotal { font-size: .8rem; color: #d4af37; margin-left: 6px; }

.cfm-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid #5c3317;
}
.cfm-btn-cancel {
  padding: 7px 18px; border-radius: 5px;
  background: #2a1c08; border: 1px solid #5c3317;
  color: #a0845c; cursor: pointer; font-family: 'Cinzel', serif;
}
.cfm-btn-cancel:hover { background: #3d2608; color: #f5deb3; }
.cfm-btn-confirm {
  padding: 7px 22px; border-radius: 5px;
  background: #2e5c1a; border: 1px solid #4a8a28;
  color: #c8f0a0; cursor: pointer; font-weight: 700;
  font-family: 'Cinzel', serif;
}
.cfm-btn-confirm:hover:not(:disabled) { background: #3d7a22; }
.cfm-btn-confirm:disabled { opacity: .45; cursor: not-allowed; }

.cfm-hint {
  text-align: center; font-size: .78rem; color: #e05252;
  padding: 0 16px 10px; margin: 0;
}

@media (max-width: 600px) {
  .cfm-modal { max-height: 92vh; border-radius: 14px 14px 0 0; align-self: flex-end; }
  .cfm-backdrop { align-items: flex-end; }
}
</style>
