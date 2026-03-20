<template>
  <div class="diplomacy-panel">

    <!-- Tabs -->
    <div class="dip-tabs">
      <button
        v-for="tab in tabs" :key="tab.id"
        class="dip-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
        <span v-if="tab.id === 'pending' && pending.length" class="dip-badge">{{ pending.length }}</span>
      </button>
    </div>

    <!-- TAB: Mis Tratados -->
    <div v-if="activeTab === 'active'" class="dip-section">
      <div v-if="loading" class="dip-empty">Cargando…</div>
      <div v-else-if="relations.length === 0" class="dip-empty">No tienes tratados activos.</div>
      <div v-else class="relation-list">
        <div
          v-for="rel in relations"
          :key="rel.relation_id"
          class="relation-card"
          :class="`rel-${rel.type_code}`"
        >
          <div class="rel-header">
            <span class="rel-type-badge">{{ rel.type_name }}</span>
            <span class="rel-oath">{{ rel.oath }}</span>
          </div>
          <div class="rel-meta">
            <span class="rel-partner">
              {{ rel.from_player_id === myPlayerId ? '→ ' + rel.to_name : '← ' + rel.from_name }}
            </span>
            <span v-if="rel.effective_rate" class="rel-rate">{{ (rel.effective_rate * 100).toFixed(0) }}% ingresos</span>
            <span v-if="rel.terms_fixed_pay" class="rel-rate">{{ rel.terms_fixed_pay.toLocaleString() }} 💰/mes</span>
            <span v-if="rel.expires_at_turn" class="rel-expiry">⏳ Expira turno {{ rel.expires_at_turn }}</span>
          </div>
          <div v-if="treatyInfo(rel.type_code)" class="rel-info">
            <p class="rel-info-desc">{{ treatyInfo(rel.type_code).desc }}</p>
            <div class="rel-info-rows">
              <span class="rel-info-item"><span class="rel-info-label">⏱ Duración:</span> {{ treatyInfo(rel.type_code).duration }}</span>
              <span class="rel-info-item"><span class="rel-info-label">✂️ Ruptura:</span> {{ treatyInfo(rel.type_code).breaking }}</span>
              <span class="rel-info-item"><span class="rel-info-label">📋 Implica:</span> {{ treatyInfo(rel.type_code).implies }}</span>
            </div>
          </div>
          <div class="rel-actions">
            <button
              v-if="rel.can_break"
              class="btn-break"
              :disabled="breaking === rel.relation_id"
              @click="doBreak(rel)"
            >
              {{ breaking === rel.relation_id ? '…' : 'Romper' }}
            </button>
            <span v-else class="rel-locked" title="Este tratado no puede romperse unilateralmente">🔒</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB: Propuestas recibidas -->
    <div v-if="activeTab === 'pending'" class="dip-section">
      <div v-if="loading" class="dip-empty">Cargando…</div>
      <div v-else-if="pending.length === 0" class="dip-empty">Sin propuestas pendientes.</div>
      <div v-else class="relation-list">
        <div
          v-for="rel in pending"
          :key="rel.relation_id"
          class="relation-card rel-pending"
        >
          <div class="rel-header">
            <span class="rel-type-badge">{{ rel.type_name }}</span>
            <span class="rel-oath">{{ rel.oath }}</span>
          </div>
          <div class="rel-meta">
            <span class="rel-partner">De: <strong>{{ rel.from_name }}</strong></span>
            <span v-if="rel.effective_rate" class="rel-rate">{{ (rel.effective_rate * 100).toFixed(0) }}% de tus ingresos</span>
            <span v-if="rel.terms_fixed_pay" class="rel-rate">Pago mensual: {{ rel.terms_fixed_pay.toLocaleString() }} 💰</span>
            <span v-if="rel.terms_duration_months" class="rel-rate">⏳ Duración: {{ rel.terms_duration_months }} meses</span>
          </div>
          <div v-if="treatyInfo(rel.type_code)" class="rel-info">
            <p class="rel-info-desc">{{ treatyInfo(rel.type_code).desc }}</p>
            <div class="rel-info-rows">
              <span class="rel-info-item"><span class="rel-info-label">⏱ Duración:</span> {{ treatyInfo(rel.type_code).duration }}</span>
              <span class="rel-info-item"><span class="rel-info-label">✂️ Ruptura:</span> {{ treatyInfo(rel.type_code).breaking }}</span>
              <span class="rel-info-item"><span class="rel-info-label">📋 Implica:</span> {{ treatyInfo(rel.type_code).implies }}</span>
            </div>
          </div>
          <div class="rel-actions">
            <button class="btn-accept" :disabled="accepting === rel.relation_id" @click="doAccept(rel)">
              {{ accepting === rel.relation_id ? '…' : 'Aceptar' }}
            </button>
            <button class="btn-break" :disabled="breaking === rel.relation_id" @click="doBreak(rel)">
              {{ breaking === rel.relation_id ? '…' : 'Rechazar' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB: Proponer tratado -->
    <div v-if="activeTab === 'propose'" class="dip-section">
      <form class="propose-form" @submit.prevent="doPropose">

        <!-- Tipo de relación -->
        <div class="form-group">
          <label>Tipo de tratado</label>
          <div class="type-grid">
            <button
              v-for="t in availableTypes"
              :key="t.id"
              type="button"
              class="type-btn"
              :class="{ selected: form.type_code === t.code }"
              :title="typeTooltip(t)"
              @click="selectType(t)"
            >
              <span class="type-icon">{{ typeIcon(t.code) }}</span>
              <span class="type-name">{{ typeLabel(t) }}</span>
            </button>
          </div>
        </div>

        <!-- Jugador destinatario -->
        <div class="form-group">
          <label>Jugador destinatario</label>
          <div class="player-search-wrap">
            <input
              v-model="playerSearch"
              type="text"
              class="dip-input"
              :class="{ 'input-selected': selectedPlayer }"
              placeholder="Buscar por linaje…"
              autocomplete="off"
              @input="onPlayerSearchInput"
            />
            <button v-if="selectedPlayer" class="clear-player" type="button" @click="clearPlayer" title="Limpiar">✕</button>
            <div v-if="playerResults.length" class="player-dropdown">
              <button
                v-for="p in playerResults"
                :key="p.player_id"
                type="button"
                class="player-option"
                @click="selectPlayer(p)"
              >
                <span class="player-option-name">{{ p.name }}</span>
                <span class="player-option-user">@{{ p.username }}</span>
              </button>
            </div>
            <div v-else-if="searchingPlayer" class="player-dropdown">
              <span class="player-searching">Buscando…</span>
            </div>
            <div v-else-if="playerSearch.length >= 2 && !selectedPlayer" class="player-dropdown">
              <span class="player-searching">Sin resultados</span>
            </div>
          </div>
          <p v-if="selectedPlayer" class="form-hint selected-hint">✓ {{ selectedPlayer.name }} (ID {{ selectedPlayer.player_id }})</p>
        </div>

        <!-- Términos según el tipo -->
        <template v-if="selectedType">

          <!-- Tributo: tasa y duración -->
          <template v-if="form.type_code === 'tributo'">
            <div class="form-group">
              <label>Tasa de tributo (5–10%)</label>
              <div class="slider-row">
                <input type="range" v-model.number="form.terms_rate_pct" min="5" max="10" step="1" class="dip-slider" />
                <span class="slider-val">{{ form.terms_rate_pct }}%</span>
              </div>
            </div>
            <div class="form-group">
              <label>Duración (12–120 meses)</label>
              <div class="slider-row">
                <input type="range" v-model.number="form.terms_duration_months" min="12" max="120" step="6" class="dip-slider" />
                <span class="slider-val">{{ form.terms_duration_months }} meses ({{ Math.round(form.terms_duration_months / 12) }} años)</span>
              </div>
            </div>
          </template>

          <!-- Mercenariado: pago fijo y duración -->
          <template v-if="form.type_code === 'mercenariado'">
            <div class="form-group">
              <label>Pago mensual (oro)</label>
              <input type="number" v-model.number="form.terms_fixed_pay" class="dip-input" min="100" step="100" placeholder="Mínimo 100" />
            </div>
            <div class="form-group">
              <label>Duración (6–24 meses)</label>
              <div class="slider-row">
                <input type="range" v-model.number="form.terms_duration_months" min="6" max="24" step="3" class="dip-slider" />
                <span class="slider-val">{{ form.terms_duration_months }} meses</span>
              </div>
            </div>
          </template>

        </template>

        <!-- Preview del juramento -->
        <div v-if="selectedType && selectedPlayer" class="oath-preview">
          <span class="oath-label">Tu juramento:</span>
          <em>{{ resolveOath(selectedType.oath_payer_template, 'ti', 'el destinatario') }}</em>
        </div>

        <!-- Descripción del tipo seleccionado -->
        <div v-if="selectedType && treatyInfo(selectedType.code)" class="rel-info">
          <p class="rel-info-desc">{{ treatyInfo(selectedType.code).desc }}</p>
          <div class="rel-info-rows">
            <span class="rel-info-item"><span class="rel-info-label">⏱ Duración:</span> {{ treatyInfo(selectedType.code).duration }}</span>
            <span class="rel-info-item"><span class="rel-info-label">✂️ Ruptura:</span> {{ treatyInfo(selectedType.code).breaking }}</span>
            <span class="rel-info-item"><span class="rel-info-label">📋 Implica:</span> {{ treatyInfo(selectedType.code).implies }}</span>
          </div>
        </div>

        <p v-if="proposeError" class="form-error">{{ proposeError }}</p>
        <p v-if="proposeOk" class="form-ok">{{ proposeOk }}</p>

        <button
          type="submit"
          class="btn-propose"
          :disabled="!form.type_code || !form.to_player_id || proposing"
        >
          {{ proposing ? 'Enviando…' : 'Enviar propuesta' }}
        </button>
      </form>
    </div>

    <p v-if="errorMsg" class="dip-error">{{ errorMsg }}</p>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import {
  getMyRelations, getPendingRelations, getRelationTypes,
  proposeRelation, acceptRelation, breakRelation, searchPlayers,
} from '@/services/mapApi.js';

const props = defineProps({
  myPlayerId:    { type: Number, required: true },
  myCultureId:   { type: Number, default: null },
});

const emit = defineEmits(['refresh']);

// ── Estado ────────────────────────────────────────────────────
const tabs = [
  { id: 'active',  label: 'Mis Tratados' },
  { id: 'pending', label: 'Propuestas' },
  { id: 'propose', label: 'Proponer' },
];
const activeTab   = ref('active');
const loading     = ref(false);
const errorMsg    = ref('');
const relations   = ref([]);
const pending     = ref([]);
const types       = ref([]);
const breaking    = ref(null);
const accepting   = ref(null);
const proposing   = ref(false);
const proposeError = ref('');
const proposeOk    = ref('');

const form = ref({
  type_code:             null,
  to_player_id:          null,
  terms_rate_pct:        5,
  terms_duration_months: 12,
  terms_fixed_pay:       500,
});

// ── Búsqueda de jugador ────────────────────────────────────────
const playerSearch    = ref('');
const playerResults   = ref([]);
const selectedPlayer  = ref(null);  // { player_id, name }
const searchingPlayer = ref(false);

let searchTimer = null;
async function onPlayerSearchInput() {
  selectedPlayer.value = null;
  form.value.to_player_id = null;
  clearTimeout(searchTimer);
  if (playerSearch.value.length < 2) { playerResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    searchingPlayer.value = true;
    try {
      const res = await searchPlayers(playerSearch.value);
      playerResults.value = res.players ?? [];
    } finally {
      searchingPlayer.value = false;
    }
  }, 300);
}

function selectPlayer(p) {
  selectedPlayer.value = p;
  form.value.to_player_id = p.player_id;
  playerSearch.value = p.name;
  playerResults.value = [];
}

function clearPlayer() {
  selectedPlayer.value = null;
  form.value.to_player_id = null;
  playerSearch.value = '';
  playerResults.value = [];
}

// ── Computed ──────────────────────────────────────────────────
const selectedType = computed(() => types.value.find(t => t.code === form.value.type_code) ?? null);

const availableTypes = computed(() => types.value.filter(t => {
  if (!t.creator_cultures || t.creator_cultures.length === 0) return true;
  return props.myCultureId !== null && t.creator_cultures.includes(props.myCultureId);
}));

// ── Carga inicial ─────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadRelations(), loadTypes()]);
});

watch(activeTab, async (tab) => {
  if (tab === 'active')  await loadRelations();
  if (tab === 'pending') await loadRelations();
});

async function loadRelations() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const [myRes, pendRes] = await Promise.all([getMyRelations(), getPendingRelations()]);
    relations.value = myRes.relations  ?? [];
    pending.value   = pendRes.pending  ?? [];
  } catch {
    errorMsg.value = 'Error al cargar las relaciones.';
  } finally {
    loading.value = false;
  }
}

async function loadTypes() {
  try {
    const res = await getRelationTypes();
    types.value = res.types ?? [];
  } catch {
    errorMsg.value = 'Error al cargar los tipos de tratado.';
  }
}

// ── Acciones ──────────────────────────────────────────────────
async function doAccept(rel) {
  accepting.value = rel.relation_id;
  errorMsg.value  = '';
  try {
    await acceptRelation(rel.relation_id);
    await loadRelations();
    activeTab.value = 'active';
  } catch (e) {
    errorMsg.value = e?.response?.data?.message ?? 'Error al aceptar el tratado.';
  } finally {
    accepting.value = null;
  }
}

async function doBreak(rel) {
  if (!confirm(`¿Romper el tratado "${rel.oath}"?`)) return;
  breaking.value = rel.relation_id;
  errorMsg.value = '';
  try {
    await breakRelation(rel.relation_id);
    await loadRelations();
  } catch (e) {
    errorMsg.value = e?.response?.data?.message ?? 'Error al romper el tratado.';
  } finally {
    breaking.value = null;
  }
}

async function doPropose() {
  proposeError.value = '';
  proposeOk.value    = '';
  proposing.value    = true;
  try {
    const payload = {
      type_code:    form.value.type_code,
      to_player_id: form.value.to_player_id,
    };
    if (form.value.type_code === 'tributo') {
      payload.terms_rate            = form.value.terms_rate_pct / 100;
      payload.terms_duration_months = form.value.terms_duration_months;
    }
    if (form.value.type_code === 'mercenariado') {
      payload.terms_fixed_pay       = form.value.terms_fixed_pay;
      payload.terms_duration_months = form.value.terms_duration_months;
    }
    const res = await proposeRelation(payload);
    proposeOk.value = `Propuesta de "${res.type_name}" enviada correctamente.`;
    form.value.to_player_id = null;
    form.value.type_code    = null;
    selectedPlayer.value    = null;
    playerSearch.value      = '';
    playerResults.value     = [];
  } catch (e) {
    proposeError.value = e?.response?.data?.message ?? 'Error al enviar la propuesta.';
  } finally {
    proposing.value = false;
  }
}

function selectType(t) {
  form.value.type_code           = t.code;
  form.value.terms_rate_pct      = 5;
  form.value.terms_duration_months = t.code === 'mercenariado' ? 6 : 12;
  form.value.terms_fixed_pay     = 500;
  proposeError.value = '';
  proposeOk.value    = '';
}

// ── Helpers UI ────────────────────────────────────────────────
function resolveOath(template, payerName, receiverName) {
  if (!template) return '';
  return template.replace('{payer}', payerName).replace('{receiver}', receiverName);
}

const TYPE_LABELS = {
  devotio:      'Juramento de Lealtad',
  clientela:    'Solicitar Protección',
  hospitium:    'Hospitium',
  rehenes:      'Exigir Rehenes',
  mercenariado: 'Contratar Mercenario',
  alianza:      'Firmar Alianza',
  tributo:      'Exigir Tributo',
  guerra:       'Declarar Guerra',
};

function typeLabel(t) {
  return TYPE_LABELS[t.code] ?? t.name;
}

function typeIcon(code) {
  const icons = {
    devotio:      '⚔️',
    clientela:    '🛡️',
    hospitium:    '🤝',
    rehenes:      '⛓️',
    mercenariado: '💰',
    alianza:      '🔗',
    tributo:      '👑',
    guerra:       '🔥',
  };
  return icons[code] ?? '📜';
}

const TREATY_INFO = {
  devotio: {
    desc:     'Juramento sagrado de fidelidad personal al servicio de un caudillo. El devoto combate bajo su mando y obtiene +5% de ataque y defensa en batalla.',
    duration: 'Indefinida — hasta la muerte del devoto o del caudillo.',
    breaking: 'Irrevocable. Ninguna de las partes puede romperlo unilateralmente.',
    implies:  'El devoto pierde autonomía militar y queda vinculado al caudillo. El caudillo debe honrar y proteger al devoto.',
  },
  clientela: {
    desc:     'El cliente se pone bajo la protección de un patrón poderoso. A cambio, cede el 10% de sus ingresos mensuales como señal de dependencia.',
    duration: 'Indefinida mientras ambas partes cumplan.',
    breaking: 'Solo el cliente puede romperlo unilateralmente. El patrón no puede expulsarlo.',
    implies:  'El patrón se compromete a defender al cliente militarmente. El cliente no puede atacar al patrón.',
  },
  hospitium: {
    desc:     'Hospitalidad y amistad mutua entre dos casas. No implica tributo ni obediencia militar, solo respeto y cooperación informal.',
    duration: 'Indefinida. Sin fecha de caducidad.',
    breaking: 'Cualquiera de las partes puede romperlo libremente.',
    implies:  'Libre paso de mensajeros y comerciantes. Acuerdo informal de no agresión. Puede firmarse con múltiples jugadores.',
  },
  rehenes: {
    desc:     'Una parte entrega rehenes en garantía de su lealtad. El custodio percibe el 2% de los ingresos mensuales del retenido como compensación.',
    duration: 'Definida por las partes al firmar.',
    breaking: 'Solo el custodio puede liberarlos. El retenido no puede romper el acuerdo.',
    implies:  'El retenido no puede declarar guerra al custodio mientras dure el acuerdo. El impago de la garantía constituye traición.',
  },
  mercenariado: {
    desc:     'Contrato militar por el que una facción provee tropas a otra a cambio de un pago mensual fijo acordado de antemano.',
    duration: 'Definida (6–24 meses según contrato).',
    breaking: 'Ambas partes pueden romperlo. Se rescinde automáticamente por impago.',
    implies:  'El mercenario provee tropas bajo el mando del contratante. El impago genera penalizaciones diplomáticas.',
  },
  alianza: {
    desc:     'Pacto militar entre iguales. Las tropas de ambos jugadores se combinan en combate y comparten victorias y territorio.',
    duration: 'Indefinida mientras ninguna parte la rompa.',
    breaking: 'Cualquiera de las partes puede romperla en cualquier momento.',
    implies:  'Obligación mutua de defensa. Sin tributo entre aliados. Ninguno puede atacar al otro mientras dure.',
  },
  tributo: {
    desc:     'El tributario paga un porcentaje de sus ingresos (5–10%) al exactor durante el periodo pactado. Señal de sometimiento político.',
    duration: 'Definida (12–120 meses). Expira automáticamente.',
    breaking: 'Cualquiera puede romperlo, pero hacerlo otorga a la otra parte un casus belli legítimo.',
    implies:  'El exactor puede declarar guerra si hay impago. El tributario queda políticamente subordinado durante la vigencia.',
  },
  guerra: {
    desc:     'Estado de guerra abierta declarada formalmente. Habilita el combate sin restricciones, el saqueo y la conquista de territorios.',
    duration: 'Indefinida hasta que se firme la paz o uno de los bandos sea derrotado.',
    breaking: 'Termina por acuerdo mutuo de paz o por victoria militar.',
    implies:  'Bloquea la firma de nuevos tratados con el bloque enemigo. Libre combate y saqueo. No hay paso seguro.',
  },
};

function treatyInfo(code) {
  return TREATY_INFO[code] ?? null;
}

function typeTooltip(t) {
  const info = treatyInfo(t.code);
  return info ? info.desc : '';
}
</script>

<style scoped>
.diplomacy-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  color: #e8d5a3;
  font-family: 'Palatino Linotype', serif;
}

/* ── Tabs ── */
.dip-tabs {
  display: flex;
  border-bottom: 1px solid #4a3820;
  flex-shrink: 0;
}
.dip-tab {
  flex: 1;
  padding: 10px 8px;
  background: transparent;
  border: none;
  color: #a08050;
  font-size: 0.82rem;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
  position: relative;
}
.dip-tab:hover { color: #e8d5a3; background: rgba(255,255,255,0.04); }
.dip-tab.active {
  color: #e8d5a3;
  border-bottom: 2px solid #c9a84c;
  font-weight: bold;
}
.dip-badge {
  background: #c84040;
  color: #fff;
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.72rem;
  margin-left: 4px;
}

/* ── Sections ── */
.dip-section {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.dip-empty {
  text-align: center;
  color: #7a6040;
  padding: 40px 0;
  font-style: italic;
}

/* ── Relation cards ── */
.relation-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.relation-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid #3a2e1a;
  border-left: 3px solid #c9a84c;
  border-radius: 4px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.relation-card.rel-guerra  { border-left-color: #c84040; }
.relation-card.rel-alianza { border-left-color: #4080c8; }
.relation-card.rel-devotio { border-left-color: #a040c8; }
.relation-card.rel-clientela { border-left-color: #40a860; }
.relation-card.rel-tributo { border-left-color: #c87040; }
.relation-card.rel-pending { border-left-color: #c8b040; opacity: 0.92; }

.rel-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.rel-type-badge {
  font-size: 0.72rem;
  background: rgba(201,168,76,0.15);
  border: 1px solid #c9a84c44;
  color: #c9a84c;
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
}
.rel-oath {
  font-size: 0.9rem;
  color: #e8d5a3;
  font-style: italic;
}
.rel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.78rem;
  color: #a08868;
}
.rel-partner { color: #c8b080; }
.rel-rate    { color: #e8c060; }
.rel-expiry  { color: #a08060; font-style: italic; }

.rel-info {
  margin: 8px 0 4px;
  padding: 8px 10px;
  background: rgba(0,0,0,0.25);
  border-left: 2px solid rgba(197,160,89,0.3);
  border-radius: 0 4px 4px 0;
}
.rel-info-desc {
  margin: 0 0 6px;
  font-size: 0.82rem;
  color: #c8b88a;
  line-height: 1.45;
  font-style: italic;
}
.rel-info-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rel-info-item {
  font-size: 0.76rem;
  color: #8a7a60;
  line-height: 1.4;
}
.rel-info-label {
  color: #a89060;
  font-weight: 600;
  margin-right: 3px;
}

.rel-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.rel-locked {
  font-size: 0.82rem;
  color: #604828;
  cursor: default;
}

/* ── Botones de acción ── */
.btn-accept, .btn-break {
  padding: 4px 12px;
  border-radius: 3px;
  border: 1px solid;
  font-size: 0.78rem;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-accept:disabled, .btn-break:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-accept {
  background: #1e4020;
  border-color: #2a6030;
  color: #80e090;
}
.btn-accept:hover:not(:disabled) { background: #2a5028; }
.btn-break {
  background: #3a1010;
  border-color: #6a2020;
  color: #e08080;
}
.btn-break:hover:not(:disabled) { background: #4a1818; }

/* ── Formulario de propuesta ── */
.propose-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 0.8rem;
  color: #a08060;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dip-input {
  background: #1a150e;
  border: 1px solid #4a3820;
  color: #e8d5a3;
  padding: 7px 10px;
  border-radius: 4px;
  font-size: 0.88rem;
  width: 100%;
  box-sizing: border-box;
}
.dip-input:focus { outline: none; border-color: #c9a84c; }
.form-hint {
  font-size: 0.74rem;
  color: #604828;
  margin: 0;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dip-slider { flex: 1; accent-color: #c9a84c; }
.slider-val { font-size: 0.82rem; color: #c9a84c; white-space: nowrap; min-width: 80px; }

/* ── Cuadrícula de tipos ── */
.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px;
  background: rgba(255,255,255,0.03);
  border: 1px solid #3a2e1a;
  border-radius: 4px;
  color: #a08050;
  cursor: pointer;
  font-size: 0.72rem;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.type-btn:hover { border-color: #c9a84c55; color: #e8d5a3; background: rgba(201,168,76,0.07); }
.type-btn.selected { border-color: #c9a84c; color: #e8d5a3; background: rgba(201,168,76,0.12); }
.type-icon { font-size: 1.2rem; }
.type-name { text-align: center; line-height: 1.2; }

/* ── Preview y descripción ── */
.oath-preview {
  background: rgba(201,168,76,0.07);
  border: 1px solid #c9a84c33;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.84rem;
}
.oath-label { color: #a08050; margin-right: 6px; }
.type-desc {
  font-size: 0.78rem;
  color: #806040;
  font-style: italic;
  line-height: 1.4;
}

/* ── Botón de envío ── */
.btn-propose {
  background: #2a1e08;
  border: 1px solid #c9a84c;
  color: #c9a84c;
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.88rem;
  transition: background 0.15s;
}
.btn-propose:hover:not(:disabled) { background: #3a2a0c; }
.btn-propose:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Mensajes ── */
.form-error, .dip-error { color: #e08080; font-size: 0.82rem; margin: 0; }
.form-ok              { color: #80e090; font-size: 0.82rem; margin: 0; }

/* ── Búsqueda de jugador ── */
.player-search-wrap {
  position: relative;
}
.dip-input.input-selected {
  border-color: #40a060;
  color: #80e090;
}
.clear-player {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #a08060;
  cursor: pointer;
  font-size: 0.82rem;
  padding: 0 4px;
}
.clear-player:hover { color: #e08080; }
.player-dropdown {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  background: #1a150e;
  border: 1px solid #4a3820;
  border-radius: 4px;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}
.player-option {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-bottom: 1px solid #2a1e0e;
  color: #e8d5a3;
  cursor: pointer;
  text-align: left;
  gap: 8px;
}
.player-option:last-child { border-bottom: none; }
.player-option:hover { background: rgba(201,168,76,0.1); }
.player-option-name { font-size: 0.9rem; }
.player-option-user { font-size: 0.75rem; color: #7a6040; }
.player-searching {
  display: block;
  padding: 10px 12px;
  font-size: 0.8rem;
  color: #7a6040;
  font-style: italic;
}
.selected-hint {
  color: #60c070 !important;
  margin-top: 4px;
}
</style>
