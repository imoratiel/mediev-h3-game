const h3 = require('h3-js');

const TERRAIN_COLORS = {
    'Mar': '#0a4b78',
    'Costa': '#fff59d',
    'Agua': '#4fc3f7',
    'Río': '#00bcd4',
    'Pantanos': '#4e342e',
    'Tierras de Cultivo': '#7db35d',
    'Tierras de Secano': '#b8a170',
    'Estepas': '#d4e157',
    'Bosque': '#558b2f',
    'Espesuras': '#2d5a27',
    'Oteros': '#a1887f',
    'Colinas': '#8d6e63',
    'Alta Montaña': '#546e7a',
    'Asentamiento': '#e53935'
};

/**
 * Format days into human-readable years and days
 * @param {number} days - Total days
 * @returns {string} Formatted string
 */
// [DEAD_CODE] TODO: Sin referencias de uso en el proyecto; revisar y eliminar si no se reutiliza.
function formatDaysToYearsAndDays(days) {
    if (days >= 999999) {
        return 'más de 2,700 años (reservas ilimitadas)';
    }

    const years = Math.floor(days / 365);
    const remainingDays = days % 365;

    if (years === 0) {
        return `${remainingDays} día${remainingDays !== 1 ? 's' : ''}`;
    } else if (remainingDays === 0) {
        return `${years} año${years !== 1 ? 's' : ''}`;
    } else {
        return `${years} año${years !== 1 ? 's' : ''} y ${remainingDays} día${remainingDays !== 1 ? 's' : ''}`;
    }
}

/**
 * Get terrain color based on name or fallback
 * @param {string} terrainName - Terrain type name
 * @param {string} dbColor - Optional color from database
 * @returns {string} Hex color
 */
function getTerrainColor(terrainName, dbColor) {
    return dbColor || TERRAIN_COLORS[terrainName] || '#9e9e9e';
}

module.exports = {
    formatDaysToYearsAndDays,
    getTerrainColor,
    TERRAIN_COLORS
};
