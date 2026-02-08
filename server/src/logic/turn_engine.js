const { logEconomyEvent } = require('./economy');
const { determineDiscoveredResource } = require('./discovery');
const { Logger } = require('../utils/logger');
const h3 = require('h3-js');

/**
 * Process a single game turn
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} config - Game configuration
 * @returns {Object} Turn result with success status
 */
async function processGameTurn(pool, config) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if game is paused
        const pauseCheck = await client.query('SELECT is_paused FROM world_state WHERE id = 1');
        if (pauseCheck.rows[0]?.is_paused === true) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Game is paused', paused: true };
        }

        // Increment turn
        const newState = await client.query(`
            UPDATE world_state
            SET current_turn = current_turn + 1,
                game_date = game_date + INTERVAL '1 day',
                last_updated = CURRENT_TIMESTAMP
            WHERE id = 1
            RETURNING current_turn, game_date, days_per_year
        `);
        const { current_turn: newTurn, game_date: newDate, days_per_year } = newState.rows[0];
        const dayOfYear = newTurn % (days_per_year || 365);

        Logger.engine(`[TURN ${newTurn}] Started processing - Date: ${newDate}`);

        // Daily food consumption
        try {
            await client.query(`
                UPDATE territory_details
                SET food_stored = GREATEST(0, food_stored - (FLOOR(population / 100.0) * 1))
                WHERE h3_index IN (SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL)
            `);
            Logger.engine(`[TURN ${newTurn}] Food consumption processed`);
        } catch (error) {
            Logger.error(error, {
                context: 'turn_engine.processGameTurn',
                phase: 'food_consumption',
                turn: newTurn
            });
            // Continue processing - don't fail entire turn for food consumption error
        }

        // Census and Production (every 30 turns)
        if (((newTurn - 1) % 30) === 0) {
            try {
                const territories = await client.query(`
                    SELECT td.*, t.name as terrain_type, m.player_id
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                    WHERE m.player_id IS NOT NULL
                `);

                let successCount = 0;
                let errorCount = 0;

                for (const t of territories.rows) {
                    try {
                        // 1% growth per census - calculate directly in SQL to avoid float parameter issues
                        await client.query(
                            'UPDATE territory_details SET population = FLOOR(population * 1.01) WHERE h3_index = $1',
                            [t.h3_index]
                        );
                        successCount++;
                    } catch (terrError) {
                        errorCount++;
                        Logger.error(terrError, {
                            context: 'turn_engine.processGameTurn',
                            phase: 'population_growth',
                            turn: newTurn,
                            h3_index: t.h3_index
                        });
                        // Continue with other territories
                    }
                }

                Logger.engine(`[TURN ${newTurn}] Census completed: ${successCount} territories updated, ${errorCount} errors`);
            } catch (error) {
                Logger.error(error, {
                    context: 'turn_engine.processGameTurn',
                    phase: 'census',
                    turn: newTurn
                });
                // Continue processing
            }
        }

        // Harvest logic (days 75 and 180)
        if (dayOfYear === 75 || dayOfYear === 180) {
            Logger.engine(`[TURN ${newTurn}] Harvest day (day ${dayOfYear} of year)`);
            // TODO: Implement harvest logic
        }

        await client.query('COMMIT');
        Logger.engine(`[TURN ${newTurn}] Completed successfully - Next turn in ${config.gameplay?.turn_duration_seconds || 60}s`);

        return { success: true, turn: newTurn, date: newDate, dayOfYear };
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        Logger.error(error, {
            context: 'turn_engine.processGameTurn',
            phase: 'global'
        });
        throw error;
    } finally {
        if (client) client.release();
    }
}

let timeoutId = null;
let isEngineRunning = false;

/**
 * Start the turn engine loop
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} config - Game configuration
 */
function startTimeEngine(pool, config) {
    if (isEngineRunning) {
        Logger.engine('[ENGINE] Already running, skipping start');
        return;
    }

    isEngineRunning = true;
    Logger.engine('[ENGINE] Starting turn engine...');

    const run = async () => {
        try {
            const result = await processGameTurn(pool, config);
            if (result.paused) {
                // Game is paused, check again in 10 seconds
                timeoutId = setTimeout(run, 10000);
            } else if (result.success) {
                // Normal turn processing
                const interval = (config.gameplay?.turn_duration_seconds || 60) * 1000;
                timeoutId = setTimeout(run, interval);
            } else {
                // Unknown error, retry in 30 seconds
                Logger.engine('[ENGINE] Unknown result, retrying in 30s');
                timeoutId = setTimeout(run, 30000);
            }
        } catch (error) {
            Logger.error(error, {
                context: 'turn_engine.startTimeEngine',
                phase: 'run_loop'
            });
            // On critical error, retry in 60 seconds
            Logger.engine('[ENGINE] Critical error, retrying in 60s');
            timeoutId = setTimeout(run, 60000);
        }
    };

    run();
}

/**
 * Stop the turn engine loop
 */
function stopTimeEngine() {
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    isEngineRunning = false;
    Logger.engine('[ENGINE] Turn engine stopped');
}

/**
 * Check if engine is running
 * @returns {boolean}
 */
function isEngineActive() {
    return isEngineRunning;
}

module.exports = {
    processGameTurn,
    startTimeEngine,
    stopTimeEngine,
    isEngineActive
};
