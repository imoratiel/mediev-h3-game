const { Logger } = require('../utils/logger');
const TerrainModel = require('../models/TerrainModel.js');
const h3 = require('h3-js');
const { getTerrainColor } = require('../logic/territory.js');
const { constants } = require('node:buffer');

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
        try {
            const result = await TerrainModel.GetTerrainTypes();
            const terrainTypes = result.rows.map(row => ({
                terrain_type_id: row.terrain_type_id,
                name: row.name,
                color: getTerrainColor(row.name, row.color),
                sort_order: row.sort_order
            }));
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
            const result = await TerrainModel.GetCellDetails(h3_index);
            if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Hexágono no encontrado' });
            const cell = result.rows[0];

            const is_capital = cell.player_id && cell.capital_h3 === h3_index;

            res.json({
                h3_index,
                terrain_type: cell.terrain_type,
                terrain_color: cell.terrain_color,
                food_output: cell.food_output || 0,
                wood_output: cell.wood_output || 0,
                player_id: cell.player_id,
                player_name: cell.player_name,
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
                    upgrade: (!cell.fief_building_constructing && cell.upgrade_building_id) ? {
                        id:        cell.upgrade_building_id,
                        name:      cell.upgrade_building_name,
                        gold_cost: cell.upgrade_gold_cost,
                        turns:     cell.upgrade_turns
                    } : null,
                } : null,
                settlement_name: cell.settlement_name,
                coord_x: cell.coord_x,
                coord_y: cell.coord_y,
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
}

module.exports = new TerrainService();