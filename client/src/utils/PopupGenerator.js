/**
 * popupGenerator.js
 * Genera el contenido HTML para los popups del mapa
 */


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
    playerCapitalH3,
    currentTurn,
    isColonizing,
    isExiled = false,
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

    // FAMINE WARNING — shown when food reserves are exhausted
    if (cell.territory.food <= 0) {
      popupContent += '<div style="background:#5c1010;border:1px solid #c0392b;border-radius:4px;padding:6px 8px;margin-bottom:6px;color:#ff6b6b;font-size:11px;font-weight:bold;">' +
        '🚨 HAMBRUNA — Sin reservas de comida. La población disminuye un 5% cada censo.' +
        '</div>';
    }

    // Population & Happiness
    popupContent += `<p class="popup-detail-item">👥 Población: ${cell.territory.population} habitantes</p>`;
    popupContent += `<p class="popup-detail-item">😊 Felicidad: ${cell.territory.happiness || 0}%</p>`;

    // Resources
    popupContent += '<p class="popup-resources-label">Recursos Almacenados:</p>';
    popupContent += '<div class="popup-resource-grid">';
    popupContent += `<span class="resource-item" ${cell.territory.food <= 0 ? 'style="color:#ff6b6b;font-weight:bold;"' : ''}>🌾 Comida: ${cell.territory.food}</span>`;
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

  // "Fundar Capital" button:
  // - Normal players: only when hex is unclaimed AND player has no capital yet
  // - Exiled players: shown on any unclaimed hex (no adjacency restriction)
  const showColonizeButton = !cell.player_id && (
    isExiled || (!playerCapitalH3 && playerHexes.size === 0)
  );
  if (showColonizeButton) {
    const hasEnoughGold = playerGold >= 100;
    const isCurrentlyColonizing = isColonizing;
    let disabledReason = '';

    const canColonize = hasEnoughGold && !isCurrentlyColonizing;
    if (isCurrentlyColonizing) disabledReason = isExiled ? 'Colonización en progreso...' : 'Fundación en progreso...';
    else if (!hasEnoughGold) disabledReason = 'Oro insuficiente (necesitas 100 💰)';

    const activeClass = canColonize ? 'btn-colonize' : 'btn-disabled';
    const btnLabel = isExiled ? '🏕️ Colonizar (100 💰)' : '👑 Fundar Capital (100 💰)';
    popupContent += `<button id="colonize-btn-${h3_index}" class="btn-popup ${activeClass}" ${!canColonize ? 'disabled' : ''} title="${disabledReason}">
      ${btnLabel}
    </button>`;

    if (isExiled) {
      popupContent += `<p class="exile-hint" style="font-size:0.72rem;color:#f97316;margin:4px 0 0 0;">⛓️ Estás en el exilio — coloniza aquí para reanudar tu reino</p>`;
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
// Inyectar animación de fade una sola vez (sin tocar CSS global)
function _ensureFadeAnimation() {
  if (!document.getElementById('army-popup-fade-style')) {
    const s = document.createElement('style');
    s.id = 'army-popup-fade-style';
    s.textContent = '@keyframes _armyFadeIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}';
    document.head.appendChild(s);
  }
}

export function generateArmyPopup(armyData, config) {
  const {
    currentPlayerId,
    h3_index,
    coord_x,
    coord_y,
    hexOwnerId = null,
    currentIndex = 0,          // índice del ejército actualmente visible
    hasExplorersAtHex = false, // el jugador tiene Exploradores en el mismo hex
    scoutingArmyId = null,     // army_id del ejército propio con exploradores
    attackingArmyId = null     // army_id del ejército propio en el mismo hex (para atacar)
  } = config;

  _ensureFadeAnimation();
  const total = armyData.armies?.length ?? 0;

  let popupContent = '<div class="army-inspector">';

  // ── Barra de navegación (solo si hay varios ejércitos) ──────────────────
  if (total > 1) {
    const btnStyle = 'background:#1e1e38;border:1px solid #3a3a5c;color:#e2e8f0;border-radius:4px;padding:3px 11px;font-size:1rem;line-height:1;cursor:pointer;transition:background 0.15s;';
    const btnDisStyle = btnStyle + 'opacity:0.3;cursor:not-allowed;';
    const prevDis = currentIndex === 0;
    const nextDis = currentIndex === total - 1;
    popupContent += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.45);border-bottom:1px solid #2d2d4a;margin-bottom:4px;">`;
    popupContent += `<button onclick="event.stopPropagation();window.armyPopupNavigate(-1)" ${prevDis ? 'disabled' : ''} style="${prevDis ? btnDisStyle : btnStyle}">◀</button>`;
    popupContent += `<span style="font-family:sans-serif;font-size:0.72rem;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;">Ejército ${currentIndex + 1} de ${total}</span>`;
    popupContent += `<button onclick="event.stopPropagation();window.armyPopupNavigate(1)" ${nextDis ? 'disabled' : ''} style="${nextDis ? btnDisStyle : btnStyle}">▶</button>`;
    popupContent += `</div>`;
  }

  // ── Contenido del ejército actual ───────────────────────────────────────
  if (total > 0) {
    const army = armyData.armies[currentIndex];
    const isOwnArmy = army.player_id === currentPlayerId;
    // Conquer is blocked if ANY enemy army shares the hex
    const hasEnemiesInHex = armyData.armies.some(a => a.player_id !== currentPlayerId);
    const armyClass = isOwnArmy ? 'army-own' : 'army-enemy';

    // Wrapper con animación fade-slide
    popupContent += `<div style="animation:_armyFadeIn 0.18s ease;">`;

    // HEADER
    popupContent += `<div class="army-header ${armyClass}">`;
    popupContent += `<h3 class="army-title">${isOwnArmy ? '🛡️ ' : '⚔️ '}${army.name || 'Ejército sin nombre'}</h3>`;
    popupContent += `<p class="army-owner" style="border-bottom:2px solid ${army.player_color}">👤 ${army.player_name}</p>`;
    popupContent += `</div>`;

    // LOCATION
    popupContent += '<div class="army-info-box">';
    let locationInfo = `📍 ${h3_index}`;
    if (coord_x != null && coord_y != null) locationInfo += ` (${coord_x}, ${coord_y})`;
    popupContent += `<p class="army-location">${locationInfo}</p>`;
    popupContent += '</div>';

    if (isOwnArmy) {
      // ── TROOPS ──────────────────────────────────────────────────────────
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
        const totalTroops = army.total_count || army.units.reduce((sum, u) => sum + u.quantity, 0);
        popupContent += `<div class="army-troop-total"><strong>Total:</strong> <span class="total-count">${totalTroops} soldados</span></div>`;
        popupContent += '</div></div>';
      }

      // ── LOGISTICS ───────────────────────────────────────────────────────
      const food = Math.round(Number(army.food_provisions) || 0);
      const gold = Number(army.gold_provisions || 0).toFixed(2);
      const woodValue = Number(army.wood_provisions) || 0;
      popupContent += '<div class="army-logistics-compact">';
      popupContent += `<span class="resource-compact">🌾 ${food}</span>`;
      popupContent += `<span class="resource-compact">💰 ${gold}</span>`;
      if (woodValue > 0) popupContent += `<span class="resource-compact">🌲 ${Math.round(woodValue)}</span>`;
      popupContent += '</div>';

      // ── STATUS ───────────────────────────────────────────────────────────
      const minStamina = army.min_stamina !== undefined ? army.min_stamina : (army.rest_level || 100);
      const staminaPercentage = Math.max(0, Math.min(100, minStamina));
      const staminaColor = staminaPercentage < 30 ? '#ff6b6b' : (staminaPercentage < 60 ? '#ffd93d' : '#4caf50');
      const staminaLabel = staminaPercentage < 30 ? 'Agotado' : (staminaPercentage < 60 ? 'Cansado' : 'Descansado');
      const hasForceRest = army.has_force_rest || false;
      const isRecovering = army.recovering && Number(army.recovering) > 0;
      const isMoving = army.destination && army.destination !== null;

      popupContent += '<div class="army-status-compact">';
      popupContent += '<div class="stamina-inline">';
      popupContent += `<span class="stamina-label">💪 ${staminaLabel}</span>`;
      popupContent += '<div class="rest-bar-thin">';
      popupContent += `<div class="rest-bar-fill-thin" style="width:${staminaPercentage}%;background-color:${staminaColor}"></div>`;
      popupContent += '</div>';
      popupContent += `<span class="stamina-value">${Math.round(staminaPercentage)}%</span>`;
      popupContent += '</div>';
      if (hasForceRest) {
        const exhaustedCount = army.exhausted_units || 0;
        popupContent += `<p class="force-rest-warning">⛔ DESCANSO FORZADO (${exhaustedCount} unidad${exhaustedCount !== 1 ? 'es' : ''})</p>`;
      }
      if (isRecovering) popupContent += `<p class="status-text">🛌 Recuperando (${Number(army.recovering)}t)</p>`;
      else if (isMoving) popupContent += `<p class="status-text">🏃 → ${army.destination}</p>`;
      else popupContent += `<p class="status-text">📍 Estacionado</p>`;
      popupContent += '</div>';

      // ── ACTIONS (own army only) ──────────────────────────────────────────
      popupContent += '<div class="army-actions-compact">';

      const canMove = !isRecovering && !hasForceRest;
      const moveClass = canMove ? 'army-action-icon' : 'army-action-icon army-action-disabled';
      let moveTitle = 'Mover';
      if (hasForceRest) moveTitle = '⛔ Unidades agotadas - Descanso forzado';
      else if (isRecovering) moveTitle = `Recuperándose: ${army.recovering} turno${Number(army.recovering) !== 1 ? 's' : ''}`;
      popupContent += `<button id="army-move-${army.army_id}" class="${moveClass}" ${!canMove ? 'disabled' : ''} title="${moveTitle}">📍</button>`;

      const canStop = isMoving;
      const stopClass = canStop ? 'army-action-icon' : 'army-action-icon army-action-disabled';
      popupContent += `<button id="army-stop-${army.army_id}" class="${stopClass}" ${!canStop ? 'disabled' : ''} title="Detener">🛑</button>`;

      const conquerBlocked = hasEnemiesInHex;
      const conquerClass = conquerBlocked ? 'army-action-icon army-action-disabled' : 'army-action-icon army-action-conquer';
      const conquerTitle = conquerBlocked ? 'Hay ejércitos enemigos en el hex — derrotalos primero' : 'Conquistar territorio';
      popupContent += `<button id="army-conquer-${army.army_id}" class="${conquerClass}" ${conquerBlocked ? 'disabled' : ''} title="${conquerTitle}">⚔️</button>`;
      popupContent += `<button id="army-split-${army.army_id}" class="army-action-icon" title="Separar">👥</button>`;

      const canMerge = total > 1;
      const mergeClass = canMerge ? 'army-action-icon' : 'army-action-icon army-action-disabled';
      popupContent += `<button id="army-merge-${army.army_id}" class="${mergeClass}" ${!canMerge ? 'disabled' : ''} title="Unir">🔗</button>`;

      popupContent += `<button id="army-supply-${army.army_id}" class="army-action-icon" title="Abastecer">🌾</button>`;
      popupContent += '</div>';
    } else {
      // ── ENEMY ARMY: classified intelligence ─────────────────────────────
      const isMoving = army.destination && army.destination !== null;
      popupContent += `<div style="margin:10px 0;padding:10px 12px;background:rgba(180,0,0,0.12);border:1px solid rgba(220,50,50,0.3);border-radius:6px;">`;
      popupContent += `<p style="margin:0 0 7px;font-size:0.78rem;color:#e57373;font-weight:600;letter-spacing:0.5px;">🔒 INTELIGENCIA CLASIFICADA</p>`;
      popupContent += `<div style="display:grid;gap:4px;font-size:0.8rem;color:#9ca3af;">`;
      popupContent += `<div>⚔️ Composición: <span style="color:#6b7280;font-style:italic;">???</span></div>`;
      popupContent += `<div>💪 Estado físico: <span style="color:#6b7280;font-style:italic;">???</span></div>`;
      popupContent += `<div>🌾 Suministros: <span style="color:#6b7280;font-style:italic;">???</span></div>`;
      popupContent += `</div>`;
      if (isMoving) popupContent += `<p style="margin:7px 0 0;font-size:0.78rem;color:#f87171;">🏃 En movimiento</p>`;
      popupContent += `</div>`;

      // ── ACCIONES SOBRE EJÉRCITO ENEMIGO ───────────────────────────────────
      popupContent += `<div class="army-actions-compact" style="margin-top:8px;display:flex;gap:6px;align-items:center;">`;

      // Botón ATACAR
      const attackEnabled = attackingArmyId !== null;
      const attackTitle = attackEnabled
        ? `Atacar con tu ejército (mismo hexágono)`
        : 'Necesitas un ejército propio en el mismo hexágono';
      const attackClass = attackEnabled
        ? 'army-action-icon army-action-attack'
        : 'army-action-icon army-action-disabled';
      popupContent += `<button id="army-attack-${army.army_id}" class="${attackClass}" ${!attackEnabled ? 'disabled' : ''} data-attacking-army="${attackingArmyId ?? ''}" title="${attackTitle}">⚔️</button>`;

      // Botón ESPIONAJE
      const scoutEnabled = hasExplorersAtHex && scoutingArmyId !== null;
      const scoutTitle = scoutEnabled
        ? 'Enviar exploradores (100💰 provisiones · 1000💰 si no hay provisiones)'
        : 'Necesitas un Explorador en este hexágono';
      const scoutClass = scoutEnabled
        ? 'army-action-icon army-action-scout'
        : 'army-action-icon army-action-disabled';
      popupContent += `<button id="army-scout-${army.army_id}" class="${scoutClass}" ${!scoutEnabled ? 'disabled' : ''} data-scouting-army="${scoutingArmyId ?? ''}" title="${scoutTitle}">🔭</button>`;

      popupContent += `<span style="font-size:0.72rem;color:#6b7280;margin-left:4px;">${attackEnabled ? attackTitle : scoutEnabled ? scoutTitle : 'Sin acciones disponibles'}</span>`;
      popupContent += `</div>`;
    }

    popupContent += '</div>'; // cierre wrapper fade

  } else {
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
