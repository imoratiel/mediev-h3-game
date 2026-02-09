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
 * Process military food consumption (troops consume from army provisions, then from fief)
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processMilitaryConsumption(client, turn, config) {
    try {
        Logger.engine(`[TURN ${turn}] Processing military food consumption...`);

        // Get all armies with their troops and stationed location
        const armiesResult = await client.query(`
            SELECT
                a.army_id,
                a.player_id,
                a.name,
                a.h3_index,
                a.food_provisions,
                p.username
            FROM armies a
            JOIN players p ON a.player_id = p.player_id
            WHERE a.h3_index IS NOT NULL
        `);

        for (const army of armiesResult.rows) {
            try {
                // Calculate total food consumption for this army
                const consumptionResult = await client.query(`
                    SELECT COALESCE(SUM(t.quantity * ut.food_consumption), 0) as total_consumption
                    FROM troops t
                    JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                    WHERE t.army_id = $1
                `, [army.army_id]);

                const totalConsumption = Math.floor(parseFloat(consumptionResult.rows[0]?.total_consumption || 0));

                if (totalConsumption === 0) {
                    continue; // No troops = no consumption
                }

                let remainingConsumption = totalConsumption;
                let consumedFromArmy = 0;
                let consumedFromFief = 0;
                let source = '';

                // STEP 1: Consume from army provisions first
                const armyProvisions = parseFloat(army.food_provisions || 0);
                if (armyProvisions > 0) {
                    consumedFromArmy = Math.min(armyProvisions, remainingConsumption);
                    remainingConsumption -= consumedFromArmy;

                    await client.query(`
                        UPDATE armies
                        SET food_provisions = GREATEST(0, food_provisions - $1)
                        WHERE army_id = $2
                    `, [consumedFromArmy, army.army_id]);
                }

                // STEP 2: If army provisions depleted, consume from fief (overflow)
                if (remainingConsumption > 0 && army.h3_index) {
                    // Verify fief belongs to same player (can't eat from enemy fief)
                    const fiefCheck = await client.query(`
                        SELECT m.player_id, td.food_stored
                        FROM h3_map m
                        JOIN territory_details td ON m.h3_index = td.h3_index
                        WHERE m.h3_index = $1
                    `, [army.h3_index]);

                    if (fiefCheck.rows.length > 0) {
                        const fief = fiefCheck.rows[0];

                        if (fief.player_id === army.player_id) {
                            const fiefFood = parseFloat(fief.food_stored || 0);
                            consumedFromFief = Math.min(fiefFood, remainingConsumption);
                            remainingConsumption -= consumedFromFief;

                            await client.query(`
                                UPDATE territory_details
                                SET food_stored = GREATEST(0, food_stored - $1)
                                WHERE h3_index = $2
                            `, [consumedFromFief, army.h3_index]);

                            // Generate warning message if army started consuming from fief
                            if (consumedFromFief > 0 && consumedFromArmy < totalConsumption) {
                                const messageSubject = `⚠️ Suministros Agotados - Ejército ${army.name}`;
                                const messageBody = `
El Ejército **${army.name}** ha agotado sus provisiones propias y ha comenzado a consumir las reservas del feudo.

📍 **Ubicación**: ${army.h3_index}
🍖 **Consumido del feudo**: ${consumedFromFief.toFixed(1)} raciones

⚠️ Reabastecer urgentemente para evitar hambruna.
                                `.trim();

                                await client.query(`
                                    INSERT INTO messages (sender_id, receiver_id, subject, body, is_read, sent_at)
                                    VALUES (NULL, $1, $2, $3, false, CURRENT_TIMESTAMP)
                                `, [army.player_id, messageSubject, messageBody]);
                            }
                        }
                    }
                }

                // STEP 3: Determine source and log
                if (consumedFromArmy > 0 && consumedFromFief > 0) {
                    source = 'Ejército+Feudo';
                } else if (consumedFromArmy > 0) {
                    source = 'Ejército';
                } else if (consumedFromFief > 0) {
                    source = 'Feudo';
                }

                // STEP 4: Check for starvation (deficit remains)
                if (remainingConsumption > 0) {
                    Logger.engine(`[TURN ${turn}] ⚠️ HAMBRUNA - Ejército ${army.army_id} (${army.name}) de player ${army.player_id}: Deficit de ${remainingConsumption.toFixed(1)} raciones`);

                    // Generate starvation message
                    const messageSubject = `🚨 HAMBRUNA - Ejército ${army.name}`;
                    const messageBody = `
¡ALERTA CRÍTICA!

El Ejército **${army.name}** está sufriendo **HAMBRUNA**.

📊 **Situación**:
• Consumo requerido: ${totalConsumption.toFixed(1)}
• Consumido de provisiones: ${consumedFromArmy.toFixed(1)}
• Consumido del feudo: ${consumedFromFief.toFixed(1)}
• **Déficit**: ${remainingConsumption.toFixed(1)} ⚠️

🩸 Las tropas están sufriendo bajas por inanición. Reabastecer INMEDIATAMENTE.
                    `.trim();

                    await client.query(`
                        INSERT INTO messages (sender_id, receiver_id, subject, body, is_read, sent_at)
                        VALUES (NULL, $1, $2, $3, false, CURRENT_TIMESTAMP)
                    `, [army.player_id, messageSubject, messageBody]);
                } else {
                    Logger.engine(`[TURN ${turn}] Ejército ${army.army_id} (${army.name}) de player ${army.player_id} (${army.username}) consumió ${totalConsumption.toFixed(1)} raciones. (Fuente: ${source})`);
                }

            } catch (armyError) {
                Logger.error(armyError, {
                    context: 'turn_engine.processMilitaryConsumption',
                    phase: 'army_consumption',
                    turn: turn,
                    armyId: army.army_id
                });
                // Continue with other armies
            }
        }

        Logger.engine(`[TURN ${turn}] Military consumption completed for ${armiesResult.rows.length} armies`);
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processMilitaryConsumption',
            phase: 'global',
            turn: turn
        });
        throw error;
    }
}

/**
 * Process monthly production (wood, stone, iron, fishing)
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processMonthlyProduction(client, turn, config) {
    try {
        Logger.engine(`[TURN ${turn}] Processing monthly production...`);

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
                        tt.wood_output, tt.stone_output, tt.iron_output, tt.fishing_output,
                        m.player_id
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                    WHERE m.player_id = $1
                `, [player.player_id]);

                let totalWoodProduced = 0;
                let totalStoneProduced = 0;
                let totalIronProduced = 0;
                let totalFishingProduced = 0;

                // Process each territory
                for (const territory of territories.rows) {
                    // Base production from terrain
                    let woodProduction = territory.wood_output || 0;
                    let stoneProduction = territory.stone_output || 0;
                    let ironProduction = territory.iron_output || 0;
                    let fishingProduction = territory.fishing_output || 0;

                    // Apply building multipliers
                    const lumberMultiplier = 1 + ((territory.lumber_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));
                    const mineMultiplier = 1 + ((territory.mine_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));

                    woodProduction = Math.floor(woodProduction * lumberMultiplier);
                    stoneProduction = Math.floor(stoneProduction * mineMultiplier);
                    ironProduction = Math.floor(ironProduction * mineMultiplier);
                    // Fishing is constant (no multiplier building yet)
                    fishingProduction = Math.floor(fishingProduction);

                    // Update territory storage
                    await client.query(`
                        UPDATE territory_details
                        SET
                            wood_stored = wood_stored + $1,
                            stone_stored = stone_stored + $2,
                            iron_stored = iron_stored + $3,
                            food_stored = food_stored + $4
                        WHERE h3_index = $5
                    `, [woodProduction, stoneProduction, ironProduction, fishingProduction, territory.h3_index]);

                    totalWoodProduced += woodProduction;
                    totalStoneProduced += stoneProduction;
                    totalIronProduced += ironProduction;
                    totalFishingProduced += fishingProduction;
                }

                // Generate monthly production message
                const messageSubject = `📊 Producción Mensual - Turno ${turn}`;
                const messageBody = `
🏭 **Producción Industrial:**
• Madera: +${totalWoodProduced}
• Piedra: +${totalStoneProduced}
• Hierro: +${totalIronProduced}

🎣 **Producción Pesquera:**
• Comida (Pesca): +${totalFishingProduced}

${territories.rows.length > 0 ? `Territorios productivos: ${territories.rows.length}` : '⚠️ No tienes territorios productivos este turno'}
                `.trim();

                // Insert message (sender_id = NULL for system messages)
                await client.query(`
                    INSERT INTO messages (sender_id, receiver_id, subject, body, is_read, sent_at)
                    VALUES (NULL, $1, $2, $3, false, CURRENT_TIMESTAMP)
                `, [player.player_id, messageSubject, messageBody]);

                Logger.engine(`[TURN ${turn}] Monthly production for player ${player.player_id} (${player.username}): Wood ${totalWoodProduced}, Stone ${totalStoneProduced}, Iron ${totalIronProduced}, Fishing ${totalFishingProduced}`);
            } catch (playerError) {
                Logger.error(playerError, {
                    context: 'turn_engine.processMonthlyProduction',
                    phase: 'player_production',
                    turn: turn,
                    playerId: player.player_id
                });
                // Continue with other players
            }
        }

        Logger.engine(`[TURN ${turn}] Monthly production completed for ${playersResult.rows.length} players`);
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processMonthlyProduction',
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

        // Military food consumption (every turn)
        await processMilitaryConsumption(client, newTurn, config);

        // Monthly production (day 1 of each month)
        const gameDate = new Date(newDate);
        const dayOfMonth = gameDate.getDate();

        if (dayOfMonth === 1) {
            Logger.engine(`[TURN ${newTurn}] Monthly production day (day 1 of month)`);
            await processMonthlyProduction(client, newTurn, config);
        }

        // Harvest logic (days 75 and 180 - Spring and Fall harvests)
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
    processExplorationsManually: processExplorations,
    processMonthlyProductionManually: processMonthlyProduction,
    processMilitaryConsumptionManually: processMilitaryConsumption
};
