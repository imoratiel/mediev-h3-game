<template>
  <div class="char-panel">

    <!-- Loading -->
    <div v-if="loading" class="char-loading">
      <div class="char-spinner"></div>
      <p>Consultando los registros de la dinastía...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="char-error">
      <p>⚠️ {{ error }}</p>
      <button class="char-btn char-btn-secondary" @click="load">Reintentar</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!characters.length" class="char-empty">
      <p>No tienes personajes activos.</p>
    </div>

    <!-- Content -->
    <div v-else class="char-content">

      <!-- ── MAIN CHARACTER ─────────────────────────────── -->
      <section class="char-section char-main">
        <div class="char-avatar-row">
          <div class="char-avatar-icon">👑</div>
          <div class="char-avatar-info">
            <h2 class="char-name">{{ mainCharacter.full_title || mainCharacter.name }}</h2>
            <div class="char-meta">
              <span class="char-age">{{ mainCharacter.age }} años</span>
              <span class="char-level">Nv. {{ mainCharacter.level }}</span>
              <span class="char-buff">+{{ mainCharacter.combat_buff_pct }}% combate</span>
              <span v-if="mainCharacter.army_id" class="char-deployed">⚔️ Desplegado</span>
            </div>
          </div>
        </div>

        <!-- Health bar -->
        <div class="char-bar-row">
          <span class="char-bar-label">Salud</span>
          <div class="char-bar-track">
            <div
              class="char-bar-fill char-health-fill"
              :style="{ width: mainCharacter.health + '%', background: healthColor(mainCharacter.health) }"
            ></div>
          </div>
          <span class="char-bar-value">{{ mainCharacter.health }}/100</span>
        </div>

        <!-- Guard bar -->
        <div class="char-bar-row">
          <span class="char-bar-label">Guardia</span>
          <div class="char-bar-track">
            <div
              class="char-bar-fill char-guard-fill"
              :style="{ width: guardPct(mainCharacter.personal_guard) + '%', background: guardColor(mainCharacter.personal_guard) }"
            ></div>
          </div>
          <span class="char-bar-value">{{ mainCharacter.personal_guard }}/25</span>
        </div>

        <!-- Abilities -->
        <div v-if="mainCharacter.abilities && mainCharacter.abilities.length" class="char-abilities">
          <div
            v-for="ab in mainCharacter.abilities"
            :key="ab.ability_key"
            class="char-ability-row"
          >
            <span class="char-ability-name">{{ abilityLabel(ab.ability_key) }}</span>
            <div class="char-ability-dots">
              <span
                v-for="i in 5"
                :key="i"
                class="char-dot"
                :class="{ filled: i <= ab.level }"
              ></span>
            </div>
            <span class="char-ability-level">{{ ab.level }}</span>
          </div>
        </div>

        <!-- Actions for main character -->
        <div class="char-actions">
          <button
            class="char-btn char-btn-primary"
            :disabled="procreating"
            @click="openProcreate(mainCharacter)"
            title="Engendrar un descendiente"
          >
            👶 Descendiente
          </button>
          <button
            v-if="mainCharacter.army_id"
            class="char-btn char-btn-secondary"
            :disabled="assigningArmy"
            @click="removeCommander(mainCharacter)"
          >
            Retirar del ejército
          </button>
          <button
            v-else
            class="char-btn char-btn-secondary"
            :disabled="assigningArmy || !armies.length"
            @click="openAssignArmy(mainCharacter)"
          >
            Asignar a ejército
          </button>
        </div>
      </section>

      <!-- ── SECONDARY CHARACTERS ──────────────────────── -->
      <section v-if="secondaryCharacters.length" class="char-section char-secondary-section">
        <h3 class="char-section-title">Linaje</h3>

        <div
          v-for="char in secondaryCharacters"
          :key="char.id"
          class="char-secondary-card"
          :class="{ 'char-heir-card': char.is_heir }"
        >
          <div class="char-secondary-header">
            <div class="char-secondary-avatar">
              <span v-if="char.is_heir" title="Heredero">👑</span>
              <span v-else>🧑</span>
            </div>
            <div class="char-secondary-info">
              <span class="char-secondary-name">
                {{ char.full_title || char.name }}
                <span v-if="char.is_heir" class="heir-badge">Heredero</span>
              </span>
              <span class="char-secondary-meta">
                {{ char.age }} años · Nv.{{ char.level }} · +{{ char.combat_buff_pct }}% combate
              </span>
            </div>
          </div>

          <!-- Health & Guard mini bars -->
          <div class="char-mini-bars">
            <div class="char-mini-bar-row">
              <span class="char-mini-label">Salud</span>
              <div class="char-bar-track char-bar-track-sm">
                <div class="char-bar-fill" :style="{ width: char.health+'%', background: healthColor(char.health) }"></div>
              </div>
            </div>
            <div class="char-mini-bar-row">
              <span class="char-mini-label">Guardia</span>
              <div class="char-bar-track char-bar-track-sm">
                <div class="char-bar-fill" :style="{ width: guardPct(char.personal_guard)+'%', background: guardColor(char.personal_guard) }"></div>
              </div>
            </div>
          </div>

          <!-- Abilities compact -->
          <div v-if="char.abilities && char.abilities.length" class="char-abilities char-abilities-sm">
            <div
              v-for="ab in char.abilities"
              :key="ab.ability_key"
              class="char-ability-row"
            >
              <span class="char-ability-name">{{ abilityLabel(ab.ability_key) }}</span>
              <div class="char-ability-dots">
                <span v-for="i in 5" :key="i" class="char-dot" :class="{ filled: i <= ab.level }"></span>
              </div>
            </div>
          </div>

          <!-- Secondary actions -->
          <div class="char-secondary-actions">
            <button
              v-if="!char.is_heir"
              class="char-btn char-btn-xs char-btn-secondary"
              @click="setHeir(char)"
            >
              Designar heredero
            </button>
            <button
              v-if="char.army_id"
              class="char-btn char-btn-xs char-btn-secondary"
              :disabled="assigningArmy"
              @click="removeCommander(char)"
            >
              Retirar del ejército
            </button>
            <button
              v-else
              class="char-btn char-btn-xs char-btn-secondary"
              :disabled="assigningArmy || !armies.length"
              @click="openAssignArmy(char)"
            >
              Asignar a ejército
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- ── PROCREATE MODAL ─────────────────────────────── -->
    <div v-if="showProcreateModal" class="char-modal-overlay" @click.self="showProcreateModal = false">
      <div class="char-modal">
        <h3 class="char-modal-title">👶 Nuevo Descendiente</h3>
        <p class="char-modal-sub">Hijo/a de {{ procreateParent?.name }}</p>
        <input
          v-model="procreateNameInput"
          class="char-modal-input"
          type="text"
          placeholder="Nombre del descendiente..."
          maxlength="100"
          @keyup.enter="confirmProcreate"
        />
        <div v-if="procreateMsg" class="char-modal-msg" :class="procreateMsg.type">{{ procreateMsg.text }}</div>
        <div class="char-modal-actions">
          <button class="char-btn char-btn-secondary" @click="showProcreateModal = false">Cancelar</button>
          <button
            class="char-btn char-btn-primary"
            :disabled="procreating || !procreateNameInput.trim()"
            @click="confirmProcreate"
          >
            {{ procreating ? 'Creando...' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── ASSIGN ARMY MODAL ───────────────────────────── -->
    <div v-if="showAssignModal" class="char-modal-overlay" @click.self="showAssignModal = false">
      <div class="char-modal">
        <h3 class="char-modal-title">⚔️ Asignar a Ejército</h3>
        <p class="char-modal-sub">{{ assignChar?.name }} liderará el ejército seleccionado</p>
        <select v-model="selectedArmyId" class="char-modal-select">
          <option :value="null" disabled>Seleccionar ejército...</option>
          <option
            v-for="army in armies"
            :key="army.army_id"
            :value="army.army_id"
          >
            {{ army.name }} — {{ army.location_name || army.h3_index }}
          </option>
        </select>
        <div v-if="assignMsg" class="char-modal-msg" :class="assignMsg.type">{{ assignMsg.text }}</div>
        <div class="char-modal-actions">
          <button class="char-btn char-btn-secondary" @click="showAssignModal = false">Cancelar</button>
          <button
            class="char-btn char-btn-primary"
            :disabled="assigningArmy || !selectedArmyId"
            @click="confirmAssignArmy"
          >
            {{ assigningArmy ? 'Asignando...' : 'Asignar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  getMyCharacters,
  procreateCharacter,
  setCharacterHeir,
  assignArmyCommander,
  removeArmyCommander,
} from '@/services/mapApi.js';

const props = defineProps({
  armies: { type: Array, default: () => [] },
});

const emit = defineEmits(['refresh']);

// ── State ───────────────────────────────────────────────
const characters = ref([]);
const loading    = ref(false);
const error      = ref(null);

const showProcreateModal  = ref(false);
const procreateParent     = ref(null);
const procreateNameInput  = ref('');
const procreating         = ref(false);
const procreateMsg        = ref(null);

const showAssignModal = ref(false);
const assignChar      = ref(null);
const selectedArmyId  = ref(null);
const assigningArmy   = ref(false);
const assignMsg       = ref(null);

// ── Computed ─────────────────────────────────────────────
const mainCharacter = computed(() =>
  characters.value.find(c => c.is_main_character) ?? characters.value[0] ?? null
);

const secondaryCharacters = computed(() =>
  characters.value.filter(c => c !== mainCharacter.value)
);

// ── Helpers ───────────────────────────────────────────────
const ABILITY_LABELS = {
  estrategia:  'Estrategia',
  logistica:   'Logística',
  diplomacia:  'Diplomacia',
};

const abilityLabel  = key => ABILITY_LABELS[key] ?? key;
const guardPct      = g  => Math.round((g / 25) * 100);

const healthColor = h =>
  h < 30 ? '#ff6b6b' : h < 60 ? '#ffd93d' : '#6bcb77';

const guardColor = g =>
  g < 8 ? '#ff6b6b' : g < 17 ? '#ffd93d' : '#c5a059';

// ── Load ─────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  error.value   = null;
  try {
    const data = await getMyCharacters();
    characters.value = data.characters ?? [];
  } catch (e) {
    error.value = e?.response?.data?.message ?? 'Error al cargar personajes';
  } finally {
    loading.value = false;
  }
};

onMounted(load);

// ── Procreate ─────────────────────────────────────────────
const openProcreate = (parent) => {
  procreateParent.value    = parent;
  procreateNameInput.value = '';
  procreateMsg.value       = null;
  showProcreateModal.value = true;
};

const confirmProcreate = async () => {
  if (!procreateNameInput.value.trim()) return;
  procreating.value = true;
  procreateMsg.value = null;
  try {
    await procreateCharacter(procreateParent.value.id, procreateNameInput.value.trim());
    procreateMsg.value = { type: 'success', text: 'Descendiente creado exitosamente.' };
    await load();
    setTimeout(() => { showProcreateModal.value = false; }, 1200);
  } catch (e) {
    procreateMsg.value = { type: 'error', text: e?.response?.data?.message ?? 'Error al crear descendiente' };
  } finally {
    procreating.value = false;
  }
};

// ── Set heir ─────────────────────────────────────────────
const setHeir = async (char) => {
  try {
    await setCharacterHeir(char.id);
    await load();
  } catch (e) {
    // toast could be added here via emit
  }
};

// ── Assign army ──────────────────────────────────────────
const openAssignArmy = (char) => {
  assignChar.value     = char;
  selectedArmyId.value = null;
  assignMsg.value      = null;
  showAssignModal.value = true;
};

const confirmAssignArmy = async () => {
  if (!selectedArmyId.value) return;
  assigningArmy.value = true;
  assignMsg.value     = null;
  try {
    await assignArmyCommander(selectedArmyId.value, assignChar.value.id);
    assignMsg.value = { type: 'success', text: 'Comandante asignado.' };
    await load();
    emit('refresh');
    setTimeout(() => { showAssignModal.value = false; }, 1000);
  } catch (e) {
    assignMsg.value = { type: 'error', text: e?.response?.data?.message ?? 'Error al asignar comandante' };
  } finally {
    assigningArmy.value = false;
  }
};

const removeCommander = async (char) => {
  assigningArmy.value = true;
  try {
    await removeArmyCommander(char.army_id);
    await load();
    emit('refresh');
  } catch (e) {
    // noop
  } finally {
    assigningArmy.value = false;
  }
};
</script>

<style scoped>
/* ── Layout ─────────────────────────────────────────── */
.char-panel {
  padding: 0.5rem;
  color: #e8d5a3;
  height: 100%;
  overflow-y: auto;
}

.char-loading, .char-error, .char-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1rem;
  color: #a89070;
}

.char-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #4a3520;
  border-top-color: #c5a059;
  border-radius: 50%;
  animation: char-spin 0.8s linear infinite;
}
@keyframes char-spin { to { transform: rotate(360deg); } }

/* ── Sections ────────────────────────────────────────── */
.char-section {
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(197,160,89,0.2);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.char-section-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #c5a059;
  margin: 0 0 0.75rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid rgba(197,160,89,0.2);
}

/* ── Avatar row ──────────────────────────────────────── */
.char-avatar-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.char-avatar-icon {
  font-size: 2rem;
  line-height: 1;
  flex-shrink: 0;
}

.char-avatar-info {
  flex: 1;
  min-width: 0;
}

.char-name {
  font-size: 1rem;
  font-weight: 700;
  color: #e8d5a3;
  margin: 0 0 0.3rem;
  line-height: 1.3;
}

.char-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.char-age, .char-level, .char-buff, .char-deployed {
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: rgba(197,160,89,0.12);
  color: #c5a059;
}

.char-deployed {
  background: rgba(255,107,107,0.15);
  color: #ff9e9e;
}

/* ── Bars ────────────────────────────────────────────── */
.char-bar-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.char-bar-label {
  font-size: 0.7rem;
  color: #a89070;
  width: 50px;
  flex-shrink: 0;
}

.char-bar-track {
  flex: 1;
  height: 7px;
  background: rgba(255,255,255,0.08);
  border-radius: 4px;
  overflow: hidden;
}

.char-bar-track-sm {
  height: 5px;
}

.char-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.char-bar-value {
  font-size: 0.7rem;
  color: #a89070;
  width: 38px;
  text-align: right;
  flex-shrink: 0;
}

/* ── Abilities ───────────────────────────────────────── */
.char-abilities {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.char-abilities-sm {
  margin-top: 0.4rem;
}

.char-ability-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.char-ability-name {
  font-size: 0.72rem;
  color: #c5a059;
  width: 70px;
  flex-shrink: 0;
}

.char-ability-dots {
  display: flex;
  gap: 3px;
}

.char-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgba(197,160,89,0.4);
  background: transparent;
  transition: background 0.15s;
}

.char-dot.filled {
  background: #c5a059;
  border-color: #c5a059;
}

.char-ability-level {
  font-size: 0.68rem;
  color: #a89070;
  margin-left: 2px;
}

/* ── Actions ─────────────────────────────────────────── */
.char-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

/* ── Buttons ─────────────────────────────────────────── */
.char-btn {
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  transition: opacity 0.15s, transform 0.1s;
}

.char-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.char-btn:not(:disabled):hover {
  opacity: 0.85;
  transform: translateY(-1px);
}

.char-btn-primary {
  background: linear-gradient(135deg, #c5a059, #9a7a3a);
  color: #1a1008;
}

.char-btn-secondary {
  background: rgba(197,160,89,0.15);
  border: 1px solid rgba(197,160,89,0.3);
  color: #c5a059;
}

.char-btn-xs {
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
}

/* ── Secondary cards ─────────────────────────────────── */
.char-secondary-card {
  background: rgba(0,0,0,0.2);
  border: 1px solid rgba(197,160,89,0.15);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
}

.char-heir-card {
  border-color: rgba(197,160,89,0.45);
  background: rgba(197,160,89,0.06);
}

.char-secondary-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.char-secondary-avatar {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.char-secondary-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.char-secondary-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #e8d5a3;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.heir-badge {
  font-size: 0.65rem;
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  background: rgba(197,160,89,0.25);
  color: #c5a059;
  font-weight: 700;
}

.char-secondary-meta {
  font-size: 0.68rem;
  color: #a89070;
}

.char-mini-bars {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.35rem;
}

.char-mini-bar-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.char-mini-label {
  font-size: 0.65rem;
  color: #7a6040;
  width: 45px;
  flex-shrink: 0;
}

.char-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

/* ── Modals ──────────────────────────────────────────── */
.char-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.char-modal {
  background: #1e1208;
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 10px;
  padding: 1.5rem;
  width: 340px;
  max-width: 90vw;
}

.char-modal-title {
  font-size: 1rem;
  color: #e8d5a3;
  margin: 0 0 0.3rem;
}

.char-modal-sub {
  font-size: 0.78rem;
  color: #a89070;
  margin: 0 0 0.75rem;
}

.char-modal-input, .char-modal-select {
  width: 100%;
  padding: 0.5rem 0.6rem;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(197,160,89,0.3);
  border-radius: 5px;
  color: #e8d5a3;
  font-size: 0.85rem;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}

.char-modal-input:focus, .char-modal-select:focus {
  border-color: rgba(197,160,89,0.6);
}

.char-modal-select option {
  background: #1e1208;
  color: #e8d5a3;
}

.char-modal-msg {
  font-size: 0.78rem;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.char-modal-msg.success {
  background: rgba(107,203,119,0.15);
  color: #6bcb77;
}

.char-modal-msg.error {
  background: rgba(255,107,107,0.15);
  color: #ff6b6b;
}

.char-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
