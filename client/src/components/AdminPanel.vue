<template>
  <div class="admin-overlay">
    <div class="admin-panel">

      <!-- Header -->
      <div class="admin-header">
        <h2 class="admin-title">⚙️ Panel de Administración</h2>
        <button class="close-btn" @click="$emit('close')" title="Cerrar">✕</button>
      </div>

      <!-- Loading state -->
      <div v-if="loading && !status" class="admin-loading">Cargando estado del sistema...</div>

      <template v-else-if="status">

        <!-- ── PROCESS MONITOR ──────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">📡 Estado del Sistema</h3>
          <div class="process-list">
            <div
              v-for="proc in status.processes"
              :key="proc.id"
              class="process-row"
            >
              <span class="led" :class="ledClass(proc.status)"></span>
              <div class="proc-info">
                <span class="proc-name">{{ proc.name }}</span>
                <span class="proc-desc">{{ proc.description }}</span>
              </div>
              <span class="proc-badge" :class="badgeClass(proc.status)">{{ statusLabel(proc.status) }}</span>
            </div>
          </div>

          <!-- Uptime -->
          <div v-if="engineProc?.startTime" class="uptime-row">
            ⏱️ Motor activo desde hace <strong>{{ formatUptime(engineProc.uptimeMs) }}</strong>
          </div>
        </section>

        <!-- ── GAME TIMING ───────────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">🕰️ Tiempo de Juego</h3>
          <div class="timing-grid">
            <div class="timing-item">
              <span class="timing-label">Turno actual</span>
              <span class="timing-value">{{ status.game.currentTurn }}</span>
            </div>
            <div class="timing-item timing-item-editable">
              <span class="timing-label">Duración de turno</span>
              <div class="timing-edit-row">
                <input
                  v-model.number="turnDurationInput"
                  type="number"
                  min="5"
                  max="3600"
                  class="timing-input"
                  :disabled="savingDuration"
                />
                <span class="timing-input-unit">s</span>
                <button
                  class="timing-save-btn"
                  :disabled="savingDuration || turnDurationInput === status.game.turnDurationSeconds"
                  @click="handleSaveDuration"
                  title="Guardar nueva duración"
                >{{ savingDuration ? '⏳' : '✓' }}</button>
              </div>
            </div>
            <div class="timing-item">
              <span class="timing-label">Último turno</span>
              <span class="timing-value">{{ formatTimestamp(status.game.lastTurnAt) }}</span>
            </div>
            <div class="timing-item">
              <span class="timing-label">Próximo turno</span>
              <span class="timing-value" :class="{ 'next-turn-soon': nextTurnSoon }">
                {{ nextTurnLabel }}
              </span>
            </div>
          </div>
        </section>

        <!-- ── ENGINE CONTROLS ───────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">🔧 Control del Motor</h3>

          <div class="controls-row">
            <!-- Engine start / stop -->
            <button
              class="ctrl-btn btn-green"
              :disabled="engineRunning || acting"
              @click="handleStart"
              title="Inicia el bucle de turnos automático"
            >▶ Arrancar Motor</button>

            <button
              class="ctrl-btn btn-red"
              :disabled="!engineRunning || acting"
              @click="handleStop"
              title="Detiene el bucle (persiste tras reinicio)"
            >■ Detener Motor</button>
          </div>

          <!-- Game pause / resume -->
          <div class="controls-row" style="margin-top:8px">
            <button
              class="ctrl-btn btn-orange"
              :disabled="gamePaused || acting"
              @click="handlePause"
              title="Pausa la lógica sin detener el motor"
            >⏸ Pausar Juego</button>

            <button
              class="ctrl-btn btn-blue"
              :disabled="!gamePaused || acting"
              @click="handleResume"
              title="Reanuda el juego"
            >▷ Reanudar Juego</button>
          </div>
        </section>

        <!-- ── FORCE OPERATIONS ──────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">⚡ Forzar Procesos</h3>
          <p class="force-hint">Ejecuta el proceso inmediatamente, sin esperar el turno automático.</p>
          <div class="controls-row">
            <button class="ctrl-btn btn-force" :disabled="acting" @click="handleForceTurn">
              ⏭ Turno
            </button>
            <button class="ctrl-btn btn-force" :disabled="acting" @click="handleForceHarvest">
              🌾 Cosecha
            </button>
            <button class="ctrl-btn btn-force" :disabled="acting" @click="handleForceExploration">
              🔍 Exploraciones
            </button>
          </div>
        </section>

        <!-- Feedback message -->
        <div v-if="message" class="admin-message" :class="messageType">{{ message }}</div>

      </template>

      <div v-if="error" class="admin-error">❌ {{ error }}</div>

      <!-- Footer: auto-refresh indicator -->
      <div class="admin-footer">
        <span class="refresh-label">Actualización automática cada 10s</span>
        <button class="refresh-btn" @click="fetchStatus" :disabled="loading">
          {{ loading ? '⏳' : '🔄' }}
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  getAdminProcessStatus,
  updateAdminGameConfig,
  startEngine, stopEngine,
  pauseGame, resumeGame,
  forceTurn, forceHarvest, forceExploration
} from '../services/mapApi.js';

const emit = defineEmits(['close']);

const status  = ref(null);
const loading = ref(false);
const acting  = ref(false);
const error   = ref('');
const message = ref('');
const messageType = ref('msg-ok');
const turnDurationInput = ref(60);
const savingDuration = ref(false);

let refreshTimer = null;

// ── Computed helpers ────────────────────────────────────────────────────────
const engineProc   = computed(() => status.value?.processes?.find(p => p.id === 'turn_engine'));
const engineRunning = computed(() => engineProc.value?.status === 'active' || engineProc.value?.status === 'paused');
const gamePaused   = computed(() => status.value?.game?.isPaused === true);

const nextTurnInMs  = computed(() => status.value?.game?.nextTurnInMs ?? null);
const nextTurnSoon  = computed(() => nextTurnInMs.value !== null && nextTurnInMs.value < 10000);
const nextTurnLabel = computed(() => {
  if (!engineRunning.value) return 'Motor detenido';
  if (gamePaused.value)     return 'Juego pausado';
  if (nextTurnInMs.value === null) return '—';
  if (nextTurnInMs.value <= 0) return 'Procesando…';
  return `en ${Math.ceil(nextTurnInMs.value / 1000)}s`;
});

// ── Status display helpers ──────────────────────────────────────────────────
const ledClass = (s) => ({
  'led-green':  s === 'active',
  'led-yellow': s === 'paused',
  'led-red':    s === 'stopped',
  'led-grey':   s === 'inactive' || s === 'disabled',
});

const badgeClass = (s) => ({
  'badge-green':  s === 'active',
  'badge-yellow': s === 'paused',
  'badge-red':    s === 'stopped',
  'badge-grey':   s === 'inactive' || s === 'disabled',
});

const STATUS_LABELS = {
  active:   'Activo',
  paused:   'Pausado',
  stopped:  'Detenido',
  inactive: 'Inactivo',
  disabled: 'Desactivado',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;

// ── Formatting ──────────────────────────────────────────────────────────────
const formatUptime = (ms) => {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0)  return `${h}h ${m % 60}m`;
  if (m > 0)  return `${m}m ${s % 60}s`;
  return `${s}s`;
};

const formatTimestamp = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// ── Data fetching ───────────────────────────────────────────────────────────
const fetchStatus = async () => {
  loading.value = true;
  error.value = '';
  try {
    const data = await getAdminProcessStatus();
    if (data.success) {
      status.value = data;
      // Sync input only if user is not currently editing
      if (!savingDuration.value) {
        turnDurationInput.value = data.game.turnDurationSeconds;
      }
    } else {
      error.value = data.message || 'Error desconocido';
    }
  } catch (e) {
    error.value = `Error de conexión: ${e.message}`;
  } finally {
    loading.value = false;
  }
};

const handleSaveDuration = async () => {
  const secs = parseInt(turnDurationInput.value, 10);
  if (!secs || secs < 5 || secs > 3600) {
    showMsg('El valor debe estar entre 5 y 3600 segundos', 'msg-err');
    return;
  }
  savingDuration.value = true;
  try {
    const data = await updateAdminGameConfig('gameplay', 'turn_duration_seconds', secs);
    if (data.success) {
      showMsg(`Duración de turno actualizada a ${secs}s (efecto en el próximo ciclo)`);
      await fetchStatus();
    } else {
      showMsg(data.message || 'Error al guardar', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    savingDuration.value = false;
  }
};

// ── Actions ─────────────────────────────────────────────────────────────────
const showMsg = (text, type = 'msg-ok') => {
  message.value = text;
  messageType.value = type;
  setTimeout(() => { message.value = ''; }, 4000);
};

const runAction = async (apiCall, successMsg) => {
  if (acting.value) return;
  acting.value = true;
  try {
    const data = await apiCall();
    if (data.success) {
      showMsg(data.message || successMsg);
      await fetchStatus();
    } else {
      showMsg(data.message || 'Error en la operación', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    acting.value = false;
  }
};

const handleStart       = () => runAction(startEngine,      'Motor iniciado');
const handleStop        = () => runAction(stopEngine,       'Motor detenido');
const handlePause       = () => runAction(pauseGame,        'Juego pausado');
const handleResume      = () => runAction(resumeGame,       'Juego reanudado');
const handleForceTurn   = () => runAction(forceTurn,        'Turno procesado');
const handleForceHarvest     = () => runAction(forceHarvest,    'Cosecha procesada');
const handleForceExploration = () => runAction(forceExploration,'Exploraciones procesadas');

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  fetchStatus();
  refreshTimer = setInterval(fetchStatus, 10000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.admin-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-panel {
  width: min(520px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  background: #1a1510;
  border: 1px solid rgba(197, 160, 89, 0.4);
  border-radius: 12px;
  color: #e8d5b5;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Header */
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 14px;
  border-bottom: 1px solid rgba(197, 160, 89, 0.2);
  position: sticky;
  top: 0;
  background: #1a1510;
  z-index: 1;
}

.admin-title {
  margin: 0;
  font-size: 1.1rem;
  color: #ffd700;
  font-weight: 700;
}

.close-btn {
  background: none;
  border: none;
  color: #a89875;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.close-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }

/* Sections */
.admin-section {
  padding: 14px 20px;
  border-bottom: 1px solid rgba(197, 160, 89, 0.12);
}
.section-title {
  margin: 0 0 12px;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #c5a059;
}

/* Process list */
.process-list { display: flex; flex-direction: column; gap: 8px; }

.process-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  padding: 8px 12px;
}

.proc-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.proc-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #e8d5b5;
}
.proc-desc {
  font-size: 0.75rem;
  color: #a89875;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* LED */
.led {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 5px currentColor;
}
.led-green  { background: #4caf50; color: #4caf50; }
.led-yellow { background: #ffc107; color: #ffc107; }
.led-red    { background: #f44336; color: #f44336; }
.led-grey   { background: #555; color: #555; box-shadow: none; }

/* Badges */
.proc-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.badge-green  { background: rgba(76,175,80,0.2);  color: #81c784; }
.badge-yellow { background: rgba(255,193,7,0.2);  color: #ffc107; }
.badge-red    { background: rgba(244,67,54,0.2);  color: #ef5350; }
.badge-grey   { background: rgba(100,100,100,0.2); color: #888; }

.uptime-row {
  margin-top: 10px;
  font-size: 0.8rem;
  color: #a89875;
}

/* Timing grid */
.timing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.timing-item {
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.timing-label {
  font-size: 0.72rem;
  color: #a89875;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.timing-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: #e8d5b5;
  font-family: monospace;
}
.next-turn-soon { color: #ffc107; }

/* Controls */
.controls-row {
  display: flex;
  gap: 8px;
}
.ctrl-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 7px;
  border: 1px solid transparent;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s, filter 0.15s;
}
.ctrl-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ctrl-btn:not(:disabled):hover { filter: brightness(1.15); }

.btn-green  { background: rgba(76,175,80,0.25);  border-color: rgba(76,175,80,0.5);  color: #81c784; }
.btn-red    { background: rgba(244,67,54,0.25);  border-color: rgba(244,67,54,0.5);  color: #ef5350; }
.btn-orange { background: rgba(255,152,0,0.25);  border-color: rgba(255,152,0,0.5);  color: #ffb74d; }
.btn-blue   { background: rgba(33,150,243,0.25); border-color: rgba(33,150,243,0.5); color: #64b5f6; }
.btn-force  { background: rgba(156,39,176,0.22); border-color: rgba(156,39,176,0.45); color: #ce93d8; }

.force-hint {
  font-size: 0.75rem;
  color: #a89875;
  margin: 0 0 10px;
}

/* Feedback */
.admin-message {
  margin: 0 20px;
  padding: 10px 14px;
  border-radius: 7px;
  font-size: 0.85rem;
  font-weight: 600;
}
.msg-ok  { background: rgba(76,175,80,0.18); color: #81c784; border: 1px solid rgba(76,175,80,0.35); }
.msg-err { background: rgba(244,67,54,0.18); color: #ef5350; border: 1px solid rgba(244,67,54,0.35); }

/* Loading / error */
.admin-loading, .admin-error {
  padding: 40px 20px;
  text-align: center;
  color: #a89875;
}
.admin-error { color: #ef5350; }

/* Footer */
.admin-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 20px;
  border-top: 1px solid rgba(197, 160, 89, 0.12);
}
.refresh-label { font-size: 0.72rem; color: #666; }
.refresh-btn {
  background: none;
  border: 1px solid rgba(197,160,89,0.25);
  border-radius: 6px;
  color: #a89875;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 3px 8px;
  transition: background 0.15s;
}
.refresh-btn:hover:not(:disabled) { background: rgba(197,160,89,0.1); }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Editable timing cell */
.timing-item-editable { grid-column: span 1; }

.timing-edit-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.timing-input {
  width: 62px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 5px;
  color: #e8d5b5;
  font-size: 0.88rem;
  font-weight: 700;
  font-family: monospace;
  padding: 2px 6px;
  text-align: right;
}
.timing-input:focus {
  outline: none;
  border-color: rgba(197,160,89,0.7);
}
.timing-input:disabled { opacity: 0.5; }

.timing-input-unit {
  font-size: 0.8rem;
  color: #a89875;
}

.timing-save-btn {
  background: rgba(76,175,80,0.2);
  border: 1px solid rgba(76,175,80,0.45);
  border-radius: 5px;
  color: #81c784;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 2px 7px;
  cursor: pointer;
  transition: background 0.15s;
}
.timing-save-btn:hover:not(:disabled) { background: rgba(76,175,80,0.35); }
.timing-save-btn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
