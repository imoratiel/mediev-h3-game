const { Logger } = require('../utils/logger');
const WorldStateModel = require('../models/TurnModel.js');
const { processGameTurn, processHarvestManually } = require('../logic/turn_engine');

class TurnService {
    async GetWorldState(req, res) {
        try {
            const state = await WorldStateModel.GetWorldState();
            res.json({ success: true, turn: state.current_turn, date: state.game_date, is_paused: state.is_paused });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/world-state', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, error: error.message });
        }
    }
    async GetGlobalStatus() {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/status - Consultando estado del motor`, req.user.player_id);

            // Aquí haces la lógica de "negocio"
            const status = await WorldStateModel.GetCurrentTurn();

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
    async SetGamePaused() {
         try {

            Logger.action(`Acceso administrativo a /admin/engine/pause - Pausando juego`, req.user.player_id);

            await WorldStateModel.SetGamePaused();
            
            Logger.action(`Juego pausado exitosamente`, req.user.player_id); 
            
            res.json({ success: true, message: 'Juego pausado. El motor no procesará más turnos.' });

        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/pause',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al pausar el juego' });
        }
    }
    async SetGameResumed() {
          try {

            Logger.action(`Acceso administrativo a /admin/engine/resume - Reanudando juego`, req.user.player_id);

            await WorldStateModel.SetGameResumed();
        
            Logger.action(`Juego reanudado exitosamente`, req.user.player_id);
            
            res.json({ success: true, message: 'Juego reanudado. El motor procesará el siguiente turno según el intervalo configurado.' });

        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/resume',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al reanudar el juego' });
        }
    }
    async ForceGameTurn() {
         try {
            // Force process a turn manually
            Logger.action(`Acceso administrativo a /admin/engine/force-turn - Forzando procesamiento de turno`, req.user.player_id);

            // Force process a turn manually
            const result = await processGameTurn(pool, config);

            if (result.paused) {
                Logger.action(`Intento de forzar turno bloqueado: juego está pausado`, req.user.player_id);
                return res.status(400).json({
                    success: false,
                    message: 'No se puede forzar turno: el juego está pausado. Usa /admin/engine/resume primero.'
                });
            }

            if (result.success) {
                Logger.action(`Turno forzado exitosamente: turno ${result.turn}`, req.user.player_id);
                res.json({
                    success: true,
                    message: `Turno ${result.turn} procesado exitosamente`,
                    turn: result.turn,
                    date: result.date
                });
            } else {
                Logger.action(`Error al forzar turno`, req.user.player_id);
                res.status(500).json({ success: false, message: 'Error al procesar turno' });
            }
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-turn',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de turno' });
        }
    }
    async ForceGameHarvest(){
         try {
            Logger.action(`Acceso administrativo a /admin/engine/force-harvest - Forzando procesamiento de cosecha`, req.user.player_id);

            const worldState = TurnService.GetGlobalStatus();
            const currentTurn = worldState.rows[0].current_turn;

            await processHarvestManually(client, currentTurn, config);

            Logger.action(`Cosecha forzada exitosamente en turno ${currentTurn}`, req.user.player_id);
            res.json({
                success: true,
                message: `Cosecha procesada exitosamente en turno ${currentTurn}`,
                turn: currentTurn
            });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-harvest',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de cosecha' });
        }



        
    }    
    async ForceGameExploration(){
        try {
            Logger.action(`Acceso administrativo a /admin/engine/force-exploration - Forzando procesamiento de exploraciones`, req.user.player_id);

            const worldState = TurnService.GetGlobalStatus();
            const currentTurn = worldState.rows[0].current_turn;

            await processExplorationsManually(client, currentTurn, config);

            Logger.action(`Exploraciones forzadas exitosamente en turno ${currentTurn}`, req.user.player_id);        
            res.json({
                success: true,
                message: `Exploraciones procesadas exitosamente en turno ${currentTurn}`,
                turn: currentTurn
            });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-exploration',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de exploraciones' });
        }
    }
}

module.exports = new TurnService();