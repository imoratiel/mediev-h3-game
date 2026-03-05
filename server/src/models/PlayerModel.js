const pool = require('../../db.js');

class PlayerModel {
    async GetById(player_id) {
        const result = await pool.query(
            'SELECT player_id, username, display_name, gold, color, tax_percentage, tithe_active FROM players WHERE player_id = $1',
            [player_id]
        );
        return result.rows[0];
    }

    async GetPlayerIdById(player_id) {
        const result = await pool.query('SELECT player_id FROM players WHERE player_id = $1', [player_id]);

        return result;
    }    
    async GetPlayerIdByUsername(username) {
        //console.log(`[DEBUG] Buscando jugador: "${playerName}"`);
        //console.log(`[DEBUG] Conectado a: ${pool.options.database} en ${pool.options.host}`);
        const result = await pool.query("SELECT player_id FROM players WHERE LOWER(username) = LOWER($1)", [username]);
        return result;
    }
    async GetPlayerByUsername(username){
        const result = await pool.query('SELECT player_id, username, display_name, password, role, capital_h3, gold FROM players WHERE username = $1', [username]);
        return result;
    }
}

module.exports = new PlayerModel();
 