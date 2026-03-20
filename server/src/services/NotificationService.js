const { Logger } = require('../utils/logger');
const NotificationModel = require('../models/NotificationModel.js');
const TurnModel = require('../models/TurnModel.js');

class NotificationService {
    async getNotifications(req, res) {
        try {
            const player_id = req.user.player_id;
            const notifications = await NotificationModel.fetchByPlayer(player_id);
            res.json({ success: true, notifications });
        } catch (error) {
            Logger.error(error, { endpoint: '/notifications', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener notificaciones' });
        }
    }

    async markAsRead(req, res) {
        try {
            const player_id = req.user.player_id;
            const { id } = req.params;
            const updated = await NotificationModel.updateReadStatus(id, player_id);
            if (!updated) {
                return res.status(404).json({ success: false, message: 'Notificación no encontrada' });
            }
            res.json({ success: true });
        } catch (error) {
            Logger.error(error, { endpoint: '/notifications/:id/read', method: 'PUT', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al actualizar notificación' });
        }
    }

    async markAllAsRead(req, res) {
        try {
            const player_id = req.user.player_id;
            const count = await NotificationModel.markAllAsRead(player_id);
            Logger.action(`Notificaciones marcadas como leídas (${count}) por jugador ${player_id}`, player_id);
            res.json({ success: true, updated: count });
        } catch (error) {
            Logger.error(error, { endpoint: '/notifications/read-all', method: 'PUT', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al marcar notificaciones como leídas' });
        }
    }

    async markTypeAsRead(req, res) {
        try {
            const player_id = req.user.player_id;
            const { type } = req.body;
            if (!type) return res.status(400).json({ success: false, message: 'Tipo requerido' });
            const count = await NotificationModel.markByType(player_id, type);
            res.json({ success: true, updated: count });
        } catch (error) {
            Logger.error(error, { endpoint: '/notifications/read-type', method: 'PUT', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al marcar notificaciones' });
        }
    }

    async markAllAsUnread(req, res) {
        try {
            const player_id = req.user.player_id;
            const count = await NotificationModel.markAllAsUnread(player_id);
            res.json({ success: true, updated: count });
        } catch (error) {
            Logger.error(error, { endpoint: '/notifications/unread-all', method: 'PUT', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al marcar notificaciones como no leídas' });
        }
    }

    /**
     * Creates a system notification for a player.
     * @param {number} player_id
     * @param {string} type - 'HARVEST' | 'PRODUCTION' | 'EXPLORATION' | 'COMBAT' | 'MOVEMENT'
     * @param {string} content
     * @param {number} [turn_number] - If provided, skips the DB query for current turn
     */
    async createSystemNotification(player_id, type, content, turn_number) {
        try {
            let turn = turn_number;
            if (turn === undefined || turn === null) {
                const world = await TurnModel.GetCurrentTurn();
                turn = world ? world.current_turn : 0;
            }
            return await NotificationModel.insert(player_id, turn, type, content);
        } catch (error) {
            Logger.error(error, { context: 'NotificationService.createSystemNotification', player_id, type });
        }
    }
}

module.exports = new NotificationService();
