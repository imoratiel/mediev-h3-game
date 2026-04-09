const pool = require('../../db.js');

class MessageModel {    
    async GetMessagesByUserId(player_id) {
        const result = await pool.query(`
            SELECT m.*,
                   s.display_name AS sender_username,
                   r.display_name AS receiver_username
            FROM messages m
            LEFT JOIN players s ON m.sender_id  = s.player_id
            LEFT JOIN players r ON m.receiver_id = r.player_id
            WHERE m.receiver_id = $1 OR m.sender_id = $1
            ORDER BY m.sent_at DESC
        `, [player_id]);
        return result;
    }
    async GetMessagesById(messageId) {
        console.log(`[DEBUG] Buscando mensaje: "${messageId}"`);
        const result = await pool.query('SELECT id, receiver_id, is_read FROM messages WHERE id = $1', [messageId]);
        return result;
    }
    async GetMessagesByThreadId(threadId, playerId){
        // Get all messages in thread where user is sender or receiver
        const result = await pool.query(`
                SELECT m.*,
                       s.display_name as sender_username,
                       r.display_name as receiver_username
                FROM messages m
                LEFT JOIN players s ON m.sender_id = s.player_id
                LEFT JOIN players r ON m.receiver_id = r.player_id
                WHERE m.thread_id = $1
                  AND (m.sender_id = $2 OR m.receiver_id = $2)
                ORDER BY m.sent_at ASC
            `, [threadId, playerId]);
        return result;
    }
    async SendMessage(sender_id, receiver_id, subject, body){
        await pool.query('INSERT INTO messages (sender_id, receiver_id, subject, body) VALUES ($1, $2, $3, $4)', [sender_id, receiver_id, subject, body]);
    }
    async MarkMessageAsRead(messageId) {
        const result = await pool.query('UPDATE messages SET is_read = TRUE WHERE id = $1', [messageId]);
        return result;
    }
}

module.exports = new MessageModel();