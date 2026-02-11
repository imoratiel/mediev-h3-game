/**
 * PopupGenerator.js
 * Utility to generate HTML content for Leaflet popups in the game map.
 * Extracts presentation logic from MapViewer.vue.
 */

export const PopupGenerator = {
    /**
     * Generates HTML for territory/cell details popup
     * @param {Object} cell - The cell data from API
     * @param {Number} playerId - Current player ID
     * @param {Set} playerHexes - Set of H3 indexes owned by player
     * @param {Number} currentTurn - Current game turn
     * @param {Boolean} isColonizing - Whether colonization mode is active
     * @param {Number} playerGold - Current player gold
     * @param {Boolean} canColonize - Whether the current player can colonize this cell
     * @param {String} disabledReason - Reason why colonization is disabled, if applicable
     * @returns {String} HTML content
     */
    generateCellPopupHtml(cell, playerId, playerHexes, currentTurn, isColonizing, playerGold, canColonize, disabledReason) {
        let popupContent = '<div class="cell-inspector">';

        // CAPITAL BADGE
        if (cell.is_capital) {
            popupContent += '<div class="capital-header">🏰 SEDE DEL REINO</div>';
        }

        // TITLE
        const title = cell.settlement_name || (cell.player_id ? `Territorio de ${cell.player_name}` : 'Territorio Salvaje');
        const titleIcon = cell.is_capital ? '👑' : (cell.settlement_name ? '🏛️' : '🗺️');

        popupContent += `<h3 class="popup-title">${titleIcon} ${title}</h3>`;

        // OWNER
        const ownerText = cell.player_name
            ? `<span class="popup-owner-name" style="color: #1a1612; border-bottom: 2px solid ${cell.player_color}">⚔️ ${cell.player_name}</span>`
            : '<span class="unclaimed-text">🌿 Sin reclamar</span>';
        popupContent += `<p class="popup-stat-row"><strong>Dueño:</strong> ${ownerText}</p>`;

        // TERRAIN TYPE
        popupContent += `<p class="popup-stat-row"><strong>Terreno:</strong> ${cell.terrain_type}</p>`;

        // BUILDING
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
            popupContent += `<div class="popup-resource-grid">`;
            popupContent += `<span class="resource-item">🌾 Comida: ${cell.territory.food}</span>`;
            popupContent += `<span class="resource-item">🌲 Madera: ${cell.territory.wood}</span>`;

            // Determine exploration state
            const isExplored = cell.territory.discovered_resource !== null;
            const isExploring = cell.territory.exploration_end_turn !== null && currentTurn < cell.territory.exploration_end_turn;

            // Mining resources
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
                    popupContent += `<span class="resource-item" style="opacity: 0.5;">⛏️ Sin recursos mineros</span>`;
                }
            } else if (isExploring) {
                popupContent += `<span class="resource-item" style="opacity: 0.5;">⏳ Prospección en curso...</span>`;
            } else {
                popupContent += `<span class="resource-item" style="opacity: 0.5;">❓ Recursos desconocidos</span>`;
            }

            popupContent += `</div>`;

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
                popupContent += `<p class="exploration-status exploration-not-started">⚪ Sin explorar</p>`;
            }

            popupContent += '</div></div>';
        } else if (cell.territory && cell.player_id) {
            popupContent += '<p class="espionage-required">🔒 Información detallada requiere espionaje</p>';
        }

        // ACTIONS (Colonization Button only)
        popupContent += '<div class="popup-actions">';

        if (!cell.player_id) {
            // Render button if not owned
            const activeClass = canColonize ? 'btn-colonize' : 'btn-disabled';
            popupContent += `<button id="colonize-btn-${cell.h3_index}" class="btn-popup ${activeClass}" ${!canColonize ? 'disabled' : ''} title="${disabledReason}">
                🏰 Colonizar (100 💰)
            </button>`;
        } else if (cell.player_id === playerId) {
            // Owner actions (Explore)
            const isExplored = cell.territory?.discovered_resource !== null;
            const isExploring = cell.territory?.exploration_end_turn !== null && currentTurn < cell.territory?.exploration_end_turn;

            // Note: Exploration cost is hard to pass in, let's assume valid or handle in MapViewer?
            // Actually, for refactor, let's just show the button and let MapViewer handle logic or pass cost?
            // To simplify: if we are owner and not exploring, show button.
            // But we need the ID for the listener.
            if (!isExplored && !isExploring) {
                popupContent += `<button id="explore-btn-${cell.h3_index}" class="btn-popup btn-explore">
                    ⛏️ Prospectar Recursos (500 💰)
                </button>`;
            }
        }

        popupContent += '</div>'; // Close actions
        popupContent += '</div>'; // Close cell-inspector
        return popupContent;
    },

    /**
     * Generates HTML for detailed army popup
     * @param {Array} armies - Array of army objects from API
     * @param {Number} playerId - Current player ID
     * @returns {String} HTML content
     */
    generateArmyPopupHtml(armies, playerId) {
        let contentHtml = '<div class="medieval-popup" style="min-width: 250px;">';

        armies.forEach(army => {
            const isOwner = army.player_id === playerId;
            const headerColor = isOwner ? '#1565C0' : '#c62828';

            contentHtml += `
            <div style="border-bottom: 2px solid #8b4513; margin-bottom: 10px; padding-bottom: 5px;">
                <h3 style="margin: 0; color: ${headerColor}; font-family: 'Cinzel', serif;">${army.name || 'Ejército'}</h3>
                <small style="color: #5d4037;">Comandante: ${army.player_name}</small>
            </div>
        `;

            // Rest/Vigor Bar (0-100)
            // DB_SCHEMA: rest_level (DECIMAL 5,2)
            const restLevel = parseFloat(army.rest_level || 0);
            const restColor = restLevel < 30 ? '#d32f2f' : '#2e7d32';
            contentHtml += `
            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                    <span>Vigor / Descanso</span>
                    <span>${restLevel.toFixed(1)}%</span>
                </div>
                <div style="width: 100%; height: 6px; background: #d7ccc8; border: 1px solid #5d4037; border-radius: 3px;">
                    <div style="width: ${restLevel}%; height: 100%; background: ${restColor};"></div>
                </div>
            </div>
        `;

            // Resources (Provisions)
            // DB_SCHEMA: gold_provisions, food_provisions, wood_provisions
            contentHtml += `<div style="display: flex; gap: 10px; margin-bottom: 10px; font-size: 12px; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 4px;">`;
            if (parseFloat(army.gold_provisions) > 0) contentHtml += `<span title="Oro">💰 ${parseFloat(army.gold_provisions).toFixed(0)}</span>`;
            if (parseFloat(army.food_provisions) > 0) contentHtml += `<span title="Comida">🍎 ${parseFloat(army.food_provisions).toFixed(0)}</span>`;
            if (parseFloat(army.wood_provisions) > 0) contentHtml += `<span title="Madera">🌲 ${parseFloat(army.wood_provisions).toFixed(0)}</span>`;
            contentHtml += `</div>`;

            // Units
            if (army.units && army.units.length > 0) {
                contentHtml += '<div style="margin-top: 5px;"><strong style="color: #3e2723;">Unidades:</strong><ul style="margin: 5px 0 0 0; padding-left: 20px; font-size: 12px; color: #3e2723;">';
                army.units.forEach(unit => {
                    contentHtml += `<li>${unit.quantity} ${unit.unit_name} <span style="opacity: 0.7;">(XP: ${unit.experience})</span></li>`;
                });
                contentHtml += '</ul></div>';
            } else {
                contentHtml += '<div style="font-style: italic; color: #795548; font-size: 12px;">Sin unidades reportadas</div>';
            }
        });

        contentHtml += '</div>';
        return contentHtml;
    }
};
