<template>
  <div class="notifications-panel">

    <!-- Pestañas de categoría -->
    <nav class="tab-bar">
      <button
        v-for="cat in CATEGORIES"
        :key="cat.key"
        class="tab-btn"
        :class="{ 'tab-active': activeTab === cat.key }"
        :style="activeTab === cat.key ? { '--tab-color': cat.color, '--tab-border': cat.border } : {}"
        @click="activeTab = cat.key"
        :title="cat.label"
      >
        <span class="tab-icon">{{ cat.icon }}</span>
        <span class="tab-label">{{ cat.label }}</span>
        <span
          v-if="unreadByTab[cat.key] > 0"
          class="tab-unread"
          :style="activeTab === cat.key ? { background: cat.color, color: '#111' } : {}"
        >{{ unreadByTab[cat.key] }}</span>
      </button>
    </nav>

    <!-- Acción global -->
    <div class="notif-topbar" v-if="!loading">
      <span class="notif-summary">
        <template v-if="unreadCount > 0">
          <span class="unread-badge">{{ unreadCount }}</span> sin leer en total
        </template>
        <template v-else>✅ Todo al día</template>
      </span>
      <button
        class="mark-all-btn"
        :disabled="unreadCount === 0 || markingAll"
        @click="handleMarkAll"
      >{{ markingAll ? '⏳' : '✓ Marcar todas' }}</button>
    </div>

    <!-- Contenido de la pestaña activa -->
    <div v-if="loading" class="notif-empty">Cargando notificaciones...</div>

    <template v-else>
      <div v-if="activeItems.length === 0" class="notif-empty">
        No hay notificaciones en esta categoría.
      </div>

      <div v-else class="notif-list">
        <article
          v-for="notif in activeItems"
          :key="notif.id"
          class="notif-card"
          :class="{ 'notif-unread': !notif.is_read }"
          :style="{ '--cat-color': activeCategory.color }"
          @click="handleRead(notif)"
        >
          <div class="notif-meta">
            <span class="notif-turn">{{ turnToGameDate(notif.turn_number) }}</span>
            <span v-if="!notif.is_read" class="notif-unread-dot"></span>
          </div>
          <p class="notif-content">{{ notif.content }}</p>
        </article>
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { markAllNotificationsRead } from '../services/mapApi.js';

const props = defineProps({
  notifications: { type: Array, default: () => [] },
  loading:       { type: Boolean, default: false },
  currentTurn:   { type: Number, default: 0 },
  gameDate:      { type: Date,   default: null },
});

// ── Categorías — orden: críticas primero ──────────────────────────────────────
const CATEGORIES = [
  { key: 'Militar',   icon: '⚔️', label: 'Militar',   color: '#e57373', border: 'rgba(229,115,115,0.6)' },
  { key: 'Hambre',    icon: '🚨', label: 'Hambre',    color: '#ff8a65', border: 'rgba(255,138,101,0.6)' },
  { key: 'Económico', icon: '💰', label: 'Económico', color: '#81c784', border: 'rgba(129,199,132,0.5)' },
  { key: 'Impuestos', icon: '📜', label: 'Impuestos', color: '#ffd700', border: 'rgba(255,215,0,  0.5)' },
  { key: 'General',   icon: '📢', label: 'General',   color: '#a89875', border: 'rgba(168,152,117,0.4)' },
];

const validKeys = new Set(CATEGORIES.map(c => c.key));

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const turnToGameDate = (n) => {
  if (!props.currentTurn || !props.gameDate || !n) return n ? `Turno ${n}` : '';
  const d = new Date(props.gameDate);
  d.setDate(d.getDate() - (props.currentTurn - n));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const emit = defineEmits(['read', 'readAll']);

const activeTab = ref('Militar');
const markingAll = ref(false);

const unreadCount = computed(() => props.notifications.filter(n => !n.is_read).length);

// ── Agrupación ────────────────────────────────────────────────────────────────
const grouped = computed(() =>
  props.notifications.reduce((acc, n) => {
    const key = validKeys.has(n.type) ? n.type : 'General';
    (acc[key] ??= []).push(n);
    return acc;
  }, {})
);

// Contador de no leídas por pestaña
const unreadByTab = computed(() =>
  Object.fromEntries(
    CATEGORIES.map(c => [c.key, (grouped.value[c.key] ?? []).filter(n => !n.is_read).length])
  )
);

const activeCategory = computed(() => CATEGORIES.find(c => c.key === activeTab.value));
const activeItems    = computed(() => grouped.value[activeTab.value] ?? []);

const handleRead = (notif) => emit('read', notif);

const handleMarkAll = async () => {
  if (unreadCount.value === 0 || markingAll.value) return;
  markingAll.value = true;
  try {
    await markAllNotificationsRead();
    // Actualizar estado local directamente para reactividad inmediata
    props.notifications.forEach(n => { n.is_read = true; });
    emit('readAll');
  } catch (err) {
    console.error('Error al marcar notificaciones:', err);
  } finally {
    markingAll.value = false;
  }
};
</script>

<style scoped>
.notifications-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: #e8d5b7;
  overflow: hidden;
}

/* ── Pestañas ────────────────────────────────── */
.tab-bar {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(197, 160, 89, 0.2);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar { display: none; }

.tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 60px;
  padding: 8px 6px 7px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #7a6a55;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  transition: color 0.18s, border-color 0.18s, background 0.18s;
}
.tab-btn:hover:not(.tab-active) {
  color: #a89875;
  background: rgba(255, 255, 255, 0.03);
}
.tab-active {
  color: var(--tab-color);
  border-bottom-color: var(--tab-color);
  background: rgba(255, 255, 255, 0.04);
}

.tab-icon { font-size: 1.1rem; line-height: 1; }
.tab-label { font-size: 0.63rem; }

.tab-unread {
  position: absolute;
  top: 5px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(197, 160, 89, 0.3);
  color: #ffd700;
  font-size: 0.62rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.18s, color 0.18s;
}

/* ── Barra de acción ─────────────────────────── */
.notif-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(197, 160, 89, 0.1);
}

.notif-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #7a6a55;
}

.unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(255, 215, 0, 0.18);
  color: #ffd700;
  font-size: 0.72rem;
  font-weight: 700;
}

.mark-all-btn {
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid rgba(197, 160, 89, 0.25);
  background: transparent;
  color: #7a6a55;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  white-space: nowrap;
}
.mark-all-btn:hover:not(:disabled) {
  background: rgba(197, 160, 89, 0.12);
  border-color: rgba(197, 160, 89, 0.5);
  color: #ffd700;
}
.mark-all-btn:disabled { opacity: 0.25; cursor: not-allowed; }

/* ── Lista y tarjetas ────────────────────────── */
.notif-empty {
  text-align: center;
  padding: 50px 20px;
  color: #5a4e40;
  font-size: 0.9rem;
}

.notif-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 14px;
}

.notif-card {
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(197, 160, 89, 0.12);
  border-left: 2px solid transparent;
  border-radius: 5px;
  padding: 9px 13px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
  flex-shrink: 0;
}
.notif-card:hover {
  background: rgba(197, 160, 89, 0.07);
  border-color: rgba(197, 160, 89, 0.28);
}
.notif-unread {
  border-left-color: var(--cat-color);
  background: rgba(0, 0, 0, 0.4);
}

.notif-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.notif-turn {
  font-size: 0.68rem;
  color: #5a4e40;
  font-family: monospace;
}

.notif-unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cat-color);
  flex-shrink: 0;
}

.notif-content {
  margin: 0;
  font-size: 0.86rem;
  color: #d0c0a0;
  white-space: pre-line;
  line-height: 1.55;
}
</style>
