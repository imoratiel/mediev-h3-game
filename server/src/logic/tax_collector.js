const { Logger } = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const { auditEvent, TOPICS } = require('../infrastructure/kafkaFacade');

/**
 * Recauda impuestos sobre el oro almacenado en cada feudo de cada jugador activo.
 *
 * Solo se ejecuta el día 10 de cada mes del calendario de juego.
 * Incluye doble seguridad: comprueba la fecha recibida Y un registro en game_config
 * para evitar doble ejecución si el servidor se reinicia el mismo día 10.
 *
 * Debe llamarse DENTRO de una transacción activa (el client ya tiene BEGIN).
 *
 * @param {Object} client   - Cliente PostgreSQL (dentro de transacción)
 * @param {number} turn     - Turno actual (para logs y notificaciones)
 * @param {Date}   gameDate - Fecha actual del calendario de juego
 */
/**
 * @returns {Promise<Map<number,number>>} Mapa playerId → oro recaudado este mes.
 *   Se usa en processRelationTributes para calcular tributos sobre los ingresos reales.
 */
async function processTaxCollection(client, turn, gameDate) {
    /** @type {Map<number,number>} */
    const incomeByPlayer = new Map();
    // ── Safety check 1: solo el día 10 del mes del calendario de juego ──────
    const gd = new Date(gameDate);
    const dayOfMonth = gd.getDate();
    if (dayOfMonth !== 10) {
        Logger.engine(`[TURN ${turn}] Tax collection skipped (game day ${dayOfMonth}, only runs on day 10)`);
        return;
    }

    // ── Safety check 2: evitar doble ejecución en caso de reinicio del servidor ──
    // Clave: "YYYY-MM" del calendario de juego
    const gameYearMonth = `${gd.getFullYear()}-${String(gd.getMonth() + 1).padStart(2, '0')}`;

    const lastRunResult = await client.query(
        `SELECT value FROM game_config WHERE "group" = 'system' AND key = 'last_tax_collection_month'`
    );
    const lastRunMonth = lastRunResult.rows[0]?.value ?? null;

    if (lastRunMonth === gameYearMonth) {
        Logger.engine(`[TURN ${turn}] Tax collection skipped (already collected for game month ${gameYearMonth})`);
        return;
    }

    Logger.engine(`[TURN ${turn}] Tax collection started — game month ${gameYearMonth}`);

    try {
        // Only players who actually own territories (active players)
        const playersResult = await client.query(`
            SELECT DISTINCT p.player_id, p.username,
                            COALESCE(p.tax_percentage, 10) AS tax_percentage
            FROM players p
            JOIN h3_map m ON p.player_id = m.player_id
            WHERE m.player_id IS NOT NULL
        `);

        let totalPlayers = 0;
        let totalGoldCollected = 0;

        for (const player of playersResult.rows) {
            const taxRate = Math.min(100, Math.max(0, parseFloat(player.tax_percentage)));
            try {
                // Fetch all territories for this player with gold stock and division tax rate.
                // Fiefs in a pagus use pd.tax_rate; fiefs without a pagus are tax-exempt (rate 0).
                const territoriesResult = await client.query(`
                    SELECT td.h3_index, td.gold_stored,
                           COALESCE(pd.tax_rate, 0) AS effective_tax_rate
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    LEFT JOIN political_divisions pd ON td.division_id = pd.id
                    WHERE m.player_id = $1
                `, [player.player_id]);

                if (territoriesResult.rows.length === 0) continue;

                let playerGoldCollected = 0;

                for (const territory of territoriesResult.rows) {
                    const goldStock      = parseFloat(territory.gold_stored) || 0;
                    if (goldStock <= 0) continue;
                    const effectiveRate  = Math.min(100, Math.max(0, parseFloat(territory.effective_tax_rate)));

                    // FLOOR to avoid decimal issues in INTEGER columns.
                    // Clamped to goldStock so the fief can never go negative.
                    const taxAmount = Math.min(goldStock, Math.floor(goldStock * effectiveRate / 100));
                    if (taxAmount <= 0) continue;

                    // Deduct from fief storehouse
                    await client.query(
                        'UPDATE territory_details SET gold_stored = gold_stored - $1 WHERE h3_index = $2',
                        [taxAmount, territory.h3_index]
                    );

                    playerGoldCollected += taxAmount;
                }

                if (playerGoldCollected <= 0) continue;

                // Add collected gold to player's global treasury
                await client.query(
                    'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                    [playerGoldCollected, player.player_id]
                );

                // Notification for this player
                const taxableFiefs = territoriesResult.rows.filter(r => parseFloat(r.effective_tax_rate) > 0).length;
                const messageBody = [
                    `💰 **Recaudación Fiscal — Turno ${turn}**`,
                    ``,
                    `Centurias tributarias (en un Pagus): ${taxableFiefs} de ${territoriesResult.rows.length}`,
                    ``,
                    `Oro recaudado e ingresado al tesoro real: **+${playerGoldCollected} 💰**`,
                ].join('\n');

                await NotificationService.createSystemNotification(
                    player.player_id,
                    'Impuestos',
                    messageBody,
                    turn
                );

                Logger.engine(`[TURN ${turn}] Tax collected from player ${player.player_id} (${player.username}): ${playerGoldCollected} gold (${taxRate}% of fief stocks)`);
                auditEvent('TAX_COLLECTION', {
                    player_id: player.player_id,
                    amount:    playerGoldCollected,
                    tax_rate:  taxRate,
                    turn,
                }, TOPICS.TAX);
                incomeByPlayer.set(player.player_id, playerGoldCollected);
                totalGoldCollected += playerGoldCollected;
                totalPlayers++;

            } catch (playerError) {
                // Resilient: log and continue with next player
                Logger.error(playerError, {
                    context: 'tax_collector.processTaxCollection',
                    phase: 'player_tax',
                    turn,
                    playerId: player.player_id
                });
            }
        }

        // ── Mark this month as collected (prevents double-execution on restart) ──
        await client.query(
            `INSERT INTO game_config ("group", "key", "value")
             VALUES ('system', 'last_tax_collection_month', $1)
             ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value`,
            [gameYearMonth]
        );

        Logger.engine(`[TURN ${turn}] Tax collection completed: ${totalPlayers} players, ${totalGoldCollected} total gold collected. Recorded month ${gameYearMonth}.`);
        return incomeByPlayer;

    } catch (error) {
        Logger.error(error, {
            context: 'tax_collector.processTaxCollection',
            phase: 'global',
            turn
        });
        throw error; // Bubble up so the turn engine can rollback
    }
}

/**
 * Procesa los tributos de relaciones políticas el día 10 de cada mes.
 * Se llama justo después de processTaxCollection, recibiendo el mapa de ingresos.
 *
 * Cubre:
 *  - Tributos porcentuales (devotio 5%, clientela 10%, rehenes 2%, tributo 5-10%)
 *  - Pagos fijos mensuales de mercenariado
 *  - Expiración de relaciones con expires_at_turn <= currentTurn
 *
 * @param {object}          client        - pg client dentro de transacción
 * @param {number}          turn          - turno actual
 * @param {Date}            gameDate      - fecha actual del juego
 * @param {Map<number,number>} incomeByPlayer - oro recaudado por jugador este mes
 */
async function processRelationTributes(client, turn, gameDate, incomeByPlayer) {
    // ── Guard: solo el día 10 del mes (mismo que tax collection) ──────────
    const gd = new Date(gameDate);
    if (gd.getDate() !== 10) return;

    // ── Guard: idempotencia ────────────────────────────────────────────────
    const gYM = `${gd.getFullYear()}-${String(gd.getMonth() + 1).padStart(2, '0')}`;
    const lastRun = await client.query(
        `SELECT value FROM game_config WHERE "group" = 'system' AND key = 'last_tribute_month'`
    );
    if (lastRun.rows[0]?.value === gYM) {
        Logger.engine(`[TURN ${turn}] Relation tributes skipped (already collected for ${gYM})`);
        return;
    }

    Logger.engine(`[TURN ${turn}] Processing relation tributes — game month ${gYM}`);

    const RelationModel = require('../models/RelationModel.js');

    // ── 1. Tributos porcentuales ───────────────────────────────────────────
    const tributeRelations = await RelationModel.getActiveTributeRelations(client);
    for (const rel of tributeRelations) {
        try {
            const income = incomeByPlayer.get(rel.from_player_id) ?? 0;
            if (income <= 0) continue;

            const amount = Math.floor(income * parseFloat(rel.effective_rate));
            if (amount <= 0) continue;

            // Verificar que el pagador tiene suficiente oro
            const { rows: pg } = await client.query(
                'SELECT gold FROM players WHERE player_id = $1', [rel.from_player_id]
            );
            const payerGold = pg[0]?.gold ?? 0;
            const actualAmount = Math.min(amount, payerGold);
            if (actualAmount <= 0) continue;

            await client.query(
                'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                [actualAmount, rel.from_player_id]
            );
            await client.query(
                'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                [actualAmount, rel.to_player_id]
            );

            await RelationModel.logEvent(client, {
                relation_id:     rel.relation_id,
                event_type:      'tribute_paid',
                actor_player_id: rel.from_player_id,
                amount:          actualAmount,
                turn_number:     turn,
                details:         { rate: rel.effective_rate, income },
            });

            Logger.engine(`[TURN ${turn}] Tribute: player ${rel.from_player_id} → ${rel.to_player_id}: ${actualAmount} gold (${rel.code})`);
        } catch (e) {
            Logger.error(e, { context: 'processRelationTributes', phase: 'percentage', relation_id: rel.relation_id });
        }
    }

    // ── 2. Pagos fijos de mercenariado ────────────────────────────────────
    const mercenaryContracts = await RelationModel.getActiveMercenaryContracts(client);
    for (const rel of mercenaryContracts) {
        try {
            const pay = parseInt(rel.terms_fixed_pay);
            const { rows: pg } = await client.query(
                'SELECT gold FROM players WHERE player_id = $1', [rel.from_player_id]
            );
            const payerGold = pg[0]?.gold ?? 0;

            if (payerGold < pay) {
                // Impago: romper el contrato
                await RelationModel.end(client, rel.relation_id, 'non_payment');
                await RelationModel.logEvent(client, {
                    relation_id:     rel.relation_id,
                    event_type:      'non_payment',
                    actor_player_id: rel.from_player_id,
                    turn_number:     turn,
                    details:         { pay, gold_available: payerGold },
                });
                await NotificationService.createSystemNotification(
                    rel.to_player_id,
                    'Impago de Mercenarios',
                    `⚠️ El contratante no ha podido pagar ${pay} de oro. El contrato de mercenariado ha sido disuelto.`,
                    turn
                );
                Logger.engine(`[TURN ${turn}] Mercenario non-payment: relation ${rel.relation_id} dissolved`);
            } else {
                await client.query(
                    'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                    [pay, rel.from_player_id]
                );
                await client.query(
                    'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                    [pay, rel.to_player_id]
                );
                await RelationModel.logEvent(client, {
                    relation_id:     rel.relation_id,
                    event_type:      'tribute_paid',
                    actor_player_id: rel.from_player_id,
                    amount:          pay,
                    turn_number:     turn,
                });
                Logger.engine(`[TURN ${turn}] Mercenario payment: player ${rel.from_player_id} → ${rel.to_player_id}: ${pay} gold`);
            }
        } catch (e) {
            Logger.error(e, { context: 'processRelationTributes', phase: 'mercenario', relation_id: rel.relation_id });
        }
    }

    // ── 3. Expiración de relaciones ────────────────────────────────────────
    const expired = await RelationModel.getExpired(client, turn);
    for (const rel of expired) {
        try {
            await RelationModel.end(client, rel.relation_id, 'expired');
            await RelationModel.logEvent(client, {
                relation_id: rel.relation_id,
                event_type:  'expired',
                turn_number: turn,
            });
            Logger.engine(`[TURN ${turn}] Relation ${rel.relation_id} (${rel.code}) expired`);
        } catch (e) {
            Logger.error(e, { context: 'processRelationTributes', phase: 'expiry', relation_id: rel.relation_id });
        }
    }

    // ── Mark mes procesado ─────────────────────────────────────────────────
    await client.query(
        `INSERT INTO game_config ("group", "key", "value")
         VALUES ('system', 'last_tribute_month', $1)
         ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value`,
        [gYM]
    );

    Logger.engine(`[TURN ${turn}] Relation tributes completed.`);
}

module.exports = { processTaxCollection, processRelationTributes };
