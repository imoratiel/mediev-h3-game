<template>
  <div class="welcome-overlay" @click.self="() => {}">
    <div class="welcome-parchment">

      <!-- Header -->
      <div class="welcome-crest">⚜️</div>
      <h1 class="welcome-title">El Destino Llama</h1>
      <div class="welcome-divider">✦ ✦ ✦</div>

      <p class="welcome-text">
        Joven Señor, antes de reclamar tus tierras debes
        <em>elegir el linaje que guiará tu casa</em>.
        Tu sangre determinará los guerreros que te jurarán lealtad.
      </p>

      <!-- ── Culture selector ── -->
      <div class="culture-section">
        <div class="culture-section-label">— Elige tu Linaje —</div>

        <div class="culture-grid">
          <button
            v-for="c in cultures"
            :key="c.id"
            class="culture-btn"
            :class="{ selected: selectedCulture?.id === c.id, random: c.id === 'random' }"
            @click="selectedCulture = c"
          >
            <!-- Shield -->
            <div class="culture-shield" :style="{ background: c.shieldBg, borderColor: c.shieldBorder }">
              <svg viewBox="0 0 60 72" xmlns="http://www.w3.org/2000/svg" class="shield-svg">
                <path d="M4,4 L56,4 L56,52 L30,68 L4,52 Z"
                      :fill="c.shieldBg"
                      :stroke="c.shieldBorder"
                      stroke-width="3"
                      stroke-linejoin="round"/>
                <!-- Inner border -->
                <path d="M9,9 L51,9 L51,49 L30,63 L9,49 Z"
                      fill="none"
                      :stroke="c.shieldBorder"
                      stroke-width="1"
                      opacity="0.5"/>
                <text x="30" y="43" text-anchor="middle" font-size="24" :fill="c.shieldSymbolColor">{{ c.symbol }}</text>
              </svg>
            </div>
            <div class="culture-name">{{ c.name }}</div>
          </button>
        </div>

        <!-- Description -->
        <transition name="desc-fade">
          <div v-if="selectedCulture" class="culture-desc" :key="selectedCulture.id">
            <div class="culture-desc-header">
              <span class="culture-desc-symbol">{{ selectedCulture.symbol }}</span>
              <strong class="culture-desc-title">{{ selectedCulture.name }}</strong>
            </div>
            <p class="culture-desc-text">{{ selectedCulture.description }}</p>
          </div>
        </transition>
      </div>

      <div class="welcome-divider">✦ ✦ ✦</div>

      <!-- ── Linaje input ── -->
      <div class="linaje-section">
        <div class="culture-section-label">— Nombre de tu Linaje —</div>
        <input
          v-model="linaje"
          class="linaje-input"
          maxlength="30"
          placeholder="ej. Barcino, de Lusitania…"
          @input="validateLinaje"
        />
        <p class="linaje-hint">Todos tus personajes llevarán este nombre.</p>
        <p v-if="linajeError" class="linaje-error">{{ linajeError }}</p>
      </div>

      <div class="welcome-divider">✦ ✦ ✦</div>

      <!-- Grants -->
      <div class="welcome-grants">
        <div class="grant-item">
          <span class="grant-icon">🏰</span>
          Un feudo capital y sus tierras colindantes
        </div>
        <div class="grant-item">
          <span class="grant-icon">⚔️</span>
          Guardia personal según el linaje elegido
          <span v-if="selectedCulture?.id === 'random'" class="bonus-tag">×2</span>
        </div>
        <div class="grant-item">
          <span class="grant-icon">💰</span>
          Oro inicial para tu expansión
          <span v-if="selectedCulture?.id === 'random'" class="bonus-tag">×2</span>
        </div>
        <div class="grant-item">
          <span class="grant-icon">🏯</span>
          Acuartelamiento erigido en tu capital
        </div>
      </div>

      <div v-if="error" class="welcome-error">{{ error }}</div>

      <button
        class="welcome-btn"
        :disabled="loading || !selectedCulture || !linajeValid"
        @click="begin"
      >
        <span v-if="loading" class="welcome-btn-inner">
          <span class="welcome-spinner"></span> Preparando tu reino...
        </span>
        <span v-else-if="!selectedCulture" class="welcome-btn-inner">
          ⚜️ &nbsp;Elige tu linaje para comenzar
        </span>
        <span v-else-if="!linajeValid" class="welcome-btn-inner">
          ⚜️ &nbsp;Escribe el nombre de tu linaje
        </span>
        <span v-else class="welcome-btn-inner">
          ⚜️ &nbsp;Comenzar mi camino
        </span>
      </button>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { initializePlayer } from '../services/mapApi.js';

const emit = defineEmits(['done']);

const loading         = ref(false);
const error           = ref('');
const selectedCulture = ref(null);
const linaje          = ref('');
const linajeError     = ref('');

function validateLinaje() {
  const val = linaje.value.trim();
  if (!val) {
    linajeError.value = '';
    return false;
  }
  if (val.length < 3) {
    linajeError.value = 'El linaje debe tener al menos 3 caracteres.';
    return false;
  }
  if (!/^[\p{L}\s\-']+$/u.test(val)) {
    linajeError.value = 'Solo letras, espacios y guiones.';
    return false;
  }
  linajeError.value = '';
  return true;
}

const linajeValid = computed(() => {
  const val = linaje.value.trim();
  return val.length >= 3 && /^[\p{L}\s\-']+$/u.test(val);
});

const cultures = [
  {
    id:               4,
    name:             'Celtas',
    symbol:           '☘',
    shieldBg:         '#162b16',
    shieldBorder:     '#4a9e4e',
    shieldSymbolColor:'#8fde74',
    description:      'Guerreros del norte y el oeste. Maestros de la emboscada y la guerra en bosques y ríos, sus caudillos inspiran una lealtad feroz. Sus tropas son rápidas y resistentes, forjadas en el frío del Cantábrico.',
  },
  {
    id:               3,
    name:             'Íberos',
    symbol:           '☀',
    shieldBg:         '#11213e',
    shieldBorder:     '#4a78c8',
    shieldSymbolColor:'#e8c830',
    description:      'Pueblo antiguo del levante peninsular. Expertos en escaramuza y arquería, sus ciudades controlan las rutas del Mediterráneo occidental. Sus guerreros son ágiles y letales desde la distancia.',
  },
  {
    id:               1,
    name:             'Roma',
    symbol:           '⚔',
    shieldBg:         '#2e0e0e',
    shieldBorder:     '#c04040',
    shieldSymbolColor:'#f0c070',
    description:      'Herederos del orden y la disciplina. Sus legiones son imbatibles en campo abierto y sus ingenieros levantan fortalezas que desafían los siglos. La formación cerrada es su mayor fortaleza.',
  },
  {
    id:               2,
    name:             'Cartago',
    symbol:           '✦',
    shieldBg:         '#1e0e33',
    shieldBorder:     '#8040c0',
    shieldSymbolColor:'#d4a020',
    description:      'Señores del comercio y el Mediterráneo. Sus mercenarios son los más temidos de cada tierra y su oro compra lo que la espada no puede. Maestros de la guerra naval y el asedio.',
  },
  {
    id:               'random',
    name:             'Aleatorio',
    symbol:           '?',
    shieldBg:         '#1a1a22',
    shieldBorder:     '#666688',
    shieldSymbolColor:'#aaaacc',
    description:      'Que el destino decida tu sangre. A cambio de la incertidumbre sobre tu linaje, recibirás el doble de tropas y el doble de oro al inicio de tu partida. Un arma poderosa para quien acepte el azar.',
  },
];

async function begin() {
  if (loading.value || !selectedCulture.value || !linajeValid.value) return;
  loading.value = true;
  error.value   = '';
  try {
    const isRandom  = selectedCulture.value.id === 'random';
    const cultureId = isRandom ? null : selectedCulture.value.id;
    const data = await initializePlayer(cultureId, isRandom, linaje.value.trim());
    if (data.success || data.message?.includes('inicializado')) {
      emit('done', { capital_h3: data.capital_h3 });
    } else {
      error.value   = data.message || 'Error al inicializar el reino';
      loading.value = false;
    }
  } catch (err) {
    if (err.response?.status === 409 && err.response?.data?.linaje_taken) {
      linajeError.value = err.response.data.message;
      loading.value = false;
    } else if (err.response?.status === 409) {
      emit('done', {});
    } else {
      error.value   = err?.response?.data?.message || 'Error de conexión. Inténtalo de nuevo.';
      loading.value = false;
    }
  }
}
</script>

<style scoped>
.welcome-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(5, 3, 1, 0.93);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

.welcome-parchment {
  background: radial-gradient(ellipse at center, #2a1f0e 0%, #1a1208 100%);
  border: 2px solid #8b6914;
  border-radius: 12px;
  max-width: 580px;
  width: 100%;
  padding: 40px 44px;
  text-align: center;
  box-shadow:
    0 0 0 1px #4a3410,
    0 0 60px rgba(201, 168, 76, 0.15),
    inset 0 0 80px rgba(0, 0, 0, 0.6);
  color: #e8d5b5;
  font-family: 'Georgia', serif;
  animation: fadeIn 0.7s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.96) translateY(12px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}

.welcome-crest {
  font-size: 2.6rem;
  margin-bottom: 10px;
  filter: drop-shadow(0 0 10px rgba(201, 168, 76, 0.6));
}

.welcome-title {
  font-size: 1.5rem;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #c9a84c;
  margin: 0 0 12px;
  font-weight: 700;
  text-shadow: 0 0 18px rgba(201, 168, 76, 0.4);
}

.welcome-divider {
  color: #5d4e37;
  letter-spacing: 6px;
  font-size: 0.75rem;
  margin: 14px 0;
}

.welcome-text {
  font-size: 0.93rem;
  line-height: 1.75;
  color: #c8b898;
  margin: 0 0 18px;
}

.welcome-text em {
  color: #e8d5b5;
  font-style: italic;
}

/* ── Culture section ─────────────────────────────────────────────────────── */
.culture-section {
  margin-bottom: 4px;
}

.culture-section-label {
  font-size: 0.8rem;
  letter-spacing: 3px;
  color: #7a6240;
  text-transform: uppercase;
  margin-bottom: 14px;
}

.culture-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-bottom: 14px;
}

.culture-btn {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid #3d2e1a;
  border-radius: 8px;
  padding: 10px 8px 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 96px;
  color: #a89070;
  font-family: 'Georgia', serif;
}

.culture-btn:hover {
  border-color: #7a6240;
  background: rgba(60, 40, 10, 0.5);
  transform: translateY(-2px);
}

.culture-btn.selected {
  border-color: #c9a84c;
  background: rgba(80, 55, 15, 0.55);
  box-shadow: 0 0 12px rgba(201, 168, 76, 0.2);
}

.culture-btn.random {
  border-style: dashed;
}

.culture-btn.random.selected {
  border-color: #9090bb;
  box-shadow: 0 0 12px rgba(140, 140, 200, 0.2);
}

.shield-svg {
  width: 52px;
  height: 62px;
  display: block;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
}

.culture-name {
  font-size: 0.72rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #a89070;
  font-family: sans-serif;
}

.culture-btn.selected .culture-name {
  color: #c9a84c;
}

/* ── Description ─────────────────────────────────────────────────────────── */
.culture-desc {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #3d2e1a;
  border-radius: 8px;
  padding: 12px 16px;
  text-align: left;
  margin-top: 4px;
}

.culture-desc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.culture-desc-symbol {
  font-size: 1.1rem;
}

.culture-desc-title {
  font-size: 0.88rem;
  color: #c9a84c;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.culture-desc-text {
  font-size: 0.82rem;
  line-height: 1.65;
  color: #a89878;
  font-family: sans-serif;
  margin: 0;
}

.desc-fade-enter-active,
.desc-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.desc-fade-enter-from,
.desc-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* ── Grants ──────────────────────────────────────────────────────────────── */
.welcome-grants {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #3d2e1a;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 18px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.grant-item {
  font-size: 0.8rem;
  color: #a89070;
  font-family: sans-serif;
  display: flex;
  align-items: center;
  gap: 10px;
}

.grant-icon {
  font-size: 0.95rem;
  flex-shrink: 0;
}

.bonus-tag {
  margin-left: auto;
  background: rgba(201, 168, 76, 0.2);
  border: 1px solid #c9a84c;
  border-radius: 4px;
  color: #c9a84c;
  font-size: 0.72rem;
  font-weight: bold;
  padding: 1px 6px;
  letter-spacing: 1px;
}

/* ── Linaje ──────────────────────────────────────────────────────────────── */
.linaje-section {
  margin-bottom: 4px;
}

.linaje-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid #5a4820;
  border-radius: 6px;
  color: #e8d5b5;
  font-family: 'Georgia', serif;
  font-size: 0.95rem;
  padding: 9px 14px;
  outline: none;
  transition: border-color 0.2s;
  margin-bottom: 6px;
}

.linaje-input::placeholder {
  color: #5a4820;
}

.linaje-input:focus {
  border-color: #c9a84c;
}

.linaje-hint {
  font-size: 0.76rem;
  color: #7a6240;
  font-family: sans-serif;
  margin: 0 0 4px;
}

.linaje-error {
  font-size: 0.76rem;
  color: #f87171;
  font-family: sans-serif;
  margin: 0 0 4px;
}

/* ── Error / Button ──────────────────────────────────────────────────────── */
.welcome-error {
  color: #f87171;
  font-size: 0.82rem;
  font-family: sans-serif;
  margin-bottom: 12px;
}

.welcome-btn {
  width: 100%;
  padding: 13px 20px;
  background: linear-gradient(135deg, #3d2d10 0%, #2d1f0a 100%);
  border: 1px solid #c9a84c;
  border-radius: 8px;
  color: #fbbf24;
  font-size: 0.95rem;
  font-family: 'Georgia', serif;
  letter-spacing: 2px;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
  text-transform: uppercase;
}

.welcome-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #4d3d1a 0%, #3d2d10 100%);
  box-shadow: 0 0 16px rgba(201, 168, 76, 0.25);
}

.welcome-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  border-color: #5a4820;
  color: #8a7040;
}

.welcome-btn-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.welcome-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #c9a84c;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
