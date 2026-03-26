const h3 = require('h3-js');

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

/**
 * Generate initial economy values for a newly claimed territory
 * @returns {Object} Initial economy values
 */
function generateInitialEconomy() {
    const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    return {
        population: getRandomInt(200, 400),
        happiness: getRandomInt(50, 70),
        food: getRandomInt(0, 2000),
        wood: getRandomInt(0, 2000),
        stone: getRandomInt(0, 2000)
    };
}

module.exports = {
    checkContiguity,
    generateInitialEconomy
};
