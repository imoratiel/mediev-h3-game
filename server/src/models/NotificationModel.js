const pool = require('../../db.js');

class NotificationModel {
    async insert(player_id, turn_number, type, content) {
        const result = await pool.query(
            'INSERT INTO notifications (player_id, turn_number, type, content) VALUES ($1, $2, $3, $4) RETURNING *',
            [player_id, turn_number, type, content]
        );
        return result.rows[0];
    }

    async fetchByPlayer(player_id) {
        const result = await pool.query(
            'SELECT * FROM notifications WHERE player_id = $1 ORDER BY turn_number DESC, created_at DESC',
            [player_id]
        );
        return result.rows;
    }

    async updateReadStatus(id, player_id) {
        const result = await pool.query(
            'UPDATE notifications SET is_read = true WHERE id = $1 AND player_id = $2 RETURNING *',
            [id, player_id]
        );
        return result.rows[0];
    }

    async markAllAsRead(player_id) {
        const result = await pool.query(
            'UPDATE notifications SET is_read = true WHERE player_id = $1 AND is_read = false RETURNING id',
            [player_id]
        );
        return result.rowCount;
    }

    async markAllAsUnread(player_id) {
        const result = await pool.query(
            'UPDATE notifications SET is_read = false WHERE player_id = $1 AND is_read = true RETURNING id',
            [player_id]
        );
        return result.rowCount;
    }

    async markByType(player_id, type) {
        const result = await pool.query(
            'UPDATE notifications SET is_read = true WHERE player_id = $1 AND type = $2 AND is_read = false RETURNING id',
            [player_id, type]
        );
        return result.rowCount;
    }

    async deleteOlderThan(days) {
        const result = await pool.query(
            `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '${parseInt(days, 10)} days'`
        );
        return result.rowCount;
    }
}

module.exports = new NotificationModel();
