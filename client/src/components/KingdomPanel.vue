<template>
  <div class="fiefs-management">
    <div class="fiefs-table-container">
      <table class="kingdom-table">
        <thead>
          <tr>
            <th class="col-feudo">Feudo</th>
            <th class="col-terreno">Terreno</th>
            <th class="col-number">👥</th>
            <th class="col-number">😊</th>
            <th class="col-number">🌾</th>
            <th class="col-number">🌲</th>
            <th class="col-number">⛰️</th>
            <th class="col-number">⛏️</th>
            <th class="col-number">💰</th>
            <th class="col-prospection">Prospección</th>
            <th class="col-number">Δ Alim.</th>
            <th class="col-number">Auton.</th>
            <th class="col-number">Dist.</th>
            <th class="col-number">⚔️</th>
            <th class="col-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="fief in fiefs" :key="fief.h3_index" :class="{ 'capital-row': fief.is_capital }">
            <td class="fief-name-cell">
              <span v-if="fief.is_capital" class="capital-icon" title="Capital del Reino">👑 </span>{{ fief.name }}
              <span v-if="fief.grace_turns > 0" class="occupation-badge" :title="`Bajo ocupación militar — ${fief.grace_turns} turno${fief.grace_turns !== 1 ? 's' : ''} restante${fief.grace_turns !== 1 ? 's' : ''}`">⚔️ ({{ fief.grace_turns }})</span>
            </td>
            <td class="terrain-cell">{{ fief.terrain }}</td>
            <td class="text-right pop-cell">
              {{ formatNumber(fief.population) }}
            </td>
            <td class="text-right">{{ fief.happiness }}%</td>
            <td class="text-right">{{ formatNumber(fief.food) }}</td>
            <td class="text-right">{{ formatNumber(fief.wood) }}</td>
            <td class="text-right">{{ formatNumber(fief.stone) }}</td>
            <td class="text-right">{{ formatNumber(fief.iron) }}</td>
            <td class="text-gold text-right">{{ formatGold(fief.gold) }}</td>
            <td class="text-center">
              <template v-if="fief.discovered_resource !== null">
                <span
                  :class="{
                    'exploration-badge': true,
                    'exploration-badge-completed': fief.explorationStatus === 'completed',
                    'exploration-badge-exploring': fief.explorationStatus === 'exploring'
                  }"
                  :title="fief.explorationStatusText"
                >
                  {{ fief.explorationStatusIcon }} {{ fief.explorationStatusShort }}
                </span>
              </template>
              <template v-else>
                <span class="dimmed-dash" title="Sin explorar">—</span>
              </template>
            </td>
            <td :class="['text-right', fief.foodBalance < 0 ? 'text-danger' : 'text-success']">
              {{ (fief.foodBalance > 0 ? '+' : '') + formatNumber(fief.foodBalance) }}
            </td>
            <td :class="['text-right', {
              'text-danger': fief.autonomy < 30,
              'text-success': fief.autonomy > 365
            }]">
              {{ fief.autonomy === Infinity ? '∞' : fief.autonomy }}
            </td>
            <td class="text-right">{{ fief.distance }}</td>
            <td class="text-right troops-cell">{{ fief.total_troops || 0 }}</td>
            <td class="table-actions">
              <button class="btn-micro" @click="$emit('focusOnFief', fief.h3_index)" title="Ver en el mapa">🗺️</button>
              <button 
                v-if="fief.explorationStatus === 'pending'"
                class="btn-micro btn-explore-micro" 
                @click="$emit('exploreFief', fief.h3_index)"
                :disabled="playerGold < explorationConfig.gold_cost"
                :title="`Explorar (${explorationConfig.gold_cost} 💰)`"
              >
                ⛏️
              </button>
              <button class="btn-micro btn-recruit-micro" @click="$emit('openRecruitment', fief)" title="Reclutar tropas">⚔️</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="fiefs.length === 0" class="empty-state">
        <p>No se encontraron feudos.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  fiefs: Array,
  playerGold: Number,
  explorationConfig: Object
});

defineEmits(['focusOnFief', 'exploreFief', 'openRecruitment']);

const formatNumber = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
  return Math.round(val).toString();
};

const formatGold = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  return Number(val).toFixed(2);
};

</script>

<style scoped>
.kingdom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  color: #e8d5b5;
  table-layout: fixed;
  border: 1px solid #5d4e37;
}

/* Column widths */
.col-feudo { width: 160px; }
.col-terreno { width: 110px; }
.col-number { width: 70px; }
.col-prospection { width: 120px; }
.col-actions { width: 140px; }

.kingdom-table th {
  background: rgba(26, 22, 18, 0.9);
  padding: 10px 12px;
  text-align: center !important;
  border: 1px solid #5d4e37;
  border-bottom: 3px solid #c5a059;
  color: #ffd700;
  font-family: 'Cinzel', serif;
  text-transform: uppercase;
  font-size: 0.8rem;
  font-weight: bold;
  position: sticky;
  top: 0;
  z-index: 10;
}

.kingdom-table td {
  padding: 10px 12px;
  border-right: 1px solid rgba(93, 78, 55, 0.4);
  border-bottom: 1px solid rgba(93, 78, 55, 0.3);
  vertical-align: middle;
}

.kingdom-table td:last-child {
  border-right: none;
}

.kingdom-table tbody tr {
  transition: background-color 0.2s;
  border-bottom: 1px solid rgba(93, 78, 55, 0.3);
}

.kingdom-table tbody tr:hover {
  background: rgba(197, 160, 89, 0.15);
}

.kingdom-table tbody tr:nth-child(even) {
  background: rgba(0, 0, 0, 0.2);
}

.kingdom-table tbody tr:nth-child(even):hover {
  background: rgba(197, 160, 89, 0.2);
}

/* Capital row highlight */
.capital-row {
  background: rgba(255, 215, 0, 0.08) !important;
  border-left: 3px solid #ffd700;
}

.capital-row:hover {
  background: rgba(255, 215, 0, 0.15) !important;
}

.capital-icon {
  font-size: 1.1rem;
  color: #ffd700;
  margin-right: 4px;
  animation: pulse-gold 2s ease-in-out infinite;
}

@keyframes pulse-gold {
  0%, 100% {
    opacity: 1;
    text-shadow: 0 0 8px rgba(255, 215, 0, 0.6);
  }
  50% {
    opacity: 0.85;
    text-shadow: 0 0 12px rgba(255, 215, 0, 0.8);
  }
}

.occupation-badge {
  display: inline-block;
  margin-left: 5px;
  font-size: 0.68rem;
  color: #ff6b35;
  background: rgba(255, 107, 53, 0.12);
  border: 1px solid rgba(255, 107, 53, 0.4);
  border-radius: 3px;
  padding: 1px 4px;
  vertical-align: middle;
  cursor: help;
}

.text-right { text-align: right; }

/* Population cap display */
.pop-cell { white-space: nowrap; }
.pop-sep { color: rgba(255,255,255,0.25); font-size: 0.75rem; margin: 0 1px; }
.pop-cap-val { color: rgba(255,255,255,0.35); font-size: 0.78rem; }
.pop-at-cap { color: #f97316; font-weight: 700; }
.text-center { text-align: center; }
.text-gold { color: #ffd700; }
.text-danger { color: #ff6b6b; }
.text-success { color: #4caf50; }

.fief-name-cell {
  font-weight: 600;
  color: #f4e4bc;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left !important;
}

.terrain-cell {
  color: #d4c5a0;
  font-size: 0.9rem;
  text-align: left !important;
}

.troops-cell {
  font-weight: bold;
  color: #ff9800;
}

.dimmed-dash {
  color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}

.table-actions {
  display: flex;
  gap: 6px;
  justify-content: center;
  align-items: center;
}

.btn-micro {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid #5d4e37;
  color: #f4e4bc;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
}

.btn-micro:hover:not(:disabled) {
  background: rgba(197, 160, 89, 0.3);
  border-color: #c5a059;
  transform: scale(1.1);
}

.btn-micro:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-explore-micro {
  background: rgba(26, 22, 18, 0.6);
}

.btn-recruit-micro {
  background: rgba(255, 215, 0, 0.1);
  color: #ffd700;
  border-color: rgba(255, 215, 0, 0.3);
}

.btn-recruit-micro:hover:not(:disabled) {
  background: rgba(255, 215, 0, 0.2);
  border-color: #ffd700;
}

.exploration-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
  display: inline-block;
}

.exploration-badge-completed {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
  border: 1px solid #4caf50;
}

.exploration-badge-exploring {
  background: rgba(243, 156, 18, 0.2);
  color: #f39c12;
  border: 1px solid #f39c12;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #a89875;
  font-style: italic;
}
</style>
