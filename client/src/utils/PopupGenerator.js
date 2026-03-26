/**
 * popupGenerator.js
 * Genera el contenido HTML para los popups del mapa
 */


function getBuildingIcon(name = '', typeName = '') {
  const n = name.toLowerCase();
  const t = (typeName || '').toLowerCase();
  if (n.includes('granja') || n.includes('farm'))                                                  return '🌾';
  if (n.includes('cuartel') || n.includes('barrack'))                                             return '🏯';
  if (n.includes('iglesia') || n.includes('church') || n.includes('catedral'))                    return '⛪';
  if (n.includes('mercado') || n.includes('market') || n.includes('foro') ||
      n.includes('factor') || n.includes('lonja') || n.includes('feria'))                         return '⚖️';
  if (n.includes('fortaleza') || n.includes('fortress') || n.includes('castillo'))                return '🏯';
  if (n.includes('astillero') || n.includes('shipyard') ||
      n.includes('portus') || n.includes('cothon') ||
      n.includes('emporio') || n.includes('embarcadero') || t === 'maritime')                     return '⛵';
  if (n.includes('mina') || n.includes('mine'))                                                   return '⛏️';
  if (n.includes('aserradero') || n.includes('lumber'))                                           return '🌲';
  if (n.includes('torre') || n.includes('tower'))                                                 return '🗼';
  if (t === 'military')  return '🏯';
  if (t === 'religious') return '⛪';
  if (t === 'economic')  return '⚖️';
  return '🏛️';
}

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
    h3_index,
    workerTypes = [],    // array of { id, name, cost } from /api/workers/types
  } = config;

  let popupContent = '<div class="cell-inspector">';

  // CAPITAL BADGE - Show if this is the capital
  if (cell.is_capital) {
    popupContent += '<div class="capital-header">🏰 SEDE DEL REINO</div>';
  }

  // TITLE - Settlement name, division name, or fallback
  const title = cell.settlement_name
    || cell.division_name
    || (cell.player_id ? 'Fundus sin Pagus' : 'Territorio Libre');
  const titleIcon = cell.is_capital ? '👑' : (cell.settlement_name ? '🏛️' : (cell.division_name ? '🏰' : '🗺️'));

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

    // Cultura
    const cultures = [
      { name: 'Romanos',       val: cell.culture?.romanos      ?? 0, color: '#c0392b' },
      { name: 'Cartagineses',  val: cell.culture?.cartagineses ?? 0, color: '#8e44ad' },
      { name: 'Íberos',        val: cell.culture?.iberos       ?? 0, color: '#d35400' },
      { name: 'Celtas',        val: cell.culture?.celtas       ?? 0, color: '#27ae60' },
    ];
    popupContent += `<p class="popup-details-title" style="margin-top:6px;">🏛️ Cultura</p>`;
    const activeCultures = cultures.filter(c => c.val > 0);
    if (activeCultures.length === 0) {
      popupContent += `<div style="font-size:11px;color:#6b7280;margin-bottom:4px;font-style:italic;">Sin cultura dominante</div>`;
    } else {
      popupContent += `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:4px;">`;
      for (const c of activeCultures) {
        popupContent += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;">
          <span style="width:80px;color:#d1d5db;">${c.name}</span>
          <div style="flex:1;background:#374151;border-radius:3px;height:8px;overflow:hidden;">
            <div style="width:${c.val}%;background:${c.color};height:100%;border-radius:3px;transition:width 0.3s;"></div>
          </div>
          <span style="width:28px;text-align:right;color:#9ca3af;">${c.val}</span>
        </div>`;
      }
      popupContent += `</div>`;
    }

    // Resources (DISABLED: wood/stone/iron hidden; exploration hidden)
    popupContent += '<p class="popup-resources-label">Recursos Almacenados:</p>';
    popupContent += '<div class="popup-resource-grid">';
    popupContent += `<span class="resource-item" ${cell.territory.food <= 0 ? 'style="color:#ff6b6b;font-weight:bold;"' : ''}>🌾 Comida: ${cell.territory.food}</span>`;
    // popupContent += `<span class="resource-item">🌲 Madera: ${cell.territory.wood}</span>`; // DISABLED
    // DISABLED: stone/iron/exploration section hidden
    popupContent += '</div></div>';
  } else if (cell.territory && cell.player_id) {
    popupContent += '<p class="espionage-required">🔒 Información detallada requiere espionaje</p>';
  }

  // FIEF BUILDING STATUS (if own territory)
  if (cell.player_id === playerId) {
    if (cell.fief_building) {
      if (cell.fief_building.is_under_construction) {
        const turnsLeft = cell.fief_building.turns_left ?? '?';
        popupContent += `<div class="popup-building-status popup-building-progress">🏗️ En construcción: <strong>${cell.fief_building.name}</strong> (${turnsLeft} turno${turnsLeft !== 1 ? 's' : ''})</div>`;
      } else {
        const cons = cell.fief_building.conservation ?? 100;
        if (cons === 0) {
          popupContent += `<div class="popup-building-status popup-building-ruins">
            🏚️ <strong>${cell.fief_building.name}</strong> — <span style="color:#f44336;font-style:italic;">En Ruinas</span>
          </div>`;
        } else {
          const consColor = cons >= 70 ? '#4caf50' : cons >= 40 ? '#ff9800' : '#f44336';
          const inactiveWarning = cons < 20 ? `<div style="font-size:11px;color:#f44336;margin-top:3px;">⚠️ Inactivo (conservación &lt; 20%)</div>` : '';
          popupContent += `<div class="popup-building-status popup-building-done">
            ${getBuildingIcon(cell.fief_building.name, cell.fief_building.type_name)} Edificio: <strong>${cell.fief_building.name}</strong>
            <div style="margin-top:4px;display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;color:#aaa;">Conservación</span>
              <div style="flex:1;height:6px;background:#333;border-radius:3px;overflow:hidden;">
                <div style="width:${cons}%;height:100%;background:${consColor};border-radius:3px;transition:width .3s;"></div>
              </div>
              <span style="font-size:11px;color:${consColor};min-width:30px;">${cons}%</span>
            </div>
            ${inactiveWarning}
          </div>`;
        }
      }
    }
  }

  // ACTIONS
  popupContent += '<div class="popup-actions">';

  // Build button removed from fief popup — accessible only from the worker panel

  // Repair button - for own fief with a completed building not at 100% conservation
  if (cell.player_id === playerId && cell.fief_building && !cell.fief_building.is_under_construction &&
      (cell.fief_building.conservation ?? 100) < 100) {
    const cost = cell.fief_building.repair_cost ?? 0;
    popupContent += `<button id="repair-btn-${h3_index}" class="btn-popup btn-repair" title="Reparar edificio (${cost} 💰)">🔧 Reparar (${cost} 💰)</button>`;
  }

  // Upgrade button - for own fief with a completed building that has an upgrade
  if (cell.player_id === playerId && cell.fief_building && !cell.fief_building.is_under_construction && cell.fief_building.upgrade) {
    const upg = cell.fief_building.upgrade;
    popupContent += `<button id="upgrade-btn-${h3_index}" class="btn-popup btn-upgrade" data-upgrade='${JSON.stringify(upg)}' title="Ampliar a ${upg.name} (${upg.gold_cost}💰, ${upg.turns}t)">🏰 Ampliar → ${upg.name}</button>`;
  }

  // Recruit button - for own fief with a completed military building
  if (cell.player_id === playerId && cell.fief_building && !cell.fief_building.is_under_construction && cell.fief_building.type_name === 'military') {
    popupContent += `<button id="recruit-btn-${h3_index}" class="btn-popup btn-recruit" title="Reclutar tropas en este feudo">⚔️ Reclutar</button>`;
  }

  // Nueva Flota button - for own fief with a completed maritime building (port)
  if (cell.player_id === playerId && cell.fief_building && !cell.fief_building.is_under_construction && cell.fief_building.type_name === 'maritime') {
    popupContent += `<button id="new-fleet-btn-${h3_index}" class="btn-popup btn-naval" title="Crear nueva flota en este puerto">⛵ Nueva Flota</button>`;
  }

  // Fueros y Leyes button - for own fief with a completed Fortaleza
  if (cell.player_id === playerId && cell.fief_building &&
      !cell.fief_building.is_under_construction && cell.fief_building.name === 'Fortaleza') {
    popupContent += `<button id="fueros-btn-${h3_index}" class="btn-popup btn-fueros" title="Gestionar Edictos de este feudo">📜 Edictos</button>`;
  }

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

  // WORKER HIRE — shown on own hexes that are Capital or have a completed Mercado
  const isOwnFief = cell.player_id === playerId;
  const hasMarket = isOwnFief && cell.fief_building &&
    cell.fief_building.name === 'Mercado' && !cell.fief_building.is_under_construction;
  const isCapitalHex = cell.is_capital && isOwnFief;
  const canHireWorkers = (isCapitalHex || hasMarket) && workerTypes.length > 0;

  if (canHireWorkers) {
    const options = workerTypes.map(t =>
      `<option value="${t.id}">${t.name} (${t.cost} 💰)</option>`
    ).join('');

    popupContent += `
      <div class="popup-worker-section">
        <p class="popup-details-title" style="margin:10px 0 6px;">👷 Contratar Trabajador</p>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select id="worker-type-select-${h3_index}"
            style="flex:1;min-width:130px;padding:5px 8px;
                   background:#1a1612;border:1px solid #c5a059;border-radius:4px;
                   color:#e8d5b5;font-size:0.85em;cursor:pointer;">
            ${options}
          </select>
          <button id="buy-worker-btn-${h3_index}"
            class="btn-popup"
            style="background:#b45309;border-color:#92400e;white-space:nowrap;"
            title="Contratar trabajador en este feudo">
            ⛏️ Contratar
          </button>
        </div>
      </div>`;
  } else if (isOwnFief && !canHireWorkers && workerTypes.length > 0 && !cell.fief_building) {
    // Own fief, no building yet — hint that a Mercado would enable workers
    popupContent += `
      <p style="font-size:0.75rem;color:#6b7280;margin:8px 0 0 0;">
        ⚒️ Construye un <strong>Mercado</strong> para poder contratar trabajadores aquí.
      </p>`;
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
    attackingArmyId = null,    // army_id del ejército propio en el mismo hex (para atacar)
    characterAtHex = null,     // personaje propio sin ejército en este hex (para asignar)
    totalItems = null,         // total combinado de ejércitos + personajes en el hex
    globalIndex = null         // índice global en la lista combinada
  } = config;

  _ensureFadeAnimation();
  const total = armyData.armies?.length ?? 0;
  // Si hay items combinados (ejércitos + personajes), usar esos para la nav bar
  const navTotal = totalItems ?? total;
  const navIndex = globalIndex ?? currentIndex;

  let popupContent = '<div class="army-inspector">';

  // ── Barra de navegación (solo si hay varios items) ──────────────────────
  if (navTotal > 1) {
    const btnStyle = 'background:#1e1e38;border:1px solid #3a3a5c;color:#e2e8f0;border-radius:4px;padding:3px 11px;font-size:1rem;line-height:1;cursor:pointer;transition:background 0.15s;';
    const btnDisStyle = btnStyle + 'opacity:0.3;cursor:not-allowed;';
    const prevDis = navIndex === 0;
    const nextDis = navIndex === navTotal - 1;
    popupContent += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.45);border-bottom:1px solid #2d2d4a;margin-bottom:4px;">`;
    popupContent += `<button onclick="event.stopPropagation();window.armyPopupNavigate(-1)" ${prevDis ? 'disabled' : ''} style="${prevDis ? btnDisStyle : btnStyle}">◀</button>`;
    popupContent += `<span style="font-family:sans-serif;font-size:0.72rem;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;">Ejército ${navIndex + 1} de ${navTotal}</span>`;
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
      if ((army.units && army.units.length > 0) || army.commander) {
        popupContent += '<div class="army-troops-section">';
        popupContent += '<p class="army-section-title">⚔️ Composición de Tropas</p>';
        popupContent += '<div class="army-troops-list">';

        // Comandante como primera fila
        if (army.commander) {
          const c = army.commander;
          const guardFill = Math.round((c.personal_guard / 25) * 100);
          const guardColor = guardFill < 30 ? '#ff6b6b' : guardFill < 70 ? '#ffd93d' : '#c5a059';
          popupContent += `<div class="army-troop-item army-troop-commander">`;
          popupContent += `<span class="troop-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="#c5a059">
              <circle cx="12" cy="7" r="4"/>
              <path d="M12 13c-5 0-8 2.5-8 4v1h16v-1c0-1.5-3-4-8-4z"/>
            </svg>
          </span>`;
          popupContent += `<span class="troop-name" style="flex:1;">${c.full_title || c.name}</span>`;
          popupContent += `<span class="troop-quantity" style="color:#c5a059;font-size:0.72rem;" title="Bono de combate al ejército">⚔️+${c.combat_buff_pct}%</span>`;
          popupContent += `<div class="guard-bar-mini" title="Guardia ${c.personal_guard}/25">
            <div style="width:${guardFill}%;background:${guardColor};height:100%;border-radius:2px;"></div>
          </div>`;
          popupContent += `</div>`;
        }

        if (army.units) {
          army.units.forEach(unit => {
            const unitIcon = getUnitIcon(unit.unit_class);
            popupContent += `<div class="army-troop-item">`;
            popupContent += `<span class="troop-icon">${unitIcon}</span>`;
            popupContent += `<span class="troop-name">${unit.unit_name}:</span>`;
            popupContent += `<span class="troop-quantity">${unit.quantity}</span>`;
            popupContent += `</div>`;
          });
          const totalTroops = army.total_count || army.units.reduce((sum, u) => sum + u.quantity, 0);
          popupContent += `<div class="army-troop-total"><strong>Total:</strong> <span class="total-count">${totalTroops} soldados</span></div>`;
        }

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
      const staminaLabel = (staminaPercentage <= 0 || army.has_force_rest) ? 'Exhausto' : (staminaPercentage < 30 ? 'Agotado' : (staminaPercentage < 60 ? 'Cansado' : 'Descansado'));
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
      const isGarrison = army.is_garrison === true;
      if (isGarrison) popupContent += `<p class="status-text">🏰 Guarnición</p>`;
      else if (isRecovering) popupContent += `<p class="status-text">🛌 Recuperando (${Number(army.recovering)}t)</p>`;
      else if (isMoving) popupContent += `<p class="status-text">🏃 → ${army.destination}</p>`;
      else popupContent += `<p class="status-text">📍 Estacionado</p>`;
      popupContent += '</div>';


      // ── ACTIONS (own army only) ──────────────────────────────────────────
      popupContent += '<div class="army-actions-compact">';

      if (!isGarrison) {
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
      }

      const canMerge = total > 1;
      const mergeClass = canMerge ? 'army-action-icon' : 'army-action-icon army-action-disabled';
      const mergeTitle = isGarrison ? (canMerge ? 'Transferir tropas con ejército co-ubicado' : 'No hay ejércitos en esta casilla') : 'Unir';
      popupContent += `<button id="army-merge-${army.army_id}" class="${mergeClass}" ${!canMerge ? 'disabled' : ''} title="${mergeTitle}">🔗</button>`;

      popupContent += `<button id="army-supply-${army.army_id}" class="army-action-icon" title="Abastecer">🌾</button>`;

      // Botón comandante: si ya tiene → retirar; si no y hay personaje en hex → asignar
      if (army.commander) {
        popupContent += `<button id="army-commander-${army.army_id}" class="army-action-icon" title="Retirar comandante">🚪</button>`;
      } else {
        const canAssign = !!characterAtHex;
        const cmdClass = canAssign ? 'army-action-icon' : 'army-action-icon army-action-disabled';
        const cmdTitle = canAssign
          ? `Asignar ${characterAtHex.name} como comandante`
          : 'No hay personaje disponible en este feudo';
        popupContent += `<button id="army-commander-${army.army_id}" class="${cmdClass}" ${!canAssign ? 'disabled' : ''} title="${cmdTitle}">👑</button>`;
      }

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
function getUnitIcon(unitClass) {
  switch (unitClass) {
    case 'INFANTRY_1':
    case 'INFANTRY_2':     return '🛡';
    case 'INFANTRY_ELITE': return '⭐';
    case 'ARCHER_1':
    case 'ARCHER_2':       return '🏹';
    case 'CAVALRY_1':
    case 'CAVALRY_2':      return '🐎';
    case 'SIEGE':          return '🪨';
    default:               return '⚔️';
  }
}
