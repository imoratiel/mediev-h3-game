/**
 * mapStyles.js
 * Funciones y constantes para los estilos visuales del mapa
 */

/**
 * Calcula los estilos de relleno para un hexágono
 * @param {Object} hex - Datos del hexágono desde la API
 * @param {Object} config - Configuración { playerId, showTerrainLayer, isPoliticalView }
 * @returns {Object} { fillColor, fillOpacity }
 */
export function getHexagonFillStyle(hex, config) {
  const { playerId, showTerrainLayer, isPoliticalView } = config;

  const isCapital = hex.is_capital === true;
  const isMyTerritory = hex.player_id === playerId;
  const playerColor = hex.player_color || null;
  const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

  // Base color: terrain if layer is active, otherwise neutral
  let fillColor = showTerrainLayer ? terrainColor : '#606060';
  let fillOpacity = 1.0; // Opacidad completa para máxima claridad visual

  // Override fill logic based on priorities
  if (isCapital && isMyTerritory) {
    fillColor = '#ff0000';
    fillOpacity = 1.0;
  } else if (isMyTerritory) {
    fillColor = '#ff0000';
    fillOpacity = 1.0;
  } else if (isPoliticalView && hex.player_id) {
    // Enemy territory: show player color if political view is active
    if (playerColor && isPoliticalView) {
      fillColor = playerColor;
    }
    fillOpacity = 0.6; // Enemy territory semitransparente para diferenciación
  } else if (playerColor) {
    fillOpacity = 0.6;
  } else if (!showTerrainLayer) {
    // No terrain layer and no player: medium opacity
    fillOpacity = 0.7;
  }

  return { fillColor, fillOpacity };
}

/**
 * Calcula los estilos de borde para un hexágono
 * @param {Object} hex - Datos del hexágono desde la API
 * @param {Object} config - Configuración { playerId, isPoliticalView, isHighRes }
 * @returns {Object} { borderColor, borderWeight }
 */
export function getHexagonBorderStyle(hex, config) {
  const { playerId, isPoliticalView, isHighRes } = config;

  const hasRoad = hex.has_road || false;
  const isCapital = hex.is_capital === true;
  const isMyTerritory = hex.player_id === playerId;
  const playerColor = hex.player_color || null;
  const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

  // Default: color red, weight 3
  let borderColor = '#d32f2f';
  let borderWeight = 3;

  // Capital uses the same border style as any own territory (icon is enough distinction)
  if (isMyTerritory) {
    borderColor = '#d32f2f';
    borderWeight = 3;
  } else if (isPoliticalView && playerColor) {
    borderColor = playerColor; // Enemy border color
    borderWeight = 3;
  } else if (hasRoad) {
    borderColor = '#d4af37'; // Gold road
  } else {
    // Neutral hexes use terrain color or minimal border
    if (!hex.player_id && !hasRoad) {
      borderColor = terrainColor;
      borderWeight = isHighRes ? 1.0 : 1.5;
    }
  }

  return { borderColor, borderWeight };
}

/**
 * Genera el HTML del icono SVG de estrella para capitales
 * @returns {String} HTML del icono
 */
export function getCapitalStarIconHTML() {
  return `
    <svg viewBox="0 0 24 24" width="32" height="32" style="filter: drop-shadow(0 0 3px rgba(0,0,0,0.8));">
      <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.335 3.869 1.4-8.168-5.934-5.787 8.2-1.192z"
            fill="#FFD700" stroke="#8B4513" stroke-width="1.5"/>
    </svg>`;
}

/**
 * Calcula los estilos completos para un hexágono (fill + border)
 * @param {Object} hex - Datos del hexágono desde la API
 * @param {Object} config - Configuración completa
 * @returns {Object} { fillColor, fillOpacity, borderColor, borderWeight }
 */
export function getHexagonStyles(hex, config) {
  const fillStyle = getHexagonFillStyle(hex, config);
  const borderStyle = getHexagonBorderStyle(hex, config);

  return {
    ...fillStyle,
    ...borderStyle
  };
}
