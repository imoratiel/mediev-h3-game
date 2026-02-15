const { Logger } = require('../utils/logger');
const ArmyModel = require('../models/ArmyModel.js');
const h3 = require('h3-js');

class ArmyService {
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
