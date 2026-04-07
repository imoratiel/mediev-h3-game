/**
 * mapStyles.js
 * Funciones y constantes para los estilos visuales del mapa
 */

// Color del jugador conectado
const OWN_COLOR = '#00e6ff';

// Rampa de colores para jugadores enemigos (se asignan por player_id)
const ENEMY_PALETTE = [
  '#ff4438', // Rojo Coral
  '#c40233', // Carmín Intenso
  '#8a0707', // Rojo Sangre
  '#5e0000', // Granate Profundo
  '#d45b6a', // Frambuesa Claro
  '#9b4e42', // Rojo Óxido
  '#3d0c0c', // Burdeos Muy Oscuro
];

/**
 * Asigna un color de la paleta enemiga de forma determinista según player_id.
 * El mismo player_id siempre recibe el mismo color en cualquier sesión.
 */
function getEnemyColor(playerId) {
  const idx = Math.abs(playerId * 2654435761 >>> 0) % ENEMY_PALETTE.length;
  return ENEMY_PALETTE[idx];
}

/**
 * Calcula los estilos de relleno para un hexágono
 * @param {Object} hex - Datos del hexágono desde la API
 * @param {Object} config - Configuración { playerId, showTerrainLayer, isPoliticalView }
 * @returns {Object} { fillColor, fillOpacity }
 */
export function getHexagonFillStyle(hex, config) {
  const { playerId, showTerrainLayer } = config;

  const isMyTerritory = hex.player_id === playerId;
  const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

  let fillColor = showTerrainLayer ? terrainColor : '#606060';
  let fillOpacity = 1.0;

  if (isMyTerritory) {
    fillColor = OWN_COLOR;
    fillOpacity = 1.0;
  } else if (hex.player_id) {
    fillColor = getEnemyColor(hex.player_id);
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
  const { playerId, isHighRes } = config;

  const hasRoad = hex.has_road || false;
  const isMyTerritory = hex.player_id === playerId;
  const terrainColor = hex.terrain_color || hex.color || '#9e9e9e';

  let borderColor = terrainColor;
  let borderWeight = isHighRes ? 1.0 : 1.5;

  if (isMyTerritory) {
    borderColor = OWN_COLOR;
    borderWeight = 3;
  } else if (hex.player_id) {
    borderColor = getEnemyColor(hex.player_id);
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
