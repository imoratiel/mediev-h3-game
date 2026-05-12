<template>
  <div class="orders-panel">
    <div v-if="loading" class="orders-empty">Cargando órdenes...</div>

    <template v-else>
      <div v-if="totalCount === 0" class="orders-empty">
        No hay órdenes pendientes.
      </div>

      <template v-else>
        <!-- Construcciones -->
        <section v-if="orders.constructions.length" class="orders-section">
          <h3 class="orders-section-title">
            <img src="/icons/barracks.png" class="orders-section-icon" draggable="false" />
            Construcciones
            <span class="orders-count">{{ orders.constructions.length }}</span>
          </h3>
          <article
            v-for="item in orders.constructions"
            :key="'c_' + item.h3_index"
            class="order-card order-construct"
          >
            <div class="order-info">
              <span class="order-name">{{ item.building_name }}</span>
              <span class="order-coords" @click="emit('focusHex', item.h3_index)" title="Ir al feudo">
                📍 {{ formatCoords(item.h3_index) }}
              </span>
            </div>
            <div class="order-footer">
              <span class="order-turns">
                <span class="turns-icon">⏳</span>{{ item.turns_remaining }} turno{{ item.turns_remaining !== 1 ? 's' : '' }}
              </span>
              <button
                class="order-cancel-btn"
                :disabled="cancelling === 'c_' + item.h3_index"
                @click="requestCancel('construction', item)"
                title="Cancelar construcción"
              >
                {{ cancelling === 'c_' + item.h3_index ? '...' : '✕ Cancelar' }}
              </button>
            </div>
          </article>
        </section>

        <!-- Demoliciones -->
        <section v-if="orders.demolitions.length" class="orders-section">
          <h3 class="orders-section-title">
            <img src="/icons/castle.png" class="orders-section-icon" draggable="false" />
            Demoliciones
            <span class="orders-count">{{ orders.demolitions.length }}</span>
          </h3>
          <article
            v-for="item in orders.demolitions"
            :key="'d_' + item.h3_index"
            class="order-card order-demolish"
          >
            <div class="order-info">
              <span class="order-name">{{ item.building_name }}</span>
              <span class="order-coords" @click="emit('focusHex', item.h3_index)" title="Ir al feudo">
                📍 {{ formatCoords(item.h3_index) }}
              </span>
            </div>
            <div class="order-footer">
              <span class="order-turns">
                <span class="turns-icon">⏳</span>{{ item.turns_remaining }} turno{{ item.turns_remaining !== 1 ? 's' : '' }}
              </span>
              <button
                class="order-cancel-btn"
                :disabled="cancelling === 'd_' + item.h3_index"
                @click="requestCancel('demolition', item)"
                title="Cancelar demolición"
              >
                {{ cancelling === 'd_' + item.h3_index ? '...' : '✕ Cancelar' }}
              </button>
            </div>
          </article>
        </section>

        <!-- Destrucciones de puentes -->
        <section v-if="orders.bridge_destructions.length" class="orders-section">
          <h3 class="orders-section-title">
            <img src="/icons/bridge.png" class="orders-section-icon" draggable="false" />
            Destrucción de puentes
            <span class="orders-count">{{ orders.bridge_destructions.length }}</span>
          </h3>
          <article
            v-for="item in orders.bridge_destructions"
            :key="'b_' + item.h3_index"
            class="order-card order-bridge"
          >
            <div class="order-info">
              <span class="order-name">Puente</span>
              <span class="order-coords" @click="emit('focusHex', item.h3_index)" title="Ir al puente">
                📍 {{ formatCoords(item.h3_index) }}
              </span>
            </div>
            <div class="order-footer">
              <span class="order-turns">
                <span class="turns-icon">⏳</span>{{ item.turns_remaining }} turno{{ item.turns_remaining !== 1 ? 's' : '' }}
              </span>
              <button
                class="order-cancel-btn"
                :disabled="cancelling === 'b_' + item.h3_index"
                @click="requestCancel('bridge', item)"
                title="Cancelar destrucción"
              >
                {{ cancelling === 'b_' + item.h3_index ? '...' : '✕ Cancelar' }}
              </button>
            </div>
          </article>
        </section>
      </template>
    </template>

    <!-- Confirmación de cancelación -->
    <Teleport to="body">
      <div v-if="confirmTarget" class="orders-confirm-backdrop" @click.self="confirmTarget = null">
        <div class="orders-confirm-dialog">
          <p class="orders-confirm-title">¿Cancelar orden?</p>
          <p class="orders-confirm-body">
            <template v-if="confirmTarget.type === 'construction'">
              Se cancelará la construcción de
              <strong>{{ confirmTarget.item.building_name }}</strong>.<br>
              <span class="orders-confirm-warn">El oro invertido no se recuperará.</span>
            </template>
            <template v-else-if="confirmTarget.type === 'demolition'">
              Se cancelará la demolición de
              <strong>{{ confirmTarget.item.building_name }}</strong>.
            </template>
            <template v-else>
              Se cancelará la destrucción del puente en
              <strong>{{ formatCoords(confirmTarget.item.h3_index) }}</strong>.
            </template>
          </p>
          <div class="orders-confirm-actions">
            <button class="orders-confirm-no" @click="confirmTarget = null">No, mantener</button>
            <button
              class="orders-confirm-yes"
              :disabled="cancelling !== null"
              @click="confirmCancel"
            >
              {{ cancelling ? '...' : 'Sí, cancelar' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { cellToLatLng } from 'h3-js';
import { getPendingOrders, cancelBuildingConstruction, cancelBuildingDemolition, cancelBridgeDestruction } from '@/services/mapApi.js';

const emit = defineEmits(['focusHex', 'cancelled', 'toast']);

const loading       = ref(true);
const cancelling    = ref(null);
const confirmTarget = ref(null); // { type, item }
const orders        = ref({ constructions: [], demolitions: [], bridge_destructions: [] });

const totalCount = computed(() =>
  orders.value.constructions.length +
  orders.value.demolitions.length +
  orders.value.bridge_destructions.length
);

function formatCoords(h3_index) {
  try {
    const [lat, lng] = cellToLatLng(h3_index);
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  } catch { return h3_index; }
}

async function load() {
  loading.value = true;
  try {
    const data = await getPendingOrders();
    orders.value = {
      constructions:       data.constructions       ?? [],
      demolitions:         data.demolitions         ?? [],
      bridge_destructions: data.bridge_destructions ?? [],
    };
  } finally {
    loading.value = false;
  }
}

function requestCancel(type, item) {
  confirmTarget.value = { type, item };
}

async function confirmCancel() {
  const { type, item } = confirmTarget.value;
  const h3_index = item.h3_index;
  const key = type === 'construction' ? 'c_' : type === 'demolition' ? 'd_' : 'b_';
  cancelling.value = key + h3_index;
  try {
    if (type === 'construction') await cancelBuildingConstruction(h3_index);
    else if (type === 'demolition') await cancelBuildingDemolition(h3_index);
    else await cancelBridgeDestruction(h3_index);

    confirmTarget.value = null;
    emit('cancelled', { type, h3_index });
    await load();
  } catch (err) {
    emit('toast', err?.response?.data?.message || 'Error al cancelar la orden', 'error');
  } finally {
    cancelling.value = null;
  }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.orders-panel {
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.orders-empty {
  text-align: center;
  color: #9e8f78;
  font-size: 13px;
  padding: 24px 0;
}

.orders-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.orders-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c9b87a;
  margin: 0 0 2px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(201,184,122,0.2);
}

.orders-section-icon {
  width: 14px;
  height: 14px;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5));
}

.orders-count {
  margin-left: auto;
  background: rgba(201,184,122,0.15);
  color: #c9b87a;
  border-radius: 10px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 18px;
}

.order-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.order-construct { border-left: 3px solid #4a9eff; }
.order-demolish  { border-left: 3px solid #f97316; }
.order-bridge    { border-left: 3px solid #ef4444; }

.order-info {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.order-name {
  font-size: 13px;
  font-weight: 600;
  color: #e8dcc8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.order-coords {
  font-size: 11px;
  color: #9e8f78;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.order-coords:hover { color: #c9b87a; }

.order-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.order-turns {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #b0a080;
}

.turns-icon { font-size: 13px; }

.order-cancel-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(239,68,68,0.4);
  background: rgba(239,68,68,0.1);
  color: #fca5a5;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.order-cancel-btn:hover:not(:disabled) {
  background: rgba(239,68,68,0.25);
  border-color: rgba(239,68,68,0.7);
}

.order-cancel-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Confirm dialog ── */
.orders-confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.orders-confirm-dialog {
  background: #1e1810;
  border: 1px solid rgba(201,184,122,0.35);
  border-radius: 8px;
  padding: 20px 22px;
  max-width: 300px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
}

.orders-confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: #e8dcc8;
  margin: 0 0 10px 0;
}

.orders-confirm-body {
  font-size: 13px;
  color: #b0a080;
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.orders-confirm-body strong {
  color: #e8dcc8;
}

.orders-confirm-warn {
  display: inline-block;
  margin-top: 6px;
  color: #fbbf24;
  font-weight: 600;
}

.orders-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.orders-confirm-no {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.06);
  color: #9e8f78;
  cursor: pointer;
}

.orders-confirm-no:hover { background: rgba(255,255,255,0.12); color: #e8dcc8; }

.orders-confirm-yes {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.15);
  color: #fca5a5;
  cursor: pointer;
  font-weight: 600;
}

.orders-confirm-yes:hover:not(:disabled) {
  background: rgba(239,68,68,0.3);
  border-color: rgba(239,68,68,0.8);
}

.orders-confirm-yes:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
