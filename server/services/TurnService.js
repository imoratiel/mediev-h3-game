const ArmyModel = require('../models/WorldStateModel.js');

class EngineService {
    async GetGlobalStatus() {
        Logger.action(`Acceso administrativo a /admin/engine/status - Consultando estado del motor`, req.user.player_id);

        // Aquí haces la lógica de "negocio"
        const status = await WorldStateModel.GetCurrentTurn();

        return {
            status
        };
    }
}

module.exports = new EngineService();