const db = require('../db.js'); // Tu conexión a DB

class WorldStateModel {
    async GetCurrentTurn() {
        const worldState = await pool.query('SELECT current_turn, is_paused, last_updated FROM world_state WHERE id = 1');
        
        const turn = worldState.rows[0];
        
        return turn;
    }
}

module.exports = new WorldStateModel();