/**
 * recruitmentNetwork.js
 * Lógica de conectividad de feudos para el sistema de reclutamiento.
 *
 * Red de Suministro:
 *   - BFS desde el feudo de reclutamiento para hallar todos los feudos
 *     contiguos del mismo jugador.
 *   - La población reclutable de cada feudo es MAX(0, poblacion - MIN_POP).
 *   - La deducción se aplica en orden BFS (feudo de reclutamiento primero).
 */

const h3 = require('h3-js');
const GAME_CONFIG = require('../config/constants.js');

const MIN_POP = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;
const MAX_RANGE = GAME_CONFIG.ECONOMY.RECRUITMENT_NETWORK_RANGE;

/**
 * BFS para encontrar todos los feudos contiguos del mismo jugador
 * dentro del radio máximo definido por RECRUITMENT_NETWORK_RANGE.
 * Retorna los h3_index en orden BFS (startH3 es siempre el primero).
 *
 * @param {Object} client  - Conexión de BD activa (dentro de transacción)
 * @param {string} startH3 - H3 index del feudo de reclutamiento
 * @param {number} playerId
 * @returns {string[]} Ordered BFS list of connected h3 indices (max distance MAX_RANGE)
 */
async function getConnectedNetwork(client, startH3, playerId) {
    const result = await client.query(
        'SELECT h3_index FROM h3_map WHERE player_id = $1',
        [playerId]
    );
    const playerHexSet = new Set(result.rows.map(r => r.h3_index));

    const visited = new Set([startH3]);
    const bfsOrder = [];
    // Queue stores [h3_index, depth]
    const queue = [[startH3, 0]];

    while (queue.length > 0) {
        const [current, depth] = queue.shift();
        bfsOrder.push(current);
        if (depth >= MAX_RANGE) continue; // No expandir más allá del radio máximo
        const neighbors = h3.gridDisk(current, 1).filter(n => n !== current);
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor) && playerHexSet.has(neighbor)) {
                visited.add(neighbor);
                queue.push([neighbor, depth + 1]);
            }
        }
    }

    return bfsOrder;
}

/**
 * Obtiene las poblaciones de los feudos indicados y los bloquea para update.
 *
 * @param {Object}   client     - Conexión de BD activa
 * @param {string[]} h3Indices  - Lista de h3_index a consultar
 * @returns {Array} [{ h3_index, population }]
 */
async function getFiefPopulations(client, h3Indices) {
    if (h3Indices.length === 0) return [];
    const result = await client.query(
        'SELECT h3_index, population FROM territory_details WHERE h3_index = ANY($1::text[]) FOR UPDATE',
        [h3Indices]
    );
    return result.rows;
}

/**
 * Calcula el total de población reclutable de una red de feudos.
 * Reclutable por feudo = MAX(0, population - MIN_POP).
 *
 * @param {Array} fiefPops - [{ h3_index, population }]
 * @returns {number}
 */
function calcRecruitablePool(fiefPops) {
    return fiefPops.reduce(
        (sum, f) => sum + Math.max(0, (parseInt(f.population) || 0) - MIN_POP),
        0
    );
}

/**
 * Deduce población de la red de feudos en orden BFS.
 * El feudo de reclutamiento (orderedH3s[0]) se vacía primero.
 *
 * @param {Object}   client       - Conexión de BD activa
 * @param {string[]} orderedH3s   - Lista BFS de h3_index (startH3 primero)
 * @param {Array}    fiefPops     - [{ h3_index, population }] bloqueados con FOR UPDATE
 * @param {number}   totalToDeduct
 */
async function deductFromNetwork(client, orderedH3s, fiefPops, totalToDeduct) {
    const popMap = new Map(fiefPops.map(f => [f.h3_index, parseInt(f.population) || 0]));
    let remaining = totalToDeduct;

    for (const h3_index of orderedH3s) {
        if (remaining <= 0) break;
        const pop = popMap.get(h3_index) ?? 0;
        const available = Math.max(0, pop - MIN_POP);
        const toDeduct = Math.min(available, remaining);
        if (toDeduct > 0) {
            await client.query(
                'UPDATE territory_details SET population = population - $1 WHERE h3_index = $2',
                [toDeduct, h3_index]
            );
            remaining -= toDeduct;
        }
    }
}

module.exports = { getConnectedNetwork, getFiefPopulations, calcRecruitablePool, deductFromNetwork };
