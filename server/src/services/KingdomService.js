const { Logger, logGameEvent } = require('../utils/logger');
const { initializePlayer } = require('../logic/playerInit.js');
const { isProfane } = require('../utils/profanityFilter.js');
const KingdomModel = require('../models/KingdomModel.js');
const ArmyModel = require('../models/ArmyModel.js');
const CombatModel = require('../models/CombatModel.js');
const { CONFIG } = require('../config.js');
const { getPopulationCap } = require('../config/gameFunctions.js');
const infrastructure = require('../logic/infrastructure.js');
const conquest = require('../logic/conquest.js');
const { calcMilitiaPower, processCapitalCollapse, GRACE_TURNS_DEFAULT } = require('../logic/conquest_system.js');
const pool = require('../../db.js');
const h3 = require('h3-js');
const { executeConstruction, canPerformAction, applyCooldown, processConquestLoot, GameActionError } = require('./gameActions.js');

class KingdomService {
    async StartExploration(req, res) {
        // DISABLED: exploration temporarily disabled
        return res.status(503).json({ success: false, message: 'La exploración de recursos está temporalmente desactivada.' });
        const client = await pool.connect(); // eslint-disable-line no-unreachable
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
    async GetBuildings(req, res) {
        const client = await pool.connect();
        try {
            const culture_id = await KingdomModel.GetPlayerCulture(client, req.user.player_id);
            const buildings = await KingdomModel.GetAllBuildings(client, culture_id);
            res.json({ success: true, buildings });
        } catch (error) {
            Logger.error(error, { endpoint: '/territory/buildings', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener catálogo de edificios' });
        } finally {
            client.release();
        }
    }
    async ConstructBuilding(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index, building_id } = req.body;
            const player_id = req.user.player_id;

            await client.query('BEGIN');
            const result = await executeConstruction(client, player_id, { h3_index, building_id });
            await client.query('COMMIT');

            res.json({ success: true, ...result });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            if (error instanceof GameActionError) {
                return res.status(400).json({ success: false, message: error.message });
            }
            Logger.error(error, { endpoint: '/territory/construct', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al iniciar construcción' });
        } finally {
            client.release();
        }
    }
    async RepairBuilding(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.user.player_id;
            if (!h3_index) return res.status(400).json({ success: false, message: 'h3_index requerido' });

            await client.query('BEGIN');

            // Ownership check
            const owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (owner?.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            // Get building with conservation and gold_cost
            const fbResult = await client.query(`
                SELECT fb.conservation, b.gold_cost
                FROM fief_buildings fb
                JOIN buildings b ON fb.building_id = b.id
                WHERE fb.h3_index = $1 AND fb.is_under_construction = FALSE
            `, [h3_index]);
            if (fbResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'No hay edificio construido en este feudo' });
            }
            const { conservation, gold_cost } = fbResult.rows[0];
            if (conservation >= 100) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El edificio ya está en perfecto estado' });
            }

            const repair_cost = Math.ceil((100 - conservation) / 100 * gold_cost);
            const player = await KingdomModel.GetPlayerGold(client, player_id);
            if ((player?.gold ?? 0) < repair_cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Oro insuficiente. Necesitas ${repair_cost} 💰` });
            }

            await KingdomModel.DeductGold(client, player_id, repair_cost);
            await KingdomModel.RepairBuilding(client, h3_index);
            await client.query('COMMIT');

            Logger.action(`[ACTION] Jugador ${player_id} reparó edificio en ${h3_index} (-${repair_cost}💰)`);
            res.json({ success: true, message: `Edificio reparado (-${repair_cost} 💰)`, repair_cost });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: '/territory/repair-building', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al reparar el edificio' });
        } finally {
            client.release();
        }
    }
    async UpgradeFiefBuilding(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.user.player_id;

            if (!h3_index) {
                return res.status(400).json({ success: false, message: 'h3_index es requerido' });
            }

            // Verify ownership
            const owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (owner?.player_id !== player_id) {
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            // Get current completed building
            const current = await KingdomModel.GetExistingFiefBuilding(client, h3_index);
            if (!current) {
                return res.status(400).json({ success: false, message: 'Este feudo no tiene ningún edificio' });
            }
            if (current.is_under_construction) {
                return res.status(400).json({ success: false, message: 'El edificio actual aún está en construcción' });
            }

            // Find the upgrade building
            const result = await client.query(
                'SELECT * FROM buildings WHERE required_building_id = $1 LIMIT 1',
                [current.building_id]
            );
            const next = result.rows[0];
            if (!next) {
                return res.status(400).json({ success: false, message: 'Este edificio no tiene mejora disponible' });
            }

            // Verify gold
            const player = await KingdomModel.GetPlayerGold(client, player_id);
            if (player.gold < next.gold_cost) {
                return res.status(400).json({ success: false, message: `Oro insuficiente. Necesitas ${next.gold_cost} 💰` });
            }

            await client.query('BEGIN');
            await KingdomModel.DeductGold(client, player_id, next.gold_cost);
            await KingdomModel.UpgradeFiefBuilding(client, h3_index, next.id, next.construction_time_turns);
            await client.query('COMMIT');

            Logger.action(
                `🏰 Jugador ${player_id} inició ampliación a "${next.name}" en ${h3_index} (${next.construction_time_turns} turnos)`,
                { player_id, h3_index, next_building_id: next.id, building_name: next.name }
            );
            res.json({
                success: true,
                message: `Ampliación a ${next.name} iniciada. Turnos restantes: ${next.construction_time_turns}`,
                building_name: next.name,
                turns: next.construction_time_turns,
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: '/territory/upgrade-building', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al iniciar ampliación' });
        } finally {
            client.release();
        }
    }
    async GetMyFiefs(req, res) {
        try {
            const page         = Math.max(1, parseInt(req.query.page)  || 1);
            const limit        = Math.min(500, Math.max(1, parseInt(req.query.limit) || 10));
            const filter_name     = (req.query.filter_name     || '').trim();
            const filter_division = (req.query.filter_division || '').trim();
            const filter_maxpop = req.query.filter_maxpop != null && req.query.filter_maxpop !== ''
                ? parseInt(req.query.filter_maxpop) : null;

            const { rows, total } = await KingdomModel.GetMyFiefs(req.user.player_id, {
                page, limit, filter_name, filter_maxpop, filter_division
            });

            const fiefs = rows.map(row => {
                const is_capital = (row.h3_index === row.capital_h3);
                return {
                    ...row,
                    is_capital,
                    pop_cap: getPopulationCap(row.terrain_name, is_capital),
                    fief_building: row.fief_building_id ? {
                        id: row.fief_building_id,
                        name: row.fief_building_name,
                        type_name: row.fief_building_type_name,
                        is_under_construction: row.fief_building_constructing,
                        turns_left: row.fief_building_constructing ? row.fief_building_turns_left : null,
                        conservation: row.fief_building_conservation ?? 100,
                        repair_cost: Math.ceil((100 - (row.fief_building_conservation ?? 100)) / 100 * (row.fief_building_gold_cost ?? 0)),
                        upgrade: (!row.fief_building_constructing && row.upgrade_building_id) ? {
                            id:        row.upgrade_building_id,
                            name:      row.upgrade_building_name,
                            gold_cost: row.upgrade_gold_cost,
                            turns:     row.upgrade_turns
                        } : null,
                    } : null,
                    can_recruit: is_capital || (
                        !!row.fief_building_id &&
                        !row.fief_building_constructing &&
                        (row.fief_building_type_name || '').toLowerCase() === 'military'
                    ),
                };
            });

            res.json({ success: true, fiefs, total, page, limit });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/my-fiefs', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener feudos' });
        }
    }
    async GetCapital(req, res) {
        try {
            const row = await KingdomModel.GetCapital(req.user.player_id);
            const isExiled = row?.is_exiled ?? false;
            if (!row || (!row.capital_h3 && !isExiled)) {
                return res.status(200).json({ success: false, message: 'No tienes capital', is_exiled: false });
            }
            if (isExiled) {
                return res.json({ success: true, h3_index: null, is_exiled: true, message: '⛓️ Estás en el exilio. Coloniza cualquier feudo libre para reanudar tu reino.' });
            }
            res.json({ success: true, h3_index: row.capital_h3, is_exiled: false });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/capital', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener información de capital' });
        }
    }

    async ClaimTerritory(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.body;

            if (!h3_index) {
                return res.status(400).json({ success: false, message: 'Falta parámetro: h3_index' });
            }

            await client.query('BEGIN');

            const territoryCount = await KingdomModel.GetTerritoryCount(client, player_id);
            const isFirstTerritory = (territoryCount === 0);

            const isExiled = await KingdomModel.GetPlayerExileStatus(client, player_id);

            const hex = await KingdomModel.GetHexForClaim(client, h3_index);
            if (!hex) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Hexágono no encontrado en el mapa' });
            }
            if (!hex.is_colonizable) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: '🌊 No puedes colonizar este tipo de terreno' });
            }
            if (hex.player_id !== null) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: '🛡️ Este territorio ya está ocupado' });
            }

            const playerRow = await KingdomModel.GetPlayerGoldForUpdate(client, player_id);
            if (!playerRow) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
            }

            const CLAIM_COST = (isFirstTerritory || isExiled) ? 0 : 100;
            if (playerRow.gold < CLAIM_COST) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `💰 Oro insuficiente. Necesitas: ${CLAIM_COST}, Tienes: ${playerRow.gold}` });
            }

            if (!isFirstTerritory && !isExiled) {
                const neighbors = h3.gridDisk(h3_index, 1).filter(n => n !== h3_index);
                const adjResult = await client.query(
                    'SELECT COUNT(*) as count FROM h3_map WHERE player_id = $1 AND h3_index = ANY($2::text[])',
                    [player_id, neighbors]
                );
                if (parseInt(adjResult.rows[0].count) === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: '📍 Debes colonizar territorios contiguos a los tuyos' });
                }
            }

            const eco = {
                population: Math.floor(Math.random() * 201) + 200,
                happiness: Math.floor(Math.random() * 21) + 50,
                food: Math.floor(Math.random() * 2001),
                wood: Math.floor(Math.random() * 2001),
                stone: Math.floor(Math.random() * 2001),
                gold: Math.floor(Math.random() * 501) + 100,
            };

            await KingdomModel.ClaimHex(client, h3_index, player_id);
            if (isFirstTerritory || isExiled) {
                await KingdomModel.SetCapital(client, h3_index, player_id);
                if (isExiled) await KingdomModel.ClearExileStatus(client, player_id);
            }
            await KingdomModel.InsertTerritoryDetails(client, h3_index, eco);
            await KingdomModel.DeductGold(client, player_id, CLAIM_COST);

            // On first claim (capital/exile), also claim all colonizable ring-2 neighbors for free
            let bonusHexes = [];
            if (isFirstTerritory || isExiled) {
                const ring1 = h3.gridDisk(h3_index, 2).filter(n => n !== h3_index);
                const neighbors = await KingdomModel.GetColonizableNeighbors(client, ring1);
                for (const neighbor of neighbors) {
                    await KingdomModel.ClaimHex(client, neighbor.h3_index, player_id);
                    await KingdomModel.InsertTerritoryDetails(client, neighbor.h3_index, {
                        population: Math.floor(Math.random() * 201) + 200,
                        happiness: Math.floor(Math.random() * 21) + 50,
                        food: Math.floor(Math.random() * 2001),
                        wood: Math.floor(Math.random() * 2001),
                        stone: Math.floor(Math.random() * 2001),
                    });
                    bonusHexes.push(neighbor.h3_index);
                }
            }

            await client.query('COMMIT');

            logGameEvent(`[COLONIZACIÓN] Jugador ${player_id} colonizó ${h3_index}${isFirstTerritory || isExiled ? ` (capital) + ${bonusHexes.length} adyacentes` : ''}`);

            const updatedGold = playerRow.gold - CLAIM_COST;
            res.json({
                success: true,
                new_gold_balance: updatedGold,
                is_capital: isFirstTerritory || isExiled,
                bonus_hexes: bonusHexes,
                message: (isFirstTerritory || isExiled)
                    ? `👑 ¡Capital fundada! Tu reino comienza aquí. (+${bonusHexes.length} territorios adyacentes)`
                    : `🏰 ¡Territorio #${territoryCount + 1} colonizado!`
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/game/claim', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error interno del servidor: ' + error.message });
        } finally {
            client.release();
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
                return res.status(404).json({ success: false, message: 'No tienes ningún ejército en ese hexágono' });
            }

            // 2. Cooldown check
            if (!(await canPerformAction(client, armyId, 'conquer'))) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Este ejército no puede conquistar todavía. Debe esperar a que pase el período de enfriamiento.',
                    code: 'COOLDOWN_ACTIVE',
                });
            }

            // 3. Verificar que el hex no es propio + cargar datos de milicia y capital
            const hexResult = await client.query(`
                SELECT m.player_id,
                       COALESCE(td.custom_name, m.h3_index) AS fief_name,
                       COALESCE(td.population, 200)    AS population,
                       COALESCE(td.defense_level, 0)   AS defense_level,
                       p.capital_h3
                FROM h3_map m
                LEFT JOIN territory_details td ON td.h3_index = m.h3_index
                LEFT JOIN players p ON p.player_id = m.player_id
                WHERE m.h3_index = $1
            `, [h3_index]);
            if (hexResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Hexágono no encontrado en el mapa' });
            }
            const hex = hexResult.rows[0];
            const currentOwner = hex.player_id;
            if (currentOwner === player_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este territorio ya es tuyo' });
            }

            // 3. Verificar que no hay ejércitos enemigos (deben ser derrotados primero)
            const enemyArmiesResult = await client.query(
                'SELECT COUNT(*)::int AS count FROM armies WHERE h3_index = $1 AND player_id != $2',
                [h3_index, player_id]
            );
            if (enemyArmiesResult.rows[0].count > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: '⚔️ Hay ejércitos enemigos en este hexágono. ¡Atácalos primero!' });
            }

            // 4. Cargar tropas del ejército atacante
            const troopsResult = await client.query(`
                SELECT t.troop_id, t.quantity, t.morale, t.stamina, t.force_rest,
                       ut.unit_type_id, ut.name AS unit_name, ut.attack
                FROM troops t JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                WHERE t.army_id = $1
            `, [armyId]);
            const troops = troopsResult.rows;
            if (troops.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El ejército no tiene tropas' });
            }

            // 5. Resistencia Civil — calcular poderes de combate
            let attackerPower = 0;
            let attackerTotal = 0;
            for (const t of troops) {
                const moraleFactor  = Math.max(0.5, parseFloat(t.morale)  / 100);
                const staminaFactor = t.force_rest ? 0.5 : Math.max(0.1, parseFloat(t.stamina) / 100);
                attackerPower += t.quantity * t.attack * moraleFactor * staminaFactor;
                attackerTotal += t.quantity;
            }
            attackerPower *= (0.85 + Math.random() * 0.30);

            const { militiaCount, defenderPower } = calcMilitiaPower(hex.population, hex.defense_level);

            const ratio = attackerPower / (defenderPower || 1);
            let result;
            if (ratio >= 1.1)      result = 'victory';
            else if (ratio <= 0.9) result = 'defeat';
            else                   result = 'draw';

            // 6. Calcular y aplicar bajas al atacante
            const attackerLossFraction = result === 'victory' ? 0.05 + (1 / ratio) * 0.10 : 0.20 + Math.random() * 0.15;
            const defenderLossFraction = result === 'defeat'  ? 0.30 + Math.random() * 0.20 : 0.70 + Math.random() * 0.30;
            const attacker_losses = Math.min(attackerTotal, Math.floor(attackerTotal * attackerLossFraction));
            const defender_losses = Math.min(militiaCount,  Math.floor(militiaCount  * defenderLossFraction));

            if (attacker_losses > 0) {
                const snapshotBefore = new Map(troops.map(t => [t.troop_id, t.quantity]));
                for (const t of troops) {
                    const deduct = Math.min(t.quantity, Math.floor(attacker_losses * (t.quantity / attackerTotal)));
                    if (deduct > 0) {
                        await client.query('UPDATE troops SET quantity = quantity - $1 WHERE troop_id = $2', [deduct, t.troop_id]);
                    }
                }
                await client.query('DELETE FROM troops WHERE army_id = $1 AND quantity <= 0', [armyId]);
                await ArmyModel.refreshDetectionRange(client, armyId);
            }

            // Ghost army cleanup: delete army if all troops are gone
            const armyDestroyed = await CombatModel.deleteArmyIfEmpty(client, armyId);

            const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // 7. Registrar cooldown de conquista (se aplica siempre, gane o pierda)
            await applyCooldown(client, armyId, 'conquer');

            // 8. Derrota → el territorio no cambia de dueño
            if (result === 'defeat') {
                await client.query('COMMIT');
                Logger.action(`Player ${player_id} failed to conquer ${h3_index} (civil resistance)`, { player_id, h3_index, result });
                return res.json({
                    success: false,
                    result: 'defeat',
                    fief_name: hex.fief_name,
                    attacker_losses,
                    defender_losses,
                    militia_count: militiaCount,
                    army_destroyed: armyDestroyed,
                    message: armyDestroyed
                        ? '⚔️ ¡Tu ejército fue aniquilado por la resistencia popular!'
                        : '⚔️ La población resistió. Tus tropas se retiran en derrota.'
                });
            }

            // 8. Victoria o Empate → transferir propiedad
            await client.query('UPDATE h3_map SET player_id = $1 WHERE h3_index = $2', [player_id, h3_index]);
            await client.query('UPDATE territory_details SET grace_turns = $1 WHERE h3_index = $2', [GRACE_TURNS_DEFAULT, h3_index]);

            // 9. Notificar al antiguo propietario
            if (currentOwner !== null) {
                const NotificationService = require('./NotificationService.js');
                await NotificationService.createSystemNotification(
                    currentOwner, 'Militar',
                    `🏴 TERRITORIO PERDIDO\nEl feudo ${hex.fief_name} ha sido conquistado por un enemigo (Turno ${turn})`,
                    turn
                );
            }

            // 10. Si era la capital del derrotado → efecto dominó
            const isCapital = currentOwner !== null && hex.capital_h3 === h3_index;
            let cascadedFiefs = [];
            if (isCapital) {
                cascadedFiefs = await processCapitalCollapse(client, h3_index, player_id, currentOwner, turn);
            }

            // 11. Saqueo (solo si el ejército sobrevivió)
            let lootResult = null;
            if (!armyDestroyed) {
                lootResult = await processConquestLoot(client, armyId, h3_index);
            }

            await client.query('COMMIT');

            Logger.action(`Player ${player_id} conquered ${h3_index} (prev owner: ${currentOwner}, result: ${result})`, { player_id, h3_index, previous_owner: currentOwner, result, cascaded: cascadedFiefs.length });
            logGameEvent(`[CONQUISTA] Jugador ${player_id} conquistó ${h3_index} (dueño anterior: ${currentOwner}) — ${isCapital ? `¡CAPITAL! Cascada: ${cascadedFiefs.length} feudos` : 'feudo normal'}`);

            return res.json({
                success: true,
                result,
                fief_name: hex.fief_name,
                attacker_losses,
                defender_losses,
                militia_count: militiaCount,
                territory_claimed: true,
                is_capital_conquest: isCapital,
                cascaded_fiefs: cascadedFiefs.length,
                army_destroyed: armyDestroyed,
                loot: lootResult,
                message: isCapital
                    ? `🏚️ ¡Capital conquistada! ${cascadedFiefs.length} feudos colapsaron automáticamente.`
                    : result === 'victory' ? '🏴 ¡Territorio conquistado!' : '🏴 El territorio cambia de manos por desgaste.'
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

            // 2. Verificar que el hex no es propio + cargar datos de milicia y capital
            const hexResult = await client.query(`
                SELECT m.player_id,
                       COALESCE(td.custom_name, m.h3_index) AS fief_name,
                       COALESCE(td.population, 200)    AS population,
                       COALESCE(td.defense_level, 0)   AS defense_level,
                       p.capital_h3
                FROM h3_map m
                LEFT JOIN territory_details td ON td.h3_index = m.h3_index
                LEFT JOIN players p ON p.player_id = m.player_id
                WHERE m.h3_index = $1
            `, [h3_index]);
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

            // Ghost army cleanup: delete army if all troops are gone
            const armyDestroyed = await CombatModel.deleteArmyIfEmpty(client, armyId);

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
            let cascadedFiefs = [];
            let isCapital = false;
            if (result === 'victory' || result === 'draw') {
                await client.query('UPDATE h3_map SET player_id = $1 WHERE h3_index = $2', [player_id, h3_index]);
                // Período de gracia para el feudo recién conquistado
                await client.query('UPDATE territory_details SET grace_turns = $1 WHERE h3_index = $2', [GRACE_TURNS_DEFAULT, h3_index]);

                const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
                const turn = worldResult.rows[0]?.current_turn ?? 0;

                if (previousOwner !== null) {
                    const NotificationService = require('./NotificationService.js');
                    await NotificationService.createSystemNotification(
                        previousOwner, 'Militar',
                        `🏴 TERRITORIO PERDIDO\nEl feudo ${hex.fief_name} ha sido conquistado (Turno ${turn})`,
                        turn
                    );
                }

                // Si era la capital del derrotado → efecto dominó
                isCapital = previousOwner !== null && hex.capital_h3 === h3_index;
                if (isCapital) {
                    cascadedFiefs = await processCapitalCollapse(client, h3_index, player_id, previousOwner, turn);
                }
            }

            // Registrar cooldown de conquista (se aplica siempre, gane o pierda)
            await applyCooldown(client, armyId, 'conquer');

            // 14. Saqueo (solo si se conquistó y el ejército sigue vivo)
            let lootResult = null;
            if ((result === 'victory' || result === 'draw') && !armyDestroyed) {
                lootResult = await processConquestLoot(client, armyId, h3_index);
            }

            await client.query('COMMIT');

            Logger.action(`Player ${player_id} conquerFief ${h3_index} → ${result}${isCapital ? ` [CAPITAL, cascade: ${cascadedFiefs.length}]` : ''}`, { player_id, h3_index, result, attacker_losses, defender_losses });
            logGameEvent(`[CONQUISTA-FEUDO] Jugador ${player_id} atacó ${h3_index}: ${result}${isCapital ? ` — ¡CAPITAL! Cascada: ${cascadedFiefs.length} feudos` : ''}`);

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
                is_capital_conquest: isCapital,
                cascaded_fiefs: cascadedFiefs.length,
                army_destroyed: armyDestroyed,
                loot: lootResult,
                message: isCapital && result !== 'defeat'
                    ? `🏚️ ¡Capital conquistada! ${cascadedFiefs.length} feudos colapsaron automáticamente.`
                    : result === 'victory' ? 'El feudo ahora es tuyo.'
                    : result === 'draw'    ? 'El feudo cambia de manos por desgaste.'
                    : armyDestroyed        ? '⚔️ ¡Tu ejército fue aniquilado por la resistencia!'
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
    async UpgradeFarm(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index } = req.params;
            const player_id = req.user.player_id;

            await client.query('BEGIN');

            const territory_owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (territory_owner?.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const territory = await KingdomModel.GetTerritoryForUpgrade(client, h3_index);
            if (!territory) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Territorio no encontrado' });
            }

            const validation_error = infrastructure.validateUpgrade('farm', territory);
            if (validation_error) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: validation_error });
            }

            const current_level = territory.farm_level || 0;
            const cost = infrastructure.calculateFarmUpgradeCost(current_level, CONFIG);

            const player = await KingdomModel.GetPlayerGoldForUpdate(client, player_id);
            if (player.gold < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Oro insuficiente. Coste: ${cost.toLocaleString()}, disponible: ${player.gold.toLocaleString()}` });
            }

            await KingdomModel.ApplyUpgrade(client, h3_index, player_id, 'farm', current_level + 1, cost);
            await client.query('COMMIT');

            logGameEvent(`[GRANJA] Jugador ${player_id} mejoró granja en ${h3_index} al nivel ${current_level + 1}`);
            res.json({
                success: true,
                message: `Granja mejorada al nivel ${current_level + 1}`,
                new_level: current_level + 1,
                gold_spent: cost,
                new_gold: player.gold - cost
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: `/fiefs/${req.params.h3_index}/upgrade-farm`, method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al mejorar la granja' });
        } finally {
            client.release();
        }
    }

    async InitializePlayer(req, res) {
        const player_id      = req.user.player_id;
        const forceCultureId = req.query?.culture_id ? parseInt(req.query.culture_id, 10) : null;
        const randomBonus    = req.query?.random_bonus === 'true';
        const linaje         = (req.query?.linaje ?? '').trim();

        // Validate linaje
        if (!linaje || linaje.length < 3 || linaje.length > 30) {
            return res.status(400).json({ success: false, message: 'El nombre del linaje debe tener entre 3 y 30 caracteres.' });
        }
        if (!/^[\p{L}\s\-']+$/u.test(linaje)) {
            return res.status(400).json({ success: false, message: 'El linaje solo puede contener letras, espacios y guiones.' });
        }
        if (isProfane(linaje)) {
            return res.status(400).json({ success: false, message: 'Ese nombre no está permitido.' });
        }

        console.log(`[Init] player=${player_id} culture_id=${forceCultureId} random_bonus=${randomBonus} linaje=${linaje} | query:`, req.query);
        try {
            const result = await initializePlayer(player_id, { forceCultureId, randomBonus, linaje });
            if (result.alreadyInitialized) {
                return res.status(409).json({ success: false, message: 'El jugador ya ha sido inicializado' });
            }
            if (result.linajeTaken) {
                return res.status(409).json({ success: false, linaje_taken: true, message: `El linaje "${linaje}" ya está en uso. Elige otro nombre.` });
            }
            Logger.action(
                `✅ Inicialización completada. Capital: ${result.capitalHex}, feudos: ${result.allHexes.length}, señorío: ${result.senorioName ?? 'ninguno'}`,
                player_id
            );
            logGameEvent(`[INIT] Jugador ${player_id} inicializado. Capital: ${result.capitalHex}`);
            res.json({ success: true, capital_h3: result.capitalHex, bonus_hexes: result.allHexes });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/initialize', method: 'POST', userId: player_id });
            res.status(500).json({ success: false, message: 'Error al inicializar jugador: ' + error.message });
        }
    }
}

module.exports = new KingdomService();
