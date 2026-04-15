<template>
  <Teleport to="body">
    <div v-if="show" class="profile-backdrop" @click.self="$emit('close')">
      <div class="profile-modal">

        <button class="profile-close" @click="$emit('close')" title="Cerrar">✕</button>

        <div v-if="loading" class="profile-loading">
          <div class="profile-spinner"></div>
          <span>Consultando los archivos...</span>
        </div>

        <div v-else-if="error" class="profile-error">
          <p>⚠️ {{ error }}</p>
        </div>

        <template v-else-if="profile">
          <!-- ── HERO ─────────────────────────────────────────── -->
          <div class="profile-hero">
            <div class="profile-portrait">
              <span class="portrait-placeholder">{{ profile.is_main_character ? '👑' : profile.is_heir ? '🤴' : profile.age < 16 ? '🧒' : '⭐' }}</span>
            </div>

            <div class="profile-identity">
              <h2 class="profile-name">{{ profile.name }}</h2>

              <div class="profile-rank-row">
                <span v-if="profile.noble_rank_title" class="rank-badge">{{ profile.noble_rank_title }}</span>
                <span v-if="profile.is_main_character" class="role-badge role-leader">Líder</span>
                <span v-else-if="profile.is_heir" class="role-badge role-heir">Heredero</span>
              </div>

              <div class="profile-meta-row">
                <span v-if="profile.dynasty" class="meta-item">🏛 {{ profile.dynasty }}</span>
                <span v-if="profile.culture_name" class="meta-sep">·</span>
                <span v-if="profile.culture_name" class="meta-item">{{ profile.culture_name }}</span>
              </div>

              <div class="profile-stats-grid">
                <div class="pstat">
                  <span class="pstat-val">{{ profile.age }}</span>
                  <span class="pstat-lbl">Edad</span>
                </div>
                <div class="pstat">
                  <span class="pstat-val">Nv.{{ profile.display_level }}</span>
                  <span class="pstat-lbl">Nivel</span>
                </div>
                <div class="pstat">
                  <span class="pstat-val" :class="healthClass(profile.health)">{{ profile.health }}%</span>
                  <span class="pstat-lbl">Salud</span>
                </div>
                <div class="pstat">
                  <span class="pstat-val">{{ profile.division_count }}</span>
                  <span class="pstat-lbl">Comarcas</span>
                </div>
                <div class="pstat">
                  <span class="pstat-val">{{ profile.fief_count }}</span>
                  <span class="pstat-lbl">Territorios</span>
                </div>
                <div class="pstat" v-if="profile.combat_buff_pct > 0">
                  <span class="pstat-val text-purple">+{{ profile.combat_buff_pct }}%</span>
                  <span class="pstat-lbl">Combate</span>
                </div>
                <div class="pstat">
                  <span class="pstat-val">{{ profile.personal_guard }}/25</span>
                  <span class="pstat-lbl">Guardia</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── DIVIDER ─────────────────────────────────────── -->
          <div class="profile-divider"></div>

          <!-- ── BODY ───────────────────────────────────────── -->
          <div class="profile-body">

            <!-- Children -->
            <div class="profile-section">
              <h3 class="section-title">👶 Hijos ({{ profile.children.length }})</h3>
              <div v-if="profile.children.length === 0" class="section-empty">Sin descendencia</div>
              <div v-else class="children-list">
                <div v-for="child in profile.children" :key="child.id" class="person-row" @click="$emit('open-profile', child.id)">
                  <span class="person-icon">{{ child.age < 16 ? '🧒' : child.is_heir ? '🤴' : '⭐' }}</span>
                  <span class="person-name">{{ child.name }}</span>
                  <span class="person-age">{{ child.age }} años</span>
                  <span v-if="child.is_heir" class="person-badge heir-badge">Heredero</span>
                </div>
              </div>
            </div>

            <!-- Lineage -->
            <div class="profile-section">
              <h3 class="section-title">📜 Linaje</h3>
              <div v-if="profile.ancestors.length === 0" class="section-empty">Sin registros</div>
              <div v-else class="ancestors-list">
                <div v-for="(anc, i) in profile.ancestors" :key="anc.id" class="person-row ancestor-row">
                  <span class="person-icon">👤</span>
                  <div class="ancestor-info">
                    <span class="person-name">{{ anc.name }}</span>
                    <span class="ancestor-rel">{{ ancestorLabel(i, profile.ancestors.length) }}</span>
                  </div>
                  <span v-if="!anc.is_alive" class="ancestor-dead" title="Fallecido">†</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ── ABILITIES ───────────────────────────────────── -->
          <div v-if="profile.abilities && profile.abilities.length" class="profile-abilities">
            <h3 class="section-title">⚔️ Habilidades</h3>
            <div class="abilities-list">
              <span
                v-for="ab in profile.abilities"
                :key="ab.ability_key"
                class="ability-chip"
                :title="ab.ability_key"
              >
                {{ abilityIcon(ab.ability_key) }} {{ abilityLabel(ab.ability_key) }}
                <span class="ability-level">Nv.{{ ab.level }}</span>
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue';
import { getCharacterProfile } from '@/services/mapApi.js';

const props = defineProps({
  show:        { type: Boolean, default: false },
  characterId: { type: Number,  default: null },
});

const emit = defineEmits(['close', 'open-profile']);

const profile = ref(null);
const loading = ref(false);
const error   = ref(null);

watch(() => [props.show, props.characterId], async ([show, id]) => {
  if (!show || !id) { profile.value = null; return; }
  loading.value = true;
  error.value   = null;
  try {
    const data = await getCharacterProfile(id);
    profile.value = data.character ?? null;
  } catch (e) {
    error.value = e?.response?.data?.message ?? 'Error al cargar la ficha';
  } finally {
    loading.value = false;
  }
}, { immediate: true });

const healthClass = (h) => h > 66 ? 'text-green' : h > 33 ? 'text-orange' : 'text-red';

const ANCESTOR_LABELS = ['Bisabuelo', 'Abuelo', 'Padre'];
const ancestorLabel = (i, total) => {
  const fromEnd = total - 1 - i;
  return ANCESTOR_LABELS[fromEnd] ?? 'Antepasado';
};

const ABILITY_META = {
  estrategia: { label: 'Estrategia', icon: '⚔️' },
  logistica:  { label: 'Logística',  icon: '📦' },
  diplomacia: { label: 'Diplomacia', icon: '⚖️' },
};
const abilityLabel = (key) => ABILITY_META[key]?.label ?? key;
const abilityIcon  = (key) => ABILITY_META[key]?.icon  ?? '✦';
</script>

<style scoped>
/* ── Backdrop ─────────────────────────────────────────────── */
.profile-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.70);
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

/* ── Modal card ───────────────────────────────────────────── */
.profile-modal {
  position: relative;
  background: linear-gradient(160deg, #1a1410 0%, #13100c 100%);
  border: 1px solid rgba(197, 160, 89, 0.35);
  border-top: 2px solid rgba(197, 160, 89, 0.6);
  border-radius: 12px;
  width: 560px;
  max-width: 96vw;
  max-height: 88vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(197, 160, 89, 0.1);
  padding: 24px 22px 20px;
  scrollbar-width: thin;
  scrollbar-color: rgba(197,160,89,0.2) transparent;
}

/* ── Close button ─────────────────────────────────────────── */
.profile-close {
  position: absolute;
  top: 14px;
  right: 14px;
  background: none;
  border: none;
  color: #7a6a50;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s;
  line-height: 1;
}
.profile-close:hover { color: #e8d5b5; }

/* ── Loading / error states ───────────────────────────────── */
.profile-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px 20px;
  color: #a89070;
  font-size: 0.85rem;
  justify-content: center;
}
.profile-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #4a3520;
  border-top-color: #c5a059;
  border-radius: 50%;
  animation: pspin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes pspin { to { transform: rotate(360deg); } }

.profile-error {
  padding: 30px 20px;
  text-align: center;
  color: #ff6b6b;
  font-size: 0.85rem;
}

/* ── Hero ─────────────────────────────────────────────────── */
.profile-hero {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.profile-portrait {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  background: rgba(197, 160, 89, 0.07);
  border: 1px solid rgba(197, 160, 89, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.portrait-placeholder {
  font-size: 2.5rem;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
}

.profile-identity {
  flex: 1;
  min-width: 0;
}

.profile-name {
  font-family: 'Cinzel', serif;
  font-size: 1.3rem;
  font-weight: 700;
  color: #f4e4bc;
  margin: 0 0 6px;
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.profile-rank-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}
.rank-badge {
  font-size: 0.75rem;
  font-family: 'Cinzel', serif;
  color: #c5a059;
  background: rgba(197, 160, 89, 0.12);
  border: 1px solid rgba(197, 160, 89, 0.3);
  border-radius: 4px;
  padding: 2px 8px;
}
.role-badge {
  font-size: 0.7rem;
  font-weight: 700;
  border-radius: 4px;
  padding: 2px 7px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.role-leader { background: rgba(255,215,0,0.12); color: #ffd700; border: 1px solid rgba(255,215,0,0.3); }
.role-heir   { background: rgba(197,160,89,0.12); color: #c5a059; border: 1px solid rgba(197,160,89,0.3); }

.profile-meta-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 0.78rem;
  color: #9a8a6a;
}
.meta-sep { color: rgba(197,160,89,0.3); }

/* ── Stats grid ───────────────────────────────────────────── */
.profile-stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pstat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(93, 78, 55, 0.5);
  border-radius: 6px;
  padding: 5px 10px;
  min-width: 52px;
}
.pstat-val {
  font-size: 0.95rem;
  font-weight: 700;
  color: #e8d5b5;
  line-height: 1.2;
}
.pstat-lbl {
  font-size: 0.62rem;
  color: #7a6a50;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 1px;
}

/* ── Divider ──────────────────────────────────────────────── */
.profile-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(197,160,89,0.3), transparent);
  margin: 0 0 18px;
}

/* ── Body columns ─────────────────────────────────────────── */
.profile-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

/* ── Section ──────────────────────────────────────────────── */
.profile-section {
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(93, 78, 55, 0.4);
  border-radius: 8px;
  padding: 12px 13px;
}

.section-title {
  font-size: 0.72rem;
  font-family: 'Cinzel', serif;
  color: #c5a059;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 9px;
  font-weight: 700;
}

.section-empty {
  font-size: 0.75rem;
  color: #5a4a30;
  font-style: italic;
}

/* ── Person row (children & ancestors) ───────────────────── */
.person-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(93, 78, 55, 0.2);
}
.person-row:last-child { border-bottom: none; }

.children-list .person-row {
  cursor: pointer;
  border-radius: 4px;
  padding: 4px 3px;
  transition: background 0.12s;
}
.children-list .person-row:hover { background: rgba(197,160,89,0.06); }

.person-icon { font-size: 0.9rem; flex-shrink: 0; }

.person-name {
  font-size: 0.8rem;
  color: #e8d5b5;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.person-age {
  font-size: 0.7rem;
  color: #7a6a50;
  flex-shrink: 0;
}

.person-badge {
  font-size: 0.62rem;
  padding: 1px 5px;
  border-radius: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.heir-badge { background: rgba(197,160,89,0.2); color: #c5a059; }

/* ── Ancestor specific ────────────────────────────────────── */
.ancestor-row { cursor: default; }
.ancestor-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ancestor-rel {
  font-size: 0.62rem;
  color: #7a6a50;
}
.ancestor-dead {
  color: #5a4a30;
  font-size: 0.9rem;
  font-weight: 700;
  flex-shrink: 0;
  title: "Fallecido";
}

/* ── Abilities ────────────────────────────────────────────── */
.profile-abilities {
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(93, 78, 55, 0.4);
  border-radius: 8px;
  padding: 12px 13px;
}

.abilities-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ability-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(120, 100, 200, 0.12);
  border: 1px solid rgba(120, 100, 200, 0.25);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.78rem;
  color: #b0a0e0;
}
.ability-level {
  font-size: 0.68rem;
  color: #7a6a8a;
  margin-left: 2px;
}

/* ── Color helpers ────────────────────────────────────────── */
.text-green  { color: #4caf50; }
.text-orange { color: #ff9800; }
.text-red    { color: #f44336; }
.text-purple { color: #b39ddb; }

/* ── Scrollbar ────────────────────────────────────────────── */
.profile-modal::-webkit-scrollbar { width: 4px; }
.profile-modal::-webkit-scrollbar-track { background: transparent; }
.profile-modal::-webkit-scrollbar-thumb { background: rgba(197,160,89,0.2); border-radius: 2px; }

/* ── Mobile ───────────────────────────────────────────────── */
@media (max-width: 560px) {
  .profile-body {
    grid-template-columns: 1fr;
  }
  .profile-hero {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .profile-rank-row,
  .profile-meta-row,
  .profile-stats-grid {
    justify-content: center;
  }
}
</style>
