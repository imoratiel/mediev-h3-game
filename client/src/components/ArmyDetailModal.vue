<template>
  <Teleport to="body">
    <Transition name="adm-fade">
      <div v-if="show" class="adm-backdrop" @click.self="$emit('close')">
        <div class="adm-box" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="adm-header">
            <div class="adm-title-row">
              <span class="adm-icon">⚔️</span>
              <h2 class="adm-title">{{ army?.name ?? '—' }}</h2>
            </div>
            <button class="adm-close" @click="$emit('close')" title="Cerrar (Escape)">✕</button>
          </div>

          <!-- Loading -->
          <div v-if="loading" class="adm-loading">Cargando datos del ejército...</div>

          <!-- Error -->
          <div v-else-if="error" class="adm-error">❌ {{ error }}</div>

          <template v-else>
            <!-- Tabla de tropas -->
            <div class="adm-section-label">🗡 COMPOSICIÓN DE TROPAS</div>
            <div class="adm-table-wrap">
              <table v-if="troops.length > 0" class="adm-table">
                <thead>
                  <tr>
                    <th class="adm-th-name">Unidad</th>
                    <th class="adm-th-num">Cant.</th>
                    <th class="adm-th-num">Exp.</th>
                    <th class="adm-th-bar">Moral</th>
                    <th class="adm-th-bar">Estamina</th>
                    <th class="adm-th-num">Atq.</th>
                    <th class="adm-th-num">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in troops" :key="t.unit_name" class="adm-tr">
                    <td class="adm-td-name">{{ t.unit_name }}</td>
                    <td class="adm-td-num">{{ t.quantity }}</td>
                    <td class="adm-td-num adm-gold">{{ t.experience }}</td>
                    <td class="adm-td-bar">
                      <div class="adm-bar-wrap">
                        <div class="adm-bar-fill" :style="{ width: t.morale + '%', background: barColor(t.morale) }"></div>
                        <span class="adm-bar-label">{{ t.morale }}%</span>
                      </div>
                    </td>
                    <td class="adm-td-bar">
                      <div class="adm-bar-wrap">
                        <div class="adm-bar-fill" :style="{ width: t.stamina + '%', background: barColor(t.stamina) }"></div>
                        <span class="adm-bar-label">{{ t.stamina }}%</span>
                      </div>
                    </td>
                    <td class="adm-td-num">{{ t.attack }}</td>
                    <td class="adm-td-num">
                      <span v-if="t.force_rest" class="adm-badge adm-badge-rest">😴 Descanso</span>
                      <span v-else class="adm-badge adm-badge-ok">✅ Listo</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="adm-empty">Sin tropas reclutadas.</p>
            </div>

            <!-- Recursos / Provisiones -->
            <div class="adm-section-label">🎒 PROVISIONES DEL EJÉRCITO</div>
            <div class="adm-provisions">
              <div class="adm-prov-item">
                <span class="adm-prov-icon">💰</span>
                <span class="adm-prov-label">Oro</span>
                <span class="adm-prov-val" :class="{ 'adm-zero': !armyDetail?.gold_provisions }">
                  {{ armyDetail?.gold_provisions ?? 0 }}
                </span>
              </div>
              <div class="adm-prov-item">
                <span class="adm-prov-icon">🌾</span>
                <span class="adm-prov-label">Comida</span>
                <span class="adm-prov-val" :class="{ 'adm-zero': !armyDetail?.food_provisions }">
                  {{ armyDetail?.food_provisions ?? 0 }}
                </span>
              </div>
              <div class="adm-prov-item">
                <span class="adm-prov-icon">🪵</span>
                <span class="adm-prov-label">Madera</span>
                <span class="adm-prov-val" :class="{ 'adm-zero': !armyDetail?.wood_provisions }">
                  {{ armyDetail?.wood_provisions ?? 0 }}
                </span>
              </div>
            </div>
          </template>

          <button class="adm-btn-close" @click="$emit('close')">Cerrar</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const props = defineProps({
  show:    { type: Boolean, default: false },
  army:    { type: Object,  default: null  },  // datos básicos del panel (name, army_id, …)
});
const emit = defineEmits(['close']);

const loading    = ref(false);
const error      = ref('');
const armyDetail = ref(null);  // army con provisiones
const troops     = ref([]);

const barColor = (val) => {
  const n = parseFloat(val);
  if (n >= 70) return '#22c55e';
  if (n >= 40) return '#f59e0b';
  return '#ef4444';
};

const fetchDetail = async (armyId) => {
  loading.value = true;
  error.value   = '';
  try {
    const { data } = await axios.get(`${API_URL}/api/military/armies/${armyId}`, { withCredentials: true });
    if (data.success) {
      armyDetail.value = data.army;
      troops.value     = data.troops;
    } else {
      error.value = data.message || 'Error al cargar datos';
    }
  } catch (err) {
    error.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    loading.value = false;
  }
};

// Fetch cuando se abre el modal
watch(() => props.show, (val) => {
  if (val && props.army?.army_id) {
    fetchDetail(props.army.army_id);
    document.addEventListener('keydown', handleEsc);
  } else {
    document.removeEventListener('keydown', handleEsc);
    // Limpiar al cerrar
    armyDetail.value = null;
    troops.value     = [];
    error.value      = '';
  }
});

const handleEsc = (e) => { if (e.key === 'Escape') emit('close'); };
onUnmounted(() => document.removeEventListener('keydown', handleEsc));
</script>

<style scoped>
.adm-fade-enter-active, .adm-fade-leave-active { transition: opacity 0.2s ease; }
.adm-fade-enter-from, .adm-fade-leave-to { opacity: 0; }

.adm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.adm-box {
  background: #111827;
  border: 1px solid #374151;
  border-radius: 10px;
  width: 100%;
  max-width: 700px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.8);
  font-family: sans-serif;
}

/* Header */
.adm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #1f2937;
  background: #0d1117;
  flex-shrink: 0;
}
.adm-title-row { display: flex; align-items: center; gap: 10px; }
.adm-icon { font-size: 1.4rem; }
.adm-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #fbbf24;
  letter-spacing: 1px;
  font-family: 'Georgia', serif;
}
.adm-close {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s;
}
.adm-close:hover { color: #e5e7eb; }

/* Loading / error */
.adm-loading, .adm-error { padding: 40px; text-align: center; color: #9ca3af; font-size: 0.9rem; }
.adm-error { color: #f87171; }

/* Section label */
.adm-section-label {
  padding: 12px 20px 6px;
  font-size: 0.68rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #4b5563;
  font-weight: 700;
  flex-shrink: 0;
}

/* Tabla de tropas */
.adm-table-wrap {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 300px;
  padding: 0 20px 8px;
  flex-shrink: 0;
}
.adm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  min-width: 540px;
}
.adm-table thead th {
  padding: 7px 10px;
  color: #4b5563;
  font-size: 0.68rem;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  border-bottom: 1px solid #1f2937;
  font-weight: 600;
  white-space: nowrap;
}
.adm-th-name { text-align: left; }
.adm-th-num, .adm-th-bar { text-align: center; }

.adm-tr { border-bottom: 1px solid #0d1117; }
.adm-tr:hover { background: rgba(255,255,255,0.02); }

.adm-td-name { padding: 9px 10px; color: #e2e8f0; font-weight: 600; }
.adm-td-num { padding: 9px 10px; text-align: center; color: #9ca3af; }
.adm-td-bar { padding: 9px 10px; min-width: 100px; }
.adm-gold { color: #fbbf24 !important; }

/* Barra de progreso */
.adm-bar-wrap {
  position: relative;
  height: 16px;
  background: #1f2937;
  border-radius: 4px;
  overflow: hidden;
}
.adm-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 0.3s;
  border-radius: 4px;
}
.adm-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}

/* Badges estado */
.adm-badge {
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}
.adm-badge-rest { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.adm-badge-ok   { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25); }

/* Sin tropas */
.adm-empty { padding: 20px; text-align: center; color: #4b5563; font-style: italic; font-size: 0.85rem; }

/* Provisiones */
.adm-provisions {
  display: flex;
  gap: 12px;
  padding: 6px 20px 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.adm-prov-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 10px 16px;
  min-width: 130px;
}
.adm-prov-icon { font-size: 1.2rem; }
.adm-prov-label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
.adm-prov-val { font-size: 1rem; font-weight: 700; color: #e2e8f0; margin-left: auto; }
.adm-zero { color: #374151 !important; }

/* Botón cerrar */
.adm-btn-close {
  margin: 0 20px 16px;
  padding: 10px;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  color: #9ca3af;
  font-size: 0.82rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.adm-btn-close:hover { background: #374151; color: #e5e7eb; }
</style>
