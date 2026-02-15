const { Logger } = require('../utils/logger');
const PlayerModel = require('../models/PlayerModel.js');

class PlayerService {
    async GetById(req, res) {
        try {
            const player = await PlayerModel.GetById(req.params.id);
            if (!player) return res.status(404).json({ error: 'Player not found' });
            res.json(player);
        } catch (error) {
            Logger.error(error, { endpoint: '/players/:id', method: 'GET', userId: req.params?.id });
            res.status(500).json({ error: 'Error al obtener jugador' });
        }
    }
}

module.exports = new PlayerService();
