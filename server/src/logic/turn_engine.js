const { logEconomyEvent } = require('./economy');
const { auditEvent, TOPICS } = require('../infrastructure/kafkaFacade');
const { determineDiscoveredResource } = require('./discovery');
const { processTaxCollection, processRelationTributes } = require('./tax_collector');
const { processCharacterLifecycle } = require('./character_lifecycle');
const { processNobleRanks } = require('./noble_rank_system');
const { processTithe } = require('./tithe_system');
const { processBuildingDecay } = require('./building_decay');
const MarketModel = require('../models/MarketModel');
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

/** Formats an H3 index as "lat, lng (h3_index)" for player-facing notifications */
function fmtHex(h3_index) {
    const [lat, lng] = h3.cellToLatLng(h3_index);
    return `${lat.toFixed(3)}, ${lng.toFixed(3)} (${h3_index})`;
}

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

        // ── Pre-calcular: pagus con Mercado activo ────────────────────────────────
        // Un solo Mercado por pagus activa el bono; tener dos no añade efecto extra.
        const marketPagusResult = await client.query(`
            SELECT DISTINCT td.division_id
            FROM territory_details td
            JOIN fief_buildings fb ON fb.h3_index = td.h3_index
            JOIN buildings b ON b.id = fb.building_id
            WHERE b.name = 'Mercado'
              AND fb.is_under_construction = FALSE
              AND fb.conservation > 0
              AND td.division_id IS NOT NULL
        `);
        const pagusWithMarket = new Set(marketPagusResult.rows.map(r => r.division_id));

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
                let marketFamineBonusUsed = false; // True si algún feudo en hambruna usó bono de Mercado

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

                    // ── BONO DE MERCADO ───────────────────────────────────────────────────
                    // Si el pagus tiene al menos un Mercado activo:
                    //   · Feudo normal     → +3% producción de comida
                    //   · Feudo en hambruna → +15% producción de comida (penaliza oro al jugador)
                    // Tener dos Mercados en el mismo pagus no acumula bonificación.
                    if (territory.division_id && pagusWithMarket.has(territory.division_id)) {
                        if ((territory.food_stored || 0) <= 0) {
                            foodProduction = Math.floor(foodProduction * 1.15);
                            marketFamineBonusUsed = true;
                        } else {
                            foodProduction = Math.floor(foodProduction * 1.03);
                        }
                    }
                    // ─────────────────────────────────────────────────────────────────────

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

                // ── MERCADO: penalización de oro por hambruna ─────────────────────────
                // Si algún feudo en hambruna recibió el bono de emergencia del Mercado,
                // el jugador pierde el 15% de su oro total (coste de importar alimentos).
                let marketGoldPenalty = 0;
                if (marketFamineBonusUsed) {
                    const goldRow = await client.query(
                        'SELECT gold FROM players WHERE player_id = $1',
                        [player.player_id]
                    );
                    const currentGold = parseInt(goldRow.rows[0]?.gold) || 0;
                    marketGoldPenalty = Math.floor(currentGold * 0.15);
                    if (marketGoldPenalty > 0) {
                        await client.query(
                            'UPDATE players SET gold = GREATEST(0, gold - $1) WHERE player_id = $2',
                            [marketGoldPenalty, player.player_id]
                        );
                    }
                    Logger.engine(`[TURN ${turn}] 🏪 Mercado hambruna: −${marketGoldPenalty} oro para jugador ${player.player_id}`);
                }
                // ─────────────────────────────────────────────────────────────────────

                // Generate harvest notification
                const miracleSection = miracleHarvests.length > 0
                    ? `\n\n✨ **¡Cosecha milagrosa!**\n` +
                      `El tesón de vuestros labradores ante la penuria ha dado frutos inesperados:\n` +
                      miracleHarvests.map(m =>
                          `• ${fmtHex(m.h3_index)}: ×${m.multiplier.toFixed(2)} (+${m.bonus} comida extra)`
                      ).join('\n')
                    : '';

                const marketSection = marketFamineBonusUsed
                    ? `\n\n🏪 **Mercado — Abastecimiento de urgencia**\n` +
                      `Las reservas del mercado han aliviado la penuria en los feudos más afectados (+15%).\n` +
                      `• Coste de importación: −${marketGoldPenalty.toLocaleString('es-ES')} oro (15% del tesoro)`
                    : '';

                const messageBody = `
📜 **Informe de cosecha del reino**

🌾 **Rendimiento de los feudos:**
• Comida: +${totalFoodProduced}
• Oro: +${totalGoldProduced}

⚔️ **Manutención de las huestes:**
• Comida: -${totalFoodConsumption}
• Oro: -${totalGoldConsumption}

⚖️ **Balance neto:**
• Comida: ${netFood >= 0 ? '+' : ''}${netFood}
• Oro: ${netGold >= 0 ? '+' : ''}${netGold}

${territories.rows.length > 0 ? `Feudos productivos este ciclo: ${territories.rows.length}` : '⚠️ Ningún feudo ha rendido frutos este ciclo'}${miracleSection}${marketSection}
                `.trim();

                await NotificationService.createSystemNotification(player.player_id, 'Económico', messageBody, turn);

                // Soldadas notification
                if (totalGoldConsumption > 0) {
                    const soldadasBody = `⚔️ **Pago de soldadas**\n\nLos recaudadores han distribuido el jornal entre vuestras huestes.\n• Tropas en nómina: ${totalTroops}\n• Plata entregada: -${totalGoldConsumption} 💰`;
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
    try {
        Logger.engine(`[TURN ${turn}] Processing military food consumption...`);

        // ── PASO 1: Descontar de provisions del ejército ──────────────────────
        // Una sola query bulk: calcula consumo de cada ejército y descuenta de provisions.
        // Devuelve los ejércitos con déficit (consumo > provisions disponibles).
        const armyUpdateResult = await client.query(`
            WITH consumption AS (
                SELECT
                    a.army_id,
                    a.player_id,
                    a.h3_index,
                    a.food_provisions,
                    COALESCE(SUM(t.quantity * ut.food_consumption * 0.001), 0) AS total_consumption
                FROM armies a
                LEFT JOIN troops t       ON t.army_id        = a.army_id
                LEFT JOIN unit_types ut  ON ut.unit_type_id  = t.unit_type_id
                WHERE a.h3_index IS NOT NULL
                GROUP BY a.army_id, a.player_id, a.h3_index, a.food_provisions
                HAVING COALESCE(SUM(t.quantity * ut.food_consumption * 0.001), 0) > 0
            ),
            updated AS (
                UPDATE armies a
                SET food_provisions = GREATEST(0, a.food_provisions - c.total_consumption)
                FROM consumption c
                WHERE a.army_id = c.army_id
                RETURNING c.army_id, c.player_id, c.h3_index, c.total_consumption, c.food_provisions
            )
            SELECT
                army_id,
                player_id,
                h3_index,
                total_consumption,
                food_provisions,
                GREATEST(0, total_consumption - food_provisions) AS fief_deficit
            FROM updated
        `);

        const totalArmies = armyUpdateResult.rows.length;
        const withDeficit  = armyUpdateResult.rows.filter(r => parseFloat(r.fief_deficit) > 0);

        // ── PASO 2: Descontar déficit del feudo (solo si el feudo pertenece al jugador) ──
        // Una sola query: unnest hex+player+deficit, JOIN con h3_map para validar ownership.
        if (withDeficit.length > 0) {
            const hexes     = withDeficit.map(r => r.h3_index);
            const playerIds = withDeficit.map(r => r.player_id);
            const deficits  = withDeficit.map(r => parseFloat(r.fief_deficit));

            await client.query(`
                UPDATE territory_details td
                SET food_stored = GREATEST(0, td.food_stored - agg.total_deficit)
                FROM (
                    SELECT v.h3_index, SUM(v.deficit) AS total_deficit
                    FROM (
                        SELECT unnest($1::text[])    AS h3_index,
                               unnest($2::int[])     AS player_id,
                               unnest($3::float[])   AS deficit
                    ) v
                    -- Solo descuenta si el feudo pertenece al jugador del ejército
                    JOIN h3_map m ON m.h3_index = v.h3_index AND m.player_id = v.player_id
                    GROUP BY v.h3_index
                ) agg
                WHERE td.h3_index = agg.h3_index
            `, [hexes, playerIds, deficits]);
        }

        Logger.engine(`[TURN ${turn}] Military consumption completed: ${totalArmies} armies, ${withDeficit.length} with fief deficit`);

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
                    ? `🗺️ **Exploración concluida — ${fmtHex(exploration.h3_index)}**\n\nVuestros exploradores han recorrido cada palmo del territorio. Los informes son desalentadores: la tierra no guarda riquezas ocultas.`
                    : `🗺️ **¡Hallazgo en ${fmtHex(exploration.h3_index)}!**\n\nVuestros exploradores han desvelado los secretos del territorio. Bajo la superficie aguarda: **${discoveredResource.toUpperCase()}**\n\nEl recurso está listo para su explotación.`;

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
/**
 * Irradia cultura mensualmente desde los templos completados.
 * Rings 0-4 con bonus decreciente (CULTURE_TEMPLE_RINGS).
 * Solo afecta hexes colonizados (player_id IS NOT NULL).
 */
async function processCultureRadiation(client, turn) {
    try {
        const CULTURE_COL = {
            1: 'culture_romanos',
            2: 'culture_cartagineses',
            3: 'culture_iberos',
            4: 'culture_celtas',
        };
        const ALL_COLS   = Object.values(CULTURE_COL);
        const RING_BONUS = GAME_CONFIG.MILITARY.CULTURE_TEMPLE_RINGS;
        const MAX_RING   = RING_BONUS.length - 1;  // 4

        const templesRes = await client.query(`
            SELECT fb.h3_index, b.culture_id
            FROM fief_buildings fb
            JOIN buildings b ON b.id = fb.building_id
            JOIN building_types bt ON bt.building_type_id = b.type_id
            WHERE bt.name = 'religious'
              AND fb.is_under_construction = FALSE
              AND fb.conservation > 20
              AND b.culture_id IS NOT NULL
        `);

        if (templesRes.rows.length === 0) return;

        for (const temple of templesRes.rows) {
            const col = CULTURE_COL[temple.culture_id];
            if (!col) continue;

            // Construir mapa hex → bonus acumulado (un hex puede estar en varios radios si hay varios templos)
            const hexBonus = new Map();
            const allDisk  = h3.gridDisk(temple.h3_index, MAX_RING);
            for (const hex of allDisk) {
                const dist = h3.gridDistance(temple.h3_index, hex);
                const bonus = RING_BONUS[dist] ?? 0;
                if (bonus > 0) hexBonus.set(hex, (hexBonus.get(hex) || 0) + bonus);
            }

            // Agrupar por valor de bonus para minimizar queries
            const byBonus = new Map();
            for (const [hex, bonus] of hexBonus) {
                if (!byBonus.has(bonus)) byBonus.set(bonus, []);
                byBonus.get(bonus).push(hex);
            }

            const otherCols = ALL_COLS.filter(c => c !== col);
            const decaySet  = otherCols.map(c => `${c} = GREATEST(0, fief_culture.${c} - 1)`).join(', ');

            for (const [bonus, hexes] of byBonus) {
                await client.query(`
                    INSERT INTO fief_culture (h3_index, ${col}, updated_at)
                    SELECT h.h3_index, $1, NOW()
                    FROM h3_map h
                    WHERE h.h3_index = ANY($2)
                      AND h.player_id IS NOT NULL
                    ON CONFLICT (h3_index) DO UPDATE
                    SET ${col}     = LEAST($3, fief_culture.${col} + $1),
                        ${decaySet},
                        updated_at = NOW()
                `, [bonus, hexes, GAME_CONFIG.MILITARY.CULTURE_MAX]);
            }
        }

        Logger.engine(`[TURN ${turn}] Cultura irradiada (mensual) desde ${templesRes.rows.length} templos.`);
    } catch (err) {
        Logger.error(err, { context: 'processCultureRadiation', turn });
    }
}

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
                            `🏛️ **Obra concluida**\n\nLos maestros de obras anuncian que **"${building_name}"** está en pie en el feudo ${fmtHex(building.h3_index)} y listo para servir al reino.`,
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
                            `🌉 **El puente está en pie**\n\nVuestros trabajadores han concluido la obra en ${fmtHex(h3_index)}. El paso está abierto y los ejércitos pueden cruzar sin demora.`,
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

function _cancelBridgeMsg(coords) {
    const templates = [
        `🌊 **Los trabajos han sido abandonados**\n\nVuestras fuerzas se han retirado de la ribera en ${coords} sin concluir la demolición. El puente permanece en pie y el paso sigue abierto.`,
        `⚠️ **La demolición ha fracasado por falta de tropas**\n\nSin un ejército suficiente que sostenga los trabajos junto al puente en ${coords}, los cimientos han quedado intactos. Returned el lugar con fuerzas bastantes para retomar la tarea.`,
        `🏚️ **El ímpetu se ha apagado**\n\nQuienes comenzaron la demolición del puente en ${coords} se han dispersado antes de completar su obra. La estructura resiste, y con ella, el acceso del enemigo.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

function _completeBridgeMsg(coords) {
    const templates = [
        `💥 **El puente ha caído**\n\nVuestros hombres han consumado la destrucción del puente en ${coords}. Las aguas corren libres y el paso queda sellado para quien ose cruzar.`,
        `🌊 **Victoria sobre la piedra**\n\nTras largas jornadas de trabajo, el puente en ${coords} ha sido reducido a escombros arrastrados por la corriente. Solo quien domine el río podrá cruzar este vado.`,
        `⚔️ **La obra de demolición ha concluido**\n\nEl último bloque del puente en ${coords} ha cedido ante el esfuerzo de vuestras tropas. El río vuelve a ser un obstáculo natural para vuestros enemigos.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Procesa las demoliciones de puentes activas.
 * - Si el jugador no tiene ejército con 1000+ tropas adyacente, cancela la orden.
 * - Si el contador llega a 0, destruye el puente y vuelve el hexágono a terreno Río.
 */
async function processBridgeDestructions(client, turn) {
    try {
        const activeRes = await client.query('SELECT * FROM bridge_destructions');
        if (activeRes.rows.length === 0) return;

        for (const bd of activeRes.rows) {
            try {
                const vicinity = h3.gridDisk(bd.h3_index, 1); // incluye el hex del puente
                const armyRes = await client.query(`
                    SELECT a.army_id
                    FROM armies a
                    JOIN (SELECT army_id, SUM(quantity)::int AS total FROM troops GROUP BY army_id) t
                         ON t.army_id = a.army_id
                    WHERE a.h3_index = ANY($1::text[])
                      AND a.player_id = $2
                      AND t.total >= 1000
                      AND NOT a.is_garrison
                    LIMIT 1
                `, [vicinity, bd.player_id]);

                if (armyRes.rows.length === 0) {
                    // Army moved away — cancel
                    await client.query('DELETE FROM bridge_destructions WHERE h3_index = $1', [bd.h3_index]);
                    const cancelMsg = _cancelBridgeMsg(fmtHex(bd.h3_index));
                    await NotificationService.createSystemNotification(bd.player_id, 'Militar', cancelMsg, turn);
                    Logger.engine(`[TURN ${turn}] Demolición de puente cancelada: ${bd.h3_index} (jugador ${bd.player_id}, sin ejército adyacente)`);
                    continue;
                }

                if (bd.turns_remaining <= 1) {
                    // Displace armies standing ON the bridge before terrain changes
                    const armiesOnBridge = await client.query(
                        'SELECT army_id, player_id FROM armies WHERE h3_index = $1',
                        [bd.h3_index]
                    );
                    if (armiesOnBridge.rows.length > 0) {
                        const ring = h3.gridDisk(bd.h3_index, 1).filter(n => n !== bd.h3_index);
                        const landRes = await client.query(`
                            SELECT h3_index FROM h3_map
                            WHERE h3_index = ANY($1::text[])
                              AND terrain_type_id NOT IN (1, 4, 15)
                            ORDER BY RANDOM()
                            LIMIT 1
                        `, [ring]);

                        if (landRes.rows.length > 0) {
                            const landingHex = landRes.rows[0].h3_index;
                            await client.query(
                                'UPDATE armies SET h3_index = $1 WHERE h3_index = $2',
                                [landingHex, bd.h3_index]
                            );
                            const affectedPlayerIds = [...new Set(armiesOnBridge.rows.map(a => a.player_id))];
                            for (const pid of affectedPlayerIds) {
                                await NotificationService.createSystemNotification(
                                    pid, 'Militar',
                                    `⚠️ **Retirada forzosa del puente**\n\nEl puente en ${fmtHex(bd.h3_index)} ha cedido bajo vuestras tropas. Las huestes se han replegado al feudo más cercano en tierra firme.`,
                                    turn
                                );
                            }
                            Logger.engine(`[TURN ${turn}] Ejércitos sobre el puente ${bd.h3_index} desplazados a ${landingHex}`);
                        } else {
                            // No adjacent land — displace to ring 2
                            const ring2 = h3.gridDisk(bd.h3_index, 2).filter(n => n !== bd.h3_index && !ring.includes(n));
                            const landRes2 = await client.query(`
                                SELECT h3_index FROM h3_map
                                WHERE h3_index = ANY($1::text[])
                                  AND terrain_type_id NOT IN (1, 4, 15)
                                ORDER BY RANDOM()
                                LIMIT 1
                            `, [ring2]);
                            if (landRes2.rows.length > 0) {
                                const landingHex = landRes2.rows[0].h3_index;
                                await client.query(
                                    'UPDATE armies SET h3_index = $1 WHERE h3_index = $2',
                                    [landingHex, bd.h3_index]
                                );
                                Logger.engine(`[TURN ${turn}] Ejércitos sobre el puente ${bd.h3_index} desplazados a ${landingHex} (ring 2)`);
                            } else {
                                Logger.engine(`[TURN ${turn}] WARN: no se encontró feudo de tierra para desplazar ejércitos del puente ${bd.h3_index}`);
                            }
                        }
                    }

                    // Destruction complete
                    await client.query('DELETE FROM bridge_destructions WHERE h3_index = $1', [bd.h3_index]);
                    await client.query('DELETE FROM bridges WHERE h3_index = $1', [bd.h3_index]);
                    await client.query(`
                        UPDATE h3_map
                        SET terrain_type_id = (SELECT terrain_type_id FROM terrain_types WHERE name = 'Río' LIMIT 1)
                        WHERE h3_index = $1
                    `, [bd.h3_index]);
                    const completeMsg = _completeBridgeMsg(fmtHex(bd.h3_index));
                    await NotificationService.createSystemNotification(bd.player_id, 'Militar', completeMsg, turn);
                    Logger.engine(`[TURN ${turn}] Puente destruido: ${bd.h3_index} (jugador ${bd.player_id})`);
                } else {
                    await client.query(
                        'UPDATE bridge_destructions SET turns_remaining = turns_remaining - 1 WHERE h3_index = $1',
                        [bd.h3_index]
                    );
                }
            } catch (innerErr) {
                Logger.error(innerErr, { context: 'processBridgeDestructions.bridge', h3_index: bd.h3_index, turn });
            }
        }
    } catch (err) {
        Logger.error(err, { context: 'processBridgeDestructions', turn });
    }
}

/**
 * Procesa intentos de escape de personajes cautivos (2% por turno)
 * y decrementa el cooldown de captura.
 */
async function processCaptiveEscapes(client, turn) {
    const NotificationService = require('../services/NotificationService');
    const CharacterModel      = require('../models/CharacterModel');

    try {
        // Decrementar cooldowns de captura
        await CharacterModel.decrementCaptureCooldowns(client);

        // Obtener cautivos no encarcelados
        const captives = await CharacterModel.getAllCaptives(client);
        let escapedCount = 0;

        for (const captive of captives) {
            if (Math.random() > 0.02) continue; // 2% de escape

            // Escape exitoso
            await CharacterModel.flee(client, captive.id, captive.capital_h3);
            escapedCount++;

            Logger.engine(`[TURN ${turn}] Escape: ${captive.name} (id=${captive.id}) huye del cautiverio`);

            await NotificationService.createSystemNotification(
                captive.player_id, 'Militar',
                `🏃 **${captive.name} ha escapado del cautiverio**\n\nVuestro vasallo ha burlado la vigilancia del enemigo y regresa a vuestra capital.`,
                turn
            );

            // Notificar al captor (si el ejército aún existe y tiene jugador)
            if (captive.captured_by_army_id) {
                const captorResult = await client.query(
                    'SELECT player_id FROM armies WHERE army_id = $1',
                    [captive.captured_by_army_id]
                );
                const captorId = captorResult.rows[0]?.player_id;
                if (captorId) {
                    await NotificationService.createSystemNotification(
                        captorId, 'Militar',
                        `🏃 **${captive.name} ha huido**\n\nEl prisionero ha logrado escabullirse de vuestro ejército. Las cadenas no siempre retienen a los hombres resueltos.`,
                        turn
                    );
                }
            }
        }

        if (captives.length > 0) {
            Logger.engine(`[TURN ${turn}] Captive escapes: ${escapedCount}/${captives.length} escaped`);
        }
    } catch (err) {
        Logger.error(err, { context: 'turn_engine.processCaptiveEscapes', turn });
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
                a.h3_index,
                a.battle_recovery_turns_left,
                p.username,
                EXISTS (
                    SELECT 1 FROM characters c
                    WHERE c.army_id = a.army_id AND c.age >= 16
                ) AS has_character,
                (m.player_id = a.player_id) AS in_own_fief
            FROM armies a
            JOIN players p ON a.player_id = p.player_id
            LEFT JOIN h3_map m ON m.h3_index = a.h3_index
            WHERE a.is_naval = FALSE
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

                    // Moral pasiva: feudo propio +1/turno
                    if (army.in_own_fief) {
                        await client.query(
                            `UPDATE troops SET morale = LEAST(100, morale + 1) WHERE army_id = $1`,
                            [army.army_id]
                        );
                    }

                    // Moral pasiva: personaje presente +5/mes (cada 30 turnos)
                    if (army.has_character && (turn % 30) === 0) {
                        await client.query(
                            `UPDATE troops SET morale = LEAST(100, morale + 5) WHERE army_id = $1`,
                            [army.army_id]
                        );
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
    // Activar flag de procesamiento (fuera de transacción para que sea visible inmediatamente)
    await pool.query('UPDATE world_state SET is_processing = TRUE WHERE id = 1');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if game is paused
        const pauseCheck = await client.query('SELECT is_paused FROM world_state WHERE id = 1');
        if (pauseCheck.rows[0]?.is_paused === true) {
            await client.query('ROLLBACK');
            await pool.query('UPDATE world_state SET is_processing = FALSE WHERE id = 1');
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
                                    `🚨 **Hambruna en ${fmtHex(t.h3_index)}**\n\nLas arcas de grano están vacías y el pueblo pasa hambre. ${deaths} ${noun} han perecido por falta de alimento.\n\nAbasteced el territorio antes de que el silencio se extienda.`,
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

        // Culture radiation from temples (monthly — day 1 of each month)
        if (day === 1) await processCultureRadiation(client, newTurn);

        // Grace turns decay: decrement occupation counters (every turn)
        await processGraceTurns(client, newTurn);

        // Building construction ticks (fief buildings: Cuartel, Mercado, etc.)
        await processConstructionTicks(client, newTurn);

        // Worker-initiated constructions (bridges, etc.)
        await processWorkerConstructions(client, newTurn);

        // Bridge destruction orders (demolición de puentes)
        await client.query('SAVEPOINT bridge_destructions');
        try {
            await processBridgeDestructions(client, newTurn);
            await client.query('RELEASE SAVEPOINT bridge_destructions');
        } catch (bridgeErr) {
            await client.query('ROLLBACK TO SAVEPOINT bridge_destructions');
            Logger.error(bridgeErr, { context: 'processGameTurn.bridge_destructions', turn: newTurn });
        }

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

        // Captive escape attempts (2%/turno) y decremento de capture_cooldown
        await processCaptiveEscapes(client, newTurn);

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
            // Renovación/expiración de accesos de mercado
            try {
                const { renewed, expired, renewedList, expiredList } = await MarketModel.ProcessMonthlyAccessRenewals(client);
                if (renewed + expired > 0) {
                    Logger.engine(`[TURN ${newTurn}] Accesos de mercado: ${renewed} renovados, ${expired} expirados`);
                }
                for (const r of renewedList) {
                    await NotificationService.createSystemNotification(
                        r.player_id,
                        'Económico',
                        `⛏️ **Canteras de piedra — Acceso renovado**\n\nLos maestros canteros han renovado su acuerdo con vuestro tesoro. Se han deducido ${r.cost.toLocaleString('es-ES')} 💰. Vuestros edificios seguirán siendo reparados durante el próximo ciclo.`,
                        newTurn
                    );
                }
                for (const e of expiredList) {
                    await NotificationService.createSystemNotification(
                        e.player_id,
                        'Económico',
                        `⚠️ **Canteras de piedra — Acceso cancelado**\n\nVuestro tesoro no ha podido hacer frente al pago de los canteros. Los obreros han abandonado los trabajos y vuestros edificios volverán a deteriorarse. Acudid al Mercado para retomar el acuerdo.`,
                        newTurn
                    );
                }
            } catch (err) {
                Logger.error(err, { context: 'turn_engine.processMonthlyAccessRenewals', turn: newTurn });
            }
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
        // Desactivar flag siempre, incluso si hubo error
        await pool.query('UPDATE world_state SET is_processing = FALSE WHERE id = 1').catch(() => {});
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
