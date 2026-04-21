<template>
  <Teleport to="body">
    <Transition name="bsm-fade">
      <div v-if="show" class="bsm-backdrop" @click.self="$emit('close')">
        <div class="bsm-box" :class="`bsm-${battle.result}`" role="dialog" aria-modal="true">

          <!-- Decoración lateral -->
          <div class="bsm-deco bsm-deco-left">⚔</div>
          <div class="bsm-deco bsm-deco-right">⚔</div>

          <!-- Header épico -->
          <div class="bsm-header">
            <div class="bsm-crest">{{ resultCrest }}</div>
            <h1 class="bsm-title" :class="`bsm-title-${battle.result}`">{{ resultLabel }}</h1>
            <p class="bsm-fief">{{ fiefLabel }}</p>
          </div>

          <!-- Bloque atacante -->
          <div class="bsm-divider"><span>⚔ TUS TROPAS</span></div>
          <div class="bsm-table-wrap">
            <table class="bsm-table">
              <thead>
                <tr>
                  <th class="bsm-th-unit">Unidad</th>
                  <th class="bsm-th-num">Perdidos</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in groupedAttacker"
                  :key="row.nombre"
                  :class="{ 'bsm-row-zero': row.perdidos === 0 }"
                >
                  <td class="bsm-td-unit">{{ row.nombre }}</td>
                  <td class="bsm-td-num" :class="row.perdidos > 0 ? 'bsm-red' : 'bsm-zero'">
                    {{ row.perdidos > 0 ? `−${row.perdidos}` : '—' }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="bsm-tfoot">
                  <td>TOTAL BAJAS</td>
                  <td class="bsm-td-num bsm-red">{{ battle.attacker_losses > 0 ? `−${battle.attacker_losses}` : '—' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Bloque milicia / ejército enemigo -->
          <div class="bsm-divider"><span>{{ battle.defender_label ?? '🛡 MILICIA DEL FEUDO' }}</span></div>
          <div class="bsm-table-wrap">
            <table class="bsm-table">
              <thead>
                <tr>
                  <th class="bsm-th-unit">Unidad</th>
                  <th class="bsm-th-num">Perdidos</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in groupedDefender"
                  :key="row.nombre"
                  :class="{ 'bsm-row-zero': row.perdidos === 0 }"
                >
                  <td class="bsm-td-unit">{{ row.nombre }}</td>
                  <td class="bsm-td-num" :class="row.perdidos > 0 ? 'bsm-orange' : 'bsm-zero'">
                    {{ row.perdidos > 0 ? `−${row.perdidos}` : '—' }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="bsm-tfoot">
                  <td>TOTAL BAJAS</td>
                  <td class="bsm-td-num bsm-orange">{{ battle.defender_losses > 0 ? `−${battle.defender_losses}` : '—' }}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Frase de resultado -->
          <div class="bsm-outcome">
            <span class="bsm-outcome-icon">{{ resultOutcomeIcon }}</span>
            <span class="bsm-outcome-text">{{ battle.message }}</span>
          </div>

          <!-- Experiencia ganada -->
          <div v-if="battle.experience_gained > 0" class="bsm-exp">
            <span class="bsm-exp-icon">⭐</span>
            <span class="bsm-exp-text">Tus tropas han ganado <strong>+{{ battle.experience_gained }}</strong> de experiencia</span>
          </div>

          <!-- Botón cerrar -->
          <button class="bsm-btn" @click="$emit('close')">Cerrar</button>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, watch, onUnmounted } from 'vue';
import * as h3 from 'h3-js';

const props = defineProps({
  show:   { type: Boolean, default: false },
  battle: { type: Object,  default: () => ({}) }
});
const emit = defineEmits(['close']);

const H3_RE = /^[0-9a-fA-F]{15,16}$/;
const fiefLabel = computed(() => {
  const name = props.battle?.fief_name;
  if (!name || !H3_RE.test(name)) return name;
  const [lat, lng] = h3.cellToLatLng(name);
  const fmtLat = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const fmtLng = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'O'}`;
  return `${fmtLat}, ${fmtLng}`;
});

const resultLabel = computed(() => ({
  victory: 'VICTORIA',
  defeat:  'DERROTA',
  draw:    'TABLAS',
}[props.battle?.result] ?? '—'));

const resultCrest = computed(() => ({
  victory: '🏆',
  defeat:  '💀',
  draw:    '⚖️',
}[props.battle?.result] ?? '⚔️'));

const resultOutcomeIcon = computed(() => ({
  victory: '🏴',
  defeat:  '🏳️',
  draw:    '⚔️',
}[props.battle?.result] ?? ''));

/**
 * Agrupa las filas de desglose por nombre de unidad, sumando las pérdidas.
 * Ordena de mayor a menor pérdida para que las unidades más castigadas aparezcan primero.
 * @param {Array<{nombre:string, perdidos:number}>} rows
 * @returns {Array<{nombre:string, perdidos:number}>}
 */
function groupLosses(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const existing = map.get(row.nombre);
    if (existing) existing.perdidos += row.perdidos;
    else          map.set(row.nombre, { nombre: row.nombre, perdidos: row.perdidos });
  }
  return [...map.values()].sort((a, b) => b.perdidos - a.perdidos);
}

const groupedAttacker = computed(() => groupLosses(props.battle.desglose?.Atacante));
const groupedDefender = computed(() => groupLosses(props.battle.desglose?.Milicia));

// ── Sonido (hook preparado) ───────────────────────────────────────────────
// Para activar: descomenta las líneas y coloca los archivos en /public/sounds/
// const sounds = { victory: '/sounds/fanfare.mp3', defeat: '/sounds/drums.mp3', draw: '/sounds/neutral.mp3' };
// function playResultSound(result) { try { new Audio(sounds[result])?.play(); } catch(_) {} }

// ── Tecla Escape ─────────────────────────────────────────────────────────
const handleEsc = (e) => { if (e.key === 'Escape') emit('close'); };
watch(() => props.show, (val) => {
  if (val) {
    document.addEventListener('keydown', handleEsc);
    // playResultSound(props.battle?.result);   // ← descomentar para sonido
  } else {
    document.removeEventListener('keydown', handleEsc);
  }
}, { immediate: false });
onUnmounted(() => document.removeEventListener('keydown', handleEsc));
</script>

<style scoped>
/* ── Transición de entrada ─────────────────────────────────────────────── */
.bsm-fade-enter-active, .bsm-fade-leave-active { transition: opacity 0.25s ease; }
.bsm-fade-enter-from, .bsm-fade-leave-to { opacity: 0; }

/* ── Fondo ────────────────────────────────────────────────────────────── */
.bsm-backdrop {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.82) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

/* ── Caja principal ───────────────────────────────────────────────────── */
.bsm-box {
  position: relative;
  width: 100%;
  max-width: 460px;
  border-radius: 12px;
  overflow: hidden;
  font-family: 'Georgia', serif;
  box-shadow: 0 0 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06);
  background: #0d0d14;
}

/* ── Gradiente lateral por resultado ──────────────────────────────────── */
.bsm-victory { border-top: 3px solid #22c55e; box-shadow: 0 0 60px rgba(0,0,0,0.9), 0 0 30px rgba(34,197,94,0.25); }
.bsm-defeat  { border-top: 3px solid #dc2626; box-shadow: 0 0 60px rgba(0,0,0,0.9), 0 0 30px rgba(220,38,38,0.25); }
.bsm-draw    { border-top: 3px solid #d97706; box-shadow: 0 0 60px rgba(0,0,0,0.9), 0 0 30px rgba(217,119,6,0.25); }

/* ── Decoraciones laterales ───────────────────────────────────────────── */
.bsm-deco {
  position: absolute;
  top: 18px;
  font-size: 1.1rem;
  opacity: 0.25;
  pointer-events: none;
  user-select: none;
}
.bsm-deco-left  { left: 16px;  transform: scaleX(-1); }
.bsm-deco-right { right: 16px; }

/* ── Header ───────────────────────────────────────────────────────────── */
.bsm-header {
  text-align: center;
  padding: 28px 24px 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%);
}

.bsm-crest {
  font-size: 2.8rem;
  line-height: 1;
  margin-bottom: 8px;
  filter: drop-shadow(0 0 12px currentColor);
}

.bsm-title {
  font-size: 2rem;
  font-weight: 900;
  letter-spacing: 6px;
  text-transform: uppercase;
  margin: 0 0 6px;
  line-height: 1;
}
.bsm-title-victory { color: #4ade80; text-shadow: 0 0 20px rgba(74,222,128,0.7), 0 0 40px rgba(74,222,128,0.3); }
.bsm-title-defeat  { color: #f87171; text-shadow: 0 0 20px rgba(248,113,113,0.7), 0 0 40px rgba(248,113,113,0.3); }
.bsm-title-draw    { color: #fbbf24; text-shadow: 0 0 20px rgba(251,191,36,0.7),  0 0 40px rgba(251,191,36,0.3); }

.bsm-fief {
  margin: 0;
  font-size: 0.8rem;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #6b7280;
  font-family: sans-serif;
}

/* ── Divisor ──────────────────────────────────────────────────────────── */
.bsm-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  margin: 4px 0 0;
  color: #4b5563;
  font-family: sans-serif;
  font-size: 0.65rem;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.bsm-divider::before, .bsm-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, #2d2d4a);
}
.bsm-divider::after { background: linear-gradient(90deg, #2d2d4a, transparent); }

/* ── Tabla ────────────────────────────────────────────────────────────── */
.bsm-table-wrap { padding: 12px 20px 4px; }
.bsm-table {
  width: 100%;
  border-collapse: collapse;
  font-family: sans-serif;
  font-size: 0.85rem;
}
.bsm-th-unit, .bsm-th-num {
  padding: 6px 8px;
  color: #4b5563;
  font-size: 0.7rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  border-bottom: 1px solid #1e1e38;
  font-weight: 600;
}
.bsm-th-num { text-align: center; }

.bsm-td-unit {
  padding: 8px 8px;
  color: #d1d5db;
}
.bsm-td-num {
  text-align: center;
  padding: 8px 8px;
  font-weight: 700;
  font-size: 0.95rem;
}
.bsm-table tbody tr { border-bottom: 1px solid #13131f; }
.bsm-table tbody tr:last-child { border-bottom: none; }

/* Fila sin bajas — gris apagado */
.bsm-row-zero .bsm-td-unit { color: #374151; }

/* Colores de bajas */
.bsm-red    { color: #f87171; }
.bsm-orange { color: #fb923c; }
.bsm-zero   { color: #374151; }

/* Fila total */
.bsm-tfoot td {
  padding: 8px 8px;
  border-top: 1px solid #2d2d4a;
  font-family: sans-serif;
  font-size: 0.7rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #4b5563;
  font-weight: 700;
}
.bsm-tfoot .bsm-td-num { font-size: 0.9rem; }

/* ── Resultado final ──────────────────────────────────────────────────── */
.bsm-outcome {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 20px 8px;
  padding: 12px 16px;
  background: rgba(255,255,255,0.03);
  border: 1px solid #1e1e38;
  border-radius: 8px;
  font-family: sans-serif;
}
.bsm-outcome-icon { font-size: 1.3rem; flex-shrink: 0; }
.bsm-outcome-text { font-size: 0.9rem; color: #9ca3af; font-style: italic; }

/* ── Experiencia ganada ───────────────────────────────────────────────── */
.bsm-exp {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 20px 12px;
  padding: 10px 14px;
  background: rgba(251,191,36,0.07);
  border: 1px solid rgba(251,191,36,0.2);
  border-radius: 8px;
  font-family: sans-serif;
}
.bsm-exp-icon { font-size: 1.1rem; flex-shrink: 0; }
.bsm-exp-text { font-size: 0.88rem; color: #d1d5db; }
.bsm-exp-text strong { color: #fbbf24; }

/* ── Botón cerrar ─────────────────────────────────────────────────────── */
.bsm-btn {
  display: block;
  width: calc(100% - 40px);
  margin: 12px 20px 20px;
  padding: 11px;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 6px;
  color: #9ca3af;
  font-size: 0.85rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  font-family: sans-serif;
  transition: background 0.15s, color 0.15s;
}
.bsm-btn:hover { background: #1f2937; color: #e5e7eb; }
</style>
