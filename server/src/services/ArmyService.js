const { Logger } = require('../utils/logger');
const ArmyModel = require('../models/ArmyModel.js');
const ArmySimulationService = require('./ArmySimulationService.js');
const h3 = require('h3-js');
const pool = require('../../db.js');
const GAME_CONFIG = require('../config/constants.js');
const NameGenerator = require('../logic/NameGenerator.js');

class ArmyService {
    async GetArmyDetails(req, res) {
        try {
            const { h3_index } = req.params;

            const armiesResult = await ArmyModel.GetArmyDetailsByHex(h3_index);
            const armies = armiesResult.rows;

            for (const army of armies) {
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
            }

            res.json({ success: true, armies, current_player_id: req.user.player_id });
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
            const army_name = req.body.army_name || NameGenerator.generate();

            if (!h3_index || !unit_type_id || !quantity) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos' });
            }
            if (quantity <= 0) {
                return res.status(400).json({ success: false, message: 'La cantidad debe ser mayor a 0' });
            }

            await client.query('BEGIN');

            const reqResult = await ArmyModel.GetUnitRequirements(client, unit_type_id);
            const requirements = reqResult.rows;

            const terrResult = await ArmyModel.GetTerritoryForRecruitment(client, h3_index);
            if (terrResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Territorio no encontrado' });
            }
            const territory = terrResult.rows[0];

            if (territory.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const playerResult = await ArmyModel.GetPlayerGold(client, player_id);
            const player = playerResult.rows[0];

            // Validate resources
            for (const req of requirements) {
                const needed = req.amount * quantity;
                if (req.resource_type === 'gold' && player.gold < needed) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: `Oro insuficiente. Necesitas ${needed} oro, pero solo tienes ${player.gold}.` });
                } else if (req.resource_type === 'wood_stored' && (territory.wood_stored || 0) < needed) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: `Madera insuficiente. Necesitas ${needed}, pero solo tienes ${territory.wood_stored || 0}.` });
                } else if (req.resource_type === 'stone_stored' && (territory.stone_stored || 0) < needed) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: `Piedra insuficiente. Necesitas ${needed}, pero solo tienes ${territory.stone_stored || 0}.` });
                } else if (req.resource_type === 'iron_stored' && (territory.iron_stored || 0) < needed) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: `Hierro insuficiente. Necesitas ${needed}, pero solo tienes ${territory.iron_stored || 0}.` });
                }
            }

            // Deduct resources
            for (const req of requirements) {
                const cost = req.amount * quantity;
                if (req.resource_type === 'gold') {
                    await ArmyModel.DeductPlayerGold(client, player_id, cost);
                } else {
                    await ArmyModel.DeductTerritoryResource(client, h3_index, req.resource_type, cost);
                }
            }

            // Find or create army
            const existingArmy = await ArmyModel.FindArmy(client, h3_index, army_name, player_id);
            let army_id;
            if (existingArmy.rows.length === 0) {
                const newArmy = await ArmyModel.CreateArmy(client, army_name, player_id, h3_index);
                army_id = newArmy.rows[0].army_id;
            } else {
                army_id = existingArmy.rows[0].army_id;
            }

            await ArmyModel.AddTroops(client, army_id, unit_type_id, quantity);
            await client.query('COMMIT');

            Logger.action(`Reclutó ${quantity} unidades (tipo ${unit_type_id}) en ${h3_index}`, player_id, { army_name, unit_type_id, quantity });
            res.json({ success: true, message: 'Unidades reclutadas exitosamente', army_id });
        } catch (error) {
            await client.query('ROLLBACK');
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
                total_troops: parseInt(a.total_troops) || 0,
                total_combat_power: parseInt(a.total_combat_power) || 0,
                average_moral: parseInt(a.average_moral) || 0,
                min_stamina: parseInt(a.min_stamina) || 0,
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
            detail.army.gold_provisions = parseFloat(detail.army.gold_provisions) || 0;
            detail.army.food_provisions = parseFloat(detail.army.food_provisions) || 0;
            detail.army.wood_provisions = parseFloat(detail.army.wood_provisions) || 0;

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
            const { h3_index, army_name, units } = req.body;
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
            const territory = await ArmyModel.GetTerritoryForRecruitment(client, h3_index);
            if (!territory.rows.length || territory.rows[0].player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres propietario de este territorio' });
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

            // Validate resources (anti-exploit double-check)
            const goldResult = await ArmyModel.GetPlayerGold(client, player_id);
            const playerGold = parseFloat(goldResult.rows[0]?.gold) || 0;
            if (playerGold < totalCost.gold) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }

            const td = territory.rows[0];
            if ((td.wood_stored || 0) < totalCost.wood_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Madera insuficiente' });
            }
            if ((td.stone_stored || 0) < totalCost.stone_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Piedra insuficiente' });
            }
            if ((td.iron_stored || 0) < totalCost.iron_stored) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Hierro insuficiente' });
            }

            // Deduct resources
            if (totalCost.gold > 0) await ArmyModel.DeductPlayerGold(client, player_id, totalCost.gold);
            if (totalCost.wood_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'wood_stored', totalCost.wood_stored);
            if (totalCost.stone_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'stone_stored', totalCost.stone_stored);
            if (totalCost.iron_stored > 0) await ArmyModel.DeductTerritoryResource(client, h3_index, 'iron_stored', totalCost.iron_stored);

            // Create army
            const resolvedName = (army_name || '').trim() || NameGenerator.generate();
            const armyResult = await ArmyModel.CreateArmy(client, resolvedName, player_id, h3_index);
            const army_id = armyResult.rows[0].army_id;

            // Add troops
            for (const u of units) {
                await ArmyModel.AddTroops(client, army_id, u.unit_type_id, u.quantity);
            }

            await client.query('COMMIT');

            const totalTroops = units.reduce((s, u) => s + u.quantity, 0);
            Logger.action(`Reclutó lote: ${totalTroops} tropas en ${h3_index}`, player_id);
            res.json({ success: true, army_id, army_name: resolvedName, total_troops: totalTroops });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/military/bulk-recruit', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al reclutar lote' });
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

            const H3_RESOLUTION = 8;
            const polygon = [
                [bounds.minLat, bounds.minLng],
                [bounds.minLat, bounds.maxLng],
                [bounds.maxLat, bounds.maxLng],
                [bounds.maxLat, bounds.minLng]
            ];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, H3_RESOLUTION)).slice(0, 50000);

            if (h3CellsArray.length === 0) {
                return res.json({ success: true, armies: [], current_player_id: req.user.player_id });
            }

            const result = await ArmyModel.GetArmiesInBounds(h3CellsArray);

            res.json({
                success: true,
                armies: result.rows,
                current_player_id: req.user.player_id
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/armies', method: 'GET', userId: req.user?.player_id, payload: req.query });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos' });
        }
    }
}

module.exports = new ArmyService();
 