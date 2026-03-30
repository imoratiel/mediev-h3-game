const { Logger } = require('../utils/logger');
const NotificationService = require('../services/NotificationService');

// Fixed tithe rate: 10% of food_stored per non-capital fief
const TITHE_RATE = 0.10;

/**
 * Transfiere el diezmo de comida (10% de food_stored) de los feudos secundarios
 * a la capital correspondiente:
 *   - Feudos de un señorío → capital del señorío (political_divisions.capital_h3)
 *   - Feudos libres        → capital del jugador (players.capital_h3)
 *
 * Solo se ejecuta el día 10 de cada mes del calendario de juego,
 * cuando config.gameplay.tithe_active === true.
 * Incluye guardia de idempotencia para evitar doble ejecución.
 *
 * @param {Object} client   - Cliente PostgreSQL (dentro de transacción)
 * @param {number} turn     - Turno actual
 * @param {Date}   gameDate - Fecha actual del calendario de juego
 */
async function processTithe(client, turn, gameDate) {
    // ── Safety check 1: solo el día 10 del mes ───────────────────────────────
    const gd = new Date(gameDate);
    const dayOfMonth = gd.getDate();
    if (dayOfMonth !== 10) {
        Logger.engine(`[TURN ${turn}] Tithe skipped (game day ${dayOfMonth}, only runs on day 10)`);
        return;
    }

    // ── Safety check 2: idempotencia mensual ─────────────────────────────────
    const gameYearMonth = `${gd.getFullYear()}-${String(gd.getMonth() + 1).padStart(2, '0')}`;

    const lastRunResult = await client.query(
        `SELECT value FROM game_config WHERE "group" = 'system' AND key = 'last_tithe_month'`
    );
    if (lastRunResult.rows[0]?.value === gameYearMonth) {
        Logger.engine(`[TURN ${turn}] Tithe skipped (already collected for game month ${gameYearMonth})`);
        return;
    }

    Logger.engine(`[TURN ${turn}] Tithe collection started — game month ${gameYearMonth} (rate: ${TITHE_RATE * 100}%, food only)`);

    try {
        // Players with at least one territory and a capital defined
        const playersResult = await client.query(`
            SELECT DISTINCT p.player_id, p.username, p.capital_h3, p.tithe_active
            FROM players p
            JOIN h3_map m ON p.player_id = m.player_id
            WHERE m.player_id IS NOT NULL
              AND p.capital_h3 IS NOT NULL
        `);

        let totalPlayers = 0;

        for (const player of playersResult.rows) {
            if (!player.tithe_active) continue;
            try {
                const playerCapital = player.capital_h3;

                // Fetch all non-capital fiefs with their señorío capital (if any).
                // Solo se usa la capital del pagus si el pagus sigue perteneciendo
                // a este jugador; si fue conquistado, el diezmo va a la capital propia.
                const fiefsResult = await client.query(`
                    SELECT td.h3_index,
                           td.food_stored,
                           CASE WHEN pd.player_id = $1 THEN pd.capital_h3 ELSE NULL END AS division_capital
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    LEFT JOIN political_divisions pd ON td.division_id = pd.id
                    WHERE m.player_id = $1
                      AND td.h3_index != $2
                `, [player.player_id, playerCapital]);

                if (fiefsResult.rows.length === 0) continue;

                // Accumulate food per destination capital
                // Map: destinationH3 → totalFood
                const foodByDest = {};

                for (const fief of fiefsResult.rows) {
                    const food = Math.floor((parseFloat(fief.food_stored) || 0) * TITHE_RATE);
                    if (food === 0) continue;

                    // Destination: señorío capital > player capital
                    const dest = fief.division_capital || playerCapital;

                    // Deduct from source fief
                    await client.query(`
                        UPDATE territory_details
                        SET food_stored = food_stored - $1
                        WHERE h3_index = $2
                    `, [food, fief.h3_index]);

                    foodByDest[dest] = (foodByDest[dest] || 0) + food;
                }

                const destinations = Object.entries(foodByDest);
                if (destinations.length === 0) continue;

                // Add food to each destination capital
                for (const [destH3, food] of destinations) {
                    await client.query(`
                        UPDATE territory_details
                        SET food_stored = food_stored + $1
                        WHERE h3_index = $2
                    `, [food, destH3]);
                }

                // Notification
                const totalFood = destinations.reduce((s, [, f]) => s + f, 0);
                const destList = destinations
                    .map(([h3, f]) => `• ${h3}: +${f} 🌾`)
                    .join('\n');

                const lines = [
                    `⛪ **Diezmo Recaudado — Turno ${turn}**`,
                    ``,
                    `Feudos tributarios: ${fiefsResult.rows.length}`,
                    `Total comida recaudada: **+${totalFood} 🌾**`,
                    ``,
                    `**Destinos:**`,
                    destList,
                ];

                await NotificationService.createSystemNotification(
                    player.player_id,
                    'Impuestos',
                    lines.join('\n'),
                    turn
                );

                Logger.engine(`[TURN ${turn}] Tithe collected for player ${player.player_id} (${player.username}): ${totalFood} food → ${destinations.length} capital(s)`);
                totalPlayers++;

            } catch (playerError) {
                Logger.error(playerError, {
                    context: 'tithe_system.processTithe',
                    phase: 'player_tithe',
                    turn,
                    playerId: player.player_id
                });
            }
        }

        // Mark month as collected
        await client.query(
            `INSERT INTO game_config ("group", "key", "value")
             VALUES ('system', 'last_tithe_month', $1)
             ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value`,
            [gameYearMonth]
        );

        Logger.engine(`[TURN ${turn}] Tithe collection completed: ${totalPlayers} players processed. Recorded month ${gameYearMonth}.`);

    } catch (error) {
        Logger.error(error, {
            context: 'tithe_system.processTithe',
            phase: 'global',
            turn
        });
        throw error;
    }
}

module.exports = { processTithe };
