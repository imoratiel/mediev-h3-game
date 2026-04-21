/**
 * recruitmentNetwork.js
 * Lógica de conectividad de feudos para el sistema de reclutamiento.
 *
 * Red de Suministro:
 *   - BFS desde el feudo de reclutamiento para hallar todos los feudos
 *     contiguos del mismo jugador dentro de la misma comarca.
 *   - Cap por feudo: MIN( population * 15%, MAX(0, population - MIN_POP) )
 *   - Recuperación mensual: la capacidad usada se recupera linealmente
 *     en RECRUITMENT_RECOVERY_TURNS turnos (1 mes = 30 turnos).
 *   - El reparto de población se hace proporcionalmente al surplus disponible.
 */

const h3 = require('h3-js');
const GAME_CONFIG = require('../config/constants.js');

const MIN_POP        = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;
const MAX_RANGE      = GAME_CONFIG.ECONOMY.RECRUITMENT_NETWORK_RANGE;
const CAP_RATIO      = GAME_CONFIG.ECONOMY.RECRUITMENT_CAP_RATIO;
const RECOVERY_TURNS = GAME_CONFIG.ECONOMY.RECRUITMENT_RECOVERY_TURNS;

/**
 * BFS para encontrar todos los feudos contiguos del mismo jugador
 * dentro del radio máximo y la misma comarca.
 * Retorna los h3_index en orden BFS (startH3 es siempre el primero).
 */
async function getConnectedNetwork(client, startH3, playerId) {
    const RIVER_ID  = GAME_CONFIG.MAP.RIVER_TERRAIN_TYPE_ID;
    const BRIDGE_ID = GAME_CONFIG.MAP.BRIDGE_TERRAIN_TYPE_ID;

    const divResult = await client.query(
        'SELECT division_id FROM territory_details WHERE h3_index = $1',
        [startH3]
    );
    const divisionId = divResult.rows[0]?.division_id ?? null;

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
            if (playerHexSet.has(neighbor) || bridgeSet.has(neighbor)) {
                queue.push([neighbor, depth + 1]);
            }
        }
    }

    return bfsOrder;
}

/**
 * Obtiene las poblaciones y el estado de reclutamiento de los feudos indicados.
 * Bloquea las filas para UPDATE dentro de la transacción activa.
 */
async function getFiefPopulations(client, h3Indices) {
    if (h3Indices.length === 0) return [];
    const result = await client.query(
        `SELECT h3_index, population, division_id, recruited_turn, recruited_amount
         FROM territory_details
         WHERE h3_index = ANY($1::text[]) FOR UPDATE`,
        [h3Indices]
    );
    return result.rows;
}

/**
 * Calcula el surplus de reclutamiento disponible para un feudo en el turno actual.
 *
 * cap_bruto  = MIN( FLOOR(pop * 15%), MAX(0, pop - MIN_POP) )
 * ya_usado   = FLOOR( recruited_amount * (1 − turns_since / RECOVERY_TURNS) )
 * disponible = MAX(0, cap_bruto − ya_usado)
 */
function fiefAvailable(f, currentTurn) {
    const pop           = parseInt(f.population) || 0;
    const turnsSince    = Math.max(0, currentTurn - (parseInt(f.recruited_turn) || 0));
    const recoveryRatio = Math.min(1.0, turnsSince / RECOVERY_TURNS);
    const alreadyUsed   = Math.floor((parseInt(f.recruited_amount) || 0) * (1 - recoveryRatio));

    // Reconstruir la población pre-reclutamiento sumando lo ya consumido este ciclo.
    // Evita que el cap del 15% encoja a medida que se recluta (doble penalización).
    const effectivePop  = pop + alreadyUsed;
    const floorSurplus  = Math.max(0, effectivePop - MIN_POP);
    const cap15         = Math.floor(effectivePop * CAP_RATIO);
    const rawCap        = Math.min(cap15, floorSurplus);

    return Math.max(0, rawCap - alreadyUsed);
}

/**
 * Calcula el total de población reclutable de una red de feudos.
 *
 * @param {Array}  fiefPops    - [{ h3_index, population, recruited_turn, recruited_amount }]
 * @param {number} currentTurn
 * @returns {number}
 */
function calcRecruitablePool(fiefPops, currentTurn) {
    return fiefPops.reduce((sum, f) => sum + fiefAvailable(f, currentTurn), 0);
}

/**
 * Reparte la población entre los feudos proporcionalmente a su disponibilidad.
 * Actualiza population, recruited_turn y recruited_amount en cada feudo que contribuye.
 *
 * El "colapso" de recuperación en cada escritura garantiza que lecturas futuras
 * calculen correctamente desde el nuevo baseline.
 *
 * @param {Object}   client
 * @param {string[]} orderedH3s    - Lista BFS (startH3 primero)
 * @param {Array}    fiefPops      - Resultado de getFiefPopulations (bloqueado FOR UPDATE)
 * @param {number}   totalToDeduct
 * @param {number}   currentTurn
 */
async function deductFromNetwork(client, orderedH3s, fiefPops, totalToDeduct, currentTurn) {
    const popMap = new Map(fiefPops.map(f => [f.h3_index, f]));

    const contributors = orderedH3s
        .map(h3_index => {
            const f = popMap.get(h3_index);
            if (!f) return null;
            return { h3_index, available: fiefAvailable(f, currentTurn), f };
        })
        .filter(c => c && c.available > 0);

    const totalPool = contributors.reduce((s, c) => s + c.available, 0);
    if (totalPool === 0 || totalToDeduct === 0) return;

    let deducted = 0;
    for (let i = 0; i < contributors.length; i++) {
        const { h3_index, available, f } = contributors[i];
        const isLast   = i === contributors.length - 1;
        const share    = isLast ? totalToDeduct - deducted : Math.floor(totalToDeduct * (available / totalPool));
        const toDeduct = Math.min(share, available);
        if (toDeduct <= 0) continue;

        // Colapsar la recuperación parcial en el nuevo baseline
        const turnsSince    = Math.max(0, currentTurn - (parseInt(f.recruited_turn) || 0));
        const recoveryRatio = Math.min(1.0, turnsSince / RECOVERY_TURNS);
        const prevRemaining = Math.floor((parseInt(f.recruited_amount) || 0) * (1 - recoveryRatio));
        const newAmount     = prevRemaining + toDeduct;

        await client.query(
            `UPDATE territory_details
             SET population       = population - $1,
                 recruited_turn   = $2,
                 recruited_amount = $3
             WHERE h3_index = $4`,
            [toDeduct, currentTurn, newAmount, h3_index]
        );

        deducted += toDeduct;
    }
}

module.exports = { getConnectedNetwork, getFiefPopulations, calcRecruitablePool, deductFromNetwork };
