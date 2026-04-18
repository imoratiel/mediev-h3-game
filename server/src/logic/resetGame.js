const pool = require('../../db.js');
const GAME_CONFIG = require('../config/constants');

/**
 * Resetea completamente una partida en curso manteniendo las cuentas de jugadores.
 *
 * Operaciones (en una sola transacción):
 *  1. Elimina ejércitos y tropas (CASCADE)
 *  2. Elimina trabajadores
 *  3. Elimina construcciones activas
 *  4. Restaura terreno original en hexes de puentes y elimina puentes
 *  5. Elimina edificios de feudos
 *  6. Resetea metadatos de territorios y re-randomiza gold_stored, food_stored y population con los multiplicadores de GAME_CONFIG
 *  7. Libera todos los hexes del mapa (player_id = NULL)
 *  8. Elimina mensajes y notificaciones
 *  9. Elimina bots (is_ai = TRUE)
 * 10. Reinicia jugadores humanos: oro, capital, impuestos y diezmo a valores por defecto
 * 11. Reinicia el contador de turnos y la fecha del calendario de juego
 */
async function resetGame() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Adquirir locks exclusivos en todas las tablas afectadas ANTES de cualquier DML.
        // Esto evita deadlocks: si otra conexión tiene un lock activo, esta transacción
        // esperará a que termine en lugar de competir por locks en orden diferente.
        await client.query(`
            LOCK TABLE armies, troops, workers, active_constructions, bridges,
                       fief_buildings, territory_details, h3_map,
                       messages, notifications, players, world_state,
                       political_divisions, characters,
                       market_reserves, market_transactions, player_resource_access
            IN ACCESS EXCLUSIVE MODE
        `);

        // 1. Armies (troops cascade via FK)
        await client.query('DELETE FROM armies');

        // 2. Workers
        await client.query('DELETE FROM workers');

        // 3. In-progress bridge constructions
        await client.query('DELETE FROM active_constructions');

        // 4. Restore bridge hexes terrain to River, then remove bridge records
        await client.query(`
            UPDATE h3_map
            SET terrain_type_id = (
                SELECT terrain_type_id FROM terrain_types
                WHERE LOWER(name) IN ('río', 'rio', 'river')
                LIMIT 1
            )
            WHERE h3_index IN (SELECT h3_index FROM bridges)
              AND (SELECT terrain_type_id FROM terrain_types WHERE LOWER(name) IN ('río', 'rio', 'river') LIMIT 1) IS NOT NULL
        `);
        await client.query('DELETE FROM bridges');

        // 5. Buildings in fiefs
        await client.query('DELETE FROM fief_buildings');

        // 6. Reset territory metadata and re-randomize economic resources
        const eco = GAME_CONFIG.ECONOMY;
        const goldMin  = eco.GOLD_STORED_BASE_MIN  * eco.RESOURCE_MULTIPLIER;
        const goldMax  = eco.GOLD_STORED_BASE_MAX  * eco.RESOURCE_MULTIPLIER;
        const foodMin  = eco.FOOD_STORED_BASE_MIN  * eco.RESOURCE_MULTIPLIER;
        const foodMax  = eco.FOOD_STORED_BASE_MAX  * eco.RESOURCE_MULTIPLIER;
        const popMin   = eco.POPULATION_BASE_MIN   * eco.POPULATION_MULTIPLIER;
        const popMax   = eco.POPULATION_BASE_MAX   * eco.POPULATION_MULTIPLIER;

        await client.query(`
            UPDATE territory_details td SET
                custom_name          = NULL,
                discovered_resource  = NULL,
                exploration_end_turn = NULL,
                grace_turns          = 0,
                farm_level           = 0,
                mine_level           = 0,
                lumber_level         = 0,
                port_level           = 0,
                defense_level        = 0,
                division_id          = NULL,
                gold_stored = floor($1::int + random() * ($2::int - $1::int + 1)),
                food_stored = floor(($3::int + random() * ($4::int - $3::int + 1))
                              * COALESCE((
                                  SELECT t.food_output FROM h3_map m
                                  JOIN terrain_types t ON t.terrain_type_id = m.terrain_type_id
                                  WHERE m.h3_index = td.h3_index
                              ), 100) / 100.0),
                population  = floor($5::int + random() * ($6::int - $5::int + 1))
        `, [goldMin, goldMax, foodMin, foodMax, popMin, popMax]);

        // 6b. Delete political divisions (señoríos y otras divisiones)
        await client.query('DELETE FROM political_divisions');

        // 7. Release hex ownership
        await client.query('UPDATE h3_map SET player_id = NULL');

        // 8. Messages and notifications
        await client.query('DELETE FROM messages');
        await client.query('DELETE FROM notifications');

        // 9. Remove all characters, then AI bots
        await client.query('DELETE FROM characters');
        await client.query('DELETE FROM players WHERE is_ai = TRUE');

        // 10. Reset human players (keep accounts, reset game state)
        await client.query(`
            UPDATE players
            SET gold = ${GAME_CONFIG.ECONOMY.STARTING_GOLD}, capital_h3 = NULL,
                tax_percentage = 10.00, tithe_active = FALSE,
                is_initialized = FALSE
            WHERE is_ai = FALSE AND deleted = FALSE
        `);

        // 11. Reset world date and turn counter
        await client.query(`UPDATE world_state SET current_turn = 0, game_date = '0210-01-01 BC' WHERE id = 1`);

        // 12. Reset market: clear transactions and access, restore food reserve
        await client.query('DELETE FROM player_resource_access');
        await client.query('DELETE FROM market_transactions');
        await client.query(`
            UPDATE market_reserves
            SET current_reserve = mrt.base_reserve, updated_at = NOW()
            FROM market_resource_types mrt
            WHERE market_reserves.resource_type_id = mrt.id
        `);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { resetGame };
