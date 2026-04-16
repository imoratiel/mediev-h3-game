const h3 = require('h3-js');
const { Logger } = require('../utils/logger');
const NotificationService = require('../services/NotificationService');

/** Default number of turns a freshly-conquered fief stays in "grace period". */
const GRACE_TURNS_DEFAULT = 3;

/** Max BFS depth for capital-collapse cascade. */
const CAPITAL_COLLAPSE_RANGE = 5;

/**
 * Calcula el poder de combate de la milicia local de un feudo.
 * Función pura (sin BD), compartida entre conquestTerritory y conquerFief.
 *
 * @param {number} population   - Población actual del feudo
 * @param {number} defenseLevel - Nivel del edificio de defensa
 * @returns {{ militiaCount: number, defenderPower: number }}
 */
function calcMilitiaPower(population, defenseLevel) {
    const militiaCount = Math.floor((population || 0) * 0.1) + (defenseLevel || 0) * 10;
    const MILITIA_ATTACK = 3;
    const defenderPower = militiaCount * MILITIA_ATTACK * (0.85 + Math.random() * 0.30);
    return { militiaCount, defenderPower };
}

/**
 * Decrementa en 1 los turnos_gracia de todos los feudos en período de gracia.
 * Se llama cada turno desde turn_engine.js.
 *
 * @param {Object} client - Cliente PostgreSQL (dentro de transacción)
 * @param {number} turn   - Turno actual (para logs)
 */
async function processGraceTurns(client, turn) {
    const result = await client.query(`
        UPDATE territory_details
        SET grace_turns = GREATEST(0, grace_turns - 1)
        WHERE grace_turns > 0
    `);
    if (result.rowCount > 0) {
        Logger.engine(`[TURN ${turn}] Grace turns decremented for ${result.rowCount} territories`);
    }
}

/**
 * Efecto Dominó: conquista automática en cascada al tomar la capital.
 *
 * BFS desde la capital recién conquistada. Recorre hasta CAPITAL_COLLAPSE_RANGE nodos.
 * Solo conquista feudos del jugador derrotado que sean CONTIGUOS al frente de avance.
 * Regla Blitzkrieg: feudos del conquistador con grace_turns > 0 actúan como waypoints
 * transparentes (la ola puede propagarse a través de ellos).
 *
 * No aplica combate de milicia individual — el colapso es incondicional.
 *
 * @param {Object} client           - Cliente PostgreSQL (dentro de transacción)
 * @param {string} capitalH3        - Hex de la capital recién conquistada
 * @param {number} newOwnerId       - player_id del conquistador
 * @param {number} defeatedPlayerId - player_id del jugador derrotado
 * @param {number} turn             - Turno actual (para notificaciones y logs)
 * @returns {Promise<string[]>}     Array de h3_index conquistados en cascada
 */
async function processCapitalCollapse(client, capitalH3, newOwnerId, defeatedPlayerId, turn) {
    // Cargar todos los feudos del jugador derrotado
    const defeatedResult = await client.query(
        'SELECT h3_index FROM h3_map WHERE player_id = $1',
        [defeatedPlayerId]
    );
    const defeatedFiefs = new Set(defeatedResult.rows.map(r => r.h3_index));

    // Cargar feudos del conquistador que aún están en período de gracia (waypoints)
    const graceResult = await client.query(`
        SELECT td.h3_index
        FROM territory_details td
        JOIN h3_map m ON td.h3_index = m.h3_index
        WHERE m.player_id = $1 AND td.grace_turns > 0
    `, [newOwnerId]);
    const graceFiefs = new Set(graceResult.rows.map(r => r.h3_index));
    // La capital recién conquistada también es un waypoint de inicio
    graceFiefs.add(capitalH3);

    // BFS
    const visited = new Set([capitalH3]);
    const queue = [{ h3: capitalH3, depth: 0 }];
    const toConquer = [];

    while (queue.length > 0) {
        const { h3: current, depth } = queue.shift();
        if (depth >= CAPITAL_COLLAPSE_RANGE) continue;

        const neighbors = h3.gridDisk(current, 1).filter(n => n !== current);

        for (const neighbor of neighbors) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);

            if (defeatedFiefs.has(neighbor)) {
                // Feudo del derrotado → conquistar y añadir al frente BFS
                toConquer.push(neighbor);
                queue.push({ h3: neighbor, depth: depth + 1 });
            } else if (graceFiefs.has(neighbor)) {
                // Waypoint transparente → propagar sin reconquistar
                queue.push({ h3: neighbor, depth: depth + 1 });
            }
            // Cualquier otro hex (agua, neutral, 3º jugador) → detener en esta dirección
        }
    }

    if (toConquer.length === 0) {
        Logger.engine(`[TURN ${turn}] Capital collapse at ${capitalH3}: no adjacent fiefs to cascade (defeated player ${defeatedPlayerId})`);
        return [];
    }

    // Cambiar propietario y asignar período de gracia en bloque
    await client.query(
        'UPDATE h3_map SET player_id = $1 WHERE h3_index = ANY($2::text[])',
        [newOwnerId, toConquer]
    );
    await client.query(
        'UPDATE territory_details SET grace_turns = $1 WHERE h3_index = ANY($2::text[])',
        [GRACE_TURNS_DEFAULT, toConquer]
    );

    // ── Transferir señoríos al conquistador ────────────────────────────────
    // Todos los señoríos del derrotado pasan al conquistador.
    // Si hay colisión de nombre (UNIQUE player_id+name), se añade sufijo con el id.
    const existingNamesRes = await client.query(
        'SELECT name FROM political_divisions WHERE player_id = $1',
        [newOwnerId]
    );
    const existingNames = new Set(existingNamesRes.rows.map(r => r.name));

    const defeatedDivisionsRes = await client.query(
        'SELECT id, name FROM political_divisions WHERE player_id = $1',
        [defeatedPlayerId]
    );
    const defeatedDivisionIds = [];
    for (const div of defeatedDivisionsRes.rows) {
        let finalName = div.name;
        if (existingNames.has(finalName)) {
            finalName = `${div.name} #${div.id}`;
        }
        existingNames.add(finalName);
        await client.query(
            'UPDATE political_divisions SET player_id = $1, name = $2 WHERE id = $3',
            [newOwnerId, finalName, div.id]
        );
        defeatedDivisionIds.push(div.id);
    }

    // Asegurar que TODOS los feudos de las comarcas transferidas cambian de dueño,
    // no sólo los alcanzados por el BFS (que tiene límite de rango).
    if (defeatedDivisionIds.length > 0) {
        await client.query(`
            UPDATE h3_map SET player_id = $1
            WHERE h3_index IN (
                SELECT h3_index FROM territory_details WHERE division_id = ANY($2::int[])
            ) AND player_id = $3
        `, [newOwnerId, defeatedDivisionIds, defeatedPlayerId]);
    }

    Logger.engine(`[TURN ${turn}] Capital collapse: ${toConquer.length} fiefs cascade-conquered from ${capitalH3} (defeated player ${defeatedPlayerId})`);

    // Notificar al jugador derrotado
    const fiefList = toConquer.slice(0, 5).join(', ') + (toConquer.length > 5 ? ` … y ${toConquer.length - 5} más` : '');
    await NotificationService.createSystemNotification(
        defeatedPlayerId,
        'Militar',
        [
            `🏚️ **COLAPSO TERRITORIAL — La capital ha caído**`,
            ``,
            `La caída de vuestra capital ha desencadenado el derrumbe del reino.`,
            `**${toConquer.length} feudos** han quedado en manos del vencedor.`,
            ``,
            `Feudos perdidos: ${fiefList}`,
        ].join('\n'),
        turn
    );

    // Gestionar sucesión: qué pasa al jugador derrotado con sus feudos restantes
    await processCapitalSuccession(client, defeatedPlayerId, turn);

    return toConquer;
}

/**
 * Gestiona la sucesión de capital tras la caída del reino de un jugador.
 *
 * - Si le quedan feudos: promueve el de mayor población como nueva capital.
 * - Si NO le quedan feudos: marca al jugador como exiliado (is_exiled = TRUE).
 *
 * Se llama siempre al final de processCapitalCollapse.
 *
 * @param {Object} client           - Cliente PostgreSQL (dentro de transacción)
 * @param {number} defeatedPlayerId - player_id del jugador derrotado
 * @param {number} turn             - Turno actual (para notificaciones y logs)
 */
async function processCapitalSuccession(client, defeatedPlayerId, turn) {
    // Buscar feudo con más población de los que quedan
    const remainingResult = await client.query(`
        SELECT m.h3_index,
               COALESCE(td.custom_name, m.h3_index) AS fief_name,
               COALESCE(td.population, 0) AS population
        FROM h3_map m
        LEFT JOIN territory_details td ON m.h3_index = td.h3_index
        WHERE m.player_id = $1
        ORDER BY td.population DESC NULLS LAST
        LIMIT 1
    `, [defeatedPlayerId]);

    if (remainingResult.rows.length > 0) {
        // Quedan feudos → promover el de mayor población como nueva capital
        const newCapital = remainingResult.rows[0];
        await client.query(
            'UPDATE players SET capital_h3 = $1 WHERE player_id = $2',
            [newCapital.h3_index, defeatedPlayerId]
        );

        await NotificationService.createSystemNotification(
            defeatedPlayerId,
            'Militar',
            [
                `🏛️ **NUEVA CAPITAL ESTABLECIDA**`,
                ``,
                `Vuestra capital ha caído en manos enemigas, pero el reino no está perdido aún.`,
                `La sede del poder se traslada a: **${newCapital.fief_name}**`,
                ``,
                `Defended ese bastión con uñas y dientes, pues es todo lo que os queda.`,
            ].join('\n'),
            turn
        );

        Logger.engine(`[TURN ${turn}] Capital succession: player ${defeatedPlayerId} → new capital ${newCapital.h3_index} (${newCapital.fief_name})`);
    } else {
        // Sin feudos → exilio
        await client.query(
            'UPDATE players SET capital_h3 = NULL, is_exiled = TRUE WHERE player_id = $1',
            [defeatedPlayerId]
        );

        await NotificationService.createSystemNotification(
            defeatedPlayerId,
            'Militar',
            [
                `⛓️ **EL REINO HA CAÍDO**`,
                ``,
                `No queda feudo bajo vuestra autoridad. El poder que ostentabais se ha disuelto como sal en el mar.`,
                ``,
                `Para continuar, habrá de empezarse de nuevo.`,
                `Podéis colonizar **cualquier feudo libre del mapa** sin restricción de adyacencia.`,
            ].join('\n'),
            turn
        );

        Logger.engine(`[TURN ${turn}] Capital succession: player ${defeatedPlayerId} has NO remaining fiefs → EXILED`);
    }
}

module.exports = { calcMilitiaPower, processGraceTurns, processCapitalCollapse, GRACE_TURNS_DEFAULT };
