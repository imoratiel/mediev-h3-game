const pool = require('../../db.js');

class AdminModel {
    async ResetWorld() {
        await pool.query("UPDATE world_state SET current_turn = 0, game_date = '1039-03-01' WHERE id = 1");
    }
    async GetStats() {
        const world = (await pool.query('SELECT current_turn, game_date FROM world_state WHERE id = 1')).rows[0];
        const turnConfig = (await pool.query("SELECT value FROM game_config WHERE \"group\" = 'gameplay' AND key = 'turn_duration_seconds'")).rows[0];
        const players = (await pool.query('SELECT COUNT(*) FROM players')).rows[0].count;
        const territories = (await pool.query('SELECT COUNT(*) FROM h3_map WHERE player_id IS NOT NULL')).rows[0].count;
        const messages = (await pool.query('SELECT COUNT(*) FROM messages')).rows[0].count;
        return { world, turnConfig, players, territories, messages };
    }
    async ResetExplorations() {
        await pool.query('UPDATE territory_details SET exploration_end_turn = NULL, discovered_resource = NULL');
    }
    async UpsertConfig(group, key, value) {
        await pool.query(
            'INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value',
            [group, key, value.toString()]
        );
    }
}

module.exports = new AdminModel();
