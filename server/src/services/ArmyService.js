const { Logger } = require('../utils/logger');
const ArmyModel = require('../models/ArmyModel.js');
const CharacterModel = require('../models/CharacterModel.js');
const WorkerModel = require('../models/WorkerModel.js');
const ArmySimulationService = require('./ArmySimulationService.js');
const h3 = require('h3-js');
const pool = require('../../db.js');
const GAME_CONFIG = require('../config/constants.js');
const { getArmyLimit, getPopulationCap } = require('../config/gameFunctions.js');
const NameGenerator = require('../logic/NameGenerator.js');
const recruitmentNetwork = require('../logic/recruitmentNetwork.js');
const { executeRecruitment, GameActionError } = require('./gameActions.js');

class ArmyService {
    async GetArmyDetails(req, res) {
        try {
            const { h3_index } = req.params;
            const requestingPlayerId = req.user.player_id;

            const armiesResult = await ArmyModel.GetArmyDetailsByHex(h3_index);
            const armies = armiesResult.rows;

            for (const army of armies) {
                const isOwn = army.player_id === requestingPlayerId;

                if (isOwn) {
                    // Full intelligence for own army
                    const unitsResult = await ArmyModel.GetArmyUnits(army.army_id);
                    army.units = unitsResult.rows;
                    army.total_count = army.units.reduce((sum, u) => sum + u.quantity, 0);

                    const fatigueStatus = await ArmySimulationService.getArmyFatigueStatus(army.army_id);
                    if (fatigueStatus.success) {
                        army.min_stamina = fatigueStatus.minStamina;
                        army.has_force_rest = fatigueStatus.hasForceRest;
                        army.exhausted_units = fatigueStatus.exhaustedUnits;
                    } else {
                        army.min_stamina = 100;
                        army.has_force_rest = false;
                        army.exhausted_units = 0;
                    }
                } else {
                    // Enemy army: redact all sensitive military intelligence
                    army.units = null;
                    army.total_count = null;
                    army.min_stamina = null;
                    army.has_force_rest = null;
                    army.exhausted_units = null;
                    army.food_provisions = null;
                    army.gold_provisions = null;
                    army.wood_provisions = null;
                    army.is_enemy = true;
                }
            }

            res.json({ success: true, armies, current_player_id: requestingPlayerId });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/army-details', method: 'GET', userId: req.user?.player_id, payload: req.params });
            res.status(500).json({ success: false, message: 'Error al obtener detalles del ejército' });
        }
    }
    async GetUnitTypes(req, res) {
        try {
            const result = await ArmyModel.GetUnitTypes();
            res.json({ success: true, unit_types: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/unit-types', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener tipos de unidades' });
        }
    }
    async Recruit(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index, unit_type_id, quantity } = req.body;

            await client.query('BEGIN');

            const cultureRow = await client.query('SELECT culture_id FROM players WHERE player_id = $1', [player_id]);
            const culture_id = cultureRow.rows[0]?.culture_id ?? null;
            const army_name = req.body.army_name || NameGenerator.generate(culture_id);
            const result = await executeRecruitment(client, player_id, { h3_index, unit_type_id, quantity, army_name });
            await client.query('COMMIT');

            res.json({ success: true, ...result });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof GameActionError) {
                return res.status(400).json({ success: false, message: error.message });
            }
            Logger.error(error, { endpoint: '/military/recruit', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al reclutar unidades', error: error.message });
        } finally {
            client.release();
        }
    }
    async GetTroops(req, res) {
        try {
            const player_id = req.user.player_id;
            const result = await ArmyModel.GetTroops(player_id);
            Logger.action('Consultó panel de tropas', player_id);
            res.json({ success: true, troops: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/troops', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener tropas' });
        }
    }
    async GetArmies(req, res) {
        try {
            const player_id = req.user.player_id;
            const result = await ArmyModel.GetArmies(player_id);
            const armies = result.rows.map(a => ({
                ...a,
                total_troops:      parseInt(a.total_troops)      || 0,
                total_combat_power: parseInt(a.total_combat_power) || 0,
                average_moral:     parseInt(a.average_moral)     || 0,
                min_stamina:       parseInt(a.min_stamina)       || 0,
                fief_grace_turns:  parseInt(a.fief_grace_turns)  || 0,
                is_own_fief:       a.is_own_fief === true,
            }));
            res.json({ success: true, armies });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/armies', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos' });
        }
    }
    async GetArmyDetail(req, res) {
        try {
            const player_id = req.user.player_id;
            const armyId = parseInt(req.params.id);
            if (!armyId) return res.status(400).json({ success: false, message: 'ID inválido' });

            const detail = await ArmyModel.GetArmyFullDetail(armyId, player_id);
            if (!detail) return res.status(404).json({ success: false, message: 'Ejército no encontrado' });

            // Normalizar decimales
            detail.troops = detail.troops.map(t => ({
                ...t,
                quantity:   parseInt(t.quantity)          || 0,
                experience: parseFloat(t.experience).toFixed(1),
                morale:     parseFloat(t.morale).toFixed(1),
                stamina:    parseFloat(t.stamina).toFixed(1),
            }));
            detail.army.gold_provisions  = parseFloat(detail.army.gold_provisions)  || 0;
            detail.army.food_provisions  = parseFloat(detail.army.food_provisions)  || 0;
            detail.army.wood_provisions  = parseFloat(detail.army.wood_provisions)  || 0;
            detail.army.fief_population  = parseInt(detail.army.fief_population)    || 0;
            detail.army.fief_grace_turns = parseInt(detail.army.fief_grace_turns)   || 0;
            detail.army.fief_wood        = parseInt(detail.army.fief_wood)          || 0;
            detail.army.fief_stone       = parseInt(detail.army.fief_stone)         || 0;
            detail.army.fief_iron        = parseInt(detail.army.fief_iron)          || 0;
            detail.army.is_own_fief      = detail.army.is_own_fief === true;
            // Compute population cap for dismiss-warning in the UI
            // getPopulationCap imported at top of file
            const isCapital = detail.army.h3_index === detail.army.capital_h3;
            detail.army.fief_pop_cap = getPopulationCap(detail.army.terrain_name, isCapital);

            res.json({ success: true, ...detail });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/armies/:id', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener detalle del ejército' });
        }
    }

    async MoveArmy(req, res) {
        try {
            const player_id = req.user.player_id;
            const { army_id, target_h3 } = req.body;

            if (!army_id || !target_h3) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos (army_id, target_h3)' });
            }

            const armyResult = await ArmyModel.GetArmyWithPlayer(army_id);
            if (armyResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Ejército no encontrado' });
            }

            const army = armyResult.rows[0];
            if (army.player_id !== player_id) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para mover este ejército' });
            }

            if (army.is_garrison) {
                return res.status(400).json({ success: false, message: 'Las tropas acuarteladas no pueden moverse. Forman parte de la guarnición del feudo.' });
            }

            const distance = h3.gridDistance(army.h3_index, target_h3);
            const MAX_DISTANCE = GAME_CONFIG.MAP.MAX_MOVEMENT_DISTANCE;
            if (distance > MAX_DISTANCE) {
                Logger.army(army_id, 'MOVE_ERROR',
                    `Distancia excedida: ${distance} hexágonos (Máx: ${MAX_DISTANCE})`,
                    { army_id, from: army.h3_index, to: target_h3, distance, max_distance: MAX_DISTANCE }
                );
                return res.status(400).json({ success: false, message: `Destino demasiado lejano (${distance} hexágonos, máximo ${MAX_DISTANCE})` });
            }

            const routeResult = await ArmySimulationService.calculateAndSaveRoute(army_id, target_h3);
            if (!routeResult.success) {
                return res.status(400).json({ success: false, message: routeResult.message || 'No se pudo calcular la ruta hacia ese destino' });
            }

            Logger.action(
                `Destino fijado para "${army.name}": ${army.h3_index} → ${target_h3} (ruta: ${routeResult.steps} pasos)`,
                player_id,
                { army_id, from: army.h3_index, to: target_h3, distance, steps: routeResult.steps }
            );

            res.json({
                success: true,
                message: `${army.name} en marcha hacia ${target_h3} (${routeResult.steps} pasos en ruta)`,
                data: {
                    army_name: army.name,
                    from: army.h3_index,
                    to: target_h3,
                    distance,
                    steps: routeResult.steps,
                    path: routeResult.path
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/move-army', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al mover ejército', error: error.message });
        }
    }
    async GetMyRoutes(req, res) {
        try {
            const result = await ArmyModel.GetMyRoutes(req.user.player_id);
            res.json({ success: true, routes: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/my-routes', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener rutas' });
        }
    }
    async BulkRecruit(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index, army_name, units, mode = 'field' } = req.body;
            const is_garrison = mode === 'garrison';
            // units: [{ unit_type_id, quantity }, ...]

            if (!h3_index || !Array.isArray(units) || units.length === 0) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos' });
            }
            for (const u of units) {
                if (!u.unit_type_id || !u.quantity || u.quantity <= 0) {
                    return res.status(400).json({ success: false, message: 'Unidades inválidas en el lote' });
                }
            }

            await client.query('BEGIN');

            // Verify territory ownership
            const terrResult = await ArmyModel.GetTerritoryForRecruitment(client, h3_index);
            if (!terrResult.rows.length || terrResult.rows[0].player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres propietario de este territorio' });
            }
            const territory = terrResult.rows[0];

            // ── Validación de ubicación: Capital o edificio militar ───────────────
            const isCapital = territory.capital_h3 === h3_index;
            if (!isCapital) {
                const hasMilitary = await ArmyModel.CheckMilitaryBuildingInFief(client, h3_index);
                if (!hasMilitary) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        message: 'Solo puedes reclutar en tu Capital o en feudos con un edificio militar (Cuartel o Fortaleza).'
                    });
                }
            }

            // ── Validación de población por red conectada ─────────────────────────
            const totalTroops = units.reduce((s, u) => s + u.quantity, 0);
            const connectedH3s = await recruitmentNetwork.getConnectedNetwork(client, h3_index, player_id);
            const fiefPops = await recruitmentNetwork.getFiefPopulations(client, connectedH3s);
            const recruitablePool = recruitmentNetwork.calcRecruitablePool(fiefPops);

            if (recruitablePool < totalTroops) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Población insuficiente. Tu red de feudos puede aportar ${recruitablePool} reclutas (mínimo garantizado por feudo: ${GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION} hab.; límite en señorío: ${GAME_CONFIG.DIVISIONS.MAX_RECRUITS_DIVISION}, en feudo libre: ${GAME_CONFIG.DIVISIONS.MAX_RECRUITS_INDEPENDENT}).`
                });
            }

            // Fetch all requirements in one query
            const unitTypeIds = units.map(u => u.unit_type_id);
            const reqResult = await ArmyModel.GetBulkUnitRequirements(client, unitTypeIds);
            const requirementsByType = {};
            for (const row of reqResult.rows) {
                if (!requirementsByType[row.unit_type_id]) requirementsByType[row.unit_type_id] = [];
                requirementsByType[row.unit_type_id].push(row);
            }

            // Compute total cost
            const totalCost = { gold: 0, wood_stored: 0, stone_stored: 0, iron_stored: 0 };
            for (const u of units) {
                const reqs = requirementsByType[u.unit_type_id] || [];
                for (const req of reqs) {
                    totalCost[req.resource_type] = (totalCost[req.resource_type] || 0) + req.amount * u.quantity;
                }
            }

            // Validate resources
            const goldResult = await ArmyModel.GetPlayerGold(client, player_id);
            const playerGold = parseFloat(goldResult.rows[0]?.gold) || 0;
            if (playerGold < totalCost.gold) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }
            if ((territory.wood_stored || 0) < totalCost.wood_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Madera insuficiente' });
            }
            if ((territory.stone_stored || 0) < totalCost.stone_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Piedra insuficiente' });
            }
            if ((territory.iron_stored || 0) < totalCost.iron_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Hierro insuficiente' });
            }

            // Deduct resources
            if (totalCost.gold > 0) await ArmyModel.DeductPlayerGold(client, player_id, totalCost.gold);
            if (totalCost.wood_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'wood_stored', totalCost.wood_stored);
            if (totalCost.stone_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'stone_stored', totalCost.stone_stored);
            if (totalCost.iron_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'iron_stored', totalCost.iron_stored);

            // Deduct population from network (recruiting fief first, then neighbors in BFS order)
            await recruitmentNetwork.deductFromNetwork(client, connectedH3s, fiefPops, totalTroops);

            let army_id;
            let resolvedName;

            if (is_garrison) {
                // ── Garrison mode: add to existing garrison or create a new one ──
                const existingGarrison = await ArmyModel.GetGarrisonAtHex(client, h3_index, player_id);
                if (existingGarrison) {
                    army_id = existingGarrison.army_id;
                } else {
                    resolvedName = 'Guarnición';
                    const armyResult = await ArmyModel.CreateArmy(client, resolvedName, player_id, h3_index, true);
                    army_id = armyResult.rows[0].army_id;
                }
                for (const u of units) {
                    await ArmyModel.AddTroops(client, army_id, u.unit_type_id, u.quantity);
                }
                await ArmyModel.refreshDetectionRange(client, army_id);
                await client.query('COMMIT');
                Logger.action(`Acuarteló lote: ${totalTroops} tropas en ${h3_index}`, player_id);
                return res.json({ success: true, army_id, mode: 'garrison', total_troops: totalTroops });
            }

            // ── Field army mode ───────────────────────────────────────────────────
            // Army limit check (server-side, cannot be bypassed from client)
            const capacity = await ArmyModel.GetPlayerArmyCapacity(client, player_id);
            const armyLimit = getArmyLimit(capacity.fief_count);
            if (capacity.army_count >= armyLimit) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    message: `Has alcanzado el límite de ejércitos (${capacity.army_count}/${armyLimit}). Necesitas más feudos para comandar más ejércitos.`
                });
            }

            // Create army
            resolvedName = (army_name || '').trim() || NameGenerator.generate(territory.culture_id);
            const armyResult = await ArmyModel.CreateArmy(client, resolvedName, player_id, h3_index);
            army_id = armyResult.rows[0].army_id;

            // Add troops
            for (const u of units) {
                await ArmyModel.AddTroops(client, army_id, u.unit_type_id, u.quantity);
            }
            await ArmyModel.refreshDetectionRange(client, army_id);

            await client.query('COMMIT');

            Logger.action(`Reclutó lote: ${totalTroops} tropas en ${h3_index}`, player_id);
            res.json({ success: true, army_id, army_name: resolvedName, total_troops: totalTroops, mode: 'field' });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/bulk-recruit', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al reclutar lote' });
        } finally {
            client.release();
        }
    }
    async GetCapacity(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const capacity = await ArmyModel.GetPlayerArmyCapacity(client, player_id);
            const army_limit = getArmyLimit(capacity.fief_count);
            res.json({
                success: true,
                army_count: capacity.army_count,
                fief_count: capacity.fief_count,
                army_limit,
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/capacity', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener capacidad de ejércitos' });
        } finally {
            client.release();
        }
    }

    async StopArmy(req, res) {
        try {
            const player_id = req.user.player_id;
            const { army_id } = req.body;

            if (!army_id) {
                return res.status(400).json({ success: false, message: 'Falta army_id' });
            }

            const army = await ArmyModel.stopArmy(army_id, player_id);
            if (!army) {
                return res.status(404).json({ success: false, message: 'Ejército no encontrado o no te pertenece' });
            }

            Logger.action(`Detuvo ejército "${army.name}" (id: ${army_id})`, player_id);
            res.json({ success: true, message: `Ejército "${army.name}" detenido correctamente` });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/stop', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al detener el ejército' });
        }
    }
    async renameArmy(req, res) {
        try {
            const player_id = req.user.player_id;
            const { army_id, new_name } = req.body;

            if (!army_id || typeof new_name !== 'string') {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos' });
            }
            const trimmed = new_name.trim();
            if (trimmed.length < 3 || trimmed.length > 25) {
                return res.status(400).json({ success: false, message: 'El nombre debe tener entre 3 y 25 caracteres' });
            }

            const updated = await ArmyModel.updateName(army_id, player_id, trimmed);
            if (!updated) {
                return res.status(404).json({ success: false, message: 'Ejército no encontrado o no te pertenece' });
            }

            Logger.army(army_id, 'RENAME', `[RENAME] Army ${army_id} changed name to ${trimmed}`, { player_id, new_name: trimmed });
            res.json({ success: true, new_name: updated.name });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/rename', method: 'PATCH', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al renombrar ejército' });
        }
    }
    async MergeArmies(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { army_id, h3_index } = req.body;

            if (!army_id || !h3_index) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros: army_id, h3_index' });
            }

            await client.query('BEGIN');

            // 1. Verificar que el ejército anfitrión pertenece al jugador y está en h3_index
            const hostResult = await client.query(
                `SELECT army_id, name, gold_provisions, food_provisions, wood_provisions
                 FROM armies WHERE army_id = $1 AND player_id = $2 AND h3_index = $3`,
                [army_id, player_id, h3_index]
            );
            if (hostResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército anfitrión no encontrado o posición incorrecta' });
            }
            const host = hostResult.rows[0];

            // 2. Buscar el resto de ejércitos propios en la misma casilla
            const othersResult = await ArmyModel.GetArmiesAtHexForMerge(client, h3_index, player_id, army_id);
            const others = othersResult.rows;

            if (others.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No hay otros ejércitos propios en esta casilla para fusionar' });
            }

            const dissolveIds = others.map(a => a.army_id);

            // 3. Fusionar provisiones
            const goldSum = others.reduce((s, a) => s + parseFloat(a.gold_provisions || 0), 0);
            const foodSum = others.reduce((s, a) => s + parseFloat(a.food_provisions || 0), 0);
            const woodSum = others.reduce((s, a) => s + parseFloat(a.wood_provisions || 0), 0);

            await client.query(
                `UPDATE armies
                 SET gold_provisions = gold_provisions + $1,
                     food_provisions = food_provisions + $2,
                     wood_provisions = wood_provisions + $3
                 WHERE army_id = $4`,
                [goldSum, foodSum, woodSum, army_id]
            );

            // 4. Fusionar tropas con media ponderada por unit_type_id
            const allArmyIds = [army_id, ...dissolveIds];
            const troopsResult = await ArmyModel.GetTroopsByArmies(client, allArmyIds);
            const allTroops = troopsResult.rows;

            // Agrupar por unit_type_id
            const byType = {};
            for (const t of allTroops) {
                const key = t.unit_type_id;
                if (!byType[key]) byType[key] = [];
                byType[key].push(t);
            }

            for (const [unit_type_id, rows] of Object.entries(byType)) {
                const totalQty = rows.reduce((s, r) => s + parseInt(r.quantity), 0);
                const wExp     = Math.round(rows.reduce((s, r) => s + parseFloat(r.experience) * parseInt(r.quantity), 0) / totalQty * 100) / 100;
                const wMorale  = Math.round(rows.reduce((s, r) => s + parseFloat(r.morale)     * parseInt(r.quantity), 0) / totalQty * 100) / 100;
                const wStamina = Math.round(rows.reduce((s, r) => s + parseFloat(r.stamina)    * parseInt(r.quantity), 0) / totalQty * 100) / 100;
                // Si alguna unidad estaba en force_rest, el grupo fusionado también lo hereda
                const hasForceRest = rows.some(r => r.force_rest);

                const hostTroop = rows.find(r => parseInt(r.army_id) === army_id);

                if (hostTroop) {
                    // El anfitrión ya tiene este tipo: actualizar su fila
                    await client.query(
                        `UPDATE troops
                         SET quantity = $1, experience = $2, morale = $3, stamina = $4, force_rest = $5
                         WHERE army_id = $6 AND unit_type_id = $7`,
                        [totalQty, wExp, wMorale, wStamina, hasForceRest, army_id, parseInt(unit_type_id)]
                    );
                } else {
                    // El anfitrión no tiene este tipo: transferir una fila de un ejército disuelto
                    const donorTroop = rows[0];
                    await client.query(
                        `UPDATE troops
                         SET army_id = $1, quantity = $2, experience = $3, morale = $4, stamina = $5, force_rest = $6
                         WHERE troop_id = $7`,
                        [army_id, totalQty, wExp, wMorale, wStamina, hasForceRest, donorTroop.troop_id]
                    );
                }
            }

            // 5. Eliminar las tropas restantes de los ejércitos disueltos
            //    (las transferidas ya tienen army_id = host, así que no se borran)
            await client.query('DELETE FROM troops WHERE army_id = ANY($1::int[])', [dissolveIds]);

            // 6. Eliminar rutas y ejércitos disueltos
            await client.query('DELETE FROM army_routes WHERE army_id = ANY($1::int[])', [dissolveIds]);
            await client.query('DELETE FROM armies WHERE army_id = ANY($1::int[])', [dissolveIds]);

            // 7. Actualizar caché de detection_range del ejército anfitrión
            await ArmyModel.refreshDetectionRange(client, army_id);

            await client.query('COMMIT');

            Logger.action(
                `Fusionó ${others.length} ejércitos en "${host.name}" (${h3_index})`,
                player_id,
                { host_army_id: army_id, dissolved: dissolveIds }
            );
            res.json({
                success: true,
                message: `${others.length} ejército${others.length !== 1 ? 's' : ''} fusionado${others.length !== 1 ? 's' : ''} en "${host.name}"`,
                army_id,
                dissolved_count: others.length
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/merge', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al fusionar ejércitos' });
        } finally {
            client.release();
        }
    }

    async GetArmiesAtHex(req, res) {
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.params;
            if (!h3_index) return res.status(400).json({ success: false, message: 'Falta h3_index' });
            const armies = await ArmyModel.GetArmiesAtHex(h3_index, player_id);
            res.json({ success: true, armies });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/armies-at-hex', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos' });
        }
    }

    async GetRecruitablePool(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.query;
            if (!h3_index) return res.status(400).json({ success: false, message: 'Falta h3_index' });

            const connectedH3s = await recruitmentNetwork.getConnectedNetwork(client, h3_index, player_id);
            // Read-only query (no FOR UPDATE) — just for display
            const popResult = connectedH3s.length > 0
                ? await client.query('SELECT h3_index, population FROM territory_details WHERE h3_index = ANY($1::text[])', [connectedH3s])
                : { rows: [] };
            const recruitable  = recruitmentNetwork.calcRecruitablePool(popResult.rows);
            const min_pop      = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;

            res.json({ success: true, recruitable, fiefs: connectedH3s.length, min_pop });
        } catch (error) {
            Logger.error(error, { endpoint: '/military/recruitable-pool', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al calcular población reclutable' });
        } finally {
            client.release();
        }
    }

    async TransferArmy(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { from_army_id, to_army_id, troops = [], provisions = {} } = req.body;

            if (!from_army_id || !to_army_id) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros: from_army_id, to_army_id' });
            }
            if (from_army_id === to_army_id) {
                return res.status(400).json({ success: false, message: 'Los ejércitos de origen y destino deben ser distintos' });
            }

            await client.query('BEGIN');

            // Validate both armies belong to player and share same h3_index
            const armiesResult = await client.query(
                `SELECT army_id, name, h3_index, destination,
                        gold_provisions, food_provisions, wood_provisions, stone_provisions, iron_provisions
                 FROM armies
                 WHERE army_id = ANY($1::int[]) AND player_id = $2`,
                [[from_army_id, to_army_id], player_id]
            );

            if (armiesResult.rows.length !== 2) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Uno o ambos ejércitos no encontrados o no te pertenecen' });
            }

            const fromArmy = armiesResult.rows.find(a => parseInt(a.army_id) === from_army_id);
            const toArmy   = armiesResult.rows.find(a => parseInt(a.army_id) === to_army_id);

            if (!fromArmy || !toArmy) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejércitos no encontrados' });
            }
            if (fromArmy.h3_index !== toArmy.h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Los ejércitos deben estar en la misma casilla' });
            }
            if (fromArmy.destination || toArmy.destination) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No se puede transferir entre ejércitos en movimiento' });
            }

            // Transfer troops
            for (const { unit_type_id, quantity } of troops) {
                if (!unit_type_id || !quantity || quantity <= 0) continue;
                await ArmyModel.TransferTroops(client, from_army_id, to_army_id, unit_type_id, quantity);
            }

            // Transfer provisions
            const PROV_FIELDS = ['gold', 'food', 'wood', 'stone', 'iron'];
            for (const field of PROV_FIELDS) {
                const amount = parseFloat(provisions[field] || 0);
                if (amount <= 0) continue;
                const col = `${field}_provisions`;
                const available = parseFloat(fromArmy[col] || 0);
                if (amount > available) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: `Suministros de ${field} insuficientes en ejército origen` });
                }
                await client.query(
                    `UPDATE armies SET ${col} = ${col} - $1 WHERE army_id = $2`,
                    [amount, from_army_id]
                );
                await client.query(
                    `UPDATE armies SET ${col} = ${col} + $1 WHERE army_id = $2`,
                    [amount, to_army_id]
                );
            }

            // Check if either army is now empty — dissolve it and pass remaining provisions to the other
            const PROV_COLS = ['gold_provisions', 'food_provisions', 'wood_provisions', 'stone_provisions', 'iron_provisions'];
            let dissolved_army_id = null;
            let dissolved_name    = null;
            let survivor_army_id  = null;

            for (const [emptyId, survivorId] of [[from_army_id, to_army_id], [to_army_id, from_army_id]]) {
                const troopCheck = await client.query(
                    'SELECT COALESCE(SUM(quantity), 0) AS total FROM troops WHERE army_id = $1',
                    [emptyId]
                );
                if (parseInt(troopCheck.rows[0].total) === 0) {
                    // Transfer all remaining provisions to survivor
                    const emptyRow = await client.query(
                        `SELECT ${PROV_COLS.join(', ')} FROM armies WHERE army_id = $1`, [emptyId]
                    );
                    const ep = emptyRow.rows[0];
                    const setClauses = PROV_COLS.map(c => `${c} = ${c} + ${parseFloat(ep[c] || 0)}`).join(', ');
                    if (setClauses) {
                        await client.query(`UPDATE armies SET ${setClauses} WHERE army_id = $1`, [survivorId]);
                    }
                    // Delete routes and army
                    await client.query('DELETE FROM army_routes WHERE army_id = $1', [emptyId]);
                    await client.query('DELETE FROM armies WHERE army_id = $1', [emptyId]);
                    dissolved_army_id = emptyId;
                    dissolved_name    = emptyId === from_army_id ? fromArmy.name : toArmy.name;
                    survivor_army_id  = survivorId;
                    break;
                }
            }

            // Refresh detection ranges (only for armies that still exist)
            if (dissolved_army_id !== from_army_id) await ArmyModel.refreshDetectionRange(client, from_army_id);
            if (dissolved_army_id !== to_army_id)   await ArmyModel.refreshDetectionRange(client, to_army_id);

            await client.query('COMMIT');

            const msg = dissolved_army_id
                ? `Transferencia aplicada. El ejército "${dissolved_name}" quedó vacío y fue disuelto.`
                : 'Transferencia realizada correctamente';

            Logger.action(
                `Transferencia entre ejércitos "${fromArmy.name}" → "${toArmy.name}" (${fromArmy.h3_index})`,
                player_id,
                { from_army_id, to_army_id, troop_types: troops.length, provisions, dissolved_army_id }
            );

            res.json({ success: true, message: msg, dissolved_army_id });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/transfer', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: error.message || 'Error al transferir tropas' });
        } finally {
            client.release();
        }
    }

    async GetArmiesInRegion(req, res) {
        try {
            const { minLat, maxLat, minLng, maxLng } = req.query;

            if (!minLat || !maxLat || !minLng || !maxLng) {
                return res.status(400).json({ success: false, message: 'Missing bounding box parameters' });
            }

            const bounds = {
                minLat: parseFloat(minLat),
                maxLat: parseFloat(maxLat),
                minLng: parseFloat(minLng),
                maxLng: parseFloat(maxLng)
            };

            if (Object.values(bounds).some(isNaN)) {
                return res.status(400).json({ success: false, message: 'Invalid bounding box parameters' });
            }

            const playerId = req.user.player_id;
            const H3_RESOLUTION = 7;
            const polygon = [
                [bounds.minLat, bounds.minLng],
                [bounds.minLat, bounds.maxLng],
                [bounds.maxLat, bounds.maxLng],
                [bounds.maxLat, bounds.minLng]
            ];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, H3_RESOLUTION)).slice(0, 50000);

            if (h3CellsArray.length === 0) {
                return res.json({ success: true, armies: [], current_player_id: playerId });
            }

            // Fetch armies in viewport + player's vision sources in parallel
            const [armiesResult, ownArmyVision, ownFiefPositions, characterPositions, workerPositions, fleetPositions] = await Promise.all([
                ArmyModel.GetArmiesInBounds(h3CellsArray),
                ArmyModel.GetPlayerArmiesWithDetection(playerId),
                ArmyModel.GetPlayerFiefPositions(playerId),
                CharacterModel.getStandalonePositions(playerId),
                WorkerModel.GetPlayerWorkerPositions(playerId),
                ArmyModel.GetPlayerFleetPositions(playerId),
            ]);

            const fiefRange      = GAME_CONFIG.MILITARY.FIEF_DETECTION_RANGE;
            const characterRange = GAME_CONFIG.CHARACTERS.DETECTION_RANGE;
            const FLEET_DETECTION_RANGE = 10;
            const visibleHexes = new Set();

            for (const army of ownArmyVision) {
                h3.gridDisk(army.h3_index, army.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fiefH3 of ownFiefPositions) {
                h3.gridDisk(fiefH3, fiefRange).forEach(hex => visibleHexes.add(hex));
            }
            for (const charH3 of characterPositions) {
                h3.gridDisk(charH3, characterRange).forEach(hex => visibleHexes.add(hex));
            }
            for (const w of workerPositions) {
                h3.gridDisk(w.h3_index, w.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fleetH3 of fleetPositions) {
                h3.gridDisk(fleetH3, FLEET_DETECTION_RANGE).forEach(hex => visibleHexes.add(hex));
            }

            // Own armies always visible; enemy armies only if in the visible zone
            const visibleArmies = armiesResult.rows
                .filter(army => army.player_id === playerId || visibleHexes.has(army.h3_index))
                .map(army => {
                    if (army.player_id === playerId) return army;
                    // Enemy army: only expose position, owner and naval flag (for map icon), no military intelligence
                    return { h3_index: army.h3_index, player_id: army.player_id, has_naval: army.has_naval, has_garrison: army.has_garrison, total_troops: army.total_troops };
                });

            res.json({ success: true, armies: visibleArmies, current_player_id: playerId });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/armies', method: 'GET', userId: req.user?.player_id, payload: req.query });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos' });
        }
    }

    async DismissTroops(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { army_id, unit_type_id, quantity } = req.body;

            if (!army_id || !unit_type_id || !quantity || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Parámetros inválidos' });
            }
            const qty = parseInt(quantity, 10);

            await client.query('BEGIN');

            // Ownership + location check (army must be in own fief)
            const army = await ArmyModel.GetArmyForDismiss(client, army_id);
            if (!army) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército no encontrado' });
            }
            if (army.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres el propietario de este ejército' });
            }
            if (army.fief_owner !== player_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Solo puedes licenciar tropas en un feudo propio' });
            }

            // Validate troop group
            const troop = await ArmyModel.GetTroopGroup(client, army_id, unit_type_id);
            if (!troop) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Tipo de tropa no encontrado en este ejército' });
            }
            if (troop.quantity < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Solo tienes ${troop.quantity} unidades de este tipo` });
            }

            // Reduce or delete this troop group
            const remaining = troop.quantity - qty;
            if (remaining === 0) {
                await client.query('DELETE FROM troops WHERE army_id = $1 AND unit_type_id = $2', [army_id, unit_type_id]);
            } else {
                await client.query('UPDATE troops SET quantity = $1 WHERE army_id = $2 AND unit_type_id = $3', [remaining, army_id, unit_type_id]);
            }

            // Soldiers return to local population, capped by terrain limit
            // getPopulationCap imported at top of file
            const isCapital = army.h3_index === army.capital_h3;
            const popCap = getPopulationCap(army.terrain_name, isCapital);
            const currentPop = parseInt(army.fief_population) || 0;
            const newPop = Math.min(currentPop + qty, popCap);
            const surplus = (currentPop + qty) - newPop; // people discarded (no room)
            await client.query(
                'UPDATE territory_details SET population = $1 WHERE h3_index = $2',
                [newPop, army.h3_index]
            );

            // Check if the army is now empty
            const totResult = await client.query(
                'SELECT COALESCE(SUM(quantity), 0)::int AS total FROM troops WHERE army_id = $1',
                [army_id]
            );
            const totalLeft = totResult.rows[0].total;

            if (totalLeft === 0) {
                // Transfer provisions to fief storehouse
                await client.query(
                    `UPDATE territory_details
                     SET food_stored  = food_stored  + $1,
                         wood_stored  = wood_stored  + $2,
                         stone_stored = stone_stored + $3,
                         iron_stored  = iron_stored  + $4
                     WHERE h3_index = $5`,
                    [army.food_provisions, army.wood_provisions, army.stone_provisions, army.iron_provisions, army.h3_index]
                );
                // Gold returns to player
                if (army.gold_provisions > 0) {
                    await client.query(
                        'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                        [army.gold_provisions, player_id]
                    );
                }
                await client.query('DELETE FROM army_routes WHERE army_id = $1', [army_id]);
                await client.query('DELETE FROM armies WHERE army_id = $1', [army_id]);
            } else {
                await ArmyModel.refreshDetectionRange(client, army_id);
            }

            await client.query('COMMIT');

            Logger.action(`Licenció ${qty} tropas (tipo ${unit_type_id}) del ejército ${army_id}`, player_id, { h3_index: army.h3_index, surplus });
            const baseMsg = totalLeft === 0
                ? `${qty} soldados licenciados. El ejército se ha disuelto y los suministros han vuelto al feudo.`
                : `${qty} soldados licenciados y devueltos a la población civil.`;
            const surplusMsg = surplus > 0 ? ` ${surplus} personas no encontraron acomodo y se dispersaron.` : '';
            res.json({
                success: true,
                army_dissolved: totalLeft === 0,
                surplus,
                message: baseMsg + surplusMsg,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/dismiss', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al licenciar tropas' });
        } finally {
            client.release();
        }
    }

    /**
     * Adds troops to an existing army (reinforcement).
     * Conditions: army must be at a player-owned fief with grace_turns = 0.
     * Same recruitment costs apply (gold, resources, population).
     * POST /api/military/reinforce
     * Body: { armyId, units: [{ unit_type_id, quantity }] }
     */
    async ReinforceArmy(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { armyId, units } = req.body;

            if (!armyId || !Array.isArray(units) || units.length === 0) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros: armyId y units' });
            }
            for (const u of units) {
                if (!u.unit_type_id || !u.quantity || u.quantity <= 0) {
                    return res.status(400).json({ success: false, message: 'Unidades inválidas en el lote' });
                }
            }

            await client.query('BEGIN');

            // 1. Verify army ownership and get its position
            const armyResult = await client.query(
                'SELECT army_id, name, h3_index FROM armies WHERE army_id = $1 AND player_id = $2',
                [armyId, player_id]
            );
            if (armyResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército no encontrado o no te pertenece' });
            }
            const army = armyResult.rows[0];
            const h3_index = army.h3_index;

            // 2. Verify the fief: must be owned by player AND have grace_turns = 0
            const territoryResult = await client.query(
                `SELECT td.population, td.wood_stored, td.stone_stored, td.iron_stored,
                        td.grace_turns, m.player_id AS fief_owner
                 FROM territory_details td
                 JOIN h3_map m ON td.h3_index = m.h3_index
                 WHERE td.h3_index = $1`,
                [h3_index]
            );
            if (territoryResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'El feudo donde está el ejército no existe' });
            }
            const territory = territoryResult.rows[0];

            if (territory.fief_owner !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'El ejército no está en un feudo propio' });
            }
            if (parseInt(territory.grace_turns) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Feudo en período de ocupación (${territory.grace_turns} turnos restantes). No se puede reforzar hasta que se estabilice.`
                });
            }

            // 2b. Verify location: must be capital or fief with completed military building
            const playerCapResult = await client.query(
                'SELECT capital_h3 FROM players WHERE player_id = $1',
                [player_id]
            );
            const isCapital = playerCapResult.rows[0]?.capital_h3 === h3_index;
            if (!isCapital) {
                const hasMilitary = await ArmyModel.CheckMilitaryBuildingInFief(client, h3_index);
                if (!hasMilitary) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        message: 'Solo puedes reforzar en tu Capital o en feudos con un edificio militar completado (Cuartel o Fortaleza).'
                    });
                }
            }

            // 3. Compute total cost (same as recruitment)
            const unitTypeIds = units.map(u => u.unit_type_id);
            const reqResult = await ArmyModel.GetBulkUnitRequirements(client, unitTypeIds);
            const requirementsByType = {};
            for (const row of reqResult.rows) {
                if (!requirementsByType[row.unit_type_id]) requirementsByType[row.unit_type_id] = [];
                requirementsByType[row.unit_type_id].push(row);
            }

            const totalCost = { gold: 0, wood_stored: 0, stone_stored: 0, iron_stored: 0 };
            let totalQuantity = 0;
            for (const u of units) {
                const reqs = requirementsByType[u.unit_type_id] || [];
                for (const req of reqs) {
                    totalCost[req.resource_type] = (totalCost[req.resource_type] || 0) + req.amount * u.quantity;
                }
                totalQuantity += u.quantity;
            }

            // 4. Validate population minimum
            const MIN_POP = GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION;
            const currentPop = parseInt(territory.population) || 0;
            if (currentPop - totalQuantity < MIN_POP) {
                await client.query('ROLLBACK');
                const available = Math.max(0, currentPop - MIN_POP);
                return res.status(400).json({
                    success: false,
                    message: `Población insuficiente. Puedes reforzar como máximo ${available} unidades (mínimo de ${MIN_POP} habitantes garantizados).`
                });
            }

            // 5. Validate gold and territory resources
            const goldResult = await ArmyModel.GetPlayerGold(client, player_id);
            const playerGold = parseFloat(goldResult.rows[0]?.gold) || 0;
            if (playerGold < totalCost.gold) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }
            if ((territory.wood_stored || 0) < totalCost.wood_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Madera insuficiente' });
            }
            if ((territory.stone_stored || 0) < totalCost.stone_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Piedra insuficiente' });
            }
            if ((territory.iron_stored || 0) < totalCost.iron_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Hierro insuficiente' });
            }

            // 6. Deduct resources
            if (totalCost.gold        > 0) await ArmyModel.DeductPlayerGold(client, player_id, totalCost.gold);
            if (totalCost.wood_stored  > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'wood_stored',  totalCost.wood_stored);
            if (totalCost.stone_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'stone_stored', totalCost.stone_stored);
            if (totalCost.iron_stored  > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'iron_stored',  totalCost.iron_stored);

            // 7. Deduct population
            await ArmyModel.DeductPopulation(client, h3_index, totalQuantity);

            // 8. Add troops to the existing army (merge with existing unit type rows)
            for (const u of units) {
                await ArmyModel.ReinforceTroops(client, armyId, u.unit_type_id, u.quantity);
            }
            await ArmyModel.refreshDetectionRange(client, armyId);

            await client.query('COMMIT');

            Logger.action(`Reforzó ejército ${armyId} "${army.name}" con ${totalQuantity} tropas en ${h3_index}`, player_id, { armyId, units });
            return res.json({
                success: true,
                message: `Ejército reforzado con ${totalQuantity} unidades`,
                army_id: armyId,
                total_added: totalQuantity
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/reinforce', method: 'POST', userId: req.user?.player_id, payload: req.body });
            return res.status(500).json({ success: false, message: 'Error al reforzar el ejército' });
        } finally {
            client.release();
        }
    }
}

module.exports = new ArmyService();
 