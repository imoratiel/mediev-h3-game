<template>
  <div class="notifications-panel">

    <!-- Barra de filtro -->
    <div class="notif-filter-bar">
      <div class="notif-filter-toggle">
        <button
          class="filter-pill"
          :class="{ active: !showOnlyUnread }"
          @click="showOnlyUnread = false"
        >Todas <span class="filter-count">{{ notifications.length }}</span></button>
        <button
          class="filter-pill"
          :class="{ active: showOnlyUnread }"
          @click="showOnlyUnread = true"
        >No leídas <span class="filter-count unread-count">{{ unreadCount }}</span></button>
      </div>
      <button
        class="mark-all-btn"
        :disabled="unreadCount === 0 || markingAll"
        @click="handleMarkAll"
        title="Marcar todas como leídas"
      >{{ markingAll ? '⏳' : '✓ Marcar todas' }}</button>
    </div>

    <div v-if="loading" class="notif-loading">Cargando notificaciones...</div>

    <div v-else-if="filteredNotifications.length === 0" class="notif-empty">
      <p v-if="showOnlyUnread && notifications.length > 0">✅ Todo al día — sin notificaciones sin leer.</p>
      <p v-else>No tienes notificaciones.</p>
    </div>

    <div v-else class="notif-list">
      <div
        v-for="notif in filteredNotifications"
        :key="notif.id"
        class="notif-card"
        :class="{ 'notif-unread': !notif.is_read, [`notif-type-${notif.type?.toLowerCase()}`]: true }"
        @click="handleRead(notif)"
      >
        <div class="notif-header">
          <span class="notif-type-badge">{{ typeLabel(notif.type) }}</span>
          <span class="notif-turn">Turno {{ notif.turn_number }}</span>
        </div>
        <div class="notif-content">{{ notif.content }}</div>
        <div v-if="!notif.is_read" class="notif-unread-dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { markAllNotificationsRead } from '../services/mapApi.js';

const props = defineProps({
  notifications: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
});

const emit = defineEmits(['read', 'readAll']);

const showOnlyUnread = ref(false);
const markingAll = ref(false);

const unreadCount = computed(() => props.notifications.filter(n => !n.is_read).length);

const filteredNotifications = computed(() =>
  showOnlyUnread.value
    ? props.notifications.filter(n => !n.is_read)
    : props.notifications
);

const TYPE_LABELS = {
  HARVEST: '🌾 Cosecha',
  PRODUCTION: '🏭 Producción',
  EXPLORATION: '🔍 Exploración',
  COMBAT: '⚔️ Combate',
  MOVEMENT: '🚶 Movimiento',
};

const typeLabel = (type) => TYPE_LABELS[type] || `📢 ${type || 'Sistema'}`;

const handleRead = (notif) => {
  emit('read', notif);
};

const handleMarkAll = async () => {
  if (unreadCount.value === 0 || markingAll.value) return;
  markingAll.value = true;
  try {
    await markAllNotificationsRead();
    emit('readAll');
  } catch (err) {
    console.error('❌ Error al marcar todas como leídas:', err);
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
  overflow-y: auto;
  padding: 12px 16px;
  gap: 10px;
  color: #e8d5b5;
}

/* ── Barra de filtro ─────────────────────────── */
.notif-filter-bar {
  flex-shrink: 0;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(197, 160, 89, 0.18);
}

.notif-filter-toggle {
  display: flex;
  gap: 6px;
}

.mark-all-btn {
  margin-top: 6px;
  width: 100%;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(197, 160, 89, 0.3);
  background: rgba(197, 160, 89, 0.08);
  color: #a89875;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.mark-all-btn:hover:not(:disabled) {
  background: rgba(197, 160, 89, 0.18);
  border-color: rgba(197, 160, 89, 0.6);
  color: #ffd700;
}

.mark-all-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.filter-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 20px;
  border: 1px solid rgba(197, 160, 89, 0.25);
  background: rgba(0, 0, 0, 0.25);
  color: #a89875;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.filter-pill:hover {
  border-color: rgba(197, 160, 89, 0.5);
  color: #d4c4a0;
}

.filter-pill.active {
  background: rgba(197, 160, 89, 0.15);
  border-color: rgba(197, 160, 89, 0.6);
  color: #ffd700;
}

.filter-count {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  min-width: 18px;
  text-align: center;
}

.unread-count {
  background: rgba(255, 215, 0, 0.18);
  color: #ffd700;
}

/* ── Estados vacíos y carga ──────────────────── */
.notif-loading,
.notif-empty {
  text-align: center;
  padding: 40px 20px;
  color: #a89875;
  font-size: 1rem;
}

/* ── Lista ───────────────────────────────────── */
.notif-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notif-card {
  position: relative;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(197, 160, 89, 0.25);
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.notif-card:hover {
  background: rgba(197, 160, 89, 0.12);
  border-color: rgba(197, 160, 89, 0.5);
}

.notif-unread {
  border-left: 3px solid #ffd700;
  background: rgba(255, 215, 0, 0.06);
}

.notif-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.notif-type-badge {
  font-size: 0.78rem;
  font-weight: 700;
  color: #ffd700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.notif-turn {
  font-size: 0.75rem;
  color: #a89875;
  font-family: monospace;
}

.notif-content {
  font-size: 0.88rem;
  color: #d4c4a0;
  white-space: pre-line;
  line-height: 1.5;
}

.notif-unread-dot {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffd700;
}
</style>
