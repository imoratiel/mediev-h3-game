const pool = require('../../db.js');

class PlayerModel {
    async GetById(player_id) {
        const result = await pool.query(
            'SELECT player_id, username, gold, color FROM players WHERE player_id = $1',
            [player_id]
        );
        return result.rows[0];
    }
}

module.exports = new PlayerModel();
