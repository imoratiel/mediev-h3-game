<template>
  <div class="changelog-overlay">
    <div class="changelog-container">
      <div class="changelog-header">
        <h2 class="changelog-title">📋 Novedades</h2>
        <button class="changelog-close" @click="$emit('close')">✕</button>
      </div>

      <div class="changelog-content">
        <div v-if="loading" class="changelog-loading">Cargando novedades...</div>
        <div v-else-if="error" class="changelog-error">{{ error }}</div>
        <div v-else-if="releases.length === 0" class="changelog-empty">Sin entradas aún.</div>

        <div v-else class="releases-list">
          <div v-for="r in releases" :key="r.version" class="release-card">
            <div class="release-header">
              <span class="release-version">v{{ r.version }}</span>
              <span v-if="r.date" class="release-date">{{ r.date }}</span>
            </div>
            <div class="release-body" v-html="renderMarkdown(r.body)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

defineEmits(['close']);

const loading  = ref(true);
const error    = ref('');
const releases = ref([]);

onMounted(async () => {
  try {
    const { data } = await axios.get('/api/changelog');
    releases.value = data.releases || [];
  } catch {
    error.value = 'No se pudieron cargar las novedades.';
  } finally {
    loading.value = false;
  }
});

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^### (.+)$/gm, '<h4 class="cl-section">$1</h4>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // strip links, keep text
    .replace(/\n{2,}/g, '<br>');
}
</script>

<style scoped>
.changelog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.changelog-container {
  background: #1a1a2e;
  border: 1px solid #3a3a5c;
  border-radius: 10px;
  width: min(560px, 95vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}

.changelog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #3a3a5c;
}

.changelog-title {
  margin: 0;
  font-size: 1.1rem;
  color: #f4e4bc;
}

.changelog-close {
  background: none;
  border: none;
  color: #888;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 2px 6px;
}
.changelog-close:hover { color: #fff; }

.changelog-content {
  overflow-y: auto;
  padding: 16px 20px;
  flex: 1;
}

.changelog-loading,
.changelog-error,
.changelog-empty {
  color: #888;
  text-align: center;
  padding: 24px 0;
}

.releases-list { display: flex; flex-direction: column; gap: 20px; }

.release-card {
  border-left: 3px solid #4a6fa5;
  padding-left: 14px;
}

.release-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.release-version {
  font-weight: 700;
  color: #7eb8f7;
  font-size: 1rem;
}

.release-date {
  font-size: 0.78rem;
  color: #666;
}

.release-body {
  font-size: 0.85rem;
  color: #c8bfa8;
  line-height: 1.55;
}

.release-body :deep(h4.cl-section) {
  font-size: 0.82rem;
  color: #a0a0c0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 10px 0 4px;
}

.release-body :deep(ul) {
  margin: 0;
  padding-left: 16px;
  list-style: disc;
}

.release-body :deep(li) {
  margin-bottom: 2px;
}
</style>
