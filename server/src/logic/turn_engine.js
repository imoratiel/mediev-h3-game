const { logEconomyEvent } = require('./economy');
const { determineDiscoveredResource } = require('./discovery');
const { Logger } = require('../utils/logger');
const h3 = require('h3-js');

/**
 * Process harvest for all players
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processHarvest(client, turn, config) {
    try {
        Logger.engine(`[TURN ${turn}] Processing harvest...`);

        // Get all active players
        const playersResult = await client.query(`
            SELECT DISTINCT p.player_id, p.username
            FROM players p
            JOIN h3_map m ON p.player_id = m.player_id
            WHERE m.player_id IS NOT NULL
        `);

        for (const player of playersResult.rows) {
            try {
                // Calculate production for this player's territories
                const territories = await client.query(`
                    SELECT
                        td.*,
                        tt.food_output, tt.wood_output, tt.stone_output, tt.iron_output, tt.fishing_output,
                        m.player_id
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                    WHERE m.player_id = $1
                `, [player.player_id]);

                let totalFoodProduced = 0;
                let totalWoodProduced = 0;
                let totalStoneProduced = 0;
                let totalIronProduced = 0;
                let totalGoldProduced = 0;

                // Process each territory
                for (const territory of territories.rows) {
                    // Base production from terrain
                    let foodProduction = territory.food_output || 0;
                    let woodProduction = territory.wood_output || 0;
                    let stoneProduction = territory.stone_output || 0;
                    let ironProduction = territory.iron_output || 0;

                    // Apply building multipliers
                    const farmMultiplier = 1 + ((territory.farm_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));
                    const lumberMultiplier = 1 + ((territory.lumber_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));
                    const mineMultiplier = 1 + ((territory.mine_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));

                    foodProduction = Math.floor(foodProduction * farmMultiplier);
                    woodProduction = Math.floor(woodProduction * lumberMultiplier);
                    stoneProduction = Math.floor(stoneProduction * mineMultiplier);
                    ironProduction = Math.floor(ironProduction * mineMultiplier);

                    // Gold production (10% of population)
                    const goldProduction = Math.floor((territory.population || 0) * 0.1);

                    // Update territory storage
                    await client.query(`
                        UPDATE territory_details
                        SET
                            food_stored = food_stored + $1,
                            wood_stored = wood_stored + $2,
                            stone_stored = stone_stored + $3,
                            iron_stored = iron_stored + $4,
                            gold_stored = gold_stored + $5
                        WHERE h3_index = $6
                    `, [foodProduction, woodProduction, stoneProduction, ironProduction, goldProduction, territory.h3_index]);

                    totalFoodProduced += foodProduction;
                    totalWoodProduced += woodProduction;
                    totalStoneProduced += stoneProduction;
                    totalIronProduced += ironProduction;
                    totalGoldProduced += goldProduction;
                }

                // Calculate troop consumption
                const troopsResult = await client.query(`
                    SELECT
                        SUM(t.quantity * ut.food_consumption) as total_food_consumption,
                        SUM(t.quantity * ut.gold_upkeep) as total_gold_consumption
                    FROM troops t
                    JOIN armies a ON t.army_id = a.army_id
                    JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                    WHERE a.player_id = $1
                `, [player.player_id]);

                const totalFoodConsumption = Math.floor(parseFloat(troopsResult.rows[0]?.total_food_consumption || 0));
                const totalGoldConsumption = Math.floor(parseFloat(troopsResult.rows[0]?.total_gold_consumption || 0));

                // Net production
                const netFood = totalFoodProduced - totalFoodConsumption;
                const netGold = totalGoldProduced - totalGoldConsumption;

                // Update player gold (food stays in territory_details.food_stored)
                await client.query(`
                    UPDATE players
                    SET gold = GREATEST(0, gold + $1)
                    WHERE player_id = $2
                `, [netGold, player.player_id]);

                // Generate harvest message
                const messageSubject = `📊 Resumen de Cosecha - Turno ${turn}`;
                const messageBody = `
🌾 **Producción Total:**
• Comida: +${totalFoodProduced}
• Madera: +${totalWoodProduced}
• Piedra: +${totalStoneProduced}
• Hierro: +${totalIronProduced}
• Oro: +${totalGoldProduced}

⚔️ **Consumo de Tropas:**
• Comida: -${totalFoodConsumption}
• Oro: -${totalGoldConsumption}

💰 **Balance Neto:**
• Comida: ${netFood >= 0 ? '+' : ''}${netFood}
• Oro: ${netGold >= 0 ? '+' : ''}${netGold}

${territories.rows.length > 0 ? `Territorios productivos: ${territories.rows.length}` : '⚠️ No tienes territorios productivos este turno'}
                `.trim();

                // Insert message (sender_id = NULL for system messages)
                await client.query(`
                    INSERT INTO messages (sender_id, receiver_id, subject, body, is_read, sent_at)
                    VALUES (NULL, $1, $2, $3, false, CURRENT_TIMESTAMP)
                `, [player.player_id, messageSubject, messageBody]);

                Logger.engine(`[TURN ${turn}] Harvest processed for player ${player.player_id} (${player.username}): Food ${netFood}, Gold ${netGold}, Wood ${totalWoodProduced}`);
            } catch (playerError) {
                Logger.error(playerError, {
                    context: 'turn_engine.processHarvest',
                    phase: 'player_harvest',
                    turn: turn,
                    playerId: player.player_id
                });
                // Continue with other players
            }
        }

        Logger.engine(`[TURN ${turn}] Harvest completed for ${playersResult.rows.length} players`);
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processHarvest',
            phase: 'global',
            turn: turn
        });
        throw error;
    }
}

/**
 * Process completed explorations
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processExplorations(client, turn, config) {
    try {
        Logger.engine(`[TURN ${turn}] Processing completed explorations...`);

        // Get all territories with completed explorations
        const explorationsResult = await client.query(`
            SELECT
                td.h3_index,
                td.exploration_end_turn,
                m.player_id,
                tt.name as terrain_type,
                p.username
            FROM territory_details td
            JOIN h3_map m ON td.h3_index = m.h3_index
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            JOIN players p ON m.player_id = p.player_id
            WHERE td.exploration_end_turn <= $1
                AND td.exploration_end_turn IS NOT NULL
        `, [turn]);

        let successCount = 0;
        let errorCount = 0;

        for (const exploration of explorationsResult.rows) {
            try {
                // Determine discovered resource
                const discoveredResource = determineDiscoveredResource(exploration.terrain_type);

                // Update territory with discovery result and clear exploration_end_turn
                await client.query(`
                    UPDATE territory_details
                    SET discovered_resource = $1,
                        exploration_end_turn = NULL
                    WHERE h3_index = $2
                `, [discoveredResource, exploration.h3_index]);

                // Generate message for player
                const messageSubject = discoveredResource === 'none'
                    ? `🔍 Exploración Completada - ${exploration.h3_index}`
                    : `💎 Recurso Descubierto - ${exploration.h3_index}`;

                const messageBody = discoveredResource === 'none'
                    ? `La exploración del territorio ${exploration.h3_index} ha finalizado.\n\n❌ No se encontraron recursos especiales en este territorio.`
                    : `¡La exploración del territorio ${exploration.h3_index} ha finalizado con éxito!\n\n✨ **Recurso descubierto**: ${discoveredResource.toUpperCase()}\n\nEste recurso estará disponible para su explotación.`;

                await client.query(`
                    INSERT INTO messages (sender_id, receiver_id, subject, body, is_read, sent_at)
                    VALUES (NULL, $1, $2, $3, false, CURRENT_TIMESTAMP)
                `, [exploration.player_id, messageSubject, messageBody]);

                Logger.engine(`[TURN ${turn}] Exploration completed for player ${exploration.player_id} (${exploration.username}) at ${exploration.h3_index}: discovered ${discoveredResource}`);
                successCount++;
            } catch (explorationError) {
                errorCount++;
                Logger.error(explorationError, {
                    context: 'turn_engine.processExplorations',
                    phase: 'territory_exploration',
                    turn: turn,
                    h3_index: exploration.h3_index,
                    playerId: exploration.player_id
                });
                // Continue with other explorations
            }
        }

        if (successCount > 0 || errorCount > 0) {
            Logger.engine(`[TURN ${turn}] Explorations completed: ${successCount} successful, ${errorCount} errors`);
        }
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processExplorations',
            phase: 'global',
            turn: turn
        });
        // Don't throw - allow turn to continue
    }
}

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
            // Buscar esta línea en MapViewer.vue para asegurarnos de que el consumo de comida coincide entre backend y frontend:
            // const FOOD_CONSUMPTION_MULTIPLIER = 0.1;
            await client.query(`
                UPDATE territory_details
                SET food_stored = GREATEST(0, food_stored - (FLOOR(population / 100.0) * 0.1))
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

        // Process completed explorations (every turn)
        await processExplorations(client, newTurn, config);

        // Harvest logic (days 75 and 180)
        if (dayOfYear === 75 || dayOfYear === 180) {
            Logger.engine(`[TURN ${newTurn}] Harvest day (day ${dayOfYear} of year)`);
            await processHarvest(client, newTurn, config);
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
    isEngineActive,
    processHarvestManually: processHarvest,
    processExplorationsManually: processExplorations
};
