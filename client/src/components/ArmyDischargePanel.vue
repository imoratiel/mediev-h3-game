<template>
  <Teleport to="body">
    <div v-if="show" class="adp-overlay">
      <div class="adp-panel">
        <div class="adp-header">
          <span>🏳️ Licenciar tropas</span>
          <button class="adp-close" @click="$emit('close')">✕</button>
        </div>

        <div class="adp-body">
          <div v-if="loading" class="adp-loading">Cargando...</div>
          <template v-else>
            <div class="adp-info">Las tropas licenciadas vuelven como población a los feudos de la comarca.</div>

            <div class="adp-troops">
              <div v-for="t in troopList" :key="t.unit_type_id" class="adp-troop-row">
                <div class="adp-troop-name">{{ t.unit_name }}</div>
                <div class="adp-troop-qty">{{ t.quantity.toLocaleString('es-ES') }}</div>
                <input
                  v-model.number="selections[t.unit_type_id]"
                  type="number" min="0" :max="t.quantity"
                  class="adp-input"
                  @input="clamp(t)"
                />
              </div>
            </div>

            <div v-if="errorMsg"   class="adp-error">{{ errorMsg }}</div>
            <div v-if="successMsg" class="adp-success">{{ successMsg }}</div>

            <div class="adp-actions">
              <button class="adp-btn adp-btn-partial" :disabled="busy || totalSelected === 0" @click="doDischarge(false)">
                ⬇ Licenciar selección ({{ totalSelected.toLocaleString('es-ES') }})
              </button>
              <button class="adp-btn adp-btn-full" :disabled="busy || !troopList.length" @click="doDischarge(true)">
                🏳️ Licenciar ejército completo
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { getArmyDetail, dischargeArmy } from '../services/mapApi.js';

const props = defineProps({
  show:   { type: Boolean, default: false },
  armyId: { type: Number,  default: null  },
});
const emit = defineEmits(['close', 'done']);

const loading    = ref(false);
const busy       = ref(false);
const troopList  = ref([]);
const selections = ref({});
const errorMsg   = ref('');
const successMsg = ref('');

const totalSelected = computed(() =>
  Object.values(selections.value).reduce((s, v) => s + (parseInt(v) || 0), 0)
);

const clamp = (t) => {
  const v = parseInt(selections.value[t.unit_type_id]) || 0;
  selections.value[t.unit_type_id] = Math.max(0, Math.min(v, t.quantity));
};

async function loadData() {
  if (!props.armyId) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await getArmyDetail(props.armyId);
    const byType = {};
    for (const t of (res?.troops ?? [])) {
      if (!byType[t.unit_type_id]) byType[t.unit_type_id] = { unit_type_id: t.unit_type_id, unit_name: t.unit_name, quantity: 0 };
      byType[t.unit_type_id].quantity += parseInt(t.quantity) || 0;
    }
    troopList.value = Object.values(byType);
    selections.value = Object.fromEntries(troopList.value.map(t => [t.unit_type_id, 0]));
  } catch {
    errorMsg.value = 'Error al cargar las tropas';
  } finally {
    loading.value = false;
  }
}

watch(() => props.show, (v) => {
  if (v) {
    errorMsg.value = '';
    successMsg.value = '';
    loadData();
  }
});

const onKeydown = (e) => { if (e.key === 'Escape' && props.show) emit('close'); };
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

async function doDischarge(full) {
  errorMsg.value   = '';
  successMsg.value = '';
  busy.value = true;
  try {
    const troops = full ? [] : troopList.value
      .filter(t => (selections.value[t.unit_type_id] || 0) > 0)
      .map(t => ({ unit_type_id: t.unit_type_id, quantity: selections.value[t.unit_type_id] }));

    const res = await dischargeArmy(props.armyId, troops, full);
    successMsg.value = res.message;

    if (res.army_dissolved) {
      setTimeout(() => emit('done', { dissolved: true, message: res.message }), 1200);
    } else {
      // Update local troop list
      if (full) {
        troopList.value = [];
      } else {
        for (const t of troops) {
          const found = troopList.value.find(x => x.unit_type_id === t.unit_type_id);
          if (found) found.quantity -= t.quantity;
        }
        troopList.value = troopList.value.filter(t => t.quantity > 0);
        selections.value = Object.fromEntries(troopList.value.map(t => [t.unit_type_id, 0]));
      }
      emit('done', { dissolved: false, message: res.message });
    }
  } catch (err) {
    errorMsg.value = err?.response?.data?.message || 'Error al licenciar';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.adp-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9100;
}
.adp-panel {
  background: #1e1a14; border: 1px solid #7a6a4a; border-radius: 8px;
  width: 480px; max-width: 96vw; color: #e8dcc8; font-size: 14px;
}
.adp-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; border-bottom: 1px solid #3a3020;
  font-weight: 700; font-size: 15px; color: #d4b870;
}
.adp-close { background: none; border: none; color: #888; font-size: 16px; cursor: pointer; }
.adp-close:hover { color: #e8dcc8; }
.adp-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.adp-info { font-size: 12px; color: #9a8a6a; }
.adp-loading { text-align: center; color: #9a8a6a; padding: 20px 0; }
.adp-troops { display: flex; flex-direction: column; gap: 8px; }
.adp-troop-row {
  display: grid; grid-template-columns: 1fr auto auto;
  gap: 10px; align-items: center;
  background: #2a2418; border: 1px solid #3a3020; border-radius: 5px;
  padding: 8px 12px;
}
.adp-troop-name { font-weight: 600; }
.adp-troop-qty  { color: #9a8a6a; font-size: 13px; min-width: 60px; text-align: right; }
.adp-input {
  width: 90px; background: #14110c; border: 1px solid #5a4a2a; border-radius: 4px;
  color: #e8dcc8; padding: 5px 8px; font-size: 13px; text-align: right;
}
.adp-input:focus { outline: none; border-color: #d4b870; }
.adp-actions { display: flex; gap: 8px; flex-direction: column; }
.adp-btn {
  width: 100%; padding: 9px 14px; border-radius: 5px; border: none;
  cursor: pointer; font-size: 13px; font-weight: 700;
}
.adp-btn:disabled { opacity: .4; cursor: not-allowed; }
.adp-btn-partial { background: #2d5a2d; color: #90d090; }
.adp-btn-partial:not(:disabled):hover { background: #3a7a3a; }
.adp-btn-full { background: #5a2020; color: #e08080; }
.adp-btn-full:not(:disabled):hover { background: #7a2a2a; }
.adp-error   { color: #e07070; font-size: 12px; text-align: center; }
.adp-success { color: #70c070; font-size: 12px; text-align: center; }
</style>
