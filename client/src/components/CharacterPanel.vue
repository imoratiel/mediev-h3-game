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
      <button class="char-btn char-btn-primary" @click="openAdopt">⚔️ Incorporar</button>
    </div>

    <!-- ── ÁRBOL GENEALÓGICO ─────────────────────────── -->
    <div v-else class="char-tree">

      <!-- GENERACIÓN 0: Líder -->
      <div class="tree-gen tree-gen0" v-if="mainCharacter">
        <div
          class="tree-node node-leader"
          :class="{ 'node-deployed': mainCharacter.army_id }"
          @click="selectChar(mainCharacter)"
          :data-selected="selectedId === mainCharacter.id"
        >
          <div class="node-crown">👑</div>
          <div class="node-fullname">{{ mainCharacter.name }}</div>
          <div class="node-badges">
            <span class="badge badge-age">Edad {{ mainCharacter.age }}</span>
            <span class="badge badge-level">Nv.{{ displayLevel(mainCharacter.level) }}</span>
            <span v-if="mainCharacter.army_id" class="badge badge-war">⚔</span>
          </div>
        </div>
      </div>

      <!-- Conector vertical hacia gen1 -->
      <div v-if="mainCharacter && gen1.length" class="tree-vline"></div>

      <!-- GENERACIÓN 1: hijos directos del líder (heredero + otros adultos + niños) -->
      <div v-if="gen1.length" class="tree-gen tree-gen1">
        <div class="tree-hline"></div>
        <div
          v-for="char in gen1"
          :key="char.id"
          class="tree-branch"
        >
          <div class="branch-vline"></div>
          <div
            class="tree-node"
            :class="nodeClass(char)"
            :data-selected="selectedId === char.id"
            @click="selectChar(char)"
          >
            <div class="node-icon">{{ nodeIcon(char) }}</div>
            <div class="node-fullname">{{ char.name }}</div>
            <div class="node-badges">
              <span class="badge badge-age">Edad {{ char.age }}</span>
              <span v-if="char.age >= 16" class="badge badge-level">Nv.{{ displayLevel(char.level) }}</span>
              <span v-if="char.is_heir" class="badge badge-heir">Heredero</span>
              <span v-if="char.army_id" class="badge badge-war">⚔</span>
            </div>

          </div>
        </div>
      </div>

      <!-- PANEL DE ACCIONES del personaje seleccionado -->
      <transition name="action-slide">
        <div v-if="selected" class="char-actions-panel">
          <div class="actions-header">
            <span class="actions-name">{{ selected.name }}</span>
            <span v-if="selected.combat_buff_pct > 0" class="actions-buff">+{{ selected.combat_buff_pct }}% combate</span>
          </div>

          <!-- Ver en mapa (solo adultos con posición) -->
          <div v-if="selected.h3_index && selected.age >= 16" class="actions-row">
            <button class="char-btn char-btn-secondary char-btn-xs" @click="emit('focus-hex', selected.h3_index)">
              🗺️ Ver en mapa
            </button>
          </div>

          <div v-if="selected.age >= 16" class="actions-row">
            <!-- Ejército -->
            <button
              v-if="selected.army_id"
              class="char-btn char-btn-secondary char-btn-xs"
              :disabled="assigningArmy"
              @click="removeCommander(selected)"
            >
              Retirar del ejército
            </button>
            <button
              v-else
              class="char-btn char-btn-secondary char-btn-xs"
              :disabled="assigningArmy || !armies.length"
              @click="openAssignArmy(selected)"
            >
              Asignar a ejército
            </button>

            <!-- Heredero -->
            <button
              v-if="!selected.is_main_character && !selected.is_heir"
              class="char-btn char-btn-secondary char-btn-xs"
              @click="setHeir(selected)"
            >
              Designar heredero
            </button>
          </div>
        </div>
      </transition>

      <!-- ── ADOPCIÓN ────────────────────────────────── -->
      <div v-if="canAdopt" class="adopt-row">
        <button class="char-btn char-btn-primary char-btn-xs" @click="openAdopt">
          ⚔️ Adoptar Nuevo Miembro
        </button>
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

    <!-- ── ADOPT MODAL ─────────────────────────────────── -->
    <div v-if="showAdoptModal" class="char-modal-overlay" @click.self="showAdoptModal = false">
      <div class="char-modal">
        <h3 class="char-modal-title">⚔️ Incorporar a tu Familia</h3>
        <p class="char-modal-sub">Hemos encontrado un guerrero de noble espíritu que podría incorporarse a nuestra familia. Nos exige <strong>100.000 monedas de oro</strong>. ¿Aceptas?</p>
        <div v-if="adoptMsg" class="char-modal-msg" :class="adoptMsg.type">{{ adoptMsg.text }}</div>
        <div class="char-modal-actions">
          <button class="char-btn char-btn-secondary" @click="showAdoptModal = false">Rechazar</button>
          <button
            class="char-btn char-btn-primary"
            :disabled="adopting"
            @click="confirmAdopt"
          >
            {{ adopting ? 'Sellando el pacto...' : 'Aceptar' }}
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
  setCharacterHeir,
  assignArmyCommander,
  removeArmyCommander,
  adoptCharacter,
} from '@/services/mapApi.js';

const props = defineProps({
  armies: { type: Array, default: () => [] },
});

const emit = defineEmits(['refresh', 'focus-hex']);

// ── State ───────────────────────────────────────────────
const characters  = ref([]);
const loading     = ref(false);
const error       = ref(null);
const selectedId  = ref(null);

const showAssignModal = ref(false);
const assignChar      = ref(null);
const selectedArmyId  = ref(null);
const assigningArmy   = ref(false);
const assignMsg       = ref(null);

const showAdoptModal = ref(false);
const adopting       = ref(false);
const adoptMsg       = ref(null);

// ── Computed ─────────────────────────────────────────────
const mainCharacter = computed(() =>
  characters.value.find(c => c.is_main_character) ?? null
);

/** Todos los no-líder: hijos directos + heredero + otros adultos + niños */
const gen1 = computed(() => {
  if (!mainCharacter.value) return characters.value.filter(c => !c.is_main_character);
  // Heredero primero, luego adultos, luego niños; dentro de cada grupo por nivel DESC
  return characters.value
    .filter(c => !c.is_main_character)
    .sort((a, b) => {
      const rank = c => c.is_heir ? 0 : c.age >= 16 ? 1 : 2;
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return (b.level ?? 1) - (a.level ?? 1);
    });
});

const selected    = computed(() => characters.value.find(c => c.id === selectedId.value) ?? null);
const adultCount  = computed(() => characters.value.filter(c => c.age >= 16).length);
const canAdopt    = computed(() => adultCount.value < 3);


/** Nivel mostrado: floor(level / 10), rango 0–10 */
const displayLevel = level => Math.floor((level ?? 1) / 10);

const nodeIcon = char => {
  if (char.is_main_character) return '👑';
  if (char.is_heir)           return '🤴';
  if (char.age < 16)          return '🧒';
  return '⭐';
};

const nodeClass = char => {
  if (char.is_heir)  return 'node-heir';
  if (char.age < 16) return 'node-child';
  return 'node-adult';
};

// ── Select ────────────────────────────────────────────────
const selectChar = char => {
  selectedId.value = selectedId.value === char.id ? null : char.id;
};

// ── Load ─────────────────────────────────────────────────
const load = async () => {
  loading.value = true;
  error.value   = null;
  try {
    const data = await getMyCharacters();
    characters.value = data.characters ?? [];
    // Deselect if character no longer exists
    if (selectedId.value && !characters.value.find(c => c.id === selectedId.value)) {
      selectedId.value = null;
    }
  } catch (e) {
    error.value = e?.response?.data?.message ?? 'Error al cargar personajes';
  } finally {
    loading.value = false;
  }
};

onMounted(load);

// ── Set heir ─────────────────────────────────────────────
const setHeir = async (char) => {
  try {
    await setCharacterHeir(char.id);
    await load();
  } catch (e) { /* noop */ }
};

// ── Assign army ──────────────────────────────────────────
const openAssignArmy = (char) => {
  assignChar.value      = char;
  selectedArmyId.value  = null;
  assignMsg.value       = null;
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
  } catch (e) { /* noop */ }
  finally { assigningArmy.value = false; }
};

// ── Adopt ─────────────────────────────────────────────────
const openAdopt = () => {
  adoptMsg.value       = null;
  showAdoptModal.value = true;
};

const confirmAdopt = async () => {
  adopting.value = true;
  adoptMsg.value = null;
  try {
    await adoptCharacter('');
    adoptMsg.value = { type: 'success', text: 'Adopción completada.' };
    await load();
    setTimeout(() => { showAdoptModal.value = false; }, 1200);
  } catch (e) {
    adoptMsg.value = { type: 'error', text: e?.response?.data?.message ?? 'Error al adoptar' };
  } finally {
    adopting.value = false;
  }
};
</script>

<style scoped>
/* ── Panel base ──────────────────────────────────────── */
.char-panel {
  padding: 0.75rem 0.5rem;
  color: #e8d5a3;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
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
  width: 28px;
  height: 28px;
  border: 2px solid #4a3520;
  border-top-color: #c5a059;
  border-radius: 50%;
  animation: char-spin 0.8s linear infinite;
}
@keyframes char-spin { to { transform: rotate(360deg); } }

/* ── Tree layout ─────────────────────────────────────── */
.char-tree {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

/* Generation rows */
.tree-gen {
  display: flex;
  justify-content: center;
  gap: 6px;
  width: 100%;
}

/* Vertical line from gen0 down */
.tree-vline {
  width: 2px;
  height: 16px;
  background: rgba(197,160,89,0.35);
  flex-shrink: 0;
}

/* Horizontal connector spanning gen1 */
.tree-gen1 {
  position: relative;
  padding-top: 0;
  padding-left: 55px;
  padding-right: 55px;
}

.tree-hline {
  position: absolute;
  top: 0;
  left: 55px;
  right: 55px;
  height: 2px;
  background: rgba(197,160,89,0.35);
}

/* Each branch in gen1 */
.tree-branch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.branch-vline {
  width: 2px;
  height: 14px;
  background: rgba(197,160,89,0.35);
}

/* ── Node cards ──────────────────────────────────────── */
.tree-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 12px 9px;
  border-radius: 10px;
  border: 1px solid rgba(197,160,89,0.2);
  background: rgba(0,0,0,0.28);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
  width: 110px;
  min-width: 110px;
  user-select: none;
}

.tree-node:hover {
  border-color: rgba(197,160,89,0.5);
  background: rgba(197,160,89,0.07);
  transform: translateY(-1px);
}

.tree-node[data-selected="true"] {
  border-color: #c5a059;
  background: rgba(197,160,89,0.12);
  box-shadow: 0 0 10px rgba(197,160,89,0.25);
}

/* Leader node — slightly larger */
.node-leader {
  width: 130px;
  min-width: 130px;
  border-color: rgba(197,160,89,0.4);
  background: rgba(197,160,89,0.06);
}

.node-heir {
  border-color: rgba(197,160,89,0.35);
}

.node-child {
  border-color: rgba(100,140,200,0.25);
  background: rgba(80,120,180,0.06);
}

.node-deployed {
  border-color: rgba(255,140,100,0.4) !important;
  background: rgba(255,100,60,0.06) !important;
}

/* Icons */
.node-crown {
  font-size: 1.5rem;
  line-height: 1;
  margin-bottom: 4px;
}

.node-icon {
  font-size: 1.3rem;
  line-height: 1;
  margin-bottom: 4px;
}

/* Name — una sola línea completa */
.node-fullname {
  font-size: 0.82rem;
  font-weight: 700;
  color: #e8d5a3;
  text-align: center;
  line-height: 1.3;
  word-break: break-word;
  max-width: 100%;
  margin-bottom: 4px;
}


/* Badges row */
.node-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 3px;
  margin-top: 2px;
}

.badge {
  font-size: 0.68rem;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.4;
  font-weight: 600;
}

.badge-age {
  background: rgba(197,160,89,0.15);
  color: #a89070;
}

.badge-level {
  background: rgba(120,100,200,0.2);
  color: #b0a0e0;
}

.badge-heir {
  background: rgba(197,160,89,0.25);
  color: #c5a059;
}

.badge-war {
  background: rgba(255,100,80,0.2);
  color: #ff9e9e;
}

/* ── Actions panel ───────────────────────────────────── */
.char-actions-panel {
  margin-top: 12px;
  width: 100%;
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(197,160,89,0.2);
  border-radius: 8px;
  padding: 8px 10px;
}

.actions-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.actions-name {
  font-size: 0.78rem;
  font-weight: 700;
  color: #e8d5a3;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-buff {
  font-size: 0.65rem;
  color: #b0a0e0;
  background: rgba(120,100,200,0.15);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

/* ── Adopt row ───────────────────────────────────────── */
.adopt-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.adopt-hint {
  font-size: 0.68rem;
  color: #7a6040;
}

/* ── Transition ──────────────────────────────────────── */
.action-slide-enter-active,
.action-slide-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.action-slide-enter-from,
.action-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Buttons ─────────────────────────────────────────── */
.char-btn {
  padding: 0.3rem 0.65rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  transition: opacity 0.15s, transform 0.1s;
}

.char-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.char-btn:not(:disabled):hover { opacity: 0.85; transform: translateY(-1px); }

.char-btn-primary {
  background: linear-gradient(135deg, #c5a059, #9a7a3a);
  color: #1a1008;
}

.char-btn-secondary {
  background: rgba(197,160,89,0.15);
  border: 1px solid rgba(197,160,89,0.3);
  color: #c5a059;
}

.char-btn-xs { padding: 0.18rem 0.45rem; font-size: 0.68rem; }

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
  padding: 1.4rem;
  width: 320px;
  max-width: 90vw;
}

.char-modal-title {
  font-size: 0.95rem;
  color: #e8d5a3;
  margin: 0 0 0.25rem;
}

.char-modal-sub {
  font-size: 0.75rem;
  color: #a89070;
  margin: 0 0 0.7rem;
}

.char-modal-input, .char-modal-select {
  width: 100%;
  padding: 0.45rem 0.55rem;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(197,160,89,0.3);
  border-radius: 5px;
  color: #e8d5a3;
  font-size: 0.82rem;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}

.char-modal-input:focus, .char-modal-select:focus { border-color: rgba(197,160,89,0.6); }
.char-modal-select option { background: #1e1208; color: #e8d5a3; }

.char-modal-msg {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.char-modal-msg.success { background: rgba(107,203,119,0.15); color: #6bcb77; }
.char-modal-msg.error   { background: rgba(255,107,107,0.15); color: #ff6b6b; }

.char-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
