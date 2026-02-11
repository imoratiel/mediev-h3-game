/**
 * popupGenerator.js
 * Genera el contenido HTML para los popups del mapa
 */

import { gridDisk } from 'h3-js';

/**
 * Genera el contenido HTML del popup de detalles de celda
 * @param {Object} cell - Datos de la celda desde la API
 * @param {Object} config - Configuración del popup
 * @returns {String} HTML content para el popup
 */
export function generateCellPopupContent(cell, config) {
  const {
    playerId,
    playerGold,
    playerHexes,
    currentTurn,
    isColonizing,
    explorationConfig,
    h3_index
  } = config;

  let popupContent = '<div class="cell-inspector">';

  // CAPITAL BADGE - Show if this is the capital
  if (cell.is_capital) {
    popupContent += '<div class="capital-header">🏰 SEDE DEL REINO</div>';
  }

  // TITLE - Settlement name or "Territorio Salvaje"
  const title = cell.settlement_name || (cell.player_id ? `Territorio de ${cell.player_name}` : 'Territorio Salvaje');
  const titleIcon = cell.is_capital ? '👑' : (cell.settlement_name ? '🏛️' : '🗺️');

  popupContent += `<h3 class="popup-title">${titleIcon} ${title}</h3>`;

  // HEXAGON INFO - ID and Coordinates in one line
  popupContent += '<div class="hex-info-box">';

  // Build single line: 📍 h3_index (coord_x, coord_y)
  let hexInfo = `📍 ${h3_index}`;
  if (cell.coord_x !== null && cell.coord_x !== undefined && cell.coord_y !== null && cell.coord_y !== undefined) {
    hexInfo += ` (${cell.coord_x}, ${cell.coord_y})`;
  }

  popupContent += `<p class="hex-info-item">${hexInfo}</p>`;
  popupContent += '</div>';

  // OWNER - Player name or "Sin reclamar"
  const ownerText = cell.player_name
    ? `<span class="popup-owner-name" style="color: #1a1612; border-bottom: 2px solid ${cell.player_color}">⚔️ ${cell.player_name}</span>`
    : '<span class="unclaimed-text">🌿 Sin reclamar</span>';
  popupContent += `<p class="popup-stat-row"><strong>Dueño:</strong> ${ownerText}</p>`;

  // TERRAIN TYPE
  popupContent += `<p class="popup-stat-row"><strong>Terreno:</strong> ${cell.terrain_type}</p>`;

  // BUILDING (if any)
  if (cell.building_type) {
    popupContent += `<p class="popup-stat-row"><strong>Edificio:</strong> ${cell.building_type}</p>`;
  }

  // TERRITORY DETAILS (only if owned and has territory data)
  if (cell.territory && cell.player_id === playerId) {
    popupContent += '<div class="popup-details-box">';
    popupContent += '<p class="popup-details-title">📊 Detalles del Territorio</p>';

    // Population & Happiness
    popupContent += `<p class="popup-detail-item">👥 Población: ${cell.territory.population} habitantes</p>`;
    popupContent += `<p class="popup-detail-item">😊 Felicidad: ${cell.territory.happiness || 0}%</p>`;

    // Resources
    popupContent += '<p class="popup-resources-label">Recursos Almacenados:</p>';
    popupContent += '<div class="popup-resource-grid">';
    popupContent += `<span class="resource-item">🌾 Comida: ${cell.territory.food}</span>`;
    popupContent += `<span class="resource-item">🌲 Madera: ${cell.territory.wood}</span>`;

    // Determine exploration state
    const isExplored = cell.territory.discovered_resource !== null;
    const isExploring = cell.territory.exploration_end_turn !== null && currentTurn < cell.territory.exploration_end_turn;

    // Mining resources - only show if territory has been explored
    if (isExplored) {
      if (cell.territory.discovered_resource !== 'none') {
        if (cell.territory.discovered_resource === 'stone') {
          const stone = Number(cell.territory.stone || 0);
          popupContent += `<span class="resource-item">⛰️ Piedra: ${Math.round(stone)}</span>`;
        }
        if (cell.territory.discovered_resource === 'iron') {
          const iron = Number(cell.territory.iron || 0);
          popupContent += `<span class="resource-item">⛏️ Hierro: ${Math.round(iron)}</span>`;
        }
        if (cell.territory.discovered_resource === 'gold') {
          const gold = Number(cell.territory.gold || 0);
          popupContent += `<span class="resource-item resource-gold">🪙 Oro: ${gold.toFixed(2)}</span>`;
        }
      } else {
        popupContent += '<span class="resource-item" style="opacity: 0.5;">⛏️ Sin recursos mineros</span>';
      }
    } else if (isExploring) {
      popupContent += '<span class="resource-item" style="opacity: 0.5;">⏳ Prospección en curso...</span>';
    } else {
      popupContent += '<span class="resource-item" style="opacity: 0.5;">❓ Recursos desconocidos</span>';
    }

    popupContent += '</div>';

    // EXPLORATION STATUS
    popupContent += '<div class="exploration-status-box">';
    popupContent += '<p class="exploration-status-label">📊 Estado de Prospección:</p>';

    if (isExplored) {
      const resourceIcon = {
        'stone': '⛰️ Piedra',
        'iron': '⛏️ Hierro',
        'gold': '🪙 Oro',
        'none': '❌ Sin recursos'
      };
      const resourceName = resourceIcon[cell.territory.discovered_resource] || '✅ Explorado';
      popupContent += `<p class="exploration-status exploration-completed">✅ Explorado - ${resourceName}</p>`;
    } else if (isExploring) {
      const turnsRemaining = cell.territory.exploration_end_turn - currentTurn;
      popupContent += `<p class="exploration-status exploration-in-progress">⏳ Explorando... (Faltan ${turnsRemaining} turno${turnsRemaining !== 1 ? 's' : ''})</p>`;
    } else {
      popupContent += '<p class="exploration-status exploration-not-started">⚪ Sin explorar</p>';
    }

    popupContent += '</div></div>';
  } else if (cell.territory && cell.player_id) {
    popupContent += '<p class="espionage-required">🔒 Información detallada requiere espionaje</p>';
  }

  // ACTIONS
  popupContent += '<div class="popup-actions">';

  if (!cell.player_id) {
    const hasEnoughGold = playerGold >= 100;
    const isCurrentlyColonizing = isColonizing;
    let isAdjacent = false;
    let disabledReason = '';

    if (playerHexes.size === 0) {
      isAdjacent = true;
    } else {
      const neighbors = gridDisk(h3_index, 1);
      isAdjacent = neighbors.some(neighborHex =>
        neighborHex !== h3_index && playerHexes.has(neighborHex)
      );
    }

    // Button is disabled if: not enough gold, not adjacent, OR currently colonizing
    const canColonize = hasEnoughGold && isAdjacent && !isCurrentlyColonizing;
    if (isCurrentlyColonizing) disabledReason = 'Colonización en progreso...';
    else if (!hasEnoughGold) disabledReason = 'Oro insuficiente';
    else if (!isAdjacent) disabledReason = 'Debe ser contiguo a tu territorio';

    const activeClass = canColonize ? 'btn-colonize' : 'btn-disabled';
    popupContent += `<button id="colonize-btn-${h3_index}" class="btn-popup ${activeClass}" ${!canColonize ? 'disabled' : ''} title="${disabledReason}">
      🏰 Colonizar (100 💰)
    </button>`;
  } else if (cell.player_id === playerId) {
    const isExplored = cell.territory?.discovered_resource !== null;
    const isExploring = cell.territory?.exploration_end_turn !== null && currentTurn < cell.territory?.exploration_end_turn;
    const explorationCost = explorationConfig.gold_cost;

    if (!isExplored && !isExploring) {
      const hasEnoughGold = playerGold >= explorationCost;
      popupContent += `<button id="explore-btn-${h3_index}" class="btn-popup ${hasEnoughGold ? 'btn-explore' : 'btn-disabled'}" ${!hasEnoughGold ? 'disabled' : ''} title="${!hasEnoughGold ? 'Oro insuficiente' : 'Iniciar exploración minera'}">
        ⛏️ Explorar Terreno (${explorationCost} 💰)
      </button>`;
    } else if (isExploring) {
      const turnsRemaining = cell.territory.exploration_end_turn - currentTurn;
      popupContent += `<button class="btn-popup btn-exploring" disabled>
        ⏳ Explorando... (${turnsRemaining} turno${turnsRemaining !== 1 ? 's' : ''})
      </button>`;
    }
  }

  popupContent += '</div>';
  popupContent += '</div>';

  return popupContent;
}
