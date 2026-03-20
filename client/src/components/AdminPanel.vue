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
                  min="2"
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

        <!-- ── TESTING: CREAR PAGUS ──────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">🏛️ Testing</h3>
          <p class="force-hint">Crea un Pagus completo adyacente a tu territorio (centurias colonizadas + fortaleza + capital).</p>
          <div class="controls-row">
            <button class="ctrl-btn btn-force" :disabled="creatingPagus" @click="handleCreatePagus">
              {{ creatingPagus ? '⏳ Creando...' : '🏛️ Crear Pagus' }}
            </button>
            <button class="ctrl-btn btn-force" :disabled="spawningDummy" @click="handleSpawnDummy">
              {{ spawningDummy ? '⏳ Invocando...' : '🪆 Invocar DUMMY' }}
            </button>
          </div>
          <p v-if="pagusMsg" class="force-hint" :style="{ color: pagusOk ? '#86efac' : '#f87171', marginTop: '6px' }">
            {{ pagusOk ? '✅' : '❌' }} {{ pagusMsg }}
          </p>
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

        <!-- ── KAFKA AUDIT ───────────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">
            📨 Auditoría Kafka
            <span class="ai-count-badge" :class="auditConnected ? 'badge-green' : 'badge-grey'">
              {{ auditConnected ? 'conectado' : 'desconectado' }}
            </span>
          </h3>

          <div class="kafka-status-row">
            <span class="kafka-meta">Broker: {{ auditBrokers.join(', ') || '—' }}</span>
            <span class="kafka-meta">Flag: <code>KAFKA_AUDIT_ENABLED={{ auditEnabled ? 'true' : 'false' }}</code></span>
          </div>

          <div class="controls-row" style="margin-top:8px">
            <button
              class="ctrl-btn btn-kafka-test"
              :disabled="kafkaTesting"
              @click="handleKafkaTest('tax')"
              title="Envía TAX_COLLECTION a tax.collection"
            >{{ kafkaTesting === 'tax' ? '⏳' : '🧪 Test tax.collection' }}</button>

            <button
              class="ctrl-btn btn-kafka-test"
              :disabled="kafkaTesting"
              @click="handleKafkaTest('military')"
              title="Envía ARMY_MOVED a army.movement"
            >{{ kafkaTesting === 'military' ? '⏳' : '🧪 Test army.movement' }}</button>

            <button
              class="ctrl-btn btn-kafka-test"
              :disabled="kafkaTesting"
              @click="handleKafkaTest('harvest')"
              title="Envía HARVEST_COMPLETE a harvest.events"
            >{{ kafkaTesting === 'harvest' ? '⏳' : '🧪 Test harvest' }}</button>

            <button
              class="ctrl-btn btn-kafka-test"
              :disabled="kafkaTesting"
              @click="handleKafkaTest('production')"
              title="Envía MONTHLY_PRODUCTION a harvest.events"
            >{{ kafkaTesting === 'production' ? '⏳' : '🧪 Test producción' }}</button>

            <button
              class="ctrl-btn btn-kafka-test"
              :disabled="kafkaTesting"
              @click="handleKafkaTest('salary')"
              title="Envía SALARY_PAYMENT a salary.payments"
            >{{ kafkaTesting === 'salary' ? '⏳' : '🧪 Test salary' }}</button>
          </div>

          <p class="force-hint" style="margin-top:6px">
            ⚠️ Dentro de Docker el broker debe ser <code>kafka:9092</code>, no <code>localhost:9092</code>.
            Revisa la variable <code>KAFKA_BROKERS</code> en tu <code>.env</code>.
          </p>
        </section>

        <!-- ── AI AGENTS ──────────────────────────────────────────────────── -->
        <section class="admin-section">
          <h3 class="section-title">
            🤖 Agentes IA
            <span class="ai-count-badge">{{ agents.length }}</span>
          </h3>

          <!-- AI Control strip -->
          <div class="ai-control-strip">
            <button
              class="ai-toggle-btn"
              :class="aiEnabled ? 'toggle-on' : 'toggle-off'"
              :disabled="settingsLoading"
              @click="handleToggleAI"
              :title="aiEnabled ? 'IA activa — clic para desactivar' : 'IA desactivada — clic para activar'"
            >
              <span class="toggle-dot"></span>
              <span class="toggle-label">{{ aiEnabled ? 'IA Activa' : 'IA Off' }}</span>
            </button>
            <select
              v-model="aiProvider"
              class="ai-spawn-select"
              :disabled="settingsLoading"
              @change="handleSaveSetting('ai_provider', aiProvider)"
              title="Proveedor de decisiones IA"
            >
              <option value="procedural">🔧 Procedural (Gratis)</option>
              <option value="gemini">✨ Gemini Flash</option>
              <option value="openai">🤖 GPT-4o Mini</option>
            </select>
            <input
              v-model.number="aiBudget"
              type="number"
              min="1000"
              step="10000"
              class="ai-budget-input"
              :disabled="settingsLoading"
              title="Presupuesto máximo en tokens"
            />
            <button
              class="ctrl-btn btn-ai-save"
              :disabled="settingsLoading"
              @click="handleSaveSetting('max_token_budget', aiBudget)"
              title="Guardar presupuesto"
            >💾</button>
            <button
              class="ctrl-btn btn-ai-test"
              :disabled="settingsLoading || testing || aiProvider === 'procedural'"
              @click="handleTestConnection"
              title="Probar conexión con la API del proveedor seleccionado"
            >{{ testing ? '⏳' : '🔌 Probar' }}</button>
          </div>

          <!-- API key error banner -->
          <div v-if="aiLastError && aiProvider !== 'procedural'" class="ai-error-banner">
            <span class="ai-error-icon">⚠️</span>
            <div class="ai-error-body">
              <span class="ai-error-title">Error de API ({{ aiLastError.provider }})</span>
              <span class="ai-error-msg">{{ aiLastError.message }}</span>
            </div>
            <span class="ai-error-time">{{ aiLastError.timestamp ? new Date(aiLastError.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '' }}</span>
          </div>

          <!-- Spawn form -->
          <div class="ai-spawn-row">
            <label class="ai-spawn-label">Crear</label>
            <input
              v-model.number="spawnCount"
              type="number" min="1" max="10"
              class="ai-spawn-input"
              :disabled="spawning"
              title="Cantidad de agentes (máx. 10)"
              @input="spawnCount = Math.min(10, Math.max(1, spawnCount || 1))"
            />
            <select v-model="spawnType" class="ai-spawn-select" :disabled="spawning">
              <option value="farmer">🌾 Agricultor</option>
              <option value="expansionist">⚔️ Expansionista</option>
              <option value="balanced">⚖️ Equilibrado</option>
            </select>
            <button
              class="ctrl-btn btn-ai-spawn"
              :disabled="spawning || acting"
              @click="handleSpawnAgents"
            >{{ spawning ? '⏳' : '＋ Crear' }}</button>
            <button
              class="ctrl-btn btn-ai-cycle"
              :disabled="acting || spawning"
              @click="handleForceAITurn"
              title="Fuerza un ciclo de decisión IA ahora"
            >🔄 Ciclo IA</button>
          </div>

          <!-- Agent table -->
          <div v-if="agentLoading && agents.length === 0" class="ai-empty">Cargando agentes...</div>
          <div v-else-if="agents.length === 0" class="ai-empty">Sin agentes activos</div>
          <div v-else class="ai-table-wrap">
            <table class="ai-table">
              <thead>
                <tr>
                  <th class="ai-th ai-th-name">Nombre</th>
                  <th class="ai-th ai-th-num">Tipo</th>
                  <th class="ai-th ai-th-num">💰 Oro</th>
                  <th class="ai-th ai-th-num">🏰 Feudos</th>
                  <th class="ai-th ai-th-act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="agent in agents" :key="agent.player_id" class="ai-row">
                  <td class="ai-td ai-td-name">
                    <span
                      class="ai-color-dot"
                      :style="{ background: agent.color || '#888' }"
                    ></span>
                    {{ agent.display_name }}
                  </td>
                  <td class="ai-td ai-td-center">
                    <span
                      class="ai-profile-badge"
                      :class="{
                        'badge-expansionist': agent.ai_profile === 'expansionist',
                        'badge-balanced': agent.ai_profile === 'balanced'
                      }"
                    >{{ profileLabel(agent.ai_profile) }}</span>
                  </td>
                  <td class="ai-td ai-td-num">{{ formatGold(agent.gold) }}</td>
                  <td class="ai-td ai-td-num">{{ agent.territory_count }}</td>
                  <td class="ai-td ai-td-act">
                    <button
                      v-if="agent.capital_h3"
                      class="ai-goto-btn"
                      @click="$emit('go-to-hex', agent.capital_h3)"
                      title="Ir a la capital del agente"
                    >📍 Ir</button>
                    <span v-else class="ai-no-capital">—</span>
                    <button
                      class="ai-delete-btn"
                      :disabled="deletingId === agent.player_id"
                      @click="handleDeleteAgent(agent)"
                      title="Eliminar agente permanentemente"
                    >{{ deletingId === agent.player_id ? '⏳' : '🗑️' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Usage monitor -->
          <div class="ai-usage-monitor">
            <div class="usage-header">
              <span class="usage-title">📊 Consumo IA</span>
              <button
                class="ctrl-btn btn-usage-reset"
                :disabled="acting"
                @click="handleResetStats"
                title="Reiniciar contadores de uso"
              >↺ Reiniciar</button>
            </div>
            <div class="ai-progress">
              <div
                class="ai-progress-bar"
                :style="{ width: budgetPercent + '%' }"
                :class="{
                  'bar-warn':  budgetPercent > 50,
                  'bar-crit':  budgetPercent > 80
                }"
              ></div>
            </div>
            <div class="usage-numbers">
              {{ (usageTotals.total_tokens || 0).toLocaleString() }} /
              {{ aiBudget.toLocaleString() }} tokens
              &nbsp;·&nbsp;
              Coste: ${{ Number(usageTotals.total_cost || 0).toFixed(4) }}
            </div>
            <table v-if="usageRows.length > 0" class="usage-table">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Modelo</th>
                  <th>Llamadas</th>
                  <th>Tokens</th>
                  <th>Coste</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in usageRows" :key="`${row.player_id}-${row.model_name}`">
                  <td>{{ row.display_name }}</td>
                  <td><code>{{ row.model_name }}</code></td>
                  <td>{{ row.calls_count }}</td>
                  <td>{{ (row.total_tokens || 0).toLocaleString() }}</td>
                  <td>${{ Number(row.estimated_cost || 0).toFixed(4) }}</td>
                  <td>{{ row.last_call_at ? new Date(row.last_call_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="ai-empty" style="margin-top:6px">Sin registros de uso</div>
          </div>
        </section>

        <!-- ── ZONA DE PELIGRO ────────────────────────────────────────────── -->
        <section class="admin-section danger-section">
          <h3 class="section-title danger-title">⚠️ Zona de Peligro</h3>
          <p class="danger-hint">Estas acciones son irreversibles y afectan a todos los jugadores.</p>

          <div v-if="!showResetConfirm">
            <button class="ctrl-btn btn-danger-reset" @click="showResetConfirm = true" :disabled="acting">
              🗑️ Resetear Partida
            </button>
          </div>

          <div v-else class="reset-confirm-box">
            <p class="reset-confirm-text">
              ¿Seguro? Esto eliminará <strong>todos los bots, ejércitos, feudos, edificios, mensajes y notificaciones</strong>.
              Los jugadores conservan su cuenta pero empezarán con 50.000 de oro.
            </p>
            <div class="reset-confirm-actions">
              <button class="ctrl-btn btn-danger-confirm" :disabled="acting" @click="handleResetGame">
                {{ acting ? '⏳ Reseteando...' : '⚠️ Sí, resetear todo' }}
              </button>
              <button class="ctrl-btn btn-cancel" @click="showResetConfirm = false" :disabled="acting">
                Cancelar
              </button>
            </div>
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
  forceTurn, forceHarvest, forceExploration,
  getAIAgents, spawnAIFarmer, spawnAIAgent, forceAITurn,
  getAISettings, updateAISetting, getAIUsageStats, resetAIUsageStats, testAIConnection,
  deleteAIAgent, resetGame,
  getAuditStatus, testKafkaEvent,
  createAdminPagus,
} from '../services/mapApi.js';

const emit = defineEmits(['close', 'go-to-hex']);

const status  = ref(null);
const loading = ref(false);
const acting  = ref(false);
const error   = ref('');
const message = ref('');
const messageType = ref('msg-ok');
const turnDurationInput = ref(60);
const savingDuration = ref(false);
const showResetConfirm = ref(false);

// AI agents state
const agents       = ref([]);
const agentLoading = ref(false);
const spawnCount   = ref(1);
const spawnType    = ref('farmer');
const spawning     = ref(false);
const deletingId   = ref(null);

// AI proxy / budget state
const aiEnabled      = ref(false);
const aiProvider     = ref('procedural');
const aiBudget       = ref(100000);
const settingsLoading = ref(false);
const usageRows      = ref([]);
const usageTotals    = ref({ total_calls: 0, total_tokens: 0, total_cost: 0 });
const aiLastError    = ref(null);  // { provider, message, timestamp } | null
const testing        = ref(false);

// Kafka audit state
const auditEnabled   = ref(false);
const auditConnected = ref(false);
const auditBrokers   = ref([]);
const kafkaTesting   = ref(null); // 'tax' | 'military' | null

const creatingPagus = ref(false);
const pagusMsg      = ref('');
const pagusOk       = ref(false);
const spawningDummy = ref(false);

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

// ── AI helpers ──────────────────────────────────────────────────────────────
const PROFILE_LABELS = { farmer: '🌾 Agricultor', expansionist: '⚔️ Expansionista', balanced: '⚖️ Equilibrado' };
const profileLabel = (p) => PROFILE_LABELS[p] || p || '—';

const formatGold = (n) => {
  const v = parseInt(n) || 0;
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return String(v);
};

const fetchAgents = async () => {
  agentLoading.value = true;
  try {
    const data = await getAIAgents();
    if (data.success) agents.value = data.agents;
  } catch { /* silencioso */ } finally {
    agentLoading.value = false;
  }
};

const handleSpawnAgents = async () => {
  if (spawning.value) return;
  spawning.value = true;
  try {
    const data = await spawnAIAgent(spawnType.value, spawnCount.value);
    if (data.success) {
      const n = spawnCount.value;
      showMsg(data.message || `Agente${n > 1 ? 's' : ''} creado${n > 1 ? 's' : ''} correctamente`);
      await fetchAgents();
    } else {
      showMsg(data.message || 'Error al crear agente', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    spawning.value = false;
  }
};

const handleForceAITurn = () => runAction(forceAITurn, 'Ciclo IA ejecutado');

const handleDeleteAgent = async (agent) => {
  if (deletingId.value) return;
  const confirmed = confirm(
    `¿Eliminar al agente "${agent.display_name}"?\n\n` +
    `Se borrarán sus ejércitos, mensajes, edificios y se liberarán sus ${agent.territory_count} feudos. Esta acción no se puede deshacer.`
  );
  if (!confirmed) return;
  deletingId.value = agent.player_id;
  try {
    const data = await deleteAIAgent(agent.player_id);
    if (data.success) {
      agents.value = agents.value.filter(a => a.player_id !== agent.player_id);
      showMsg(data.message || 'Agente eliminado correctamente');
    } else {
      showMsg(data.message || 'Error al eliminar agente', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    deletingId.value = null;
  }
};

// ── AI proxy helpers ─────────────────────────────────────────────────────────
const budgetPercent = computed(() => {
  const budget = aiBudget.value || 1;
  return Math.min(100, Math.round((usageTotals.value.total_tokens || 0) / budget * 100));
});

const fetchAISettings = async () => {
  try {
    const data = await getAISettings();
    if (data.success && data.settings) {
      aiEnabled.value  = data.settings.ai_enabled === 'true';
      aiProvider.value = data.settings.ai_provider || 'procedural';
      aiBudget.value   = parseInt(data.settings.max_token_budget) || 100000;
      aiLastError.value = data.lastError || null;
    }
  } catch { /* silencioso */ }
};

const fetchUsageStats = async () => {
  try {
    const data = await getAIUsageStats();
    if (data.success) {
      usageRows.value   = data.rows   || [];
      usageTotals.value = data.totals || { total_calls: 0, total_tokens: 0, total_cost: 0 };
    }
  } catch { /* silencioso */ }
};

const handleSaveSetting = async (key, value) => {
  if (settingsLoading.value) return;
  settingsLoading.value = true;
  try {
    const data = await updateAISetting(key, String(value));
    if (data.success) {
      showMsg(data.message || `${key} actualizado`);
    } else {
      showMsg(data.message || 'Error al guardar', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    settingsLoading.value = false;
  }
};

const handleToggleAI = async () => {
  const newVal = !aiEnabled.value;
  aiEnabled.value = newVal; // optimistic update
  await handleSaveSetting('ai_enabled', newVal ? 'true' : 'false');
};

const handleTestConnection = async () => {
  if (testing.value) return;
  testing.value = true;
  try {
    const data = await testAIConnection();
    if (data.success) {
      aiLastError.value = null;
      showMsg(`✅ Conexión OK con ${data.provider}`);
    } else {
      aiLastError.value = { provider: data.provider, message: data.message, timestamp: new Date().toISOString() };
      showMsg(`Error de conexión: ${data.message}`, 'msg-err');
    }
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    aiLastError.value = { provider: aiProvider.value, message: msg, timestamp: new Date().toISOString() };
    showMsg(`Error: ${msg}`, 'msg-err');
  } finally {
    testing.value = false;
  }
};

const handleResetStats = async () => {
  if (!confirm('¿Reiniciar todos los contadores de uso de IA?')) return;
  try {
    const data = await resetAIUsageStats();
    if (data.success) {
      usageRows.value   = [];
      usageTotals.value = { total_calls: 0, total_tokens: 0, total_cost: 0 };
      showMsg('Estadísticas reiniciadas');
    } else {
      showMsg(data.message || 'Error al reiniciar', 'msg-err');
    }
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  }
};

// ── Kafka audit ──────────────────────────────────────────────────────────────
const fetchAuditStatus = async () => {
  try {
    const data = await getAuditStatus();
    auditEnabled.value   = data.enabled   ?? false;
    auditConnected.value = data.connected ?? false;
    auditBrokers.value   = data.brokers   ?? [];
  } catch { /* silencioso */ }
};

const handleKafkaTest = async (channel) => {
  if (kafkaTesting.value) return;
  kafkaTesting.value = channel;
  try {
    const data = await testKafkaEvent(channel);
    showMsg(data.ok ? data.message : (data.message || 'Error al enviar'), data.ok ? 'msg-ok' : 'msg-err');
  } catch (e) {
    showMsg(`Error: ${e.response?.data?.message || e.message}`, 'msg-err');
  } finally {
    kafkaTesting.value = null;
  }
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
  if (!secs || secs < 2 || secs > 3600) {
    showMsg('El valor debe estar entre 2 y 3600 segundos', 'msg-err');
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

const handleSpawnDummy = async () => {
  if (spawningDummy.value) return;
  spawningDummy.value = true;
  pagusMsg.value = '';
  try {
    const data = await spawnAIAgent('dummy');
    pagusOk.value  = data.success;
    pagusMsg.value = data.success
      ? `DUMMY "${data.name}" invocado en ${data.h3_index} (${data.hexes_claimed} centurias)`
      : data.message || 'Error desconocido';
  } catch (err) {
    pagusOk.value  = false;
    pagusMsg.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    spawningDummy.value = false;
  }
};

const handleCreatePagus = async () => {
  if (creatingPagus.value) return;
  creatingPagus.value = true;
  pagusMsg.value = '';
  try {
    const data = await createAdminPagus();
    if (data.success) {
      pagusOk.value  = true;
      pagusMsg.value = `"${data.division_name}" creado — ${data.hex_count} centurias (capital: ${data.capital_h3})`;
    } else {
      pagusOk.value  = false;
      pagusMsg.value = data.message || 'Error desconocido';
    }
  } catch (err) {
    pagusOk.value  = false;
    pagusMsg.value = err?.response?.data?.message || 'Error de conexión';
  } finally {
    creatingPagus.value = false;
  }
};

const handleResetGame = async () => {
  if (acting.value) return;
  acting.value = true;
  error.value  = '';
  message.value = '';
  try {
    const data = await resetGame();
    showResetConfirm.value = false;
    localStorage.setItem('feudos_transparency', '40');
    messageType.value = 'msg-ok';
    message.value = data.message || 'Partida reseteada correctamente.';
    await fetchStatus();
  } catch (err) {
    messageType.value = 'msg-error';
    message.value = err?.response?.data?.message || 'Error al resetear la partida.';
  } finally {
    acting.value = false;
  }
};

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  fetchStatus();
  fetchAgents();
  fetchAISettings();
  fetchUsageStats();
  fetchAuditStatus();
  refreshTimer = setInterval(() => {
    fetchStatus();
    fetchAgents();
    fetchUsageStats();
    fetchAuditStatus();
  }, 10000);
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
  width: min(640px, 95vw);
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

/* ── AI Agents section ────────────────────────────────────────────── */
.ai-count-badge {
  display: inline-block;
  margin-left: 8px;
  background: rgba(197,160,89,0.2);
  color: #c5a059;
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 10px;
  padding: 1px 8px;
  vertical-align: middle;
  letter-spacing: 0;
  text-transform: none;
}

.ai-spawn-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.ai-spawn-label {
  font-size: 0.78rem;
  color: #a89875;
  flex-shrink: 0;
}

.ai-spawn-input {
  width: 48px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 5px;
  color: #e8d5b5;
  font-size: 0.85rem;
  font-weight: 700;
  font-family: monospace;
  padding: 4px 6px;
  text-align: center;
}
.ai-spawn-input:focus { outline: none; border-color: rgba(197,160,89,0.7); }
.ai-spawn-input:disabled { opacity: 0.5; }

.ai-spawn-select {
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 5px;
  color: #e8d5b5;
  font-size: 0.82rem;
  padding: 4px 8px;
  cursor: pointer;
}
.ai-spawn-select:disabled { opacity: 0.5; }

.btn-ai-spawn {
  flex: 1;
  background: rgba(76,175,80,0.2);
  border-color: rgba(76,175,80,0.45);
  color: #81c784;
  padding: 5px 10px;
  min-width: 72px;
}
.btn-ai-cycle {
  flex: 1;
  background: rgba(33,150,243,0.2);
  border-color: rgba(33,150,243,0.45);
  color: #64b5f6;
  padding: 5px 10px;
  min-width: 90px;
}

.ai-empty {
  font-size: 0.8rem;
  color: #666;
  text-align: center;
  padding: 14px 0 6px;
}

.ai-table-wrap {
  overflow-x: auto;
  border-radius: 7px;
  border: 1px solid rgba(197,160,89,0.15);
}

.ai-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.ai-th {
  background: rgba(0,0,0,0.35);
  color: #c5a059;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 7px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(197,160,89,0.2);
  white-space: nowrap;
}
.ai-th-num { text-align: right; }
.ai-th-act { width: 90px; }

.ai-row { border-bottom: 1px solid rgba(197,160,89,0.08); }
.ai-row:last-child { border-bottom: none; }
.ai-row:hover { background: rgba(197,160,89,0.05); }

.ai-td {
  padding: 7px 10px;
  color: #e8d5b5;
  vertical-align: middle;
}
.ai-td-name {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-td-center { text-align: center; }
.ai-td-num { text-align: right; font-family: monospace; font-weight: 600; }
.ai-td-act { text-align: center; }

.ai-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1.5px solid rgba(255,255,255,0.3);
}

.ai-profile-badge {
  font-size: 0.72rem;
  background: rgba(197,160,89,0.15);
  color: #c5a059;
  border-radius: 8px;
  padding: 2px 7px;
  white-space: nowrap;
}
.ai-profile-badge.badge-expansionist {
  background: rgba(178,34,34,0.18);
  color: #ef9a9a;
}
.ai-profile-badge.badge-balanced {
  background: rgba(21,101,192,0.18);
  color: #90caf9;
}

.ai-goto-btn {
  background: rgba(197,160,89,0.15);
  border: 1px solid rgba(197,160,89,0.3);
  color: #c5a059;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.ai-goto-btn:hover { background: rgba(197,160,89,0.3); }

.ai-delete-btn {
  background: rgba(244,67,54,0.12);
  border: 1px solid rgba(244,67,54,0.3);
  color: #ef5350;
  font-size: 0.78rem;
  border-radius: 5px;
  padding: 3px 7px;
  cursor: pointer;
  margin-left: 4px;
  transition: background 0.15s;
}
.ai-delete-btn:hover:not(:disabled) { background: rgba(244,67,54,0.28); }
.ai-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.ai-no-capital {
  color: #555;
  font-size: 0.8rem;
}

/* ── AI Control Strip ────────────────────────────────────────────────────── */
.ai-control-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.ai-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 6px;
  border-radius: 20px;
  border: 1px solid;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  transition: all 0.15s;
  min-width: 95px;
}
.ai-toggle-btn.toggle-on {
  background: rgba(56,142,60,0.18);
  border-color: rgba(56,142,60,0.5);
  color: #81c784;
}
.ai-toggle-btn.toggle-off {
  background: rgba(97,97,97,0.15);
  border-color: rgba(97,97,97,0.3);
  color: #9e9e9e;
}
.toggle-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.ai-budget-input {
  width: 90px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 5px;
  color: #e0e0e0;
  font-size: 0.78rem;
  padding: 4px 6px;
}
.btn-ai-save {
  padding: 4px 8px;
  min-width: unset;
  background: rgba(197,160,89,0.12);
  border-color: rgba(197,160,89,0.3);
  color: #c5a059;
}
.btn-ai-save:hover:not(:disabled) { background: rgba(197,160,89,0.25); }

.btn-ai-test {
  padding: 4px 10px;
  min-width: unset;
  background: rgba(100,181,246,0.12);
  border-color: rgba(100,181,246,0.3);
  color: #64b5f6;
}
.btn-ai-test:hover:not(:disabled) { background: rgba(100,181,246,0.25); }

.ai-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(244,67,54,0.1);
  border: 1px solid rgba(244,67,54,0.4);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.ai-error-icon { font-size: 1.05rem; flex-shrink: 0; margin-top: 1px; }
.ai-error-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ai-error-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: #ef5350;
}
.ai-error-msg {
  font-size: 0.75rem;
  color: #ef9a9a;
  word-break: break-word;
}
.ai-error-time {
  font-size: 0.7rem;
  color: #888;
  flex-shrink: 0;
  align-self: flex-start;
  white-space: nowrap;
}

/* ── AI Usage Monitor ────────────────────────────────────────────────────── */
.ai-usage-monitor {
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
}
.usage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.usage-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #aaa;
  letter-spacing: 0.05em;
}
.btn-usage-reset {
  font-size: 0.7rem;
  padding: 3px 8px;
  background: rgba(97,97,97,0.15);
  border-color: rgba(97,97,97,0.3);
  color: #9e9e9e;
}
.btn-usage-reset:hover:not(:disabled) { background: rgba(97,97,97,0.3); }
.ai-progress {
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}
.ai-progress-bar {
  height: 100%;
  border-radius: 3px;
  background: #42a5f5;
  transition: width 0.4s ease, background 0.4s ease;
  min-width: 2px;
}
.ai-progress-bar.bar-warn { background: #ffa726; }
.ai-progress-bar.bar-crit { background: #ef5350; }
.usage-numbers {
  font-size: 0.73rem;
  color: #888;
  margin-bottom: 8px;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
}
.usage-table th {
  color: #777;
  font-weight: 600;
  text-align: left;
  padding: 3px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.usage-table td {
  color: #ccc;
  padding: 3px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.usage-table code {
  font-size: 0.68rem;
  background: rgba(255,255,255,0.07);
  border-radius: 3px;
  padding: 1px 4px;
  color: #90caf9;
}

/* ── Danger zone ──────────────────────────────────────────────────── */
.danger-section {
  border: 1px solid rgba(239, 83, 80, 0.25);
  border-radius: 6px;
  margin: 12px 8px;
  background: rgba(239, 83, 80, 0.04);
}
.danger-title { color: #ef5350 !important; }
.danger-hint {
  font-size: 0.76rem;
  color: #888;
  margin: 0 0 12px;
}
.btn-danger-reset {
  background: rgba(183, 28, 28, 0.15);
  border-color: rgba(239, 83, 80, 0.4);
  color: #ef9a9a;
}
.btn-danger-reset:hover:not(:disabled) {
  background: rgba(183, 28, 28, 0.3);
  border-color: #ef5350;
  color: #fff;
}
.reset-confirm-box {
  background: rgba(183, 28, 28, 0.12);
  border: 1px solid rgba(239, 83, 80, 0.35);
  border-radius: 6px;
  padding: 12px 14px;
}
.reset-confirm-text {
  font-size: 0.8rem;
  color: #ef9a9a;
  margin: 0 0 12px;
  line-height: 1.5;
}
.reset-confirm-text strong { color: #fff; }
.reset-confirm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-danger-confirm {
  background: rgba(183, 28, 28, 0.6);
  border-color: #ef5350;
  color: #fff;
  font-weight: 700;
}
.btn-danger-confirm:hover:not(:disabled) {
  background: #c62828;
  border-color: #ef5350;
}
.btn-cancel {
  background: transparent;
  border-color: rgba(255,255,255,0.2);
  color: #999;
}
.btn-cancel:hover:not(:disabled) {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.4);
  color: #ccc;
}

/* ── Kafka audit ─────────────────────────────────────────────────────────── */
.kafka-status-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.kafka-meta {
  font-size: 11px;
  color: #a09070;
}
.kafka-meta code {
  background: rgba(255,255,255,0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
.btn-kafka-test {
  background: rgba(33, 150, 243, 0.15);
  border-color: rgba(33, 150, 243, 0.5);
  color: #64b5f6;
}
.btn-kafka-test:hover:not(:disabled) {
  background: rgba(33, 150, 243, 0.3);
}
</style>
