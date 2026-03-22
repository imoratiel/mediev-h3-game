const { logEconomyEvent } = require('./economy');
const { auditEvent, TOPICS } = require('../infrastructure/kafkaFacade');
const { determineDiscoveredResource } = require('./discovery');
const { processTaxCollection, processRelationTributes } = require('./tax_collector');
const { processCharacterLifecycle } = require('./character_lifecycle');
const { processNobleRanks } = require('./noble_rank_system');
const { processTithe } = require('./tithe_system');
const { processBuildingDecay } = require('./building_decay');
const { processGraceTurns } = require('./conquest_system');
const { processWorkerMovements } = require('./workerMovement');
const GAME_CONFIG = require('../config/constants');
const { getPopulationCap } = require('../config/gameFunctions');
const { Logger } = require('../utils/logger');
const ArmySimulationService = require('../services/ArmySimulationService');
const NotificationService = require('../services/NotificationService');
const CharacterService = require('../services/CharacterService');
const { calculateHappiness } = require('../services/FiefService');
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
                const miracleHarvests = []; // Tracks miracle events for the notification

                // Process each territory
                for (const territory of territories.rows) {
                    // Base production from terrain
                    let foodProduction = territory.food_output || 0;
                    let woodProduction = territory.wood_output || 0;
                    let stoneProduction = territory.stone_output || 0;
                    let ironProduction = territory.iron_output || 0;

                    // Apply building multipliers
                    const farmMultiplier = 1 + ((territory.farm_level || 0) * (config.infrastructure?.farm_prod_multiplier || 0.10));
                    const lumberMultiplier = 1 + ((territory.lumber_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));
                    const mineMultiplier = 1 + ((territory.mine_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));

                    foodProduction = Math.floor(foodProduction * farmMultiplier * GAME_CONFIG.HARVEST.FOOD_PRODUCTION_MULTIPLIER);
                    woodProduction = Math.floor(woodProduction * lumberMultiplier);
                    stoneProduction = Math.floor(stoneProduction * mineMultiplier);
                    ironProduction = Math.floor(ironProduction * mineMultiplier);

                    // ── EMERGENCY HARVEST ────────────────────────────────────────────────
                    // If the fief cannot sustain even one more day of consumption after this
                    // harvest, simulate a miraculous surge in food production (×2.0 to ×4.0).
                    // Only applies to food and only when the fief is truly critical.
                    const population = territory.population || 0;
                    const nextTurnConsumption = Math.floor(population / 100.0) * 0.1;
                    const foodAfterHarvest = (territory.food_stored || 0) + foodProduction;

                    if (nextTurnConsumption > 0 && foodAfterHarvest < nextTurnConsumption) {
                        const { EMERGENCY_HARVEST_MIN: ehMin, EMERGENCY_HARVEST_MAX: ehMax } = GAME_CONFIG.HARVEST;
                        const miracleMultiplier = ehMin + Math.random() * (ehMax - ehMin);
                        const normalProduction = foodProduction;
                        foodProduction = Math.floor(foodProduction * miracleMultiplier);
                        const bonus = foodProduction - normalProduction;

                        miracleHarvests.push({
                            h3_index: territory.h3_index,
                            multiplier: miracleMultiplier,
                            bonus,
                        });

                        Logger.engine(`[TURN ${turn}] ✨ COSECHA MILAGROSA en ${territory.h3_index} (player ${player.player_id}): ×${miracleMultiplier.toFixed(2)}, +${bonus} comida extra`);
                    }
                    // ────────────────────────────────────────────────────────────────────

                    // Gold production (10% of population × balance multiplier).
                    const goldProduction = Math.floor((territory.population || 0) * 0.1 * GAME_CONFIG.HARVEST.GOLD_PRODUCTION_MULTIPLIER);

                    // Update territory storage
                    // DISABLED: wood/stone/iron production temporarily disabled
                    await client.query(`
                        UPDATE territory_details
                        SET
                            food_stored = food_stored + $1,
                            gold_stored = gold_stored + $2
                        WHERE h3_index = $3
                    `, [foodProduction, goldProduction, territory.h3_index]);

                    totalFoodProduced += foodProduction;
                    // totalWoodProduced += woodProduction;   // DISABLED
                    // totalStoneProduced += stoneProduction; // DISABLED
                    // totalIronProduced += ironProduction;   // DISABLED
                    totalGoldProduced += goldProduction;
                }

                // Calculate troop consumption
                const troopsResult = await client.query(`
                    SELECT
                        SUM(t.quantity) as total_troops,
                        SUM(t.quantity * ut.food_consumption * 0.001) as total_food_consumption,
                        SUM(t.quantity * ut.gold_upkeep) as total_gold_consumption
                    FROM troops t
                    JOIN armies a ON t.army_id = a.army_id
                    JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                    WHERE a.player_id = $1
                `, [player.player_id]);

                const totalTroops = parseInt(troopsResult.rows[0]?.total_troops || 0);
                const totalFoodConsumption = parseFloat(troopsResult.rows[0]?.total_food_consumption || 0);
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

                // Generate harvest notification
                const miracleSection = miracleHarvests.length > 0
                    ? `\n\n✨ **¡Cosecha Milagrosa!**\n` +
                      `Los campesinos han redoblado esfuerzos ante la hambruna y la producción ha aumentado:\n` +
                      miracleHarvests.map(m =>
                          `• ${m.h3_index}: ×${m.multiplier.toFixed(2)} (+${m.bonus} comida extra)`
                      ).join('\n')
                    : '';

                const messageBody = `
🌾 **Producción Total:**
• Comida: +${totalFoodProduced}
• Oro: +${totalGoldProduced}

⚔️ **Consumo de Tropas:**
• Comida: -${totalFoodConsumption}
• Oro: -${totalGoldConsumption}

💰 **Balance Neto:**
• Comida: ${netFood >= 0 ? '+' : ''}${netFood}
• Oro: ${netGold >= 0 ? '+' : ''}${netGold}

${territories.rows.length > 0 ? `Territorios productivos: ${territories.rows.length}` : '⚠️ No tienes territorios productivos este turno'}${miracleSection}
                `.trim();

                await NotificationService.createSystemNotification(player.player_id, 'Económico', messageBody, turn);

                // Soldadas notification
                if (totalGoldConsumption > 0) {
                    const soldadasBody = `⚔️ **Pago de Soldadas**\n• Tropas en nómina: ${totalTroops}\n• Oro pagado: -${totalGoldConsumption} 💰`;
                    await NotificationService.createSystemNotification(player.player_id, 'Militar', soldadasBody, turn);
                    auditEvent('SALARY_PAYMENT', {
                        player_id:    player.player_id,
                        turn,
                        total_troops: totalTroops,
                        gold_paid:    totalGoldConsumption,
                    }, TOPICS.SALARY);
                }

                Logger.engine(`[TURN ${turn}] Harvest processed for player ${player.player_id} (${player.username}): Food ${netFood}, Gold ${netGold}, Wood ${totalWoodProduced}`);
                auditEvent('HARVEST_COMPLETE', {
                    player_id:          player.player_id,
                    turn,
                    territories:        territories.rows.length,
                    food_produced:      totalFoodProduced,
                    wood_produced:      totalWoodProduced,
                    stone_produced:     totalStoneProduced,
                    iron_produced:      totalIronProduced,
                    gold_produced:      totalGoldProduced,
                    food_consumed:      totalFoodConsumption,
                    gold_consumed:      totalGoldConsumption,
                    net_food:           netFood,
                    net_gold:           netGold,
                    miracle_harvests:   miracleHarvests.length,
                }, TOPICS.HARVEST);
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

    //Logger.engine(`FORZADO PARA EVITAR EL CONSUMO DE EL EJERCITO POR AHORA - DESHABILITADO TEMPORALMENTE`);
    //return;


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
                    SELECT COALESCE(SUM(t.quantity * ut.food_consumption * 0.001), 0) as total_consumption
                    FROM troops t
                    JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                    WHERE t.army_id = $1
                `, [army.army_id]);

                const totalConsumption = parseFloat(consumptionResult.rows[0]?.total_consumption || 0);

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

                            // Mensaje eliminado: No se envían alertas de suministros agotados
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
                    // Mensaje eliminado: No se envían alertas de hambruna
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
 * Elimina notificaciones con más de 15 días reales de antigüedad (~495 turnos a ~33 t/día).
 * Se ejecuta una vez por mes de juego (dayOfMonth === 1).
 */
async function purgeOldNotifications(client, currentTurn) {
    const TURNS_THRESHOLD = 495;
    try {
        const result = await client.query(
            `DELETE FROM notifications WHERE turn_number < $1`,
            [currentTurn - TURNS_THRESHOLD]
        );
        const deleted = result.rowCount ?? 0;
        if (deleted > 0) {
            Logger.engine(`[TURN ${currentTurn}] Notifications purged: ${deleted} entries older than ${TURNS_THRESHOLD} turns removed`);
        }
    } catch (error) {
        Logger.error(error, { context: 'turn_engine.purgeOldNotifications', turn: currentTurn });
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
                        tt.wood_output, tt.stone_output, tt.iron_output,
                        m.player_id
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                    WHERE m.player_id = $1
                `, [player.player_id]);

                let totalWoodProduced = 0;
                let totalStoneProduced = 0;
                let totalIronProduced = 0;

                // Process each territory
                for (const territory of territories.rows) {
                    // Base production from terrain
                    let woodProduction = territory.wood_output || 0;
                    let stoneProduction = territory.stone_output || 0;
                    let ironProduction = territory.iron_output || 0;

                    // Apply building multipliers
                    const lumberMultiplier = 1 + ((territory.lumber_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));
                    const mineMultiplier = 1 + ((territory.mine_level || 0) * (config.infrastructure?.prod_multiplier_per_level || 0.20));

                    woodProduction = Math.floor(woodProduction * lumberMultiplier);
                    stoneProduction = Math.floor(stoneProduction * mineMultiplier);
                    ironProduction = Math.floor(ironProduction * mineMultiplier);

                    // DISABLED: wood/stone/iron monthly production temporarily disabled
                    // totalWoodProduced += woodProduction;
                    // totalStoneProduced += stoneProduction;
                    // totalIronProduced += ironProduction;
                }

                Logger.engine(`[TURN ${turn}] Monthly production for player ${player.player_id} (${player.username}): Wood ${totalWoodProduced}, Stone ${totalStoneProduced}, Iron ${totalIronProduced}`);
                auditEvent('MONTHLY_PRODUCTION', {
                    player_id:       player.player_id,
                    turn,
                    territories:     territories.rows.length,
                    wood_produced:   totalWoodProduced,
                    stone_produced:  totalStoneProduced,
                    iron_produced:   totalIronProduced,
                }, TOPICS.HARVEST);
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
 * Process civil food consumption for all inhabited fiefs.
 * Runs once per game month (day 1). Consumption = daily rate × 30 days.
 * Daily rate: floor(population / 100) × 0.1
 * Monthly:    floor(population / 100) × 0.1 × 30  =  floor(population / 100) × 3
 */
/**
 * Processes fief happiness for all player-owned, populated fiefs.
 * Runs monthly (day 1). Applies inertia delta based on tax, food autonomy,
 * garrison presence and war-zone status.
 */
async function processHappiness(client, turn) {
    try {
        // Effective tax rate: señorío rate (1-15) or player global (normalised to 1-15)
        const result = await client.query(`
            SELECT
                td.h3_index,
                td.happiness,
                td.food_stored,
                td.population,
                COALESCE(td.is_war_zone, FALSE) AS is_war_zone,
                LEAST(15, GREATEST(1,
                    COALESCE(pd.tax_rate, p.tax_percentage, 10)
                )) AS effective_tax_rate,
                EXISTS(
                    SELECT 1 FROM armies a
                    WHERE a.h3_index = td.h3_index AND a.is_garrison = TRUE
                ) AS has_garrison
            FROM territory_details td
            JOIN h3_map m ON td.h3_index = m.h3_index
            JOIN players p ON p.player_id = m.player_id
            LEFT JOIN political_divisions pd ON pd.id = td.division_id
            WHERE m.player_id IS NOT NULL
              AND td.population > 0
        `);

        if (result.rows.length === 0) return;

        const h3Indices  = [];
        const newValues  = [];
        const deltaValues = [];

        for (const fief of result.rows) {
            const oldHappiness = fief.happiness ?? 50;
            const newHappiness = calculateHappiness(
                {
                    happiness:   oldHappiness,
                    food_stored: fief.food_stored,
                    population:  fief.population,
                    is_war_zone: fief.is_war_zone,
                },
                {
                    tax_rate:     parseFloat(fief.effective_tax_rate),
                    has_garrison: fief.has_garrison,
                }
            );
            h3Indices.push(fief.h3_index);
            newValues.push(newHappiness);
            deltaValues.push(newHappiness - oldHappiness);
        }

        await client.query(`
            UPDATE territory_details AS td
            SET happiness       = u.happiness,
                happiness_delta = u.delta
            FROM (
                SELECT UNNEST($1::text[]) AS h3_index,
                       UNNEST($2::int[])  AS happiness,
                       UNNEST($3::int[])  AS delta
            ) AS u
            WHERE td.h3_index = u.h3_index
        `, [h3Indices, newValues, deltaValues]);

        Logger.engine(`[TURN ${turn}] Happiness updated for ${h3Indices.length} fief(s)`);
    } catch (error) {
        Logger.error(error, { context: 'turn_engine.processHappiness', turn });
    }
}

/**
 * Señorío food solidarity: before monthly consumption, fiefs in deficit
 * receive food from the richest surplus fief within the same señorío.
 *
 * Deficit fief:  food_stored < monthly_consumption  (floor(pop/100)*3)
 * Donor fief:    has surplus = food_stored - monthly_consumption > 0
 * Transfer:      MIN(deficit, donor_surplus)
 *
 * Runs once per month, BEFORE processCivilFoodConsumption.
 */
async function processSeñorioFoodSolidarity(client, turn) {
    try {
        // All deficit fiefs that belong to a señorío, ordered by largest deficit first
        const deficitResult = await client.query(`
            SELECT
                td.h3_index,
                td.division_id,
                td.food_stored,
                FLOOR(td.population / 100.0) * 3                         AS monthly_consumption,
                GREATEST(0, FLOOR(td.population / 100.0) * 3 - td.food_stored) AS deficit
            FROM territory_details td
            JOIN h3_map m ON td.h3_index = m.h3_index
            WHERE td.division_id IS NOT NULL
              AND m.player_id IS NOT NULL
              AND td.population > 0
              AND td.food_stored < FLOOR(td.population / 100.0) * 3
            ORDER BY td.division_id, deficit DESC
        `);

        if (deficitResult.rows.length === 0) return;

        let transferCount = 0;

        for (const fief of deficitResult.rows) {
            // Re-read food_stored of deficit fief (may have received a transfer already this loop)
            const currentFief = await client.query(
                'SELECT food_stored FROM territory_details WHERE h3_index = $1',
                [fief.h3_index]
            );
            const currentFood = parseFloat(currentFief.rows[0]?.food_stored || 0);
            const remainingDeficit = Math.max(0, fief.monthly_consumption - currentFood);
            if (remainingDeficit <= 0) continue;

            // Find richest donor in the same señorío with surplus after their own consumption
            const donorResult = await client.query(`
                SELECT td.h3_index, td.food_stored,
                       td.food_stored - (FLOOR(td.population / 100.0) * 3) AS surplus
                FROM territory_details td
                JOIN h3_map m ON td.h3_index = m.h3_index
                WHERE td.division_id = $1
                  AND td.h3_index   != $2
                  AND m.player_id IS NOT NULL
                  AND td.food_stored > FLOOR(td.population / 100.0) * 3
                ORDER BY surplus DESC
                LIMIT 1
            `, [fief.division_id, fief.h3_index]);

            if (!donorResult.rows[0]) continue;

            const donor = donorResult.rows[0];
            const transfer = Math.min(remainingDeficit, parseFloat(donor.surplus));
            if (transfer <= 0) continue;

            await client.query(
                'UPDATE territory_details SET food_stored = food_stored - $1 WHERE h3_index = $2',
                [transfer, donor.h3_index]
            );
            await client.query(
                'UPDATE territory_details SET food_stored = food_stored + $1 WHERE h3_index = $2',
                [transfer, fief.h3_index]
            );
            transferCount++;
            Logger.engine(`[TURN ${turn}] Solidarity: ${donor.h3_index} → ${fief.h3_index} (${transfer.toFixed(1)} food)`);
        }

        if (transferCount > 0) {
            Logger.engine(`[TURN ${turn}] Señorío food solidarity: ${transferCount} transfer(s) completed`);
        }
    } catch (error) {
        Logger.error(error, { context: 'turn_engine.processSeñorioFoodSolidarity', turn });
        // Non-fatal: allow turn to continue
    }
}

async function processCivilFoodConsumption(client, turn) {
    try {
        await client.query(`
            UPDATE territory_details
            SET food_stored = GREATEST(0, food_stored - (FLOOR(population / 100.0) * 3))
            WHERE h3_index IN (SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL)
        `);
        Logger.engine(`[TURN ${turn}] Civil food consumption processed (monthly ×30)`);
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processCivilFoodConsumption',
            turn,
        });
        // Non-fatal: allow turn to continue
    }
}

/**
 * Process completed explorations
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processExplorations(client, turn, config) {
    // DISABLED: exploration temporarily disabled
    Logger.engine(`[TURN ${turn}] Explorations skipped (disabled)`);
    return;
    try { // eslint-disable-line no-unreachable
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

                // Generate notification for player
                const messageBody = discoveredResource === 'none'
                    ? `La exploración del territorio ${exploration.h3_index} ha finalizado.\n\n❌ No se encontraron recursos especiales en este territorio.`
                    : `¡La exploración del territorio ${exploration.h3_index} ha finalizado con éxito!\n\n✨ **Recurso descubierto**: ${discoveredResource.toUpperCase()}\n\nEste recurso estará disponible para su explotación.`;

                await NotificationService.createSystemNotification(exploration.player_id, 'Económico', messageBody, turn);

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
 * Process fief building construction ticks.
 * Decrements remaining_construction_turns each turn and completes buildings at 0.
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 */
async function processConstructionTicks(client, turn) {
    try {
        // Decrement all buildings under construction
        const decrementResult = await client.query(`
            UPDATE fief_buildings
            SET remaining_construction_turns = GREATEST(0, remaining_construction_turns - 1)
            WHERE is_under_construction = TRUE
            RETURNING h3_index, building_id, remaining_construction_turns
        `);

        if (decrementResult.rows.length === 0) return;

        // Complete buildings that have reached 0 turns remaining
        const completedResult = await client.query(`
            UPDATE fief_buildings
            SET is_under_construction = FALSE
            WHERE is_under_construction = TRUE AND remaining_construction_turns = 0
            RETURNING h3_index, building_id
        `);

        if (completedResult.rows.length === 0) {
            Logger.engine(`[TURN ${turn}] Construction ticks: ${decrementResult.rows.length} en curso`);
            return;
        }

        // Notify each affected human player
        for (const building of completedResult.rows) {
            try {
                const infoResult = await client.query(`
                    SELECT m.player_id, p.is_ai, b.name AS building_name
                    FROM h3_map m
                    JOIN players p ON p.player_id = m.player_id
                    JOIN fief_buildings fb ON fb.h3_index = m.h3_index
                    JOIN buildings b ON b.id = fb.building_id
                    WHERE fb.h3_index = $1 AND fb.building_id = $2
                `, [building.h3_index, building.building_id]);

                if (infoResult.rows.length > 0) {
                    const { player_id, is_ai, building_name } = infoResult.rows[0];
                    if (!is_ai) {
                        await NotificationService.createSystemNotification(
                            player_id,
                            'Económico',
                            `🏗️ Construcción completada\n\n"${building_name}" ha sido construido en el feudo ${building.h3_index} y ya está operativo.`,
                            turn
                        );
                    }
                    Logger.engine(`[TURN ${turn}] Edificio completado: "${building_name}" en ${building.h3_index} (player ${player_id})`);
                }
            } catch (notifError) {
                Logger.error(notifError, { context: 'processConstructionTicks.notify', h3_index: building.h3_index });
            }
        }

        Logger.engine(`[TURN ${turn}] Construction ticks: ${decrementResult.rows.length} en curso, ${completedResult.rows.length} completados`);
    } catch (error) {
        Logger.error(error, { context: 'turn_engine.processConstructionTicks', turn });
        // Don't throw — allow turn to continue
    }
}

/**
 * Process worker-initiated constructions (bridges, etc.).
 *
 * Each turn: increments progress_turns on every active_constructions row.
 * When progress_turns >= total_turns the construction is finished:
 *   1) DELETE from active_constructions  (remove the work order)
 *   2) INSERT into bridges               (permanent record)
 *   3) UPDATE h3_map.terrain_type_id     (change hex to 'Puente')
 *
 * Each completion runs inside its own SAVEPOINT so a failure on one bridge
 * does not abort the entire turn.
 *
 * @param {import('pg').PoolClient} client - active transaction client
 * @param {number} turn
 */
async function processWorkerConstructions(client, turn) {
    try {
        // Tick all active constructions and return updated rows in one round-trip
        const tickResult = await client.query(`
            UPDATE active_constructions
            SET progress_turns = progress_turns + 1
            RETURNING h3_index, type, progress_turns, total_turns, player_id
        `);

        if (tickResult.rows.length === 0) return;

        const completed = tickResult.rows.filter(r => r.progress_turns >= r.total_turns);
        const inProgress = tickResult.rows.length - completed.length;

        if (completed.length === 0) {
            Logger.engine(`[TURN ${turn}] Worker constructions: ${inProgress} en curso`);
            return;
        }

        // Complete each finished construction atomically (SAVEPOINT per bridge)
        for (const construction of completed) {
            const { h3_index, type, player_id } = construction;

            await client.query('SAVEPOINT worker_construction_complete');
            try {
                // Step 1: Remove the work order
                const deleteResult = await client.query(
                    'DELETE FROM active_constructions WHERE h3_index = $1',
                    [h3_index]
                );
                if (deleteResult.rowCount === 0) {
                    // Concurrent deletion (race guard) — skip silently
                    await client.query('RELEASE SAVEPOINT worker_construction_complete');
                    continue;
                }

                // Step 2: Persist in bridges table (idempotent)
                await client.query(
                    'INSERT INTO bridges (h3_index) VALUES ($1) ON CONFLICT (h3_index) DO NOTHING',
                    [h3_index]
                );

                // Step 3: Change terrain to Puente
                //   Uses name-based lookup so it works even if terrain_type_id changes.
                const updateResult = await client.query(`
                    UPDATE h3_map
                    SET terrain_type_id = (
                        SELECT terrain_type_id FROM terrain_types WHERE name = 'Puente' LIMIT 1
                    )
                    WHERE h3_index = $1
                `, [h3_index]);

                if (updateResult.rowCount === 0) {
                    // h3_index not in h3_map — data inconsistency, abort this bridge
                    throw new Error(`h3_index ${h3_index} no encontrado en h3_map — puente no aplicado`);
                }

                await client.query('RELEASE SAVEPOINT worker_construction_complete');

                // Notify the owning player (skip bots)
                try {
                    const playerResult = await client.query(
                        'SELECT is_ai FROM players WHERE player_id = $1',
                        [player_id]
                    );
                    if (playerResult.rows.length > 0 && !playerResult.rows[0].is_ai) {
                        await NotificationService.createSystemNotification(
                            player_id,
                            'Económico',
                            `🌉 Puente completado\n\nTus trabajadores han terminado la construcción del puente en ${h3_index}. El hexágono es ahora transitable.`,
                            turn
                        );
                    }
                } catch (notifErr) {
                    Logger.error(notifErr, { context: 'processWorkerConstructions.notify', h3_index });
                }

                Logger.engine(
                    `[TURN ${turn}] Puente completado: ${h3_index} (tipo ${type}, player ${player_id})`
                );

            } catch (bridgeErr) {
                await client.query('ROLLBACK TO SAVEPOINT worker_construction_complete');
                Logger.error(bridgeErr, { context: 'processWorkerConstructions', h3_index, turn });
            }
        }

        Logger.engine(
            `[TURN ${turn}] Worker constructions: ${inProgress} en curso, ${completed.length} completados`
        );
    } catch (err) {
        Logger.error(err, { context: 'processWorkerConstructions', turn });
        // Don't throw — allow turn to continue
    }
}

/**
 * Process passive stamina recovery for all armies
 * Also handles decrementing recovering counter and regenerating movement points
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processArmyRecovery(client, turn, config, movedArmyIds = new Set()) {
    try {
        Logger.engine(`[TURN ${turn}] Processing passive stamina recovery...`);

        // Get all armies (including battle recovery state for early-move penalty)
        const armiesResult = await client.query(`
            SELECT
                a.army_id,
                a.name,
                a.player_id,
                a.battle_recovery_turns_left,
                p.username
            FROM armies a
            JOIN players p ON a.player_id = p.player_id
        `);

        let recoveredCount = 0;
        let skippedCount = 0;
        let releasedCount = 0;
        let errorCount = 0;

        for (const army of armiesResult.rows) {
            try {
                // Armies that moved this turn do not recover stamina
                if (movedArmyIds.has(army.army_id)) {
                    skippedCount++;
                    Logger.army(army.army_id, 'STAMINA_SKIP', `Sin recuperación — el ejército se movió este turno`);

                    // Penalización por moverse antes de recuperarse de batalla
                    const turnsLeft = parseInt(army.battle_recovery_turns_left) || 0;
                    if (turnsLeft > 0) {
                        const M = GAME_CONFIG.MILITARY;
                        // -COMBAT_EARLY_MOVE_MORALE_PENALTY% de moral a todas las tropas
                        await client.query(
                            `UPDATE troops
                             SET morale = GREATEST(1, morale - $1)
                             WHERE army_id = $2`,
                            [M.COMBAT_EARLY_MOVE_MORALE_PENALTY, army.army_id]
                        );
                        // -COMBAT_EARLY_MOVE_TROOP_PENALTY% de tropas (abandona heridos)
                        const troops = await client.query(
                            'SELECT troop_id, quantity FROM troops WHERE army_id = $1',
                            [army.army_id]
                        );
                        for (const t of troops.rows) {
                            const lost = Math.ceil(t.quantity * (M.COMBAT_EARLY_MOVE_TROOP_PENALTY / 100));
                            const remaining = t.quantity - lost;
                            if (remaining <= 0) {
                                await client.query('DELETE FROM troops WHERE troop_id = $1', [t.troop_id]);
                            } else {
                                await client.query(
                                    'UPDATE troops SET quantity = $1 WHERE troop_id = $2',
                                    [remaining, t.troop_id]
                                );
                            }
                        }
                        // Cancelar recuperación rápida
                        await client.query(
                            `UPDATE armies SET battle_recovery_turns_left = 0, battle_recovery_rate = 0 WHERE army_id = $1`,
                            [army.army_id]
                        );
                        Logger.engine(`[TURN ${turn}] Army ${army.army_id} (${army.name}): penalización por abandono de heridos — -${M.COMBAT_EARLY_MOVE_MORALE_PENALTY}% moral, -${M.COMBAT_EARLY_MOVE_TROOP_PENALTY}% tropas`);
                    }
                } else {
                    // Process passive stamina recovery for this army
                    const result = await ArmySimulationService.processPassiveRecovery(army.army_id);

                    if (result.success) {
                        recoveredCount++;
                        if (result.releasedUnits && result.releasedUnits > 0) {
                            releasedCount += result.releasedUnits;
                            Logger.engine(`[TURN ${turn}] Army ${army.army_id} (${army.name}): ${result.releasedUnits} units released from force_rest`);
                        }
                    } else {
                        errorCount++;
                        Logger.error(new Error(result.message || 'Unknown recovery error'), {
                            context: 'turn_engine.processArmyRecovery',
                            phase: 'stamina_recovery',
                            turn: turn,
                            armyId: army.army_id
                        });
                    }
                }

            } catch (armyError) {
                errorCount++;
                Logger.error(armyError, {
                    context: 'turn_engine.processArmyRecovery',
                    phase: 'army_recovery',
                    turn: turn,
                    armyId: army.army_id
                });
                // Continue with other armies
            }
        }

        Logger.engine(`[TURN ${turn}] Army recovery completed: ${recoveredCount} recovered, ${skippedCount} skipped (moved), ${releasedCount} units released from force_rest, ${errorCount} errors`);
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processArmyRecovery',
            phase: 'global',
            turn: turn
        });
        // Don't throw - allow turn to continue
    }
}

/**
 * Process automatic army movements (armies moving toward their destination)
 * @param {Object} client - PostgreSQL client (within transaction)
 * @param {number} turn - Current turn number
 * @param {Object} config - Game configuration
 */
async function processArmyMovements(client, turn, config) {
    try {
        Logger.engine(`[TURN ${turn}] Processing automatic army movements...`);

        // Get all armies that have a destination set
        const armiesResult = await client.query(`
            SELECT
                a.army_id,
                a.name,
                a.player_id,
                a.h3_index,
                a.destination,
                a.recovering,
                p.username
            FROM armies a
            JOIN players p ON a.player_id = p.player_id
            WHERE a.destination IS NOT NULL
        `);

        let movedCount = 0;
        let arrivedCount = 0;
        let blockedCount = 0;
        let errorCount = 0;

        const movedArmyIds = new Set();

        for (const army of armiesResult.rows) {
            try {
                // Execute full movement turn for this army (multiple steps until PM exhausted)
                const result = await ArmySimulationService.executeArmyTurn(army.army_id);

                if (result.success && result.moved && result.arrived) {
                    arrivedCount++;
                    movedArmyIds.add(army.army_id);
                    Logger.engine(`[TURN ${turn}] Army ${army.army_id} (${army.name}) arrived at destination after ${result.stepsCount} steps`);
                } else if (result.success && result.moved) {
                    movedCount++;
                    movedArmyIds.add(army.army_id);
                    const exhaustedNote = result.forceExhausted ? ' [AGOTADO]' : '';
                    Logger.engine(`[TURN ${turn}] Army ${army.army_id} (${army.name}) moved ${result.stepsCount} step(s)${exhaustedNote}`);
                } else if (result.success && !result.moved) {
                    // Blocked by recovering, force_rest, or no PM
                    blockedCount++;
                } else {
                    errorCount++;
                    Logger.error(new Error(result.message || 'Unknown movement error'), {
                        context: 'turn_engine.processArmyMovements',
                        phase: 'army_movement',
                        turn: turn,
                        armyId: army.army_id
                    });
                }
            } catch (armyError) {
                errorCount++;
                Logger.error(armyError, {
                    context: 'turn_engine.processArmyMovements',
                    phase: 'army_movement',
                    turn: turn,
                    armyId: army.army_id
                });
                // Continue with other armies
            }
        }

        Logger.engine(`[TURN ${turn}] Army movements completed: ${movedCount} moved, ${arrivedCount} arrived, ${blockedCount} blocked, ${errorCount} errors`);
        return movedArmyIds;
    } catch (error) {
        Logger.error(error, {
            context: 'turn_engine.processArmyMovements',
            phase: 'global',
            turn: turn
        });
        // Don't throw - allow turn to continue
        return new Set();
    }
}

/**
 * Tick all action cooldowns: decrement by 1 and remove expired rows.
 * Runs inside the main turn transaction so the update is atomic.
 * @param {import('pg').PoolClient} client
 * @param {number} turn
 */
async function processActionCooldowns(client, turn) {
    try {
        await client.query(
            'UPDATE army_actions_cooldowns SET turns_remaining = turns_remaining - 1'
        );
        const { rowCount } = await client.query(
            'DELETE FROM army_actions_cooldowns WHERE turns_remaining <= 0'
        );
        Logger.engine(`[TURN ${turn}] Action cooldowns ticked: ${rowCount} expired and removed`);
    } catch (error) {
        Logger.error(error, { context: 'turn_engine.processActionCooldowns', turn });
        // Non-fatal: do not abort the turn for a cooldown failure
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
            RETURNING
                current_turn,
                days_per_year,
                EXTRACT(DAY   FROM game_date)::int AS day,
                EXTRACT(MONTH FROM game_date)::int AS month,
                CASE WHEN EXTRACT(YEAR FROM game_date) < 1
                     THEN -EXTRACT(YEAR FROM game_date)::int
                     ELSE  EXTRACT(YEAR FROM game_date)::int
                END AS year,
                CASE WHEN game_date < '0001-01-01' THEN 'BC' ELSE 'AD' END AS era
        `);
        const { current_turn: newTurn, days_per_year, day, month, year, era } = newState.rows[0];
        const newDate = { day, month, year, era };
        const dayOfYear = newTurn % (days_per_year || 365);

        Logger.engine(`[TURN ${newTurn}] Started processing - Date: ${newDate.day}/${newDate.month}/${newDate.year} ${newDate.era}`);

        // Civil food consumption now runs monthly (see below, dayOfMonth === 1)

        // Census and Production (every 30 turns)
        if (((newTurn - 1) % 30) === 0) {
            try {
                const territories = await client.query(`
                    SELECT td.*, t.name as terrain_type, m.player_id, p.capital_h3
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                    JOIN players p ON m.player_id = p.player_id
                    WHERE m.player_id IS NOT NULL
                `);

                let successCount = 0;
                let errorCount = 0;
                let starvationCount = 0;

                for (const t of territories.rows) {
                    try {
                        if (t.food_stored <= 0) {
                            // STARVATION: 5% population death, never below MIN_FIEF_POPULATION
                            const minPop = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;
                            await client.query(
                                'UPDATE territory_details SET population = GREATEST($1, FLOOR(population * 0.95)) WHERE h3_index = $2',
                                [minPop, t.h3_index]
                            );
                            starvationCount++;
                            Logger.engine(`[TURN ${newTurn}] STARVATION at ${t.h3_index} (player ${t.player_id}): pop ${t.population} → ${Math.max(minPop, Math.floor(t.population * 0.95))}`);

                            // Notify only if population actually dropped (it may already be at minimum)
                            const deaths = t.population - Math.max(minPop, Math.floor(t.population * 0.95));
                            if (deaths > 0) {
                                const noun = deaths === 1 ? 'habitante' : 'habitantes';
                                await NotificationService.createSystemNotification(
                                    t.player_id,
                                    'Hambre',
                                    `🚨 HAMBRUNA en ${t.h3_index}\n\nSin reservas de comida, la población ha descendido en ${deaths} ${noun} debido a la falta de suministros.\n\nAbastece el territorio urgentemente para detener la crisis.`,
                                    newTurn
                                );
                            }
                        } else {
                            // Normal census: 1% population growth, capped by terrain limit
                            const isCapital = t.h3_index === t.capital_h3;
                            const popCap = getPopulationCap(t.terrain_type, isCapital);
                            await client.query(
                                'UPDATE territory_details SET population = LEAST($1, FLOOR(population * 1.01)) WHERE h3_index = $2',
                                [popCap, t.h3_index]
                            );
                        }
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

                Logger.engine(`[TURN ${newTurn}] Census completed: ${successCount} territories updated (${starvationCount} in famine), ${errorCount} errors`);
            } catch (error) {
                Logger.error(error, {
                    context: 'turn_engine.processGameTurn',
                    phase: 'census',
                    turn: newTurn
                });
                // Continue processing
            }
        }

        // Grace turns decay: decrement occupation counters (every turn)
        await processGraceTurns(client, newTurn);

        // Building construction ticks (fief buildings: Cuartel, Mercado, etc.)
        await processConstructionTicks(client, newTurn);

        // Worker-initiated constructions (bridges, etc.)
        await processWorkerConstructions(client, newTurn);

        // Process completed explorations (every turn)
        await processExplorations(client, newTurn, config);

        // Army automatic movements (every turn, before consumption)
        // IMPORTANT: Must run BEFORE processMilitaryConsumption to avoid a deadlock.
        // processMilitaryConsumption holds row-level locks on armies (food_provisions UPDATE via T1).
        // executeArmyTurn opens its own transaction (T2) and tries to UPDATE armies.h3_index.
        // T2 would block waiting for T1's lock, while T1 awaits T2 in JS → application-level deadlock.
        const movedArmyIds = await processArmyMovements(client, newTurn, config);

        // Worker straight-line movements (every turn)
        await processWorkerMovements(client, newTurn);

        // Army passive stamina recovery (every turn, after movements)
        // Armies that moved this turn are excluded — no recovery if the hex changed.
        await processArmyRecovery(client, newTurn, config, movedArmyIds);

        // Action cooldowns tick (every turn)
        await processActionCooldowns(client, newTurn);

        // Character movement (3 hexes/turn toward destination)
        await CharacterService.processMovements();

        // Personal guard regeneration (+1/turno, máx 25) — fuera de transacción, usa pool propio
        await CharacterService.processGuardRegeneration();



        // Military food consumption (every turn, after movements so no lock conflict)
        await processMilitaryConsumption(client, newTurn, config);

        // Monthly production (day 1 of each month)
        // newDate = { day, month, year, era } — usar .day directamente (new Date(objeto) produce Invalid Date)
        const dayOfMonth = newDate.day;
        const gameDate = new Date(0);
        gameDate.setFullYear(newDate.year, newDate.month - 1, newDate.day);

        if (dayOfMonth === 1) {
            Logger.engine(`[TURN ${newTurn}] Monthly day (day 1 of month)`);
            await processSeñorioFoodSolidarity(client, newTurn);
            await processCivilFoodConsumption(client, newTurn);
            // Happiness calculated after all consumption (civil + military already ran this turn)
            await processHappiness(client, newTurn);
            await processMonthlyProduction(client, newTurn, config);
            await purgeOldNotifications(client, newTurn);
        }

        // Harvest logic (days 75 and 180 - Spring and Fall harvests)
        if (dayOfYear === 75 || dayOfYear === 180) {
            Logger.engine(`[TURN ${newTurn}] Harvest day (day ${dayOfYear} of year)`);
            await processHarvest(client, newTurn, config);
        }

        // Tax collection (day 10 of each game month only)
        // processTaxCollection has its own guards: day-of-month check + DB idempotency key
        const incomeByPlayer = await processTaxCollection(client, newTurn, gameDate);

        // Relation tributes: collected right after tax, same day 10 guard
        // Percentage tributes (devotio, clientela, rehenes, tributo) + fixed mercenario payments
        await processRelationTributes(client, newTurn, gameDate, incomeByPlayer);

        // Tithe system (day 10 of each game month, same as tax collection)
        // processTithe has its own guards: day-of-month check + DB idempotency key
        await processTithe(client, newTurn, gameDate);

        // Building decay (day 5 of each game month)
        await processBuildingDecay(client, newTurn, gameDate);

        // Character lifecycle: una vez por mes (idempotencia interna via game_config)
        await client.query('SAVEPOINT character_lifecycle');
        try {
            await processCharacterLifecycle(client, newTurn, newDate.month, newDate.year);
            await client.query('RELEASE SAVEPOINT character_lifecycle');
        } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT character_lifecycle');
            Logger.error(err, { context: 'turn_engine.characterLifecycle', turn: newTurn });
        }

        // Noble rank evaluation (día 25 de cada mes)
        if (dayOfMonth === 25) {
            await client.query('SAVEPOINT noble_ranks');
            try {
                await processNobleRanks(client, newTurn, newDate.month, newDate.year);
                await client.query('RELEASE SAVEPOINT noble_ranks');
            } catch (err) {
                await client.query('ROLLBACK TO SAVEPOINT noble_ranks');
                Logger.error(err, { context: 'turn_engine.nobleRanks', turn: newTurn });
            }
        }

        await client.query('COMMIT');

        // Daily cleanup: delete notifications older than 7 days (max once per calendar day)
        try {
            const today = new Date().toISOString().split('T')[0];
            const lastCleanup = await pool.query(
                `SELECT value FROM game_config WHERE "group" = 'system' AND key = 'last_notification_cleanup'`
            );
            if (!lastCleanup.rows[0] || lastCleanup.rows[0].value !== today) {
                const deleted = await pool.query(
                    `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '7 days'`
                );
                await pool.query(
                    `INSERT INTO game_config ("group", key, value) VALUES ('system', 'last_notification_cleanup', $1)
                     ON CONFLICT ("group", key) DO UPDATE SET value = $1`,
                    [today]
                );
                if (deleted.rowCount > 0) {
                    Logger.engine(`[CLEANUP] ${deleted.rowCount} notificaciones antiguas eliminadas`);
                }
            }
        } catch (err) {
            Logger.error(err, { context: 'turn_engine.notificationCleanup' });
        }

        // AI agent decision cycles (every 5 turns, outside the main transaction to avoid lock conflicts)
        if (newTurn % 5 === 0) {
            const AIManagerService = require('../services/AIManagerService');
            await AIManagerService.processAITurn(newTurn);
        }
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
let engineStartTime = null;
let _enginePool = null;
let _engineConfig = null;

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

    _enginePool = pool;
    _engineConfig = config;
    isEngineRunning = true;
    engineStartTime = new Date();
    Logger.engine('[ENGINE] Starting turn engine...');

    const run = async () => {
        try {
            const result = await processGameTurn(pool, config);
            if (result.paused) {
                // Game is paused, check again in 10 seconds
                timeoutId = setTimeout(run, 10000);
            } else if (result.success) {
                // Normal turn processing
                const interval = Math.max(2, config.gameplay?.turn_duration_seconds || 60) * 1000;
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
    engineStartTime = null;
    Logger.engine('[ENGINE] Turn engine stopped');
}

/**
 * Restart the engine using stored pool/config references.
 * Throws if engine was never initialized.
 */
function restartEngine() {
    if (!_enginePool || !_engineConfig) {
        throw new Error('Engine not initialized — pool/config not available. Call startTimeEngine first.');
    }
    startTimeEngine(_enginePool, _engineConfig);
}

/**
 * Check if engine is running
 * @returns {boolean}
 */
function isEngineActive() {
    return isEngineRunning;
}

/**
 * Return runtime info about the engine process.
 */
function getEngineInfo() {
    return {
        isRunning: isEngineRunning,
        startTime: engineStartTime,
        uptimeMs: engineStartTime ? Date.now() - engineStartTime.getTime() : 0,
    };
}

module.exports = {
    processGameTurn,
    startTimeEngine,
    stopTimeEngine,
    restartEngine,
    isEngineActive,
    getEngineInfo,
    processHarvestManually: processHarvest,
    processExplorationsManually: processExplorations,
    processMonthlyProductionManually: processMonthlyProduction,
    processMilitaryConsumptionManually: processMilitaryConsumption,
    processArmyRecoveryManually: processArmyRecovery,
    processArmyMovementsManually: processArmyMovements
};
