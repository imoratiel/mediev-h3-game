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
  let fillOpacity = 1.0;

  if (isMyTerritory && playerColor) {
    // Own territory: full color, clearly solid
    fillColor = playerColor;
    fillOpacity = 1.0;
  } else if (!isMyTerritory && hex.player_id && playerColor) {
    // Enemy territory: their color but semi-transparent to distinguirlo del propio
    fillColor = playerColor;
    fillOpacity = 0.55;
  } else if (!isMyTerritory && hex.player_id) {
    // Enemy without color assigned: neutral tint
    fillColor = showTerrainLayer ? terrainColor : '#606060';
    fillOpacity = 0.55;
  } else if (!showTerrainLayer) {
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

  let borderColor = terrainColor;
  let borderWeight = isHighRes ? 1.0 : 1.5;

  if (isMyTerritory && playerColor) {
    // Own territory: bold border in own color
    borderColor = playerColor;
    borderWeight = 3;
  } else if (!isMyTerritory && hex.player_id && playerColor) {
    // Enemy territory: thinner border in their color
    borderColor = playerColor;
    borderWeight = 2;
  } else if (hasRoad) {
    borderColor = '#d4af37';
    borderWeight = 2;
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
