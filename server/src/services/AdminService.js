const { Logger } = require('../utils/logger');
const AdminModel = require('../models/AdminModel.js');
const { CONFIG } = require('../config.js');

class AdminService {
    async ResetWorld(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/reset - Reseteando mundo', req.user.player_id);
            await AdminModel.ResetWorld();
            Logger.action('Mundo reseteado exitosamente', req.user.player_id);
            res.json({ success: true, message: 'Mundo reseteado' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/reset', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al resetear mundo' });
        }
    }
    async GetStats(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/stats', req.user.player_id);
            const { world, turnConfig, players, territories, messages } = await AdminModel.GetStats();
            res.json({
                success: true,
                stats: {
                    current_turn: world.current_turn,
                    game_date: world.game_date,
                    players: parseInt(players),
                    territories: parseInt(territories),
                    messages: parseInt(messages),
                    turn_interval_seconds: turnConfig.value
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/stats', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
        }
    }
    async ResetExplorations(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/reset-explorations - Reseteando exploraciones', req.user.player_id);
            await AdminModel.ResetExplorations();
            Logger.action('Exploraciones reseteadas exitosamente', req.user.player_id);
            res.json({ success: true, message: 'Todas las exploraciones han sido reseteadas' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/reset-explorations', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al resetear exploraciones' });
        }
    }
    async UpdateConfig(req, res) {
        try {
            const { turn_interval_seconds } = req.body;
            if (!turn_interval_seconds) return res.status(400).json({ success: false, message: 'turn_interval_seconds requerido' });

            Logger.action(`Acceso administrativo a /admin/config - Actualizando intervalo de turnos a ${turn_interval_seconds}s`, req.user.player_id);
            await AdminModel.UpsertConfig('gameplay', 'turn_duration_seconds', turn_interval_seconds);
            Logger.action(`Configuración actualizada: turn_interval_seconds = ${turn_interval_seconds}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración actualizada. Reinicie el servidor para aplicar el nuevo intervalo de tiempo.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/config', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración', error: error.message });
        }
    }
    async GetGameConfig(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/game-config - Consultando configuración', req.user.player_id);
            res.json({ success: true, config: CONFIG });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/game-config', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener configuración' });
        }
    }
    async UpdateGameConfig(req, res) {
        try {
            const { group, key, value } = req.body;
            if (!group || !key || value === undefined) return res.status(400).json({ success: false, message: 'Faltan parámetros' });

            Logger.action(`Acceso administrativo a /admin/game-config - Actualizando ${group}.${key} = ${value}`, req.user.player_id);
            await AdminModel.UpsertConfig(group, key, value);

            // Update in-memory config so changes take effect without restart
            if (!CONFIG[group]) CONFIG[group] = {};
            CONFIG[group][key] = !isNaN(value) ? Number(value) : value;

            Logger.action(`Configuración actualizada: ${group}.${key} = ${value}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración de juego actualizada' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/game-config', method: 'PUT', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración de juego' });
        }
    }
}

module.exports = new AdminService();
