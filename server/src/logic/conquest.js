const h3 = require('h3-js');
const { generateFiefEconomy } = require('../config/gameFunctions.js');

/**
 * Check if a hexagon is adjacent to any player-owned territory
 * @param {string} h3Index - Hexagon to check
 * @param {number} playerId - Player ID
 * @param {Object} pool - DB Pool
 * @returns {Promise<boolean>} True if adjacent
 */
// [DEAD_CODE] TODO: Sin referencias de uso en el proyecto; revisar y eliminar si no se reutiliza.
async function checkContiguity(h3Index, playerId, pool) {
    const neighbors = h3.gridDisk(h3Index, 1);
    const immediateNeighbors = neighbors.filter(neighbor => neighbor !== h3Index);

    const neighborQuery = `
    SELECT COUNT(*) as count
    FROM h3_map
    WHERE player_id = $1 AND h3_index = ANY($2::text[])
  `;
    const neighborResult = await pool.query(neighborQuery, [playerId, immediateNeighbors]);
    return parseInt(neighborResult.rows[0].count) > 0;
}

// Re-export para compatibilidad con AIManagerService y otros importadores
const generateInitialEconomy = () => generateFiefEconomy('fief');

module.exports = {
    checkContiguity,
    generateInitialEconomy
};
