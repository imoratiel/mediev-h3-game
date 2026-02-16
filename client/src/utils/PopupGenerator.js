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

/**
 * Genera el contenido HTML del popup de detalles de ejército
 * @param {Object} armyData - Datos del ejército desde la API
 * @param {Object} config - Configuración del popup
 * @returns {String} HTML content para el popup
 */
export function generateArmyPopup(armyData, config) {
  const {
    currentPlayerId,
    h3_index,
    coord_x,
    coord_y
  } = config;

  let popupContent = '<div class="army-inspector">';

  // Si hay múltiples ejércitos en el mismo hex, mostrarlos todos
  if (armyData.armies && armyData.armies.length > 0) {

    armyData.armies.forEach((army, index) => {
      const isOwnArmy = army.player_id === currentPlayerId;
      const armyClass = isOwnArmy ? 'army-own' : 'army-enemy';

      // HEADER - Army name and owner
      popupContent += `<div class="army-header ${armyClass}">`;
      popupContent += `<h3 class="army-title">`;
      popupContent += isOwnArmy ? '🛡️ ' : '⚔️ ';
      popupContent += `${army.name || 'Ejército sin nombre'}`;
      popupContent += `</h3>`;
      popupContent += `<p class="army-owner" style="border-bottom: 2px solid ${army.player_color}">`;
      popupContent += `👤 ${army.player_name}`;
      popupContent += `</p>`;
      popupContent += `</div>`;

      // LOCATION INFO with coordinates
      popupContent += '<div class="army-info-box">';
      let locationInfo = `📍 ${h3_index}`;
      if (coord_x !== null && coord_x !== undefined && coord_y !== null && coord_y !== undefined) {
        locationInfo += ` (${coord_x}, ${coord_y})`;
      }
      popupContent += `<p class="army-location">${locationInfo}</p>`;
      popupContent += '</div>';

      // TROOPS SECTION
      if (army.units && army.units.length > 0) {
        popupContent += '<div class="army-troops-section">';
        popupContent += '<p class="army-section-title">⚔️ Composición de Tropas</p>';
        popupContent += '<div class="army-troops-list">';

        army.units.forEach(unit => {
          const unitIcon = getUnitIcon(unit.unit_name);
          popupContent += `<div class="army-troop-item">`;
          popupContent += `<span class="troop-icon">${unitIcon}</span>`;
          popupContent += `<span class="troop-name">${unit.unit_name}:</span>`;
          popupContent += `<span class="troop-quantity">${unit.quantity}</span>`;
          popupContent += `</div>`;
        });

        // Total troops
        const totalTroops = army.total_count || army.units.reduce((sum, u) => sum + u.quantity, 0);
        popupContent += `<div class="army-troop-total">`;
        popupContent += `<strong>Total:</strong> <span class="total-count">${totalTroops} soldados</span>`;
        popupContent += `</div>`;

        popupContent += '</div>';
        popupContent += '</div>';
      }

      // LOGISTICS SECTION (COMPACT - inline resources)
      const food = Math.round(Number(army.food_provisions) || 0);
      const gold = Number(army.gold_provisions || 0).toFixed(2);
      const woodValue = Number(army.wood_provisions) || 0;

      popupContent += '<div class="army-logistics-compact">';
      popupContent += `<span class="resource-compact">🌾 ${food}</span>`;
      popupContent += `<span class="resource-compact">💰 ${gold}</span>`;
      if (woodValue > 0) {
        popupContent += `<span class="resource-compact">🌲 ${Math.round(woodValue)}</span>`;
      }
      popupContent += '</div>';

      // COMBINED STATUS SECTION (COMPACT - stamina + movement)
      // Use minimum stamina (weakest link) from fatigue system
      const minStamina = army.min_stamina !== undefined ? army.min_stamina : (army.rest_level || 100);
      const staminaPercentage = Math.max(0, Math.min(100, minStamina));
      const staminaColor = staminaPercentage < 30 ? '#ff6b6b' : (staminaPercentage < 60 ? '#ffd93d' : '#4caf50');
      const staminaLabel = staminaPercentage < 30 ? 'Agotado' : (staminaPercentage < 60 ? 'Cansado' : 'Descansado');

      const hasForceRest = army.has_force_rest || false;
      const isRecovering = army.recovering && Number(army.recovering) > 0;
      const isMoving = army.destination && army.destination !== null;

      popupContent += '<div class="army-status-compact">';

      // Stamina bar (thin, inline with label) - Shows weakest unit's stamina
      popupContent += '<div class="stamina-inline">';
      popupContent += `<span class="stamina-label">💪 ${staminaLabel}</span>`;
      popupContent += '<div class="rest-bar-thin">';
      popupContent += `<div class="rest-bar-fill-thin" style="width: ${staminaPercentage}%; background-color: ${staminaColor}"></div>`;
      popupContent += '</div>';
      popupContent += `<span class="stamina-value">${Math.round(staminaPercentage)}%</span>`;
      popupContent += '</div>';

      // Force rest warning (if any unit is exhausted)
      if (hasForceRest) {
        const exhaustedCount = army.exhausted_units || 0;
        popupContent += `<p class="force-rest-warning">⛔ DESCANSO FORZADO (${exhaustedCount} unidad${exhaustedCount !== 1 ? 'es' : ''})</p>`;
      }

      // Movement status (compact)
      if (isRecovering) {
        const turnsLeft = Number(army.recovering);
        popupContent += `<p class="status-text">🛌 Recuperando (${turnsLeft}t)</p>`;
      } else if (isMoving) {
        popupContent += `<p class="status-text">🏃 → ${army.destination}</p>`;
      } else {
        popupContent += `<p class="status-text">📍 Estacionado</p>`;
      }

      popupContent += '</div>';

      // ACTIONS SECTION (COMPACT - only icons, single row)
      if (isOwnArmy) {
        popupContent += '<div class="army-actions-compact">';

        // Move button - Blocked if recovering OR has force_rest
        const canMove = !isRecovering && !hasForceRest;
        const moveClass = canMove ? 'army-action-icon' : 'army-action-icon army-action-disabled';
        let moveTitle = 'Mover';
        if (hasForceRest) {
          moveTitle = '⛔ Unidades agotadas - Descanso forzado';
        } else if (isRecovering) {
          moveTitle = `Recuperándose: ${army.recovering} turno${Number(army.recovering) !== 1 ? 's' : ''}`;
        }

        // Use onclick for immediate response (exposed global function from MapViewer)
        const armyNameEscaped = (army.name || 'Ejército').replace(/'/g, "\\'");
        const moveOnClick = canMove
          ? `onclick="if(window.startArmyMovement) window.startArmyMovement(${army.army_id}, '${armyNameEscaped}', '${army.h3_index}')"`
          : '';
        popupContent += `<button id="army-move-${army.army_id}" class="${moveClass}" ${!canMove ? 'disabled' : ''} ${moveOnClick} title="${moveTitle}">📍</button>`;

        // Stop button
        const canStop = isMoving;
        const stopClass = canStop ? 'army-action-icon' : 'army-action-icon army-action-disabled';
        popupContent += `<button id="army-stop-${army.army_id}" class="${stopClass}" ${!canStop ? 'disabled' : ''} title="Detener">🛑</button>`;

        // Conquer button
        popupContent += `<button id="army-conquer-${army.army_id}" class="army-action-icon" title="Conquistar">⚔️</button>`;

        // Split button
        popupContent += `<button id="army-split-${army.army_id}" class="army-action-icon" title="Separar">👥</button>`;

        // Merge button
        const canMerge = armyData.armies.length > 1;
        const mergeClass = canMerge ? 'army-action-icon' : 'army-action-icon army-action-disabled';
        popupContent += `<button id="army-merge-${army.army_id}" class="${mergeClass}" ${!canMerge ? 'disabled' : ''} title="Unir">🔗</button>`;

        // Supply button
        popupContent += `<button id="army-supply-${army.army_id}" class="army-action-icon" title="Abastecer">🌾</button>`;

        popupContent += '</div>';
      }

      // Separator between armies (if multiple)
      if (index < armyData.armies.length - 1) {
        popupContent += '<hr class="army-separator">';
      }
    });

  } else {
    // No armies found
    popupContent += '<p class="army-empty">⚠️ No se encontraron ejércitos en esta ubicación</p>';
  }

  popupContent += '</div>';

  return popupContent;
}

/**
 * Helper function to get appropriate icon for unit type
 * @param {string} unitName - Name of the unit type
 * @returns {string} Emoji icon
 */
function getUnitIcon(unitName) {
  const name = unitName.toLowerCase();
  if (name.includes('infanter') || name.includes('lancer')) return '⚔️';
  if (name.includes('archer') || name.includes('arquer')) return '🏹';
  if (name.includes('caball') || name.includes('knight')) return '🐴';
  if (name.includes('siege') || name.includes('catapult')) return '🎯';
  if (name.includes('scout') || name.includes('explor')) return '🔭';
  return '🛡️'; // Default icon
}
