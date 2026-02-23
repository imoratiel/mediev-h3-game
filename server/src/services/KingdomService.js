const { Logger, logGameEvent } = require('../utils/logger');
const KingdomModel = require('../models/KingdomModel.js');
const ArmyModel = require('../models/ArmyModel.js');
const { CONFIG } = require('../config.js');
const { getPopulationCap } = require('../config/constants.js');
const infrastructure = require('../logic/infrastructure.js');
const conquest = require('../logic/conquest.js');
const pool = require('../../db.js');
const h3 = require('h3-js');

class KingdomService {
    async StartExploration(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.user.player_id;

            await client.query('BEGIN');

            const territory = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (territory?.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const exploration = await KingdomModel.GetExplorationStatus(client, h3_index);
            if (exploration.discovered_resource !== null || exploration.exploration_end_turn !== null) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Exploración ya realizada o en curso' });
            }

            const player = await KingdomModel.GetPlayerGold(client, player_id);
            const cost = CONFIG.exploration.gold_cost;
            if (player.gold < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }

            const world = await KingdomModel.GetCurrentTurn(client);
            const end_turn = world.current_turn + CONFIG.exploration.turns_required;

            await KingdomModel.StartExploration(client, h3_index, player_id, cost, end_turn);
            await client.query('COMMIT');

            logGameEvent(`[EXPLORACIÓN] Jugador ${player_id} inició exploración en ${h3_index}`);

            const updated = await KingdomModel.GetPlayerGold(client, player_id);
            res.json({
                success: true,
                message: `Exploración iniciada, finaliza en turno ${end_turn}`,
                exploration_end_turn: end_turn,
                new_gold_balance: updated.gold,
                gold_spent: cost
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/territory/explore', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async UpgradeBuilding(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index, building_type } = req.body;
            const player_id = req.user.player_id;

            const territory_owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (territory_owner?.player_id !== player_id) {
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const territory = await KingdomModel.GetTerritoryForUpgrade(client, h3_index);
            const validation_error = infrastructure.validateUpgrade(building_type, territory);
            if (validation_error) {
                return res.status(400).json({ success: false, message: validation_error });
            }

            const current_level = territory[`${building_type}_level`] || 0;
            const cost = infrastructure.calculateUpgradeCost(building_type, current_level, CONFIG);

            const player = await KingdomModel.GetPlayerGold(client, player_id);
            if (player.gold < cost) {
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }

            await client.query('BEGIN');
            await KingdomModel.ApplyUpgrade(client, h3_index, player_id, building_type, current_level + 1, cost);
            await client.query('COMMIT');

            logGameEvent(`[INFRAESTRUCTURA] Jugador ${player_id} mejoró ${building_type} en ${h3_index}`);
            res.json({ success: true, message: `${building_type} mejorada al nivel ${current_level + 1}` });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/territory/upgrade', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async GetMyFiefs(req, res) {
        try {
            const result = await KingdomModel.GetMyFiefs(req.user.player_id);

            const fiefs = result.rows.map(row => {
                const is_capital = (row.h3_index === row.capital_h3);
                return {
                    ...row,
                    is_capital,
                    pop_cap: getPopulationCap(row.terrain_name, is_capital),
                };
            });

            res.json({ success: true, fiefs });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/my-fiefs', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener feudos' });
        }
    }
    async ClaimTerritory(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.body;
            if (!h3_index) return res.status(400).json({ success: false, message: 'Falta parámetro: h3_index' });

            await client.query('BEGIN');

            // Colonization is only allowed if the player has NO territory yet (founding the capital)
            const territoryCount = await KingdomModel.GetTerritoryCount(client, player_id);
            if (territoryCount > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: '👑 Ya tienes una capital. Usa la conquista para expandirte.' });
            }

            // Validate selected hex
            const hex = await KingdomModel.GetHexForClaim(client, h3_index);
            if (!hex) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Hexágono no encontrado' }); }
            if (!hex.is_colonizable) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🌊 Este terreno no puede ser colonizado' }); }
            if (hex.player_id !== null) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🛡️ Este territorio ya está ocupado' }); }

            const player = await KingdomModel.GetPlayerGoldForUpdate(client, player_id);
            const CLAIM_COST = 100;
            if (player.gold < CLAIM_COST) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '💰 Oro insuficiente' }); }

            // --- Claim the capital hex ---
            const eco = conquest.generateInitialEconomy();
            await KingdomModel.ClaimHex(client, h3_index, player_id);
            await KingdomModel.InsertTerritoryDetails(client, h3_index, eco);
            await KingdomModel.SetCapital(client, h3_index, player_id);
            await KingdomModel.DeductGold(client, player_id, CLAIM_COST);

            // --- Radial expansion: claim colonizable, unclaimed ring-1 neighbors ---
            const ring1 = h3.gridDisk(h3_index, 1).filter(n => n !== h3_index);
            const colonizableNeighbors = await KingdomModel.GetColonizableNeighbors(client, ring1);

            for (const neighbor of colonizableNeighbors) {
                const neighborEco = conquest.generateInitialEconomy();
                await KingdomModel.ClaimHex(client, neighbor.h3_index, player_id);
                await KingdomModel.InsertTerritoryDetails(client, neighbor.h3_index, neighborEco);
            }

            await client.query('COMMIT');

            Logger.action(`Capital fundada en ${h3_index} con ${colonizableNeighbors.length} territorios adyacentes`, player_id);
            logGameEvent(`[Claim] Jugador ${player_id} fundó capital en ${h3_index} (${colonizableNeighbors.length + 1} hexes reclamados)`);

            res.json({
                success: true,
                is_capital: true,
                claimed_count: colonizableNeighbors.length + 1,
                message: `👑 ¡Capital fundada! Se han reclamado ${colonizableNeighbors.length} territorios adyacentes.`
            });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/game/claim', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async GetCapital(req, res) {
        try {
            const row = await KingdomModel.GetCapital(req.user.player_id);
            if (!row || !row.capital_h3) return res.status(200).json({ success: false, message: 'No tienes capital' });
            res.json({ success: true, h3_index: row.capital_h3 });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/capital', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener información de capital' });
        }
    }

    /**
     * Conquista un hexágono enemigo.
     * Requiere que el jugador tenga un ejército propio en ese hexágono
     * y que no haya ejércitos enemigos en él (hay que atacar primero).
     *
     * POST /api/military/conquer
     * Body: { armyId, h3_index }
     */
    async conquestTerritory(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { armyId, h3_index } = req.body;

            if (!armyId || !h3_index) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros: armyId y h3_index' });
            }

            await client.query('BEGIN');

            // 1. Verificar que el ejército pertenece al jugador y está en el hex indicado
            const armyResult = await client.query(
                'SELECT army_id, name FROM armies WHERE army_id = $1 AND player_id = $2 AND h3_index = $3',
                [armyId, player_id, h3_index]
            );
            if (armyResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'No tienes ningún ejército en ese hexágono'
                });
            }

            // 2. Verificar que el hex pertenece a un enemigo (no propio, no neutral)
            const hexResult = await client.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (hexResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Hexágono no encontrado en el mapa' });
            }

            const currentOwner = hexResult.rows[0].player_id;
            if (currentOwner === player_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este territorio ya es tuyo' });
            }

            // 3. Verificar que no hay ejércitos enemigos en el hex (deben ser derrotados primero)
            const enemyArmiesResult = await client.query(
                'SELECT COUNT(*)::int AS count FROM armies WHERE h3_index = $1 AND player_id != $2',
                [h3_index, player_id]
            );
            if (enemyArmiesResult.rows[0].count > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: '⚔️ Hay ejércitos enemigos en este hexágono. ¡Atácalos primero!'
                });
            }

            // 4. Transferir propiedad del hex al conquistador
            await client.query(
                'UPDATE h3_map SET player_id = $1 WHERE h3_index = $2',
                [player_id, h3_index]
            );

            // 5. Notificar al antiguo propietario (solo si había dueño)
            const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const turn = worldResult.rows[0]?.current_turn ?? 0;
            if (currentOwner !== null) {
                const NotificationService = require('./NotificationService.js');
                await NotificationService.createSystemNotification(
                    currentOwner,
                    'COMBAT',
                    `🏴 TERRITORIO PERDIDO\nEl hexágono ${h3_index} ha sido conquistado por un enemigo (Turno ${turn})`,
                    turn
                );
            }

            await client.query('COMMIT');

            Logger.action(
                `Player ${player_id} conquered ${h3_index} (prev owner: ${currentOwner})`,
                { player_id, h3_index, previous_owner: currentOwner }
            );
            logGameEvent(`[CONQUISTA] Jugador ${player_id} conquistó ${h3_index} (anterior dueño: ${currentOwner})`);

            return res.json({
                success: true,
                message: '🏴 ¡Territorio conquistado!',
                h3_index,
                previous_owner: currentOwner
            });

        } catch (error) {
            if (client) await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/conquer', method: 'POST', userId: req.user?.player_id, payload: req.body });
            return res.status(500).json({ success: false, message: 'Error al procesar la conquista' });
        } finally {
            client.release();
        }
    }

    /**
     * Conquista un feudo mediante combate contra su milicia local.
     * POST /api/military/conquer-fief
     * Body: { armyId, h3_index }
     */
    async conquerFief(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { armyId, h3_index } = req.body;

            if (!armyId || !h3_index) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros: armyId y h3_index' });
            }

            await client.query('BEGIN');

            // 1. Verificar que el ejército pertenece al jugador y está en el hex
            const armyResult = await client.query(
                `SELECT a.army_id, a.name, a.h3_index
                 FROM armies a WHERE a.army_id = $1 AND a.player_id = $2 AND a.h3_index = $3`,
                [armyId, player_id, h3_index]
            );
            if (armyResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'No tienes ningún ejército en ese hexágono' });
            }

            // 2. Verificar que el hex no es propio
            const hexResult = await client.query(
                'SELECT m.player_id, COALESCE(td.custom_name, m.h3_index) AS fief_name, td.population, td.defense_level FROM h3_map m LEFT JOIN territory_details td ON td.h3_index = m.h3_index WHERE m.h3_index = $1',
                [h3_index]
            );
            if (hexResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Hexágono no encontrado' });
            }
            const hex = hexResult.rows[0];
            if (hex.player_id === player_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este territorio ya es tuyo' });
            }

            // 3. Verificar que no hay ejércitos enemigos (deben ser derrotados primero)
            const enemyCheck = await client.query(
                'SELECT COUNT(*)::int AS count FROM armies WHERE h3_index = $1 AND player_id != $2',
                [h3_index, player_id]
            );
            if (enemyCheck.rows[0].count > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: '⚔️ Hay ejércitos enemigos en este hexágono. ¡Atácalos primero!' });
            }

            // 4. SNAPSHOT ANTES: tropas con cantidad actual
            const troopsBefore = await client.query(
                `SELECT t.troop_id, t.quantity, t.morale, t.stamina, t.force_rest,
                        ut.unit_type_id, ut.name AS unit_name, ut.attack
                 FROM troops t JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                 WHERE t.army_id = $1`,
                [armyId]
            );
            const troops = troopsBefore.rows;
            if (troops.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El ejército no tiene tropas' });
            }
            // Mapa id → cantidad antes del combate
            const snapshotBefore = new Map(troops.map(t => [t.troop_id, t.quantity]));

            // 5. Calcular poder atacante
            let attackerPower = 0;
            let attackerTotal = 0;
            for (const t of troops) {
                const moraleFactor = Math.max(0.5, parseFloat(t.morale) / 100);
                const staminaFactor = t.force_rest ? 0.5 : Math.max(0.1, parseFloat(t.stamina) / 100);
                attackerPower += t.quantity * t.attack * moraleFactor * staminaFactor;
                attackerTotal += t.quantity;
            }
            attackerPower *= (0.85 + Math.random() * 0.30);

            // 6. Calcular poder defensor (milicia local)
            const population = parseInt(hex.population) || 200;
            const defenseLevel = parseInt(hex.defense_level) || 0;
            const militiaCount = Math.floor(population * 0.1) + defenseLevel * 10;
            const MILITIA_ATTACK = 3;
            let defenderPower = militiaCount * MILITIA_ATTACK;
            defenderPower *= (0.85 + Math.random() * 0.30);

            // 7. Determinar resultado
            const ratio = attackerPower / (defenderPower || 1);
            let result;
            if (ratio >= 1.1) result = 'victory';
            else if (ratio <= 0.9) result = 'defeat';
            else result = 'draw';

            // 8. Calcular bajas totales
            const attackerLossFraction = result === 'victory' ? 0.05 + (1 / ratio) * 0.10 : 0.20 + Math.random() * 0.15;
            const defenderLossFraction = result === 'defeat' ? 0.30 + Math.random() * 0.20 : 0.70 + Math.random() * 0.30;
            const attacker_losses = Math.min(attackerTotal, Math.floor(attackerTotal * attackerLossFraction));
            const defender_losses = Math.min(militiaCount, Math.floor(militiaCount * defenderLossFraction));

            // 9. Aplicar bajas en DB (proporcional por tipo) y limpiar vacíos
            if (attacker_losses > 0) {
                for (const t of troops) {
                    const deduct = Math.min(t.quantity, Math.floor(attacker_losses * (t.quantity / attackerTotal)));
                    if (deduct > 0) {
                        await client.query(
                            'UPDATE troops SET quantity = quantity - $1 WHERE troop_id = $2',
                            [deduct, t.troop_id]
                        );
                    }
                }
                await client.query('DELETE FROM troops WHERE army_id = $1 AND quantity <= 0', [armyId]);
                await ArmyModel.refreshDetectionRange(client, armyId);
            }

            // 10. SNAPSHOT DESPUÉS: leer cantidades reales post-combate
            const troopsAfter = await client.query(
                'SELECT troop_id, quantity FROM troops WHERE army_id = $1',
                [armyId]
            );
            const snapshotAfter = new Map(troopsAfter.rows.map(t => [t.troop_id, t.quantity]));

            // 11. Construir desglose real (antes - después = perdidos reales)
            const desgloseAtacante = troops.map(t => ({
                nombre: t.unit_name,
                perdidos: snapshotBefore.get(t.troop_id) - (snapshotAfter.get(t.troop_id) ?? 0)
            }));
            const desglose = {
                Atacante: desgloseAtacante,
                Milicia: [{ nombre: 'Milicia del Feudo', perdidos: defender_losses }]
            };

            // 12. Calcular y aplicar experiencia a supervivientes
            // EXP_Total = (milicianos_muertos × 1) + (propios_muertos × 2)
            const expTotal = (defender_losses * 1) + (attacker_losses * 2);
            const totalSurvivors = troopsAfter.rows.reduce((s, r) => s + parseInt(r.quantity), 0);
            // Reparto equitativo por soldado superviviente
            const experience_gained = (expTotal > 0 && totalSurvivors > 0)
                ? Math.round(expTotal / totalSurvivors * 100) / 100
                : 0;

            if (experience_gained > 0) {
                await client.query(
                    `UPDATE troops
                     SET experience = LEAST(100.00, experience + $1)
                     WHERE army_id = $2`,
                    [experience_gained, armyId]
                );
            }

            // 13. Aplicar resultado territorial
            const previousOwner = hex.player_id;
            if (result === 'victory' || result === 'draw') {
                await client.query('UPDATE h3_map SET player_id = $1 WHERE h3_index = $2', [player_id, h3_index]);
                if (previousOwner !== null) {
                    const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
                    const turn = worldResult.rows[0]?.current_turn ?? 0;
                    const NotificationService = require('./NotificationService.js');
                    await NotificationService.createSystemNotification(
                        previousOwner, 'COMBAT',
                        `🏴 TERRITORIO PERDIDO\nEl feudo ${hex.fief_name} ha sido conquistado (Turno ${turn})`,
                        turn
                    );
                }
            }

            await client.query('COMMIT');

            Logger.action(`Player ${player_id} conquerFief ${h3_index} → ${result}`, { player_id, h3_index, result, attacker_losses, defender_losses });
            logGameEvent(`[CONQUISTA-FEUDO] Jugador ${player_id} atacó ${h3_index}: ${result}`);

            return res.json({
                success: true,
                result,
                fief_name: hex.fief_name,
                attacker_total: attackerTotal,
                attacker_losses,
                defender_losses,
                militia_count: militiaCount,
                desglose,
                experience_gained,
                territory_claimed: result === 'victory' || result === 'draw',
                message: result === 'victory' ? 'El feudo ahora es tuyo.'
                        : result === 'draw'    ? 'El feudo cambia de manos por desgaste.'
                                               : 'Tus tropas se retiran en derrota.'
            });

        } catch (error) {
            if (client) await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/conquer-fief', method: 'POST', userId: req.user?.player_id, payload: req.body });
            return res.status(500).json({ success: false, message: 'Error al procesar la conquista del feudo' });
        } finally {
            client.release();
        }
    }
}

module.exports = new KingdomService();
