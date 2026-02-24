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
const { Logger }            = require('../utils/logger');
const CombatModel           = require('../models/CombatModel.js');
const ArmyModel             = require('../models/ArmyModel.js');
const NotificationService   = require('./NotificationService.js');
const GAME_CONFIG           = require('../config/constants.js');

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

            // 2. Buscar el primer ejército enemigo en el mismo hexágono
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

            // 3. Obtener turno actual para las notificaciones
            const worldResult = await client.query(
                'SELECT current_turn FROM world_state LIMIT 1'
            );
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // 4. Resolver combate — el atacante NO recibe el bono defensivo
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

            // 2. Verificar que el objetivo es enemigo
            const defenderResult = await client.query(
                'SELECT army_id, name, h3_index FROM armies WHERE army_id = $1 AND player_id != $2',
                [targetArmyId, player_id]
            );
            if (defenderResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército objetivo no encontrado' });
            }
            const defender = defenderResult.rows[0];

            // 3. Verificar mismo hexágono
            if (attacker.h3_index !== defender.h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El ejército objetivo no está en el mismo hexágono' });
            }

            // 4. Tropas PRE-combate para desglose
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
                ? ` · Botín: 🪙${battle.loot.gold} 🍖${battle.loot.food} 🌲${battle.loot.wood}`
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
            Logger.error(new Error('Army not found during combat resolution'), {
                armyAId, armyBId, h3Index, turn
            });
            return null;
        }
        if (!armyA.troops.length || !armyB.troops.length) {
            Logger.engine(`[TURN ${turn}] Combate omitido en ${h3Index}: ejército sin tropas`);
            return null;
        }

        // 2. Determinar quién defiende (recibe +10% de PC)
        //    Si attackerArmyId es A → B defiende; si es B → A defiende; si null → nadie
        const aIsDefender = attackerArmyId !== null && attackerArmyId === armyBId;
        const bIsDefender = attackerArmyId !== null && attackerArmyId === armyAId;

        // 3. Terreno
        const terrain = await CombatModel.getTerrainAtHex(client, h3Index);

        // 4. Calcular Poder de Combate
        const pcA = await this._calculateCombatPower(client, armyA.troops, armyB.troops, terrain, aIsDefender);
        const pcB = await this._calculateCombatPower(client, armyB.troops, armyA.troops, terrain, bIsDefender);

        Logger.engine(
            `[TURN ${turn}] BATTLE at ${h3Index}: ` +
            `${armyA.name}(PC=${pcA.toFixed(1)}) vs ${armyB.name}(PC=${pcB.toFixed(1)}) ` +
            `| Defensor: ${bIsDefender ? armyA.name : aIsDefender ? armyB.name : 'ninguno'}`
        );

        // 5. Resultado
        const maxPC  = Math.max(pcA, pcB);
        const minPC  = Math.max(1, Math.min(pcA, pcB));
        const ratio  = maxPC / minPC;
        const isDraw = ratio < 1.1;

        let winner = null;
        let loser  = null;
        if (!isDraw) {
            winner = pcA >= pcB ? armyA : armyB;
            loser  = pcA >= pcB ? armyB : armyA;
        }

        // 6. Tasas de bajas
        let lossRateA, lossRateB;
        if (isDraw) {
            lossRateA = 0.05 + Math.random() * 0.05;
            lossRateB = 0.05 + Math.random() * 0.05;
        } else {
            const winnerLoss = Math.random() * 0.10;
            const loserLoss  = 0.05 + Math.random() * 0.15;
            lossRateA = (winner === armyA) ? winnerLoss : loserLoss;
            lossRateB = (winner === armyB) ? winnerLoss : loserLoss;
        }

        // 7. Aplicar bajas
        const deadA = await this._applyCasualties(client, armyA.troops, lossRateA);
        const deadB = await this._applyCasualties(client, armyB.troops, lossRateB);

        // 8. Saqueo (solo si hay ganador claro)
        let loot = null;
        if (!isDraw && winner && loser) {
            const lootFraction = Math.min(0.75, Math.max(0.25, (ratio - 1) / 4));
            loot = await CombatModel.transferProvisions(client, loser.army_id, winner.army_id, lootFraction);
        }

        // 9. Experiencia para supervivientes
        const survivorsA = await this._getSurvivors(client, armyAId);
        const survivorsB = await this._getSurvivors(client, armyBId);
        const xpA = await this._distributeExperience(client, survivorsA, deadB + deadA * 2);
        const xpB = await this._distributeExperience(client, survivorsB, deadA + deadB * 2);

        // 10. Verificar ejércitos aniquilados
        const armyADestroyed = await CombatModel.deleteArmyIfEmpty(client, armyAId);
        const armyBDestroyed = await CombatModel.deleteArmyIfEmpty(client, armyBId);

        // Actualizar caché de detection_range para ejércitos supervivientes
        if (!armyADestroyed) await ArmyModel.refreshDetectionRange(client, armyAId);
        if (!armyBDestroyed) await ArmyModel.refreshDetectionRange(client, armyBId);

        // 11. Huida del perdedor (si no está ya destruido)
        let retreatA = null;
        let retreatB = null;
        if (!isDraw && loser) {
            if (loser === armyA && !armyADestroyed) {
                retreatA = await this._retreatArmy(client, armyAId, h3Index);
            } else if (loser === armyB && !armyBDestroyed) {
                retreatB = await this._retreatArmy(client, armyBId, h3Index);
            }
        }

        // 12. El combate agota al ganador: stamina -20 y force_rest = TRUE.
        //     Además se cancela su ruta para que no continúe marchando tras la batalla.
        if (!isDraw && winner) {
            await client.query(
                `UPDATE troops SET
                    stamina = GREATEST(0, stamina - 20),
                    force_rest = TRUE
                 WHERE army_id = $1`,
                [winner.army_id]
            );
            await client.query(
                'UPDATE armies SET destination = NULL WHERE army_id = $1',
                [winner.army_id]
            );
            await client.query('DELETE FROM army_routes WHERE army_id = $1', [winner.army_id]);
        }

        // 13. Construir resumen
        const battleResult = {
            h3Index, turn, isDraw,
            armyA: {
                id: armyAId, name: armyA.name, playerId: armyA.player_id,
                pc: pcA, dead: deadA, lossRate: lossRateA,
                xp: xpA,
                destroyed: armyADestroyed,
                retreat: retreatA,
            },
            armyB: {
                id: armyBId, name: armyB.name, playerId: armyB.player_id,
                pc: pcB, dead: deadB, lossRate: lossRateB,
                xp: xpB,
                destroyed: armyBDestroyed,
                retreat: retreatB,
            },
            winner: winner ? { id: winner.army_id, name: winner.name, playerId: winner.player_id } : null,
            loser:  loser  ? { id: loser.army_id,  name: loser.name,  playerId: loser.player_id  } : null,
            loot,
        };

        // 14. Notificar
        await this._sendBattleNotifications(battleResult);

        Logger.engine(
            `[TURN ${turn}] BATTLE RESULT at ${h3Index}: ` +
            `${isDraw ? 'EMPATE' : `Victoria ${winner.name}`} | ` +
            `Bajas: A=${deadA}, B=${deadB}`
        );

        return battleResult;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODOS PRIVADOS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Calcula el Poder de Combate total de un ejército.
     * Si isDefender = true, el resultado se multiplica por 1.10 (bono defensivo).
     */
    async _calculateCombatPower(client, troops, enemyTroops, terrain, isDefender = false) {
        const terrainName   = terrain?.terrain_name ?? null;
        const totalEnemyQty = enemyTroops.reduce((s, t) => s + t.quantity, 0) || 1;
        let totalPC = 0;

        for (const troop of troops) {
            const qty    = troop.quantity;
            const attack = parseFloat(troop.attack);

            const moraleFactor  = Math.max(0.5, parseFloat(troop.morale)  / 100);
            const staminaFactor = troop.force_rest ? 0.5 : Math.max(0.1, parseFloat(troop.stamina) / 100);

            let terrainFactor = 1.0;
            if (terrainName) {
                const mod = await CombatModel.getTerrainModifier(client, troop.unit_type_id, terrainName);
                if (mod) terrainFactor = 1 + parseFloat(mod.attack_modificator);
            }

            let counterFactor = 1.0;
            if (enemyTroops.length > 0) {
                let weighted = 0;
                for (const enemy of enemyTroops) {
                    const mult = await CombatModel.getCombatCounter(
                        client, troop.unit_type_id, enemy.unit_type_id
                    );
                    weighted += (enemy.quantity / totalEnemyQty) * mult;
                }
                counterFactor = weighted;
            }

            totalPC += qty * attack * terrainFactor * counterFactor * moraleFactor * staminaFactor;
        }

        if (isDefender) totalPC *= 1.10;
        return totalPC;
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
     * Distribuye experiencia entre supervivientes: cada unidad recibe la misma XP base.
     * EXP_base = (bajas enemigas × 1) + (bajas propias × 2)
     * EXP_final = EXP_base × COMBAT_XP_MULTIPLIER. Cap 100 por tropa.
     * @returns {number} XP base otorgada a cada unidad (tras multiplicador)
     */
    async _distributeExperience(client, survivors, totalExp) {
        if (totalExp <= 0 || survivors.length === 0) return 0;
        const xpPerUnit = Math.round(totalExp * GAME_CONFIG.MILITARY.COMBAT_XP_MULTIPLIER);
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
        const { armyA, armyB, isDraw, winner, loot, h3Index, turn } = battle;

        const formatLoot = (l) =>
            `🪙${l.gold} oro, 🍖${l.food} comida, 🌲${l.wood} madera`;

        const retreatLine = (r) =>
            r ? (r.destroyed ? '\n💀 Sin retirada posible — ejército destruido.' : `\n🏃 Se retira a ${r.newHex}.`) : '';

        let contentA, contentB;

        if (isDraw) {
            contentA =
                `⚔️ EMPATE en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} vs ${armyB.name}\n` +
                `Bajas propias: ${armyA.dead} unidades`;
            contentB =
                `⚔️ EMPATE en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} vs ${armyA.name}\n` +
                `Bajas propias: ${armyB.dead} unidades`;
        } else if (winner.id === armyA.id) {
            const lootLine = loot ? `\n💰 Botín: ${formatLoot(loot)}` : '';
            contentA =
                `⚔️ VICTORIA en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} derrotó a ${armyB.name}\n` +
                `Bajas propias: ${armyA.dead} | Bajas enemigas: ${armyB.dead}` +
                lootLine +
                (armyB.destroyed ? '\n🏳️ Ejército enemigo aniquilado.' : retreatLine(armyB.retreat));
            contentB =
                `⚔️ DERROTA en ${h3Index} (Turno ${turn})\n` +
                `${armyA.name} derrotó a ${armyB.name}\n` +
                `Bajas propias: ${armyB.dead} | Bajas enemigas: ${armyA.dead}` +
                (loot ? `\n💸 Provisiones saqueadas: ${formatLoot(loot)}` : '') +
                retreatLine(armyB.retreat);
        } else {
            const lootLine = loot ? `\n💰 Botín: ${formatLoot(loot)}` : '';
            contentA =
                `⚔️ DERROTA en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} derrotó a ${armyA.name}\n` +
                `Bajas propias: ${armyA.dead} | Bajas enemigas: ${armyB.dead}` +
                (loot ? `\n💸 Provisiones saqueadas: ${formatLoot(loot)}` : '') +
                retreatLine(armyA.retreat);
            contentB =
                `⚔️ VICTORIA en ${h3Index} (Turno ${turn})\n` +
                `${armyB.name} derrotó a ${armyA.name}\n` +
                `Bajas propias: ${armyB.dead} | Bajas enemigas: ${armyA.dead}` +
                lootLine +
                (armyA.destroyed ? '\n🏳️ Ejército enemigo aniquilado.' : retreatLine(armyA.retreat));
        }

        await NotificationService.createSystemNotification(armyA.playerId, 'COMBAT', contentA, turn);
        await NotificationService.createSystemNotification(armyB.playerId, 'COMBAT', contentB, turn);
    }
}

module.exports = new CombatService();
