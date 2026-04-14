const { Logger } = require('../utils/logger');
const MessageModel = require('../models/MessageModel.js');
const PlayerModel = require('../models/PlayerModel.js');
const pool = require('../../db.js');

class MessageService {
    async GetMessagesByUserId(req,res) {
        try {
            const player_id = req.user.player_id;  

            const result = await MessageModel.GetMessagesByUserId(player_id);

            res.json({ success: true, messages: result.rows });            
        } catch (error) {
            Logger.error(error, {
                endpoint: '/messages',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener mensajes' });
        }        
    }
    async SendMessage(req, res) {
        try {
            const { recipient_display_name, subject, body, parent_id } = req.body;

            const receiver = await PlayerModel.GetPlayerIdByDisplayName(recipient_display_name);
            if (receiver.rows.length === 0)
                return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });

            // Si es una respuesta, heredar el thread_id del mensaje padre
            let thread_id = null;
            if (parent_id) {
                const parent = await pool.query('SELECT thread_id FROM messages WHERE id = $1', [parent_id]);
                thread_id = parent.rows[0]?.thread_id ?? null;
            }

            await MessageModel.SendMessage(req.user.player_id, receiver.rows[0].player_id, subject, body, thread_id);

            res.json({ success: true, message: 'Mensaje enviado' });
        } catch (error) {
            Logger.error(error, { endpoint: '/messages', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
        }
    }    
    async MarkMessageAsRead(req,res){
        try {
            const messageId = parseInt(req.params.id);
            const playerId = req.user.player_id;

            // Verify message exists and user is the receiver
            const messageCheck = await MessageModel.GetMessagesById(messageId);

            if (messageCheck.rows.length === 0) {
                Logger.error(new Error('Message not found'), {
                    context: 'api.markMessageRead',
                    messageId: messageId,
                    userId: playerId
                });
                return res.status(404).json({ success: false, message: 'Mensaje no encontrado' });
            }

            const message = messageCheck.rows[0];

            // Security check: only the receiver can mark a message as read
            if (message.receiver_id !== playerId) {
                Logger.error(new Error('Unauthorized mark as read attempt'), {
                    context: 'api.markMessageRead',
                    messageId: messageId,
                    userId: playerId,
                    actualReceiverId: message.receiver_id
                });
                return res.status(403).json({ success: false, message: 'No autorizado' });
            }

            // Update message to mark as read
            await MessageModel.MarkMessageAsRead(messageId);

            Logger.action(`Mensaje ${messageId} marcado como leído`, playerId);
            res.json({ success: true, message: `Mensaje id: ${messageId} marcado como leído` });
        } catch (error) {
            Logger.error(error, {
                context: 'api.markMessageRead',
                endpoint: 'PUT /api/messages/:id/read',
                userId: req.user?.player_id,
                messageId: req.params.id
            });
            res.status(500).json({ success: false, message: 'Error al marcar mensaje como leído' });
        }
    }
    async GetThread(req, res) {
        try {
            const threadId = parseInt(req.params.thread_id);
            const playerId = req.user.player_id;

            const result = await MessageModel.GetMessagesByThreadId(threadId, playerId);

            res.json({ success: true, messages: result.rows });
        } catch (error) {
            Logger.error(error, {
                endpoint: 'GET /api/messages/thread/:thread_id',
                userId: req.user?.player_id,
                threadId: req.params.thread_id
            });
            res.status(500).json({ success: false, message: 'Error al cargar conversación' });
        }
    }
}

module.exports = new MessageService();