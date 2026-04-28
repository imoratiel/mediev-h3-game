const { Logger } = require('../utils/logger');
const TerrainModel = require('../models/TerrainModel.js');
const h3 = require('h3-js');
const { getTerrainColor } = require('../logic/territory.js');
const pool = require('../../db.js');
const cache = require('./CacheService.js');
const NotificationService = require('./NotificationService.js');

function fmtHex(h3_index) {
    const [lat, lng] = h3.cellToLatLng(h3_index);
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

class TerrainService {
    async GetRegion(req,res){
        try {
            const { minLat, maxLat, minLng, maxLng, res: resolution } = req.query;
            if (!minLat || !maxLat || !minLng || !maxLng) return res.status(400).json({ error: 'Missing bounding box parameters' });

            const bounds = { minLat: parseFloat(minLat), maxLat: parseFloat(maxLat), minLng: parseFloat(minLng), maxLng: parseFloat(maxLng) };
            if (Object.values(bounds).some(isNaN)) return res.status(400).json({ error: 'Invalid bounding box parameters' });

            const H3_RESOLUTION = resolution ? parseInt(resolution, 10) : 7;
            const polygon = [[bounds.minLat, bounds.minLng], [bounds.minLat, bounds.maxLng], [bounds.maxLat, bounds.maxLng], [bounds.maxLat, bounds.minLng]];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, H3_RESOLUTION)).slice(0, 50000);

            if (h3CellsArray.length === 0) return res.json([]);

            const result = await TerrainModel.GetRegion(h3CellsArray);

            const hexagons = result.rows.map(row => {
                // Campos siempre presentes (terrain + coordenadas)
                const hex = {
                    h3_index:        row.h3_index,
                    terrain_type_id: row.terrain_type_id,
                    terrain_color:   row.terrain_color || '#9e9e9e',
                    coord_x:         row.coord_x,
                    coord_y:         row.coord_y,
                };
                // Campos opcionales: solo se incluyen cuando tienen valor real
                if (row.player_id)               hex.player_id       = row.player_id;
                if (row.player_color)            hex.player_color    = row.player_color;
                if (row.is_capital)              hex.is_capital      = true;
                if (row.location_name)           hex.location_name   = row.location_name;
                if (row.settlement_type)         hex.settlement_type = row.settlement_type;
                if (row.terrain_type_id === 15)  hex.is_bridge       = true;
                return hex;
            });

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json(hexagons);
        } catch (error) {
            console.error('❌ Error fetching map data:', error);
            res.status(500).json({ error: 'Failed to fetch map data', message: error.message });
        }
    }
    async GetTerrainTypes(req,res){
        const CACHE_KEY = 'static:terrain_types';
        const cached = cache.get(CACHE_KEY);
        if (cached) return res.json(cached);
        try {
            const result = await TerrainModel.GetTerrainTypes();
            const terrainTypes = result.rows.map(row => ({
                terrain_type_id: row.terrain_type_id,
                name: row.name,
                color: getTerrainColor(row.name, row.color),
                sort_order: row.sort_order
            }));
            cache.set(CACHE_KEY, terrainTypes, 0);
            res.json(terrainTypes);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch terrain types', message: error.message });
        }
    }
    async GetBuildingsInBounds(req, res) {
        try {
            const { minLat, maxLat, minLng, maxLng } = req.query;
            if (!minLat || !maxLat || !minLng || !maxLng) {
                return res.status(400).json({ success: false, message: 'Missing bounding box parameters' });
            }
            const bounds = {
                minLat: parseFloat(minLat), maxLat: parseFloat(maxLat),
                minLng: parseFloat(minLng), maxLng: parseFloat(maxLng)
            };
            if (Object.values(bounds).some(isNaN)) {
                return res.status(400).json({ success: false, message: 'Invalid bounding box parameters' });
            }
            const polygon = [
                [bounds.minLat, bounds.minLng], [bounds.minLat, bounds.maxLng],
                [bounds.maxLat, bounds.maxLng], [bounds.maxLat, bounds.minLng]
            ];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, 7)).slice(0, 50000);
            if (h3CellsArray.length === 0) {
                return res.json({ success: true, buildings: [] });
            }
            const result = await TerrainModel.GetBuildingsInBounds(h3CellsArray);
            res.json({ success: true, buildings: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/buildings', method: 'GET' });
            res.status(500).json({ success: false, message: error.message });
        }
    }
    async GetCellDetails(req, res) {
        try {
            const { h3_index } = req.params;
            const playerId = req.user?.player_id ?? null;

            const result = await TerrainModel.GetCellDetails(h3_index);
            if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Hexágono no encontrado' });
            const cell = result.rows[0];

            const is_capital = cell.player_id && cell.capital_h3 === h3_index;
            const isBridge   = cell.terrain_type_id === 15;

            // Cultura del feudo (puede no existir si no hay templos cerca aún)
            const cultureRes = await pool.query(
                `SELECT culture_romanos, culture_cartagineses, culture_iberos, culture_celtas
                 FROM fief_culture WHERE h3_index = $1`,
                [h3_index]
            );
            const cultureRow = cultureRes.rows[0] || null;

            // Bridge destruction data (only for bridge hexes)
            let bridge_destruction = null;
            let can_destroy_bridge  = false;
            if (isBridge && playerId) {
                // Active destruction order (any player)
                const bdRes = await pool.query(
                    'SELECT player_id, turns_remaining FROM bridge_destructions WHERE h3_index = $1',
                    [h3_index]
                );
                if (bdRes.rows.length > 0) {
                    bridge_destruction = {
                        turns_remaining: bdRes.rows[0].turns_remaining,
                        is_own_order:    bdRes.rows[0].player_id === playerId,
                    };
                }

                // Can this player start destruction? Need army with 1000+ troops on or adjacent to the bridge
                if (!bridge_destruction) {
                    const vicinity = h3.gridDisk(h3_index, 1); // incluye el hex del puente
                    const armyRes = await pool.query(`
                        SELECT a.army_id
                        FROM armies a
                        JOIN (SELECT army_id, SUM(quantity)::int AS total FROM troops GROUP BY army_id) t
                             ON t.army_id = a.army_id
                        WHERE a.h3_index = ANY($1::text[])
                          AND a.player_id = $2
                          AND t.total >= 1000
                          AND NOT a.is_garrison
                        LIMIT 1
                    `, [vicinity, playerId]);
                    can_destroy_bridge = armyRes.rows.length > 0;
                }
            }

            // Building demolition data (only for own fiefs with a completed building)
            let building_demolition = null;
            let can_demolish_building = false;
            const isOwnFief = cell.player_id === playerId;
            const hasCompletedBuilding = cell.fief_building_id && !cell.fief_building_constructing;
            if (isOwnFief && hasCompletedBuilding && playerId) {
                // Active demolition order for this hex
                const demRes = await pool.query(
                    'SELECT turns_remaining FROM building_demolitions WHERE h3_index = $1',
                    [h3_index]
                );
                if (demRes.rows.length > 0) {
                    building_demolition = { turns_remaining: demRes.rows[0].turns_remaining };
                }

                // Can start demolition? Need 1000+ non-garrison troops in the same hex
                if (!building_demolition) {
                    const armyRes = await pool.query(`
                        SELECT a.army_id
                        FROM armies a
                        JOIN (SELECT army_id, SUM(quantity)::int AS total FROM troops GROUP BY army_id) t
                             ON t.army_id = a.army_id
                        WHERE a.h3_index = $1
                          AND a.player_id = $2
                          AND t.total >= 1000
                          AND NOT a.is_garrison
                        LIMIT 1
                    `, [h3_index, playerId]);
                    can_demolish_building = armyRes.rows.length > 0;
                }
            }

            // Resistencia / rebelión de la comarca contra el jugador actual
            let rebellion = null;
            if (cell.division_id && playerId && cell.player_id === playerId) {
                const rebRes = await pool.query(`
                    SELECT (resistance + aftershock)::float AS total,
                           resistance::float                AS base,
                           aftershock::float                AS aftershock
                    FROM comarca_resistance
                    WHERE division_id = $1 AND player_id = $2
                `, [cell.division_id, playerId]);
                if (rebRes.rows.length > 0 && rebRes.rows[0].total > 0) {
                    rebellion = {
                        total:     Math.round(rebRes.rows[0].total),
                        base:      Math.round(rebRes.rows[0].base),
                        aftershock: Math.round(rebRes.rows[0].aftershock),
                    };
                }
            }

            res.json({
                h3_index,
                terrain_type: cell.terrain_type,
                terrain_type_id: cell.terrain_type_id,
                terrain_color: cell.terrain_color,
                food_output: cell.food_output || 0,
                wood_output: cell.wood_output || 0,
                player_id: cell.player_id,
                player_name: cell.player_name,
                player_culture_name: cell.player_culture_name || null,
                player_color: cell.player_color || null,
                division_name: cell.division_name || null,
                building_type: cell.building_type,
                is_capital,
                fief_building: cell.fief_building_id ? {
                    id:               cell.fief_building_id,
                    name:             cell.fief_building_name,
                    type_name:        cell.fief_building_type_name,
                    is_under_construction: cell.fief_building_constructing,
                    turns_left:       cell.fief_building_constructing ? cell.fief_building_turns_left : null,
                    conservation:     cell.fief_building_conservation ?? 100,
                    construction_time_turns: cell.fief_building_construction_time ?? 0,
                    upgrade: (!cell.fief_building_constructing && cell.upgrade_building_id) ? {
                        id:        cell.upgrade_building_id,
                        name:      cell.upgrade_building_name,
                        gold_cost: cell.upgrade_gold_cost,
                        turns:     cell.upgrade_turns
                    } : null,
                } : null,
                settlement_name: cell.settlement_name,
                owner_main_character_id: cell.owner_main_character_id || null,
                coord_x: cell.coord_x,
                coord_y: cell.coord_y,
                culture: cultureRow ? {
                    romanos:       cultureRow.culture_romanos,
                    cartagineses:  cultureRow.culture_cartagineses,
                    iberos:        cultureRow.culture_iberos,
                    celtas:        cultureRow.culture_celtas,
                } : null,
                bridge_destruction,
                can_destroy_bridge,
                building_demolition,
                can_demolish_building,
                rebellion,
                territory: cell.population ? {
                    population: cell.population,
                    happiness: cell.division_id
                        ? Math.min(100, Math.floor((cell.happiness || 0) * 1.10))
                        : (cell.happiness || 0),
                    food: cell.food_stored,
                    wood: cell.wood_stored,
                    stone: cell.discovered_resource ? cell.stone_stored : 0,
                    iron: cell.discovered_resource ? cell.iron_stored : 0,
                    gold: cell.discovered_resource ? cell.gold_stored : 0,
                    discovered_resource: cell.discovered_resource,
                    exploration_end_turn: cell.exploration_end_turn,
                    farm_level: cell.farm_level,
                    mine_level: cell.mine_level,
                    lumber_level: cell.lumber_level,
                    port_level: cell.port_level
                } : null
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/cell-details', h3_index: req.params?.h3_index });
            res.status(500).json({ error: 'Error al obtener detalles de celda', message: error.message });
        }
    }

    async GetBridgeDestructions(req, res) {
        try {
            const result = await pool.query(`
                SELECT bd.h3_index, bd.player_id, bd.turns_remaining,
                       COALESCE(p.display_name, p.username) AS player_name
                FROM bridge_destructions bd
                JOIN players p ON p.player_id = bd.player_id
                ORDER BY bd.turns_remaining ASC
            `);
            res.json({ success: true, destructions: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/bridge-destructions' });
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async StartBridgeDestruction(req, res) {
        const BRIDGE_DESTRUCTION_TURNS = 15;
        try {
            const playerId   = req.user.player_id;
            const { h3_index } = req.body;
            if (!h3_index) return res.status(400).json({ success: false, message: 'h3_index requerido' });

            // Verify the hex is a bridge
            const terrainRes = await pool.query(
                `SELECT terrain_type_id FROM h3_map WHERE h3_index = $1`,
                [h3_index]
            );
            if (terrainRes.rows.length === 0 || terrainRes.rows[0].terrain_type_id !== 15) {
                return res.status(400).json({ success: false, message: 'El hexágono no es un puente' });
            }

            // Player must own at least one hex adjacent to the bridge
            const vicinity = h3.gridDisk(h3_index, 1);
            const ownerRes = await pool.query(
                'SELECT h3_index FROM h3_map WHERE h3_index = ANY($1::text[]) AND player_id = $2 LIMIT 1',
                [vicinity, playerId]
            );
            if (ownerRes.rows.length === 0) {
                return res.status(403).json({ success: false, message: 'No controlas ningún feudo adyacente a este puente' });
            }

            // No enemy troops in the bridge hex or adjacent
            const enemyBridgeRes = await pool.query(`
                SELECT a.army_id FROM armies a
                WHERE a.h3_index = ANY($1::text[]) AND a.player_id != $2 AND NOT a.is_garrison
                LIMIT 1
            `, [vicinity, playerId]);
            if (enemyBridgeRes.rows.length > 0) {
                return res.status(403).json({ success: false, message: 'Hay tropas enemigas cerca del puente, no puedes ordenar la demolición' });
            }

            // No active destruction order already
            const existing = await pool.query(
                'SELECT id FROM bridge_destructions WHERE h3_index = $1',
                [h3_index]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({ success: false, message: 'Ya hay una orden de demolición en curso para este puente' });
            }

            // Player must have an army with 1000+ troops on or adjacent to the bridge
            const armyRes = await pool.query(`
                SELECT a.army_id
                FROM armies a
                JOIN (SELECT army_id, SUM(quantity)::int AS total FROM troops GROUP BY army_id) t
                     ON t.army_id = a.army_id
                WHERE a.h3_index = ANY($1::text[])
                  AND a.player_id = $2
                  AND t.total >= 1000
                  AND NOT a.is_garrison
                LIMIT 1
            `, [vicinity, playerId]);

            if (armyRes.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Necesitas un ejército con al menos 1.000 tropas en un feudo contiguo al puente'
                });
            }

            // Get current turn
            const turnRes = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = turnRes.rows[0]?.current_turn ?? 0;

            await pool.query(
                `INSERT INTO bridge_destructions (h3_index, player_id, turns_remaining, started_turn)
                 VALUES ($1, $2, $3, $4)`,
                [h3_index, playerId, BRIDGE_DESTRUCTION_TURNS, currentTurn]
            );

            Logger.action(
                `[ACTION][Jugador ${playerId}]: Inicio demolición de puente en ${h3_index} (${BRIDGE_DESTRUCTION_TURNS} turnos)`,
                playerId
            );

            const startMsg = _pick([
                `⚔️ **El acero contra la piedra**\n\nVuestros ingenieros han comenzado a desmantelar el puente en ${fmtHex(h3_index)}. Mantened la presión y el paso quedará sellado en ${BRIDGE_DESTRUCTION_TURNS} jornadas.`,
                `🔥 **La orden ha sido dada**\n\nVuestras huestes asedian ya el puente en ${fmtHex(h3_index)}. Si permanecen en posición, la estructura caerá en ${BRIDGE_DESTRUCTION_TURNS} jornadas y el río cerrará ese paso al enemigo.`,
                `🪓 **Los trabajos de demolición han comenzado**\n\nVuestros hombres trabajan sin descanso sobre los cimientos del puente en ${fmtHex(h3_index)}. En ${BRIDGE_DESTRUCTION_TURNS} jornadas, si nadie los detiene, solo quedará ruina y corriente.`,
            ]);
            await NotificationService.createSystemNotification(playerId, 'Militar', startMsg, currentTurn);

            res.json({
                success: true,
                message: `Demolición iniciada. El puente será destruido en ${BRIDGE_DESTRUCTION_TURNS} turnos si mantienes tropas adyacentes.`,
                turns_remaining: BRIDGE_DESTRUCTION_TURNS,
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/destroy-bridge', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al iniciar la demolición' });
        }
    }

    async GetBuildingDemolitions(req, res) {
        try {
            const result = await pool.query(`
                SELECT bd.h3_index, bd.player_id, bd.building_name, bd.turns_remaining,
                       COALESCE(p.display_name, p.username) AS player_name
                FROM building_demolitions bd
                JOIN players p ON p.player_id = bd.player_id
                ORDER BY bd.turns_remaining ASC
            `);
            res.json({ success: true, demolitions: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/building-demolitions' });
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async StartBuildingDemolition(req, res) {
        try {
            const playerId = req.user.player_id;
            const { h3_index } = req.body;
            if (!h3_index) return res.status(400).json({ success: false, message: 'h3_index requerido' });

            // Verify player owns the fief
            const fiefRes = await pool.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (fiefRes.rows.length === 0 || fiefRes.rows[0].player_id !== playerId) {
                return res.status(403).json({ success: false, message: 'No eres el propietario de este feudo' });
            }

            // Get the completed building
            const buildingRes = await pool.query(`
                SELECT fb.building_id, fb.conservation, b.name, b.construction_time_turns
                FROM fief_buildings fb
                JOIN buildings b ON b.id = fb.building_id
                WHERE fb.h3_index = $1 AND fb.is_under_construction = FALSE
            `, [h3_index]);
            if (buildingRes.rows.length === 0) {
                return res.status(400).json({ success: false, message: 'No hay ningún edificio completado en este feudo' });
            }
            const building = buildingRes.rows[0];

            // No enemy troops in the same hex
            const enemyRes = await pool.query(`
                SELECT a.army_id FROM armies a
                WHERE a.h3_index = $1 AND a.player_id != $2 AND NOT a.is_garrison
                LIMIT 1
            `, [h3_index, playerId]);
            if (enemyRes.rows.length > 0) {
                return res.status(403).json({ success: false, message: 'Hay tropas enemigas en el feudo, no puedes ordenar la demolición' });
            }

            // No active demolition already
            const existing = await pool.query(
                'SELECT id FROM building_demolitions WHERE h3_index = $1',
                [h3_index]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({ success: false, message: 'Ya hay una orden de demolición en curso' });
            }

            // Need 1000+ non-garrison troops IN the same hex
            const armyRes = await pool.query(`
                SELECT a.army_id
                FROM armies a
                JOIN (SELECT army_id, SUM(quantity)::int AS total FROM troops GROUP BY army_id) t
                     ON t.army_id = a.army_id
                WHERE a.h3_index = $1
                  AND a.player_id = $2
                  AND t.total >= 1000
                  AND NOT a.is_garrison
                LIMIT 1
            `, [h3_index, playerId]);
            if (armyRes.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Necesitas un ejército con al menos 1.000 tropas en este feudo para iniciar la demolición'
                });
            }

            // Turns = ceil(construction_time * 0.5 * (conservation / 100))
            const conservation = building.conservation ?? 100;
            const turnsRemaining = Math.max(1, Math.ceil(building.construction_time_turns * 0.5 * (conservation / 100)));

            const turnRes = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = turnRes.rows[0]?.current_turn ?? 0;

            await pool.query(
                `INSERT INTO building_demolitions (h3_index, player_id, building_id, building_name, turns_remaining, started_turn)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [h3_index, playerId, building.building_id, building.name, turnsRemaining, currentTurn]
            );

            const startMsg = _pick([
                `🪓 **Los picos ya trabajan sobre los muros**\n\nVuestras tropas han comenzado a desmantelar **${building.name}** en ${fmtHex(h3_index)}. Si permanecen en posición, la obra quedará reducida a escombros en ${turnsRemaining} jornadas.`,
                `🔥 **La orden de demolición ha sido dada**\n\nEl **${building.name}** en ${fmtHex(h3_index)} tiene los días contados. Vuestros hombres trabajan sin descanso. En ${turnsRemaining} jornadas no quedará piedra sobre piedra.`,
                `⚒️ **Comienza el derribo**\n\nVuestras huestes han iniciado el desmantelamiento de **${building.name}** en ${fmtHex(h3_index)}. Mantened las tropas en el feudo para completar la tarea en ${turnsRemaining} jornadas.`,
            ]);
            await NotificationService.createSystemNotification(playerId, 'Militar', startMsg, currentTurn);

            Logger.action(
                `[ACTION][Jugador ${playerId}]: Inicio demolición de "${building.name}" en ${h3_index} (${turnsRemaining} turnos)`,
                playerId
            );

            res.json({
                success: true,
                message: `Demolición iniciada. ${building.name} será destruido en ${turnsRemaining} turnos si mantienes tropas en el feudo.`,
                turns_remaining: turnsRemaining,
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/demolish-building', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al iniciar la demolición del edificio' });
        }
    }
}

module.exports = new TerrainService();