/**
 * CombatService.js
 * Resuelve batallas entre ejércitos de distintos jugadores.
 *
 * ACTIVACIÓN: el combate es MANUAL — solo ocurre cuando el jugador pulsa "Atacar"
 * desde el Panel de Tropas. El endpoint es POST /api/military/attack.
 *
 * MECÁNICA DE BATALLA:
 *   1. El DEFENSOR recibe +10% de PC (bono defensivo).
 *   2. PC = Σ (quantity × attack × terrainFactor × counterFactor × moraleFactor × staminaFactor)
 *   3. Ratio R = PC_mayor / PC_menor
 *      - R < 1.1  → EMPATE: ambos pierden 5-10%, nadie retrocede
 *      - R >= 1.1 → Victoria: ganador pierde 0-10%, perdedor 5-20% + HUIDA
 *   4. Huida del perdedor → se mueve al hex adyacente pasable más cercano
 *      (sin enemigos, si es posible). Si no hay salida → ejército destruido.
 *   5. Saqueo: el ganador se lleva entre 25% y 75% de las provisiones del perdedor.
 *   6. Experiencia: EXP = (bajas enemigas × 1) + (bajas propias × 2), repartida entre supervivientes.
 *   7. Notificaciones a ambos jugadores inmediatamente.
 */

const pool = require('../../db.js');
const h3   = require('h3-js');
const { Logger }                        = require('../utils/logger');
const CombatModel                       = require('../models/CombatModel.js');
const ArmyModel                         = require('../models/ArmyModel.js');
const CharacterModel                    = require('../models/CharacterModel.js');
const NotificationService               = require('./NotificationService.js');
const GAME_CONFIG                       = require('../config/constants.js');
const { canPerformAction, applyCooldown } = require('./gameActions.js');

class CombatService {
    // ─────────────────────────────────────────────────────────────────────────
    // ENDPOINT HTTP: POST /api/military/attack
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Procesa un ataque manual iniciado por el jugador.
     * Verifica que el ejército atacante pertenece al jugador,
     * busca enemigos en el mismo hexágono y resuelve el combate.
     *
     * @param {Request}  req - req.body.armyId (ID del ejército atacante)
     * @param {Response} res
     */
    async manualAttack(req, res) {
        const player_id = req.user.player_id;
        const { armyId } = req.body;

        if (!armyId) {
            return res.status(400).json({ success: false, message: 'armyId es requerido' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar que el ejército atacante pertenece al jugador
            const attackerResult = await client.query(
                'SELECT army_id, name, h3_index, player_id FROM armies WHERE army_id = $1 AND player_id = $2',
                [armyId, player_id]
            );
            if (attackerResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Ejército no encontrado o no te pertenece'
                });
            }
            const attacker = attackerResult.rows[0];

            // 2. Cooldown check — el ejército atacante no puede atacar si está en enfriamiento
            if (!(await canPerformAction(client, armyId, 'attack'))) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Este ejército no puede atacar todavía. Debe esperar a que pase el período de enfriamiento.',
                    code: 'COOLDOWN_ACTIVE',
                });
            }

            // 3. Buscar el primer ejército enemigo en el mismo hexágono
            const defenderResult = await client.query(
                'SELECT army_id, name, player_id FROM armies WHERE h3_index = $1 AND player_id != $2 LIMIT 1',
                [attacker.h3_index, player_id]
            );
            if (defenderResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'No hay ejércitos enemigos en este hexágono'
                });
            }
            const defender = defenderResult.rows[0];

            // 4. Obtener turno actual para las notificaciones
            const worldResult = await client.query(
                'SELECT current_turn FROM world_state LIMIT 1'
            );
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // 5. Resolver combate — el atacante NO recibe el bono defensivo
            const battle = await this.resolveCombat(
                client,
                attacker.army_id,
                defender.army_id,
                attacker.h3_index,
                turn,
                attacker.army_id   // ← identifica al atacante para calcular el bono
            );

            await client.query('COMMIT');

            Logger.action(
                `Player ${player_id} attacked with army ${armyId} vs ${defender.army_id} at ${attacker.h3_index}`,
                { player_id, attacker_army: armyId, defender_army: defender.army_id, h3_index: attacker.h3_index }
            );

            return res.json({ success: true, battle });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'CombatService.manualAttack', player_id, armyId });
            return res.status(500).json({ success: false, message: 'Error al procesar el combate' });
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ENDPOINT HTTP: POST /api/military/attack-army
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ataca un ejército enemigo concreto desde el popup del mapa.
     * El jugador elige explícitamente qué ejército propio ataca (attackerArmyId)
     * y qué ejército enemigo es el objetivo (targetArmyId).
     * Devuelve el resultado en el formato del BattleSummaryModal.
     */
    async attackSpecificArmy(req, res) {
        const player_id = req.user.player_id;
        const { attackerArmyId, targetArmyId } = req.body;

        if (!attackerArmyId || !targetArmyId) {
            return res.status(400).json({ success: false, message: 'attackerArmyId y targetArmyId son requeridos' });
        }
        if (Number(attackerArmyId) === Number(targetArmyId)) {
            return res.status(400).json({ success: false, message: 'No puedes atacar tu propio ejército' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar que el atacante pertenece al jugador
            const attackerResult = await client.query(
                'SELECT army_id, name, h3_index FROM armies WHERE army_id = $1 AND player_id = $2',
                [attackerArmyId, player_id]
            );
            if (attackerResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército atacante no encontrado o no te pertenece' });
            }
            const attacker = attackerResult.rows[0];

            // 2. Cooldown check
            if (!(await canPerformAction(client, attackerArmyId, 'attack'))) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Este ejército no puede atacar todavía. Debe esperar a que pase el período de enfriamiento.',
                    code: 'COOLDOWN_ACTIVE',
                });
            }

            // 3. Verificar que el objetivo es enemigo
            const defenderResult = await client.query(
                'SELECT army_id, name, h3_index FROM armies WHERE army_id = $1 AND player_id != $2',
                [targetArmyId, player_id]
            );
            if (defenderResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército objetivo no encontrado' });
            }
            const defender = defenderResult.rows[0];

            // 4. Verificar mismo hexágono
            if (attacker.h3_index !== defender.h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El ejército objetivo no está en el mismo hexágono' });
            }

            // 5. Tropas PRE-combate para desglose
            const preTroops = (armyId) => client.query(
                `SELECT t.quantity, ut.name AS unit_name
                 FROM troops t
                 JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                 WHERE t.army_id = $1 AND t.quantity > 0`,
                [armyId]
            );
            const [preAttacker, preDefender] = await Promise.all([
                preTroops(attackerArmyId),
                preTroops(targetArmyId)
            ]);

            // 5. Turno actual
            const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // 6. Resolver combate — defensor recibe +10% de PC
            const battle = await this.resolveCombat(
                client, attackerArmyId, targetArmyId,
                attacker.h3_index, turn,
                attackerArmyId
            );

            await client.query('COMMIT');

            if (!battle) {
                return res.status(400).json({ success: false, message: 'Combate no pudo resolverse (ejércitos sin tropas)' });
            }

            // 7. Identificar sides desde la perspectiva del jugador
            const playerBattle = battle.armyA.id === Number(attackerArmyId) ? battle.armyA : battle.armyB;
            const enemyBattle  = battle.armyA.id === Number(targetArmyId)   ? battle.armyA : battle.armyB;

            // 8. Resultado
            let result;
            if (battle.isDraw)                                     result = 'draw';
            else if (battle.winner?.id === Number(attackerArmyId)) result = 'victory';
            else                                                   result = 'defeat';

            // 9. Desglose por unidad proporcional a la tasa de bajas de la batalla
            const makeDesglose = (preTroopsResult, lossRate) =>
                preTroopsResult.rows.map(t => ({
                    nombre: t.unit_name,
                    perdidos: Math.ceil(t.quantity * lossRate)
                }));

            // 10. Mensaje de resultado
            const lootLine = battle.loot
                ? ` · Botín: 💰${battle.loot.gold} 🍖${battle.loot.food} 🌲${battle.loot.wood}`
                : '';

            let message;
            if (result === 'draw') {
                message = 'Ambos ejércitos mantienen sus posiciones. Nadie avanza.';
            } else if (result === 'victory') {
                if (enemyBattle.destroyed)            message = `¡"${enemyBattle.name}" ha sido aniquilado!` + lootLine;
                else if (enemyBattle.retreat?.retreated) message = `"${enemyBattle.name}" huye hasta ${enemyBattle.retreat.newHex}.` + lootLine;
                else                                  message = 'El enemigo ha sido derrotado.' + lootLine;
            } else {
                if (playerBattle.destroyed)            message = `¡"${playerBattle.name}" ha sido aniquilado en el campo de batalla!`;
                else if (playerBattle.retreat?.retreated) message = `Tus tropas se retiran hacia ${playerBattle.retreat.newHex}.`;
                else                                   message = 'Tus tropas han sido derrotadas.';
            }

            Logger.action(
                `Player ${player_id} attacked army ${targetArmyId} with ${attackerArmyId} at ${attacker.h3_index} → ${result}`,
                { player_id, attackerArmyId, targetArmyId, result }
            );

            return res.json({
                success: true,
                result,
                fief_name: `${attacker.h3_index} · vs "${defender.name}"`,
                defender_label: `⚔️ ${defender.name}`,
                attacker_losses: playerBattle.dead,
                defender_losses: enemyBattle.dead,
                desglose: {
                    Atacante: makeDesglose(preAttacker, playerBattle.lossRate),
                    Milicia:  makeDesglose(preDefender, enemyBattle.lossRate)
                },
                message,
                experience_gained: playerBattle.xp
            });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'CombatService.attackSpecificArmy', player_id, attackerArmyId, targetArmyId });
            return res.status(500).json({ success: false, message: 'Error al procesar el combate' });
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESOLUCIÓN DE BATALLA INDIVIDUAL
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resuelve el combate entre dos ejércitos enemigos en el mismo hexágono.
     *
     * @param {Object}      client        - PostgreSQL client (transacción activa)
     * @param {number}      armyAId       - ID del primer ejército
     * @param {number}      armyBId       - ID del segundo ejército
     * @param {string}      h3Index       - Hexágono donde ocurre la batalla
     * @param {number}      turn          - Turno actual
     * @param {number|null} attackerArmyId - ID del ejército atacante (para bono defensor)
     * @returns {Object|null}             - Resumen de la batalla
     */
    async resolveCombat(client, armyAId, armyBId, h3Index, turn, attackerArmyId = null) {
        // 1. Cargar ejércitos con tropas
        const armies = await CombatModel.getArmiesAtHex(client, h3Index);
        const armyA  = armies.find(a => a.army_id === armyAId);
        const armyB  = armies.find(a => a.army_id === armyBId);

        if (!armyA || !armyB) {
            Logger.error(new Error('Army not found during combat resolution'), { armyAId, armyBId, h3Index, turn });
            return null;
        }

        // 2. Cargar comandantes (para combate de guardia y destino post-combate)
        const commanderA = await CharacterModel.getCommanderForArmy(client, armyAId);
        const commanderB = await CharacterModel.getCommanderForArmy(client, armyBId);

        const aHasTroops = armyA.troops.length > 0;
        const bHasTroops = armyB.troops.length > 0;
        const aHasGuard  = !aHasTroops && commanderA?.personal_guard > 0;
        const bHasGuard  = !bHasTroops && commanderB?.personal_guard > 0;

        if (!aHasTroops && !aHasGuard) {
            Logger.engine(`[TURN ${turn}] Combate omitido en ${h3Index}: ejército ${armyAId} sin tropas ni guardia`);
            return null;
        }
        if (!bHasTroops && !bHasGuard) {
            Logger.engine(`[TURN ${turn}] Combate omitido en ${h3Index}: ejército ${armyBId} sin tropas ni guardia`);
            return null;
        }

        // 3. Determinar quién defiende
        const aIsDefender = attackerArmyId !== null && attackerArmyId === armyBId;
        const bIsDefender = attackerArmyId !== null && attackerArmyId === armyAId;

        // 4. Terreno
        const terrain = await CombatModel.getTerrainAtHex(client, h3Index);

        // 5. Tropas efectivas (reales o guardia virtual)
        const troopsA = aHasTroops ? armyA.troops.map(t => ({ ...t })) : this._buildGuardTroops(commanderA);
        const troopsB = bHasTroops ? armyB.troops.map(t => ({ ...t })) : this._buildGuardTroops(commanderB);

        // 5a. Coaliciones — terceros ejércitos que se unen al combate
        const { joinA, joinB } = await this._resolveCoalitions(
            client, h3Index, armyAId, armyBId, armyA.player_id, armyB.player_id
        );
        const coalitionArmyIds = [...joinA, ...joinB].map(a => a.army_id);

        for (const ally of joinA) {
            troopsA.push(...ally.troops.map(t => ({ ...t })));
            Logger.engine(`[TURN ${turn}] Coalición: ejército ${ally.army_id} (player ${ally.player_id}) → bando A (${armyA.name})`);
        }
        for (const ally of joinB) {
            troopsB.push(...ally.troops.map(t => ({ ...t })));
            Logger.engine(`[TURN ${turn}] Coalición: ejército ${ally.army_id} (player ${ally.player_id}) → bando B (${armyB.name})`);
        }

        // 5b. Bonificadores de moral pre-batalla (solo afectan al cálculo, no se guardan)
        const totalQtyA = troopsA.reduce((s, t) => s + t.quantity, 0);
        const totalQtyB = troopsB.reduce((s, t) => s + t.quantity, 0);

        // Territorio propio: +20 moral durante la batalla al ejército que defiende su feudo
        const hexOwnerRes = await client.query(
            'SELECT player_id FROM h3_map WHERE h3_index = $1', [h3Index]
        );
        const hexOwner = hexOwnerRes.rows[0]?.player_id ?? null;
        if (hexOwner !== null) {
            if (hexOwner === armyA.player_id)
                troopsA.forEach(t => { t.morale = Math.min(100, parseFloat(t.morale) + 20).toString(); });
            if (hexOwner === armyB.player_id)
                troopsB.forEach(t => { t.morale = Math.min(100, parseFloat(t.morale) + 20).toString(); });
        }

        // Ejército aliado presente en el hex: +5 moral si ese ejército supone ≥10% del enemigo
        const alliedBonus = async (playerIdFriend, enemyTotalQty, troopsTarget) => {
            const allies = await client.query(`
                SELECT a.army_id, COALESCE(SUM(t.quantity), 0)::int AS qty
                FROM armies a
                LEFT JOIN troops t ON t.army_id = a.army_id
                WHERE a.h3_index = $1
                  AND a.player_id != $2
                  AND a.army_id NOT IN ($3, $4)
                  AND EXISTS (
                      SELECT 1 FROM player_relations pr
                      JOIN relation_types rt ON rt.id = pr.type_id
                      WHERE pr.status = 'active' AND rt.code IN ('alianza', 'mercenariado')
                        AND ((pr.from_player_id = a.player_id AND pr.to_player_id = $2)
                          OR (pr.from_player_id = $2 AND pr.to_player_id = a.player_id))
                      UNION ALL
                      SELECT 1 FROM player_relations pr
                      JOIN relation_types rt ON rt.id = pr.type_id
                      WHERE pr.status = 'active' AND rt.code = 'clientela'
                        AND pr.from_player_id = a.player_id AND pr.to_player_id = $2
                  )
                GROUP BY a.army_id
            `, [h3Index, playerIdFriend, armyAId, armyBId]);
            const allyQty = allies.rows.reduce((s, r) => s + r.qty, 0);
            if (allyQty >= enemyTotalQty * 0.10) {
                troopsTarget.forEach(t => { t.morale = Math.min(100, parseFloat(t.morale) + 5).toString(); });
            }
        };
        await alliedBonus(armyA.player_id, totalQtyB, troopsA);
        await alliedBonus(armyB.player_id, totalQtyA, troopsB);

        // 6. Calcular tasas de bajas con el nuevo sistema daño-por-unidad
        // tasaOnB = % de bajas que A inflige sobre B
        // tasaOnA = % de bajas que B inflige sobre A
        const tasaOnB = await this._calculateDamageRate(client, troopsA, troopsB, terrain, bIsDefender, armyA.player_id, armyAId);
        const tasaOnA = await this._calculateDamageRate(client, troopsB, troopsA, terrain, aIsDefender, armyB.player_id, armyBId);

        // 7. Resultado: gana quien inflige más presión al enemigo
        const DRAW_THRESHOLD = GAME_CONFIG.MILITARY.COMBAT_DRAW_THRESHOLD;
        const isDraw = Math.abs(tasaOnB - tasaOnA) < DRAW_THRESHOLD;

        let winner = null, loser = null;
        if (!isDraw) {
            winner = tasaOnB > tasaOnA ? armyA : armyB;
            loser  = winner === armyA  ? armyB : armyA;
        }

        Logger.engine(
            `[TURN ${turn}] BATTLE at ${h3Index}: ` +
            `${armyA.name}(presión→B=${(tasaOnB*100).toFixed(1)}%)${aHasGuard ? '[guardia]' : ''} vs ` +
            `${armyB.name}(presión→A=${(tasaOnA*100).toFixed(1)}%)${bHasGuard ? '[guardia]' : ''} ` +
            `| ${isDraw ? 'EMPATE' : `Victoria ${winner.name}`}`
        );

        // 8. Tasas de bajas = las tasas calculadas (sin azar en el resultado)
        const lossRateA = tasaOnA;  // bajas que sufre A (B se las inflige)
        const lossRateB = tasaOnB;  // bajas que sufre B (A se las inflige)

        // 9. Aplicar bajas (tropas reales o guardia personal)
        let deadA, deadB;
        if (aHasTroops) {
            deadA = await this._applyCasualties(client, armyA.troops, lossRateA);
        } else if (aHasGuard) {
            const lost = Math.ceil(commanderA.personal_guard * lossRateA);
            deadA = lost;
            commanderA.personal_guard = Math.max(0, commanderA.personal_guard - lost);
            await CharacterModel.updateGuard(client, commanderA.id, commanderA.personal_guard);
        } else { deadA = 0; }

        if (bHasTroops) {
            deadB = await this._applyCasualties(client, armyB.troops, lossRateB);
        } else if (bHasGuard) {
            const lost = Math.ceil(commanderB.personal_guard * lossRateB);
            deadB = lost;
            commanderB.personal_guard = Math.max(0, commanderB.personal_guard - lost);
            await CharacterModel.updateGuard(client, commanderB.id, commanderB.personal_guard);
        } else { deadB = 0; }

        // 9b. Bajas a ejércitos de coalición (misma tasa que su bando)
        for (const ally of joinA) {
            await this._applyCasualties(client, ally.troops, lossRateA);
            await CombatModel.deleteArmyIfEmpty(client, ally.army_id);
            await ArmyModel.refreshDetectionRange(client, ally.army_id).catch(() => {});
        }
        for (const ally of joinB) {
            await this._applyCasualties(client, ally.troops, lossRateB);
            await CombatModel.deleteArmyIfEmpty(client, ally.army_id);
            await ArmyModel.refreshDetectionRange(client, ally.army_id).catch(() => {});
        }

        // 10. Saqueo — fracción proporcional a la diferencia de presión
        let loot = null;
        if (!isDraw && winner && loser) {
            const winnerTasa = winner === armyA ? tasaOnB : tasaOnA;
            const loserTasa  = winner === armyA ? tasaOnA : tasaOnB;
            const pressRatio = winnerTasa / Math.max(0.001, loserTasa);
            const lootFraction = Math.min(0.75, Math.max(0.25, (pressRatio - 1) / 4));
            loot = await CombatModel.transferProvisions(client, loser.army_id, winner.army_id, lootFraction);
        }

        // 11. Experiencia (solo tropas reales)
        const survivorsA = aHasTroops ? await this._getSurvivors(client, armyAId) : [];
        const survivorsB = bHasTroops ? await this._getSurvivors(client, armyBId) : [];
        const xpA = await this._distributeExperience(client, survivorsA, deadB + deadA * 2);
        const xpB = await this._distributeExperience(client, survivorsB, deadA + deadB * 2);

        // 12. Verificar ejércitos aniquilados
        // Los ejércitos de guardia se destruyen si personal_guard llega a 0
        let armyADestroyed, armyBDestroyed;
        if (aHasGuard) {
            armyADestroyed = commanderA.personal_guard <= 0;
            if (armyADestroyed) await this._destroyArmy(client, armyAId);
        } else {
            armyADestroyed = await CombatModel.deleteArmyIfEmpty(client, armyAId);
        }
        if (bHasGuard) {
            armyBDestroyed = commanderB.personal_guard <= 0;
            if (armyBDestroyed) await this._destroyArmy(client, armyBId);
        } else {
            armyBDestroyed = await CombatModel.deleteArmyIfEmpty(client, armyBId);
        }

        if (!armyADestroyed) await ArmyModel.refreshDetectionRange(client, armyAId);
        if (!armyBDestroyed) await ArmyModel.refreshDetectionRange(client, armyBId);

        // 12b. XP de personajes por participar en la batalla
        // Victoria: +5 XP al mejor personaje del ejército ganador; derrota: +2 XP
        const winnerArmyId = winner?.army_id ?? null;
        const loserArmyId  = loser?.army_id  ?? null;
        if (winnerArmyId) {
            const bestWinner = await CharacterModel.getBestInArmy(client, winnerArmyId);
            if (bestWinner) await CharacterModel.addXp(client, bestWinner.id, 5);
        }
        if (loserArmyId) {
            const bestLoser = await CharacterModel.getBestInArmy(client, loserArmyId);
            if (bestLoser) await CharacterModel.addXp(client, bestLoser.id, 2);
        }
        if (isDraw) {
            // En empate: ambos ganan 2 XP
            const bestA = await CharacterModel.getBestInArmy(client, armyAId);
            if (bestA) await CharacterModel.addXp(client, bestA.id, 2);
            const bestB = await CharacterModel.getBestInArmy(client, armyBId);
            if (bestB) await CharacterModel.addXp(client, bestB.id, 2);
        }

        // 12c. Modificadores de moral post-batalla
        if (!isDraw && winner && loser) {
            if (!armyADestroyed && aHasTroops) {
                const delta = winner === armyA ? +5 : -5;
                await client.query(
                    `UPDATE troops SET morale = GREATEST(0, LEAST(100, morale + $1)) WHERE army_id = $2`,
                    [delta, armyAId]
                );
            }
            if (!armyBDestroyed && bHasTroops) {
                const delta = winner === armyB ? +5 : -5;
                await client.query(
                    `UPDATE troops SET morale = GREATEST(0, LEAST(100, morale + $1)) WHERE army_id = $2`,
                    [delta, armyBId]
                );
            }
            Logger.engine(`[TURN ${turn}] Moral post-batalla: ganador +5, perdedor -5`);
        }

        // 13. Huida del perdedor
        let retreatA = null, retreatB = null;
        if (!isDraw && loser) {
            if (loser === armyA && !armyADestroyed) retreatA = await this._retreatArmy(client, armyAId, h3Index);
            else if (loser === armyB && !armyBDestroyed) retreatB = await this._retreatArmy(client, armyBId, h3Index);
        }

        // 14. Cansancio post-batalla — ambos ejércitos supervivientes
        const totalA = troopsA.reduce((s, t) => s + t.quantity, 0);
        const totalB = troopsB.reduce((s, t) => s + t.quantity, 0);
        const battleType = this._getBattleType(totalA, totalB);

        if (!armyADestroyed && aHasTroops) await this._applyBattleStamina(client, armyAId, battleType);
        if (!armyBDestroyed && bHasTroops) await this._applyBattleStamina(client, armyBId, battleType);

        // El ganador detiene su marcha
        if (!isDraw && winner) {
            await client.query('UPDATE armies SET destination = NULL WHERE army_id = $1', [winner.army_id]);
            await client.query('DELETE FROM army_routes WHERE army_id = $1', [winner.army_id]);
        }

        // 15. Destino post-combate de los personajes
        const characterEvents = await this._handleCharacterPostCombat(
            client, winner, loser, isDraw,
            armyAId, armyBId,
            commanderA, commanderB,
            armyADestroyed, armyBDestroyed,
            aHasGuard, bHasGuard
        );

        // 16. Construir resumen
        const battleResult = {
            h3Index, turn, isDraw,
            armyA: {
                id: armyAId, name: armyA.name, playerId: armyA.player_id,
                pressure: tasaOnB, dead: deadA, lossRate: lossRateA, xp: xpA,
                destroyed: armyADestroyed, retreat: retreatA,
            },
            armyB: {
                id: armyBId, name: armyB.name, playerId: armyB.player_id,
                pressure: tasaOnA, dead: deadB, lossRate: lossRateB, xp: xpB,
                destroyed: armyBDestroyed, retreat: retreatB,
            },
            winner: winner ? { id: winner.army_id, name: winner.name, playerId: winner.player_id } : null,
            loser:  loser  ? { id: loser.army_id,  name: loser.name,  playerId: loser.player_id  } : null,
            loot,
            characterEvents,
        };

        // 17. Notificar
        await this._sendBattleNotifications(battleResult);

        Logger.engine(
            `[TURN ${turn}] BATTLE RESULT at ${h3Index}: ` +
            `${isDraw ? 'EMPATE' : `Victoria ${winner.name}`} | Bajas: A=${deadA}, B=${deadB}` +
            (characterEvents.length ? ` | Personajes: ${characterEvents.map(e => `${e.characterName}→${e.type}`).join(', ')}` : '')
        );

        return battleResult;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODOS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Calcula la tasa de bajas que el ejército A inflige sobre el ejército B.
     *
     * Fórmula por unidad enemiga:
     *   damage_per_B  = total_atk_A / qty_B
     *   avg_def_B     = Σ(qty_b × def_b × morale × stamina) / qty_B  [×1.15 si B defiende]
     *   mitigation    = avg_def_B / (avg_def_B + K)
     *   tasa_B        = damage_per_B × (1 - mitigation) × SCALE / avg_hp_B
     *
     * @param {Object[]} troopsA       - Tropas atacantes (con attack, defense, morale, stamina, health_points)
     * @param {Object[]} troopsB       - Tropas defensoras
     * @param {Object}   terrain       - Terreno del hex
     * @param {boolean}  bIsDefender   - Si B recibe bono defensivo (+15% def)
     * @param {number}   attackerPlayerId - Para bonus devotio del atacante
     * @param {number}   attackerArmyId  - Para bonus de personaje
     * @returns {Promise<number>} Tasa de bajas sobre B en [0, 1]
     */
    async _calculateDamageRate(client, troopsA, troopsB, terrain, bIsDefender = false, attackerPlayerId = null, attackerArmyId = null) {
        const K             = GAME_CONFIG.MILITARY.COMBAT_K_NORM;
        const SCALE         = GAME_CONFIG.MILITARY.COMBAT_DAMAGE_SCALE;
        const DEF_BONUS     = GAME_CONFIG.MILITARY.COMBAT_DEFENDER_BONUS;
        const terrainName   = terrain?.terrain_name ?? null;

        const totalQtyA = troopsA.reduce((s, t) => s + t.quantity, 0);
        const totalQtyB = troopsB.reduce((s, t) => s + t.quantity, 0);
        if (totalQtyA === 0) return 0;
        if (totalQtyB === 0) return 1.0;

        // ── Paso 1: Ataque total de A ────────────────────────────────────────
        let total_atk_A = 0;
        for (const ta of troopsA) {
            const morale  = Math.max(0.1, parseFloat(ta.morale)  / 100);
            const stamina = Math.max(0.1, parseFloat(ta.stamina) / 100);
            let   atk     = parseFloat(ta.attack);

            // Modificador de terreno (ataque)
            if (terrainName) {
                const mod = await CombatModel.getTerrainModifier(client, ta.unit_type_id, terrainName);
                if (mod) atk *= (1 + parseFloat(mod.attack_modificator));
            }

            // Factor de counter ponderado por composición de B
            let counterFactor = 1.0;
            if (troopsB.length > 0) {
                let weighted = 0;
                for (const tb of troopsB) {
                    const mult = await CombatModel.getCombatCounter(client, ta.unit_type_id, tb.unit_type_id);
                    weighted += (tb.quantity / totalQtyB) * mult;
                }
                counterFactor = weighted;
            }

            total_atk_A += ta.quantity * atk * counterFactor * morale * stamina;
        }

        // Bonus devotio del atacante: +5% ataque
        if (attackerPlayerId) {
            const { rows } = await client.query(`
                SELECT 1 FROM player_relations pr
                JOIN relation_types rt ON rt.id = pr.type_id
                WHERE pr.status = 'active' AND rt.code = 'devotio'
                  AND pr.from_player_id = $1 LIMIT 1
            `, [attackerPlayerId]);
            if (rows.length > 0) total_atk_A *= 1.05;
        }

        // Bonus de personaje atacante: +2% por nivel mostrado (máx +20%)
        if (attackerArmyId) {
            const bestChar = await CharacterModel.getBestInArmy(client, attackerArmyId);
            if (bestChar) {
                const displayLevel = Math.floor(bestChar.level / 10);
                if (displayLevel > 0) total_atk_A *= (1 + displayLevel * 0.02);
            }
        }

        // ── Paso 2: Defensa media y HP medio de B ───────────────────────────
        let total_def_B = 0;
        let total_hp_B  = 0;
        for (const tb of troopsB) {
            const morale  = Math.max(0.1, parseFloat(tb.morale)  / 100);
            const stamina = Math.max(0.1, parseFloat(tb.stamina) / 100);
            let   def     = parseFloat(tb.defense ?? 5);

            // Modificador de terreno (defensa)
            if (terrainName) {
                const mod = await CombatModel.getTerrainModifier(client, tb.unit_type_id, terrainName);
                if (mod) def *= (1 + parseFloat(mod.defense_modificator));
            }

            total_def_B += tb.quantity * def * morale * stamina;
            total_hp_B  += tb.quantity * parseFloat(tb.health_points ?? 5);
        }

        let avg_def_B = total_def_B / totalQtyB;
        if (bIsDefender) avg_def_B *= DEF_BONUS;  // +15% si B está en posición defensiva
        const avg_hp_B = total_hp_B / totalQtyB;

        // ── Paso 3: Daño por unidad enemiga y tasa de bajas ─────────────────
        const damage_per_B  = total_atk_A / totalQtyB;
        const mitigation    = avg_def_B / (avg_def_B + K);
        const net_per_B     = damage_per_B * (1 - mitigation);
        const tasa          = Math.min(1.0, (net_per_B * SCALE) / avg_hp_B);

        return tasa;
    }

    /**
     * Aplica bajas a las tropas de un ejército.
     * Devuelve el total de unidades muertas.
     */
    async _applyCasualties(client, troops, lossRate) {
        let totalDead = 0;
        for (const troop of troops) {
            const dead      = Math.ceil(troop.quantity * lossRate);
            const survivors = troop.quantity - dead;
            totalDead      += dead;
            await CombatModel.updateTroopQuantity(client, troop.troop_id, survivors);
        }
        return totalDead;
    }

    /**
     * Determina qué ejércitos terceros en el hex se unen a cada bando.
     * Reglas:
     *  - Relaciones que causan unión: alianza, mercenariado, clientela, devotio (bidireccional)
     *  - Rehenes: solo el que entregó (to_player_id) se une al que los tiene (from_player_id)
     *  - Si T tiene relación válida con AMBOS bandos → neutral
     *  - Si T tiene relación válida con solo uno → se une a ese bando
     *
     * @returns {{ joinA: Army[], joinB: Army[] }}
     */
    async _resolveCoalitions(client, h3Index, armyAId, armyBId, playerAId, playerBId) {
        // Obtener otros ejércitos en el hex que no sean A ni B
        const othersRes = await client.query(`
            SELECT a.army_id, a.player_id,
                   json_agg(json_build_object(
                       'troop_id',     t.troop_id,
                       'unit_type_id', t.unit_type_id,
                       'quantity',     t.quantity,
                       'attack',       ut.attack,
                       'defense',      ut.defense,
                       'morale',       t.morale,
                       'stamina',      t.stamina,
                       'health_points',ut.health_points
                   )) FILTER (WHERE t.troop_id IS NOT NULL) AS troops
            FROM armies a
            LEFT JOIN troops t ON t.army_id = a.army_id
            LEFT JOIN unit_types ut ON ut.id = t.unit_type_id
            WHERE a.h3_index = $1
              AND a.army_id NOT IN ($2, $3)
              AND a.is_naval = FALSE
            GROUP BY a.army_id, a.player_id
        `, [h3Index, armyAId, armyBId]);

        const joinA = [];
        const joinB = [];

        for (const third of othersRes.rows) {
            if (!third.troops || third.troops.length === 0) continue;
            const T = third.player_id;

            const qualifies = async (T, X) => {
                const res = await client.query(`
                    SELECT 1 FROM player_relations pr
                    JOIN relation_types rt ON rt.id = pr.type_id
                    WHERE pr.status = 'active' AND (
                        (rt.code IN ('alianza', 'mercenariado', 'clientela', 'devotio')
                         AND ((pr.from_player_id = $1 AND pr.to_player_id = $2)
                           OR (pr.from_player_id = $2 AND pr.to_player_id = $1)))
                        OR
                        (rt.code = 'rehenes'
                         AND pr.from_player_id = $2 AND pr.to_player_id = $1)
                    )
                    LIMIT 1
                `, [T, X]);
                return res.rows.length > 0;
            };

            const withA = await qualifies(T, playerAId);
            const withB = await qualifies(T, playerBId);

            if (withA && !withB) joinA.push(third);
            else if (withB && !withA) joinB.push(third);
            // Si withA && withB, o ninguno → neutral
        }

        return { joinA, joinB };
    }

    /**
     * Obtiene las tropas supervivientes de un ejército (post-bajas).
     */
    async _getSurvivors(client, armyId) {
        const result = await client.query(
            'SELECT troop_id, quantity, experience FROM troops WHERE army_id = $1 AND quantity > 0',
            [armyId]
        );
        return result.rows;
    }

    /**
     * Distribuye experiencia entre supervivientes como pool compartido.
     * EXP_pool = (bajas enemigas × 1) + (bajas propias × 2)
     * XP_por_unidad = (EXP_pool × MULTIPLIER) / total_supervivientes
     * Ejércitos grandes diluyen la XP; supervivientes de masacres ganan mucho.
     * Cap 100 por tropa.
     * @returns {number} XP otorgada a cada unidad individual
     */
    async _distributeExperience(client, survivors, totalExp) {
        if (totalExp <= 0 || survivors.length === 0) return 0;
        const totalSurvivors = survivors.reduce((s, t) => s + t.quantity, 0);
        if (totalSurvivors === 0) return 0;
        const xpPerUnit = Math.max(1, Math.round(
            (totalExp * GAME_CONFIG.MILITARY.COMBAT_XP_MULTIPLIER) / totalSurvivors
        ));
        for (const troop of survivors) {
            const newExp = Math.min(100, Math.round(parseFloat(troop.experience) + xpPerUnit));
            await CombatModel.updateTroopExperience(client, troop.troop_id, newExp);
            Logger.action(`[XP] troop_id=${troop.troop_id} +${xpPerUnit} XP → ${newExp}/100`);
        }
        return xpPerUnit;
    }

    /**
     * Mueve el ejército perdedor al hexágono adyacente pasable más cercano.
     * Preferencia: hexes sin enemigos → hexes con menos movimiento.
     * Si no hay hex de retirada → ejército destruido.
     *
     * @returns {{ retreated: boolean, destroyed: boolean, newHex?: string }}
     */
    async _retreatArmy(client, armyId, fromH3) {
        // Hexágonos adyacentes (radio 1, excluyendo el actual)
        const neighbors = h3.gridDisk(fromH3, 1).filter(n => n !== fromH3);

        if (neighbors.length === 0) {
            await this._destroyArmy(client, armyId);
            return { retreated: false, destroyed: true };
        }

        // Obtener player_id y capital_h3 del ejército en una sola query
        const armyRow = await client.query(
            `SELECT a.player_id, p.capital_h3
             FROM armies a
             JOIN players p ON p.player_id = a.player_id
             WHERE a.army_id = $1`,
            [armyId]
        );
        const playerId  = armyRow.rows[0]?.player_id;
        const capitalH3 = armyRow.rows[0]?.capital_h3 ?? null;

        // Si el ejército está en la capital, no puede retirarse más — se queda
        if (capitalH3 && fromH3 === capitalH3) {
            await client.query('UPDATE armies SET destination = NULL WHERE army_id = $1', [armyId]);
            await client.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);
            Logger.engine(`[COMBAT] Army ${armyId} at capital ${fromH3} — holds position, no retreat`);
            return { retreated: false, destroyed: false, newHex: fromH3 };
        }

        // Obtener hexes pasables del mapa
        const passableResult = await client.query(`
            SELECT hm.h3_index
            FROM h3_map hm
            JOIN terrain_types tt ON hm.terrain_type_id = tt.terrain_type_id
            WHERE hm.h3_index = ANY($1) AND tt.movement_cost > 0
        `, [neighbors]);

        if (passableResult.rows.length === 0) {
            await this._destroyArmy(client, armyId);
            return { retreated: false, destroyed: true };
        }

        // Para cada hex pasable: verificar enemigos y calcular distancia a la capital
        const candidates = await Promise.all(passableResult.rows.map(async (row) => {
            const enemyCheck = await client.query(
                'SELECT 1 FROM armies WHERE h3_index = $1 AND player_id != $2 LIMIT 1',
                [row.h3_index, playerId]
            );
            const hasEnemy = enemyCheck.rows.length > 0;

            let distToCapital = Infinity;
            if (capitalH3) {
                try { distToCapital = h3.gridDistance(row.h3_index, capitalH3); }
                catch (_) { /* hexes en diferente resolución — ignorar */ }
            }

            return { h3_index: row.h3_index, hasEnemy, distToCapital };
        }));

        // Prioridad: (1) sin enemigos, (2) más cercano a la capital
        candidates.sort((a, b) => {
            if (a.hasEnemy !== b.hasEnemy) return a.hasEnemy ? 1 : -1;
            return a.distToCapital - b.distToCapital;
        });

        const retreatHex = candidates[0].h3_index;

        // Mover el ejército y cancelar ruta
        await client.query(
            'UPDATE armies SET h3_index = $1, destination = NULL WHERE army_id = $2',
            [retreatHex, armyId]
        );
        await client.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);

        Logger.engine(`[COMBAT] Army ${armyId} retreated from ${fromH3} to ${retreatHex} (capital: ${capitalH3})`);
        return { retreated: true, destroyed: false, newHex: retreatHex };
    }

    /**
     * Clasifica la batalla según la relación de fuerzas (nº de soldados).
     * GREAT    → ratio ≤ 1.5   (Gran Batalla, fuerzas similares)
     * MASSACRE → ratio ≥ 50    (Matanza, sin pérdida de stamina)
     * SKIRMISH → resto          (Batalla intermedia)
     */
    _getBattleType(totalA, totalB) {
        if (totalA === 0 || totalB === 0) return 'MASSACRE';
        const ratio = Math.max(totalA, totalB) / Math.min(totalA, totalB);
        const M = GAME_CONFIG.MILITARY;
        if (ratio >= M.COMBAT_MASSACRE_RATIO)      return 'MASSACRE';
        if (ratio <= M.COMBAT_GREAT_BATTLE_RATIO)  return 'GREAT';
        return 'SKIRMISH';
    }

    /**
     * Aplica el cansancio post-batalla a un ejército superviviente.
     * GREAT:    stamina → LEAST(stamina, floor=20); tasa de recuperación rápida durante 4 turnos
     * SKIRMISH: stamina -= 20; recuperado en 1 turno
     * MASSACRE: sin cambio
     */
    async _applyBattleStamina(client, armyId, battleType) {
        const M = GAME_CONFIG.MILITARY;
        if (battleType === 'MASSACRE') return;

        if (battleType === 'GREAT') {
            const { rows } = await client.query(
                'SELECT AVG(stamina)::float AS avg FROM troops WHERE army_id = $1',
                [armyId]
            );
            const avgStamina = rows[0]?.avg ?? 100;
            const floor      = M.COMBAT_GREAT_STAMINA_FLOOR;
            const recoveryRate = avgStamina > floor
                ? parseFloat(((avgStamina - floor) / M.COMBAT_GREAT_RECOVERY_TURNS).toFixed(2))
                : 0;

            await client.query(
                `UPDATE troops SET stamina = LEAST(stamina, $1), force_rest = FALSE WHERE army_id = $2`,
                [floor, armyId]
            );
            await client.query(
                `UPDATE armies SET battle_recovery_rate = $1, battle_recovery_turns_left = $2 WHERE army_id = $3`,
                [recoveryRate, M.COMBAT_GREAT_RECOVERY_TURNS, armyId]
            );
        } else { // SKIRMISH
            await client.query(
                `UPDATE troops SET stamina = GREATEST(0, stamina - $1), force_rest = FALSE WHERE army_id = $2`,
                [M.COMBAT_SKIRMISH_STAMINA_LOSS, armyId]
            );
            await client.query(
                `UPDATE armies SET battle_recovery_rate = $1, battle_recovery_turns_left = 1 WHERE army_id = $2`,
                [M.COMBAT_SKIRMISH_STAMINA_LOSS, armyId]
            );
        }
    }

    /**
     * Construye tropas virtuales de guardia personal para el cálculo de PC.
     * Simula la guardia como Caballería Pesada (unit_type_id=7) con stats al 100%.
     */
    _buildGuardTroops(commander) {
        return [{
            unit_type_id:  7,    // Guardia de élite (stats de Pretorianos)
            quantity:      commander.personal_guard,
            attack:        22,
            defense:       9,
            health_points: 10,
            morale:        100,
            stamina:       100,
            troop_id:      null, // virtual — sin fila en DB
        }];
    }

    /**
     * Determina el destino post-combate de los comandantes.
     * - Perdedor con ejército destruido: 25% captura, si no → huye a capital.
     * - Perdedor en combate de guardia: prob. captura = (GUARD_MAX - guardia_restante) / GUARD_MAX.
     * - En empate: solo huida si guardia agotada (sin captura).
     */
    async _handleCharacterPostCombat(
        client, winner, loser, isDraw,
        armyAId, armyBId,
        commanderA, commanderB,
        armyADestroyed, armyBDestroyed,
        aHasGuard, bHasGuard
    ) {
        const GUARD_MAX = GAME_CONFIG.CHARACTERS.GUARD_MAX;
        const events = [];

        const resolveCharacter = async (commander, isDestroyed, isGuardArmy, capturingArmy) => {
            if (!commander) return null;

            let captureProb = 0;
            if (capturingArmy) {
                captureProb = isGuardArmy
                    ? (GUARD_MAX - commander.personal_guard) / GUARD_MAX  // guardia: según bajas
                    : (isDestroyed ? 0.25 : 0);                           // ejército destruido: 25%
            }
            if (!captureProb && !isDestroyed && !(isGuardArmy && commander.personal_guard <= 0)) {
                return null; // El personaje sobrevive sin consecuencias
            }

            const playerRow = await client.query(
                'SELECT capital_h3 FROM players WHERE player_id = $1',
                [commander.player_id]
            );
            const capitalH3 = playerRow.rows[0]?.capital_h3;

            if (capturingArmy && Math.random() < captureProb) {
                await CharacterModel.setCaptive(client, commander.id, capturingArmy.army_id, commander.level);
                Logger.action(
                    `[COMBAT] ${commander.name} capturado por ejército ${capturingArmy.army_id}`,
                    commander.player_id
                );
                return {
                    type:              'captured',
                    characterId:       commander.id,
                    characterName:     commander.name,
                    originalPlayerId:  commander.player_id,
                    capturingArmyId:   capturingArmy.army_id,
                    capturingPlayerId: capturingArmy.player_id,
                };
            } else {
                await CharacterModel.flee(client, commander.id, capitalH3);
                Logger.action(
                    `[COMBAT] ${commander.name} huye hacia capital ${capitalH3}`,
                    commander.player_id
                );
                return {
                    type:             'escaped',
                    characterId:      commander.id,
                    characterName:    commander.name,
                    originalPlayerId: commander.player_id,
                    capitalH3,
                };
            }
        };

        if (!isDraw && loser && winner) {
            // Solo el perdedor arriesga a su personaje
            if (loser.army_id === armyAId) {
                const ev = await resolveCharacter(commanderA, armyADestroyed, aHasGuard, winner);
                if (ev) events.push(ev);
            } else {
                const ev = await resolveCharacter(commanderB, armyBDestroyed, bHasGuard, winner);
                if (ev) events.push(ev);
            }
        } else if (isDraw) {
            // En empate, si la guardia queda a 0 el personaje huye (sin captura)
            if (aHasGuard && commanderA.personal_guard <= 0) {
                const ev = await resolveCharacter(commanderA, true, false, null);
                if (ev) events.push(ev);
            }
            if (bHasGuard && commanderB.personal_guard <= 0) {
                const ev = await resolveCharacter(commanderB, true, false, null);
                if (ev) events.push(ev);
            }
        }

        return events.filter(Boolean);
    }

    /** Elimina un ejército y su ruta de la base de datos. */
    async _destroyArmy(client, armyId) {
        await client.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);
        await client.query('DELETE FROM armies WHERE army_id = $1', [armyId]);
        Logger.engine(`[COMBAT] Army ${armyId} destroyed — no retreat available`);
    }

    /**
     * Envía notificaciones de batalla a ambos jugadores.
     */
    async _sendBattleNotifications(battle) {
        const { armyA, armyB, isDraw, winner, loot, h3Index, turn, characterEvents = [] } = battle;

        const charLines = (forPlayerId) => characterEvents.map(ev => {
            if (ev.type === 'captured' && ev.originalPlayerId === forPlayerId)
                return `\n⛓️ ${ev.characterName} ha sido capturado por el enemigo.`;
            if (ev.type === 'captured' && ev.capturingPlayerId === forPlayerId)
                return `\n⛓️ Has capturado a ${ev.characterName}.`;
            if (ev.type === 'escaped' && ev.originalPlayerId === forPlayerId)
                return `\n🏃 ${ev.characterName} ha huido hacia la capital.`;
            return '';
        }).filter(Boolean).join('');

        const formatLoot = (l) =>
            `💰${l.gold} oro, 🍖${l.food} comida, 🌲${l.wood} madera`;

        const retreatLine = (r) => {
            if (!r) return '';
            if (r.destroyed)  return '\n💀 Sin retirada posible — ejército destruido.';
            if (!r.retreated) return '\n🏰 El ejército mantiene posición en la capital.';
            return `\n🏃 Se retira a ${r.newHex}.`;
        };

        let contentA, contentB;

        if (isDraw) {
            contentA =
                `⚔️ EMPATE en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} vs ${armyB.name}\n` +
                `Bajas propias: ${armyA.dead} unidades` +
                charLines(armyA.playerId);
            contentB =
                `⚔️ EMPATE en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} vs ${armyA.name}\n` +
                `Bajas propias: ${armyB.dead} unidades` +
                charLines(armyB.playerId);
        } else if (winner.id === armyA.id) {
            const lootLine = loot ? `\n💰 Botín: ${formatLoot(loot)}` : '';
            contentA =
                `⚔️ VICTORIA en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} derrotó a ${armyB.name}\n` +
                `Bajas propias: ${armyA.dead} | Bajas enemigas: ${armyB.dead}` +
                lootLine +
                (armyB.destroyed ? '\n🏳️ Ejército enemigo aniquilado.' : retreatLine(armyB.retreat)) +
                charLines(armyA.playerId);
            contentB =
                `⚔️ DERROTA en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} derrotó a ${armyB.name}\n` +
                `Bajas propias: ${armyB.dead} | Bajas enemigas: ${armyA.dead}` +
                (loot ? `\n💸 Provisiones saqueadas: ${formatLoot(loot)}` : '') +
                retreatLine(armyB.retreat) +
                charLines(armyB.playerId);
        } else {
            const lootLine = loot ? `\n💰 Botín: ${formatLoot(loot)}` : '';
            contentA =
                `⚔️ DERROTA en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} derrotó a ${armyA.name}\n` +
                `Bajas propias: ${armyA.dead} | Bajas enemigas: ${armyB.dead}` +
                (loot ? `\n💸 Provisiones saqueadas: ${formatLoot(loot)}` : '') +
                retreatLine(armyA.retreat) +
                charLines(armyA.playerId);
            contentB =
                `⚔️ VICTORIA en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} derrotó a ${armyA.name}\n` +
                `Bajas propias: ${armyB.dead} | Bajas enemigas: ${armyA.dead}` +
                lootLine +
                (armyA.destroyed ? '\n🏳️ Ejército enemigo aniquilado.' : retreatLine(armyA.retreat)) +
                charLines(armyB.playerId);
        }

        await NotificationService.createSystemNotification(armyA.playerId, 'Militar', contentA, turn);
        await NotificationService.createSystemNotification(armyB.playerId, 'Militar', contentB, turn);
    }
}

module.exports = new CombatService();
