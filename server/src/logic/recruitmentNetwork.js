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

const MIN_POP  = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;
const MAX_RANGE = GAME_CONFIG.ECONOMY.RECRUITMENT_NETWORK_RANGE;
const MAX_RECRUITS_DIVISION    = GAME_CONFIG.DIVISIONS.MAX_RECRUITS_DIVISION;
const MAX_RECRUITS_INDEPENDENT = GAME_CONFIG.DIVISIONS.MAX_RECRUITS_INDEPENDENT;

/**
 * BFS para encontrar todos los feudos contiguos del mismo jugador
 * dentro del radio máximo definido por RECRUITMENT_NETWORK_RANGE.
 * Retorna los h3_index en orden BFS (startH3 es siempre el primero).
 *
 * @param {Object} client  - Conexión de BD activa (dentro de transacción)
 * @param {string} startH3 - H3 index del feudo de reclutamiento
 * @param {number} playerId
 * @returns {Promise<string[]>} Ordered BFS list of connected h3 indices (max distance MAX_RANGE)
 */
async function getConnectedNetwork(client, startH3, playerId) {
    const RIVER_ID  = GAME_CONFIG.MAP.RIVER_TERRAIN_TYPE_ID;
    const BRIDGE_ID = GAME_CONFIG.MAP.BRIDGE_TERRAIN_TYPE_ID;

    // Obtener la comarca del feudo de origen
    const divResult = await client.query(
        'SELECT division_id FROM territory_details WHERE h3_index = $1',
        [startH3]
    );
    const divisionId = divResult.rows[0]?.division_id ?? null;

    // Solo hexes del jugador que pertenezcan a la misma comarca (o sin comarca si el origen es independiente)
    // Excluir ríos — no transmiten abastecimiento
    const playerResult = await client.query(
        `SELECT m.h3_index FROM h3_map m
         LEFT JOIN territory_details td ON td.h3_index = m.h3_index
         WHERE m.player_id = $1
           AND m.terrain_type_id != $2
           AND (
             ($3::int IS NULL AND (td.division_id IS NULL))
             OR (td.division_id = $3)
           )`,
        [playerId, RIVER_ID, divisionId]
    );
    const playerHexSet = new Set(playerResult.rows.map(r => r.h3_index));

    // Puentes de cualquier propietario: actúan como conectores neutros para todos
    const bridgeResult = await client.query(
        'SELECT h3_index FROM h3_map WHERE terrain_type_id = $1',
        [BRIDGE_ID]
    );
    const bridgeSet = new Set(bridgeResult.rows.map(r => r.h3_index));

    const visited = new Set([startH3]);
    const bfsOrder = [];
    const queue = [[startH3, 0]];

    while (queue.length > 0) {
        const [current, depth] = queue.shift();
        bfsOrder.push(current);
        if (depth >= MAX_RANGE) continue;
        const neighbors = h3.gridDisk(current, 1).filter(n => n !== current);
        for (const neighbor of neighbors) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            // Propagar por hexes de la misma comarca o por puentes (conectores neutros)
            if (playerHexSet.has(neighbor) || bridgeSet.has(neighbor)) {
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
 * @returns {Promise<{h3_index: string, population: number}[]>}
 */
async function getFiefPopulations(client, h3Indices) {
    if (h3Indices.length === 0) return [];
    const result = await client.query(
        'SELECT h3_index, population, division_id FROM territory_details WHERE h3_index = ANY($1::text[]) FOR UPDATE',
        [h3Indices]
    );
    return result.rows;
}

/**
 * Calcula el total de población reclutable de una red de feudos.
 *
 * Por feudo: reclutable = MIN( MAX(0, population - MIN_POP), cap )
 * donde cap depende de si el feudo pertenece a un señorío:
 *   - division_id IS NOT NULL → cap MAX_RECRUITS_DIVISION    (200)
 *   - division_id IS NULL     → cap MAX_RECRUITS_INDEPENDENT (400)
 *
 * @param {Array} fiefPops - [{ h3_index, population, division_id? }]
 * @returns {number}
 */
function calcRecruitablePool(fiefPops) {
    return fiefPops.reduce((sum, f) => {
        const pop       = parseInt(f.population) || 0;
        const cap       = f.division_id ? MAX_RECRUITS_DIVISION : MAX_RECRUITS_INDEPENDENT;
        const available = Math.min(Math.max(0, pop - MIN_POP), cap);
        return sum + available;
    }, 0);
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

    // Surplus disponible por feudo (sin bajar de MIN_POP)
    const contributors = orderedH3s
        .map(h3_index => ({ h3_index, surplus: Math.max(0, (popMap.get(h3_index) ?? 0) - MIN_POP) }))
        .filter(f => f.surplus > 0);

    const totalPool = contributors.reduce((s, f) => s + f.surplus, 0);
    if (totalPool === 0 || totalToDeduct === 0) return;

    // Reparto proporcional: cada feudo contribuye según su fracción del pool total.
    // El último feudo absorbe el residuo de redondeo para no perder población.
    let deducted = 0;
    for (let i = 0; i < contributors.length; i++) {
        const f = contributors[i];
        const isLast = i === contributors.length - 1;
        const share = isLast
            ? totalToDeduct - deducted
            : Math.floor(totalToDeduct * (f.surplus / totalPool));
        const toDeduct = Math.min(share, f.surplus);
        if (toDeduct > 0) {
            await client.query(
                'UPDATE territory_details SET population = population - $1 WHERE h3_index = $2',
                [toDeduct, f.h3_index]
            );
            deducted += toDeduct;
        }
    }
}

module.exports = { getConnectedNetwork, getFiefPopulations, calcRecruitablePool, deductFromNetwork };
