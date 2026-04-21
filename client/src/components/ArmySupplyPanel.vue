<template>
  <Teleport to="body">
    <div v-if="show" class="asp-overlay">
      <div class="asp-panel">
        <div class="asp-header">
          <span>🌾 Abastecer ejército</span>
          <button class="asp-close" @click="$emit('close')">✕</button>
        </div>

        <div class="asp-body">
          <div class="asp-info-row">
            <span class="asp-label">📍 Feudo</span>
            <span class="asp-val">{{ fiefName }}</span>
          </div>

          <!-- Food -->
          <div class="asp-resource-block">
            <div class="asp-resource-header">
              <span>🌾 Comida</span>
              <span class="asp-stocks">
                Comarca: <strong>{{ formatN(comarcaFood) }}</strong> &nbsp;|&nbsp; Ejército: <strong>{{ formatN(armyFood) }}</strong>
              </span>
            </div>
            <div class="asp-input-row">
              <input v-model.number="foodAmount" type="number" min="1" class="asp-input" placeholder="Cantidad" @keyup.enter="doSupply('food', 1)" />

              <button class="asp-btn asp-btn-add" :disabled="loading || !(foodAmount > 0)" @click="doSupply('food', 1)">⬆ Aportar</button>
              <button class="asp-btn asp-btn-rem" :disabled="loading || !(foodAmount > 0)" @click="doSupply('food', -1)">⬇ Detraer</button>
            </div>
          </div>

          <!-- Gold -->
          <div class="asp-resource-block">
            <div class="asp-resource-header">
              <span>💰 Oro</span>
              <span class="asp-stocks">
                Tesoro: <strong>{{ formatN(playerGold) }}</strong> &nbsp;|&nbsp; Ejército: <strong>{{ formatN(armyGold) }}</strong>
              </span>
            </div>
            <div class="asp-input-row">
              <input v-model.number="goldAmount" type="number" min="1" class="asp-input" placeholder="Cantidad" @keyup.enter="doSupply('gold', 1)" />

              <button class="asp-btn asp-btn-add" :disabled="loading || !(goldAmount > 0)" @click="doSupply('gold', 1)">⬆ Aportar</button>
              <button class="asp-btn asp-btn-rem" :disabled="loading || !(goldAmount > 0)" @click="doSupply('gold', -1)">⬇ Detraer</button>
            </div>
          </div>

          <div v-if="errorMsg"   class="asp-error">{{ errorMsg }}</div>
          <div v-if="successMsg" class="asp-success">{{ successMsg }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { supplyArmy, getArmyDetail, getEconomySummary } from '../services/mapApi.js';

const props = defineProps({
  show:     { type: Boolean, default: false },
  armyId:   { type: Number,  default: null  },
  h3Index:  { type: String,  default: ''    },
  fiefName: { type: String,  default: ''    },
});
const emit = defineEmits(['close', 'done']);

const foodAmount   = ref(0);
const goldAmount   = ref(0);
const comarcaFood  = ref(0);
const armyFood     = ref(0);
const playerGold = ref(0);
const armyGold   = ref(0);
const loading    = ref(false);
const errorMsg   = ref('');
const successMsg = ref('');

const formatN = (v) => Math.round(Number(v) || 0).toLocaleString('es-ES');

async function loadData() {
  if (!props.armyId) return;
  try {
    const [armyRes, econRes] = await Promise.all([
      getArmyDetail(props.armyId),
      getEconomySummary(),
    ]);
    const army = armyRes?.army ?? armyRes;
    armyFood.value    = parseInt(army?.food_provisions) || 0;
    armyGold.value    = parseInt(army?.gold_provisions) || 0;
    comarcaFood.value = parseInt(army?.comarca_food)    || 0;
    playerGold.value  = parseInt(econRes?.player_gold)  || 0;
  } catch {
    errorMsg.value = 'Error al cargar datos';
  }
}

const onKeydown = (e) => { if (e.key === 'Escape' && props.show) emit('close'); };
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

watch(() => props.show, (v) => {
  if (v) {
    foodAmount.value = 0;
    goldAmount.value = 0;
    errorMsg.value   = '';
    successMsg.value = '';
    loadData();
  }
});

async function doSupply(resource, sign) {
  errorMsg.value   = '';
  successMsg.value = '';
  const amount = resource === 'food' ? foodAmount.value : goldAmount.value;
  if (!amount || amount <= 0) return;

  const food_delta = resource === 'food' ? sign * amount : 0;
  const gold_delta = resource === 'gold' ? sign * amount : 0;

  loading.value = true;
  try {
    await supplyArmy(props.armyId, food_delta, gold_delta);
    const label = resource === 'food' ? 'comida' : 'oro';
    successMsg.value = sign > 0
      ? `✅ ${formatN(amount)} de ${label} aportados al ejército`
      : `✅ ${formatN(amount)} de ${label} retirados del ejército`;

    if (resource === 'food') {
      comarcaFood.value -= food_delta;
      armyFood.value    += food_delta;
      foodAmount.value   = 0;
    } else {
      playerGold.value -= gold_delta;
      armyGold.value   += gold_delta;
      goldAmount.value  = 0;
    }
    emit('done');
  } catch (err) {
    errorMsg.value = err?.response?.data?.message || 'Error al abastecer';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.asp-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9100;
}
.asp-panel {
  background: #1e1a14; border: 1px solid #7a6a4a; border-radius: 8px;
  width: 520px; max-width: 96vw; color: #e8dcc8; font-size: 14px;
}
.asp-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid #3a3020;
  font-weight: 700; font-size: 14px; color: #d4b870;
}
.asp-close { background: none; border: none; color: #888; font-size: 16px; cursor: pointer; }
.asp-close:hover { color: #e8dcc8; }
.asp-body { padding: 18px; display: flex; flex-direction: column; gap: 16px; }
.asp-info-row { display: flex; justify-content: space-between; color: #9a8a6a; font-size: 12px; }
.asp-resource-block {
  background: #2a2418; border: 1px solid #3a3020; border-radius: 6px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.asp-resource-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.asp-stocks { font-size: 11px; color: #9a8a6a; }
.asp-input-row { display: flex; gap: 6px; align-items: center; }
.asp-input {
  flex: 1; background: #14110c; border: 1px solid #5a4a2a; border-radius: 4px;
  color: #e8dcc8; padding: 7px 10px; font-size: 14px;
}
.asp-input:focus { outline: none; border-color: #d4b870; }
.asp-btn {
  padding: 7px 14px; border-radius: 4px; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600; white-space: nowrap;
}
.asp-btn:disabled { opacity: .4; cursor: not-allowed; }

.asp-btn-add { background: #2d5a2d; color: #90d090; }
.asp-btn-add:not(:disabled):hover { background: #3a7a3a; }
.asp-btn-rem { background: #5a2d2d; color: #d09090; }
.asp-btn-rem:not(:disabled):hover { background: #7a3a3a; }
.asp-error   { color: #e07070; font-size: 12px; text-align: center; }
.asp-success { color: #70c070; font-size: 12px; text-align: center; }
</style>
