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
    async ResetGame() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Armies (troops cascade via FK)
            await client.query('DELETE FROM armies');

            // 2. Workers
            await client.query('DELETE FROM workers');

            // 3. In-progress bridge constructions
            await client.query('DELETE FROM active_constructions');

            // 4. Restore bridge hexes terrain to River, then remove bridge records
            await client.query(`
                UPDATE h3_map
                SET terrain_type_id = (
                    SELECT terrain_type_id FROM terrain_types
                    WHERE LOWER(name) IN ('río', 'rio', 'river')
                    LIMIT 1
                )
                WHERE h3_index IN (SELECT h3_index FROM bridges)
                  AND (SELECT terrain_type_id FROM terrain_types WHERE LOWER(name) IN ('río', 'rio', 'river') LIMIT 1) IS NOT NULL
            `);
            await client.query('DELETE FROM bridges');

            // 5. Buildings in fiefs
            await client.query('DELETE FROM fief_buildings');

            // 6. Territory economic data
            await client.query('DELETE FROM territory_details');

            // 7. Release hex ownership
            await client.query('UPDATE h3_map SET player_id = NULL');

            // 8. Messages and notifications
            await client.query('DELETE FROM messages');
            await client.query('DELETE FROM notifications');

            // 9. Remove AI bots entirely
            await client.query('DELETE FROM players WHERE is_ai = TRUE');

            // 10. Reset human players (keep accounts, reset game state)
            await client.query(`
                UPDATE players
                SET gold = 50000, capital_h3 = NULL
                WHERE is_ai = FALSE AND deleted = FALSE
            `);

            // 11. Reset world date and turn counter
            await client.query(`UPDATE world_state SET current_turn = 0, game_date = '1039-03-01' WHERE id = 1`);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }
    async UpsertConfig(group, key, value) {
        await pool.query(
            'INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value',
            [group, key, value.toString()]
        );
    }
}

module.exports = new AdminModel();
