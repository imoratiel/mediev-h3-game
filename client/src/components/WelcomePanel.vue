<template>
  <div class="welcome-overlay" @click.self="() => {}">
    <div class="welcome-parchment">
      <!-- Heraldic crest -->
      <div class="welcome-crest">⚜️</div>

      <h1 class="welcome-title">El Destino Llama</h1>
      <div class="welcome-divider">✦ ✦ ✦</div>

      <p class="welcome-text">
        Joven Señor, tu nombre resuena aún con suavidad, pero el destino ha puesto ante ti este
        pequeño feudo, refugio de hombres leales. Una pequeña hueste de valientes ha jurado
        proteger tu estandarte. El hierro, el trigo y la gloria aguardan. Ante ti se extiende un
        mundo implacable...
        <em>ahora la senda es tuya.</em>
        ¿Cómo escribirás tu leyenda?
      </p>

      <div class="welcome-grants">
        <div class="grant-item"><span class="grant-icon">🏰</span> Un feudo capital y sus tierras colindantes</div>
        <div class="grant-item"><span class="grant-icon">⚔️</span> Guardia del Señor: 100 milicianos, 50 arqueros, 50 jinetes</div>
        <div class="grant-item"><span class="grant-icon">🏯</span> Cuartel erigido en tu capital</div>
      </div>

      <div class="welcome-divider">✦ ✦ ✦</div>

      <div v-if="error" class="welcome-error">{{ error }}</div>

      <button
        class="welcome-btn"
        :disabled="loading"
        @click="begin"
      >
        <span v-if="loading" class="welcome-btn-inner">
          <span class="welcome-spinner"></span> Preparando tu reino...
        </span>
        <span v-else class="welcome-btn-inner">
          ⚜️ &nbsp;Comenzar mi camino
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { initializePlayer } from '../services/mapApi.js';

const emit = defineEmits(['done']);

const loading = ref(false);
const error   = ref('');

async function begin() {
  if (loading.value) return;
  loading.value = true;
  error.value   = '';
  try {
    const data = await initializePlayer();
    if (data.success || data.message?.includes('inicializado')) {
      emit('done', { capital_h3: data.capital_h3 });
    } else {
      error.value = data.message || 'Error al inicializar el reino';
      loading.value = false;
    }
  } catch (err) {
    // 409 = already initialized — treat as success and continue
    if (err.response?.status === 409) {
      emit('done', {});
    } else {
      error.value = err?.response?.data?.message || 'Error de conexión. Inténtalo de nuevo.';
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
  background: rgba(5, 3, 1, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.welcome-parchment {
  background: radial-gradient(ellipse at center, #2a1f0e 0%, #1a1208 100%);
  border: 2px solid #8b6914;
  border-radius: 12px;
  max-width: 560px;
  width: 100%;
  padding: 44px 48px;
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
  font-size: 3rem;
  margin-bottom: 12px;
  filter: drop-shadow(0 0 10px rgba(201, 168, 76, 0.6));
}

.welcome-title {
  font-size: 1.6rem;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #c9a84c;
  margin: 0 0 14px;
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
  font-size: 0.97rem;
  line-height: 1.8;
  color: #c8b898;
  margin: 0 0 22px;
  font-style: normal;
}

.welcome-text em {
  color: #e8d5b5;
  font-style: italic;
}

.welcome-grants {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #3d2e1a;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 22px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grant-item {
  font-size: 0.82rem;
  color: #a89070;
  font-family: sans-serif;
  display: flex;
  align-items: center;
  gap: 10px;
}

.grant-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.welcome-error {
  color: #f87171;
  font-size: 0.82rem;
  font-family: sans-serif;
  margin-bottom: 12px;
}

.welcome-btn {
  width: 100%;
  padding: 14px 20px;
  background: linear-gradient(135deg, #3d2d10 0%, #2d1f0a 100%);
  border: 1px solid #c9a84c;
  border-radius: 8px;
  color: #fbbf24;
  font-size: 1rem;
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
  opacity: 0.7;
  cursor: not-allowed;
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
