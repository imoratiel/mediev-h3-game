<template>
  <div class="military-panel">
    <div class="recruitment-header">
      <h3>⚔️ Reclutamiento de Tropas</h3>
      <p v-if="fief" class="recruitment-subtitle">
        Reclutando en <strong>{{ fief.name }}</strong>
      </p>
      <p v-else class="recruitment-subtitle">Selecciona un feudo desde la tabla para reclutar</p>
      <div class="army-capacity-bar">
        <span class="army-capacity-label">Capacidad de Ejércitos:</span>
        <span class="army-capacity-value" :class="{ 'at-limit': armyCount >= armyLimit }">
          {{ armyCount }}/{{ armyLimit }}
        </span>
        <span v-if="armyCount >= armyLimit" class="army-capacity-hint">
          — Necesitas más feudos para comandar más ejércitos
        </span>
      </div>
    </div>

    <div class="recruitment-content" v-if="fief">
      <!-- Resources Recap -->
      <div class="recruitment-section current-fief-mini">
        <div class="fief-resources-compact">
          <div class="resource-pill">💰 Oro: {{ formatNumber(playerGold) }}</div>
          <div class="resource-pill">🌲 Madera: {{ formatNumber(fief.wood) }}</div>
          <div class="resource-pill">⛰️ Piedra: {{ formatNumber(fief.stone) }}</div>
          <div class="resource-pill">⛏️ Hierro: {{ formatNumber(fief.iron) }}</div>
        </div>
        <button class="btn-back-to-fiefs" @click="$emit('back')">
          ← Volver a la lista de feudos
        </button>
      </div>

      <!-- Unit Type Selection with inline quantity -->
      <div class="recruitment-section">
        <h4>1. Configura tu Batallón</h4>
        <div v-if="loading" class="loading-text">Cargando unidades...</div>
        <div v-else class="unit-types-grid">
          <div
            v-for="unit in unitTypes"
            :key="unit.unit_type_id"
            :class="[
              'unit-card',
              {
                'unit-selected': unitQuantities[unit.unit_type_id] > 0,
                'unit-affordable': canAffordAtLeastOne(unit),
                'unit-unaffordable': !canAffordAtLeastOne(unit)
              }
            ]"
          >
            <div class="unit-card-header">
              <h5>{{ unit.name }}</h5>
              <span class="unit-stats">⚔️{{ unit.attack }} ❤️{{ unit.health_points }} 🏃{{ unit.speed }}</span>
            </div>
            <p class="unit-flavor">{{ unit.descrip }}</p>
            <div class="unit-requirements">
              <strong>Costo por unidad:</strong>
              <div class="req-list">
                <span
                  v-for="req in unit.requirements"
                  :key="req.resource_type"
                  class="req-item"
                  :class="{ 'req-insufficient': isInsufficient(req) }"
                >
                  {{ getResourceIcon(req.resource_type) }} {{ req.amount }}
                </span>
              </div>
            </div>
            <div class="unit-upkeep">
              <small>Manutención: 💰{{ unit.gold_upkeep }}/turno 🌾{{ unit.food_consumption }}/turno</small>
            </div>

            <!-- Quantity selector -->
            <div class="quantity-selector">
              <button class="qty-btn" @click="decrementUnit(unit)" :disabled="!unitQuantities[unit.unit_type_id]">−</button>
              <input
                type="number"
                min="0"
                max="1000"
                :value="unitQuantities[unit.unit_type_id] || 0"
                @change="setUnitQuantity(unit, $event.target.value)"
                class="qty-input"
              />
              <button class="qty-btn" @click="incrementUnit(unit)" :disabled="!canAffordAtLeastOne(unit)">+</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Army name -->
      <div class="recruitment-section army-name-section">
        <h4>2. Nombre del Ejército <span class="optional-hint">(opcional)</span></h4>
        <input
          v-model="armyName"
          type="text"
          placeholder="Dejar vacío para nombre automático"
          maxlength="100"
          class="recruitment-input"
        />
      </div>
    </div>

    <div v-else class="empty-state">
      <p>Debes seleccionar un feudo desde la tabla del reino para reclutar tropas.</p>
      <button class="btn-back-to-fiefs" @click="$emit('back')">Ver Lista de Feudos</button>
    </div>

    <!-- Sticky summary footer -->
    <div v-if="fief && totalSelectedTroops > 0" class="recruitment-footer">
      <div class="footer-summary">
        <div class="footer-troops">
          <span class="footer-label">Tropas:</span>
          <span class="footer-value">{{ totalSelectedTroops }}</span>
        </div>
        <div class="footer-costs">
          <span v-if="totalCost.gold > 0" :class="['footer-cost-item', { 'cost-insufficient': playerGold < totalCost.gold }]">
            💰 {{ totalCost.gold }}
          </span>
          <span v-if="totalCost.wood_stored > 0" :class="['footer-cost-item', { 'cost-insufficient': (fief.wood || 0) < totalCost.wood_stored }]">
            🌲 {{ totalCost.wood_stored }}
          </span>
          <span v-if="totalCost.stone_stored > 0" :class="['footer-cost-item', { 'cost-insufficient': (fief.stone || 0) < totalCost.stone_stored }]">
            ⛰️ {{ totalCost.stone_stored }}
          </span>
          <span v-if="totalCost.iron_stored > 0" :class="['footer-cost-item', { 'cost-insufficient': (fief.iron || 0) < totalCost.iron_stored }]">
            ⛏️ {{ totalCost.iron_stored }}
          </span>
        </div>
        <div class="footer-upkeep">
          <small>Mantenimiento: 💰{{ totalUpkeep.gold }}/turno 🌾{{ totalUpkeep.food }}/turno</small>
        </div>
      </div>
      <button
        class="btn-recruit"
        :disabled="!canBulkRecruit || isRecruiting || armyCount >= armyLimit"
        :title="armyCount >= armyLimit ? 'Necesitas más feudos para comandar más ejércitos' : ''"
        @click="handleBulkRecruit"
      >
        {{ isRecruiting ? 'Reclutando...' : `⚔️ Reclutar Lote (${totalSelectedTroops} tropas)` }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';

const props = defineProps({
  fief: Object,
  unitTypes: Array,
  loading: Boolean,
  playerGold: Number,
  isRecruiting: Boolean,
  armyCount: { type: Number, default: 0 },
  armyLimit: { type: Number, default: 2 },
});

const emit = defineEmits(['bulkRecruit', 'back']);

const armyName = ref('');
const unitQuantities = reactive({});

const formatNumber = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return Math.round(val).toLocaleString();
};

const getResourceIcon = (type) => {
  const icons = { gold: '💰', wood_stored: '🌲', stone_stored: '⛰️', iron_stored: '⛏️' };
  return icons[type] || '📦';
};

const isInsufficient = (req) => {
  if (!props.fief) return false;
  const { resource_type: type, amount } = req;
  if (type === 'gold') return props.playerGold < amount;
  if (type === 'wood_stored') return (props.fief.wood || 0) < amount;
  if (type === 'stone_stored') return (props.fief.stone || 0) < amount;
  if (type === 'iron_stored') return (props.fief.iron || 0) < amount;
  return false;
};

const canAffordAtLeastOne = (unit) => unit.requirements.every(req => !isInsufficient(req));

const incrementUnit = (unit) => {
  unitQuantities[unit.unit_type_id] = (unitQuantities[unit.unit_type_id] || 0) + 1;
};

const decrementUnit = (unit) => {
  const current = unitQuantities[unit.unit_type_id] || 0;
  if (current > 0) unitQuantities[unit.unit_type_id] = current - 1;
};

const setUnitQuantity = (unit, value) => {
  const qty = Math.max(0, Math.min(1000, parseInt(value) || 0));
  unitQuantities[unit.unit_type_id] = qty;
};

const totalSelectedTroops = computed(() =>
  Object.values(unitQuantities).reduce((s, q) => s + (q || 0), 0)
);

const totalCost = computed(() => {
  const cost = { gold: 0, wood_stored: 0, stone_stored: 0, iron_stored: 0 };
  if (!props.unitTypes) return cost;
  for (const unit of props.unitTypes) {
    const qty = unitQuantities[unit.unit_type_id] || 0;
    if (qty === 0) continue;
    for (const req of unit.requirements) {
      cost[req.resource_type] = (cost[req.resource_type] || 0) + req.amount * qty;
    }
  }
  return cost;
});

const totalUpkeep = computed(() => {
  const result = { gold: 0, food: 0 };
  if (!props.unitTypes) return result;
  for (const unit of props.unitTypes) {
    const qty = unitQuantities[unit.unit_type_id] || 0;
    result.gold += (unit.gold_upkeep || 0) * qty;
    result.food += (unit.food_consumption || 0) * qty;
  }
  return result;
});

const canBulkRecruit = computed(() => {
  if (!props.fief || totalSelectedTroops.value === 0) return false;
  const c = totalCost.value;
  if (props.playerGold < c.gold) return false;
  if ((props.fief.wood || 0) < c.wood_stored) return false;
  if ((props.fief.stone || 0) < c.stone_stored) return false;
  if ((props.fief.iron || 0) < c.iron_stored) return false;
  return true;
});

const handleBulkRecruit = () => {
  const units = Object.entries(unitQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([unit_type_id, quantity]) => ({ unit_type_id: parseInt(unit_type_id), quantity }));

  emit('bulkRecruit', {
    fief: props.fief,
    army_name: armyName.value.trim(),
    units,
  });

  Object.keys(unitQuantities).forEach(k => { unitQuantities[k] = 0; });
  armyName.value = '';
};
</script>

<style scoped>
.military-panel {
  padding: 20px;
  padding-bottom: 120px;
  color: #e8d5b5;
}

.recruitment-header {
  text-align: center;
  margin-bottom: 30px;
  border-bottom: 2px solid #c5a059;
  padding-bottom: 15px;
}

.recruitment-header h3 { font-family: 'Cinzel', serif; font-size: 1.8rem; color: #ffd700; margin: 0; }
.recruitment-subtitle { color: #a89875; margin-top: 5px; }

.fief-resources-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 15px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  border: 1px solid rgba(255, 215, 0, 0.3);
}

.resource-pill {
  padding: 6px 14px;
  background: rgba(26, 22, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
}

.recruitment-section {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(197, 160, 89, 0.2);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.recruitment-section h4 { color: #ffd700; margin: 0 0 15px 0; border-bottom: 1px solid rgba(255, 215, 0, 0.1); padding-bottom: 8px; }
.optional-hint { font-size: 0.75rem; color: #a89875; font-weight: normal; }

.unit-types-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 15px;
}

.unit-card {
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 15px;
  transition: border-color 0.2s, background 0.2s;
}

.unit-card.unit-selected { border-color: #ffd700; background: rgba(255, 215, 0, 0.07); }
.unit-card.unit-unaffordable { opacity: 0.6; filter: grayscale(0.5); }

.unit-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.unit-card-header h5 { margin: 0; color: #ffd700; font-size: 1.1rem; }
.unit-stats { font-size: 0.8rem; opacity: 0.8; }
.unit-flavor { font-size: 0.8rem; font-style: italic; opacity: 0.6; height: 3em; overflow: hidden; }

.req-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.req-item { font-size: 0.8rem; padding: 2px 6px; background: rgba(0, 255, 0, 0.1); border-radius: 3px; }
.req-item.req-insufficient { color: #ff6b6b; background: rgba(255, 0, 0, 0.1); text-decoration: line-through; }

.unit-upkeep { margin-top: 8px; opacity: 0.7; }

.quantity-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  justify-content: center;
}

.qty-btn {
  width: 32px;
  height: 32px;
  background: #c5a059;
  border: none;
  color: #111;
  font-size: 1.2rem;
  font-weight: bold;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
}

.qty-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.qty-btn:not(:disabled):hover { background: #ffd700; }

.qty-input {
  width: 60px;
  text-align: center;
  background: #111;
  border: 1px solid #444;
  color: #ffd700;
  font-size: 1rem;
  font-weight: bold;
  padding: 4px;
  border-radius: 4px;
}

.recruitment-input {
  width: 100%;
  background: #111;
  border: 1px solid #444;
  color: white;
  padding: 8px;
  border-radius: 4px;
  box-sizing: border-box;
}

.recruitment-footer {
  position: sticky;
  bottom: 0;
  background: rgba(10, 8, 5, 0.97);
  border-top: 2px solid #c5a059;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  z-index: 10;
}

.footer-summary {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.footer-label { color: #a89875; font-size: 0.8rem; text-transform: uppercase; }
.footer-value { color: #ffd700; font-weight: bold; font-size: 1.1rem; margin-left: 6px; }

.footer-costs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.footer-cost-item {
  font-weight: bold;
  font-size: 0.95rem;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.footer-cost-item.cost-insufficient { color: #ff6b6b; }
.footer-upkeep { font-size: 0.8rem; color: #a89875; }

.btn-recruit {
  white-space: nowrap;
  padding: 12px 20px;
  background: #c5a059;
  border: none;
  color: #111;
  font-weight: bold;
  font-family: 'Cinzel', serif;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.95rem;
}

.btn-recruit:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-recruit:not(:disabled):hover { background: #ffd700; }

.btn-back-to-fiefs {
  background: transparent;
  border: 1px solid #c5a059;
  color: #c5a059;
  padding: 5px 15px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  width: 100%;
}

.empty-state { text-align: center; padding: 60px 20px; color: #a89875; }
.loading-text { text-align: center; padding: 40px; color: #a89875; }
</style>
