const TurnService = require('../services/TurnService.js');
const { isEngineActive } = require('../src/logic/turn_engine.js');

class TurnController {
    async GetEngineStatus(req, res) {
        try {
            const status = await TurnService.getGlobalStatus();

            res.json({
                success: true,
                engine: {
                    isRunning: isEngineActive(),
                    isPaused: status.is_paused,
                    currentTurn: status.current_turn,
                    lastUpdate: status.last_updated
                }
            });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/status',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener estado del motor' });
        }
    }
}

module.exports = new TurnController();