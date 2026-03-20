'use strict';

/**
 * noble_rank_system.js
 *
 * Proceso mensual (día 25) que evalúa el rango noble de cada jugador
 * según el número de pagus (señoríos) que controla.
 *
 * Reglas:
 *  - Solo se puede subir UN nivel por mes.
 *  - Se puede bajar directamente al rango que corresponda (sin límite).
 *  - El rango no cae si el jugador sigue por encima del required_count
 *    del rango INFERIOR al suyo.
 */

const { Logger } = require('../utils/logger');
const NotificationService = require('../services/NotificationService');

async function processNobleRanks(client, currentTurn, currentMonth, currentYear) {
    const idempotencyKey = `${currentYear}-${currentMonth}`;

    // Verificar si ya se procesó este mes
    const check = await client.query(`
        SELECT value FROM game_config
        WHERE "group" = 'system' AND key = 'last_noble_rank_month'
    `);
    if (check.rows[0]?.value === idempotencyKey) return;

    await client.query(`
        INSERT INTO game_config ("group", key, value)
        VALUES ('system', 'last_noble_rank_month', $1)
        ON CONFLICT ("group", key) DO UPDATE SET value = $1
    `, [idempotencyKey]);

    Logger.action(`[NobleRanks] Evaluando rangos - mes ${idempotencyKey}`);

    // Jugadores activos con su rango y cultura actuales
    const players = await client.query(`
        SELECT p.player_id, p.gender, p.noble_rank_id, p.culture_id,
               p.last_rank_promotion,
               COALESCE(p.display_name, p.username) AS linaje,
               nr.level_order AS current_level
        FROM players p
        LEFT JOIN noble_ranks nr ON nr.id = p.noble_rank_id
        WHERE p.deleted = FALSE
          AND (p.is_exiled = FALSE OR p.is_exiled IS NULL)
          AND p.is_initialized = TRUE
    `);

    // Todos los rangos nobles, ordenados por cultura y nivel
    const ranksResult = await client.query(`
        SELECT id, culture_id, level_order, required_count,
               title_male, title_female
        FROM noble_ranks
        ORDER BY culture_id, level_order ASC
    `);
    const allRanks = ranksResult.rows;

    for (const player of players.rows) {
        try {
            await _evaluatePlayerRank(client, player, allRanks, idempotencyKey, currentTurn);
        } catch (err) {
            Logger.error(err, {
                context: 'noble_rank_system.processNobleRanks',
                player_id: player.player_id,
            });
        }
    }
}

async function _evaluatePlayerRank(client, player, allRanks, idempotencyKey, currentTurn) {
    const { player_id, gender, noble_rank_id, culture_id, current_level, last_rank_promotion, linaje } = player;

    // Contar pagus del jugador
    const pagusResult = await client.query(
        `SELECT COUNT(*)::int AS pagus_count FROM political_divisions WHERE player_id = $1`,
        [player_id]
    );
    const pagusCount = pagusResult.rows[0]?.pagus_count ?? 0;

    // Rangos de la cultura del jugador, ordenados por nivel
    const cultureRanks = allRanks.filter(r => r.culture_id === culture_id);
    if (cultureRanks.length === 0) return;

    // Rango mínimo garantizado (nivel 1 de la cultura)
    const baseRank = cultureRanks[0];

    // Rango que le corresponde por pagus: el más alto cuyo required_count <= pagusCount
    const eligibleRanks = cultureRanks.filter(r => r.required_count <= pagusCount);
    const deservedRank = eligibleRanks.length > 0
        ? eligibleRanks[eligibleRanks.length - 1]
        : baseRank;

    const currentRank = cultureRanks.find(r => r.id === noble_rank_id) ?? baseRank;

    // Sin cambio
    if (deservedRank.id === currentRank.id) return;

    const isPromotion = deservedRank.level_order > currentRank.level_order;
    const isDemotion  = deservedRank.level_order < currentRank.level_order;

    let targetRank = deservedRank;

    if (isPromotion) {
        // Máximo 1 nivel por mes
        if (last_rank_promotion === idempotencyKey) return;

        // Subir solo 1 nivel desde el actual
        const nextLevel = currentRank.level_order + 1;
        const nextRank = cultureRanks.find(r => r.level_order === nextLevel);
        if (!nextRank) return;

        // Comprobar que realmente tiene los pagus para el siguiente nivel
        if (pagusCount < nextRank.required_count) return;

        targetRank = nextRank;

    } else if (isDemotion) {
        // Bajar directamente al rango que corresponde
        // (deservedRank ya es el correcto)
    }

    // Aplicar el nuevo rango
    await client.query(
        `UPDATE players SET noble_rank_id = $1, last_rank_promotion = $2 WHERE player_id = $3`,
        [targetRank.id, isPromotion ? idempotencyKey : player.last_rank_promotion, player_id]
    );

    const isFemale = gender === 'F';
    const oldTitle  = isFemale ? currentRank.title_female : currentRank.title_male;
    const newTitle  = isFemale ? targetRank.title_female  : targetRank.title_male;

    const message = isPromotion
        ? _promotionMessage(newTitle, linaje)
        : _demotionMessage(oldTitle, newTitle);

    await NotificationService.createSystemNotification(
        player_id, 'General', message, currentTurn
    );

    Logger.action(`[NobleRanks] Player ${player_id} (${linaje}): ${oldTitle} → ${newTitle} (pagus=${pagusCount})`);
}

function _promotionMessage(newTitle, linaje) {
    const templates = [
        `⚜️ **¡Que los dioses sean testigos!**\n\nTus conquistas han extendido la gloria de ${linaje} más allá de toda frontera conocida. Las gentes se postran y susurran tu nuevo nombre: a partir de este día, serás conocido como **${newTitle}**.`,
        `🏛️ **El pueblo ha hablado.**\n\nNadie que haya visto el alcance de tu poder puede seguir llamándote por tu antiguo título. Desde hoy y para siempre, el mundo te reconocerá como **${newTitle}**.`,
        `⚔️ **La historia recuerda a los grandes.**\n\nTus hazañas han cincelado tu nombre en piedra. Que tiemblen los que aún no conocen el nombre de **${newTitle}**.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

function _demotionMessage(oldTitle, newTitle) {
    const templates = [
        `🌑 **Los tiempos han cambiado.**\n\nNadie considera ya posible seguir llamándote **${oldTitle}**. Tu poder ha menguado y con él tu título. A partir de ahora se te conocerá como **${newTitle}**.`,
        `⚠️ **El destino es cruel con los que caen.**\n\nEl título de **${oldTitle}** perteneció a alguien con más tierras de las que tú controlas hoy. Recobra lo que perdiste, pues ahora se te llama **${newTitle}**.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

module.exports = { processNobleRanks };
