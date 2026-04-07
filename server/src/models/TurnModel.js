const db = require('../../db.js');

// SQL fragment that extracts day/month/year(historical)/era from a DATE column.
// Works correctly for BC dates: EXTRACT(YEAR) returns astronomical year (-209 for 210 BC).
// Historical BC year = -astronomical + 1  (e.g. -(-209)+1 = 210)
const DATE_PARTS_SQL = `
    EXTRACT(DAY   FROM game_date)::int AS day,
    EXTRACT(MONTH FROM game_date)::int AS month,
    CASE WHEN EXTRACT(YEAR FROM game_date) < 1
         THEN -EXTRACT(YEAR FROM game_date)::int
         ELSE  EXTRACT(YEAR FROM game_date)::int
    END AS year,
    CASE WHEN game_date < '0001-01-01' THEN 'BC' ELSE 'AD' END AS era
`;

class TurnModel {
    async GetCurrentTurn() {
        const result = await db.query('SELECT current_turn, is_paused, last_updated FROM world_state WHERE id = 1');
        return result.rows[0];
    }
    async GetWorldState() {
        const result = await db.query(`SELECT current_turn, is_paused, is_processing, ${DATE_PARTS_SQL} FROM world_state WHERE id = 1`);
        return result.rows[0];
    }
    async SetGamePaused() {
        await db.query('UPDATE world_state SET is_paused = true WHERE id = 1');
    }
    async SetGameResumed() {
        await db.query('UPDATE world_state SET is_paused = false WHERE id = 1');
    }
}

module.exports = new TurnModel();