const db = require('../../db.js');

class TurnModel {
    async GetCurrentTurn() {
        const result = await db.query('SELECT current_turn, is_paused, last_updated FROM world_state WHERE id = 1');
        return result.rows[0];
    }
    async GetWorldState() {
        const result = await db.query('SELECT current_turn, game_date, is_paused FROM world_state WHERE id = 1');
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