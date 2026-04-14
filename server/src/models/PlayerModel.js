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
        const result = await pool.query('SELECT player_id, username, display_name, password, role, capital_h3, gold, is_initialized FROM players WHERE LOWER(username) = LOWER($1)', [username]);
        return result;
    }

    async GetPlayerIdByDisplayName(displayName) {
        const result = await pool.query(
            'SELECT player_id FROM players WHERE LOWER(display_name) = LOWER($1) AND deleted = FALSE',
            [displayName]
        );
        return result;
    }

    // ── OAuth ──────────────────────────────────────────────────────────────────

    /**
     * Busca la cuenta OAuth y devuelve el player_id vinculado, o null si no existe.
     */
    async FindOAuthAccount(provider, providerId) {
        const result = await pool.query(
            'SELECT player_id FROM oauth_accounts WHERE provider = $1 AND provider_id = $2',
            [provider, providerId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Fetch básico de player para construir el JWT payload tras OAuth.
     */
    async GetPlayerById(playerId) {
        const result = await pool.query(
            'SELECT player_id, username, display_name, role, capital_h3 FROM players WHERE player_id = $1',
            [playerId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Crea un player nuevo sin contraseña y su registro oauth_accounts en una
     * transacción ya iniciada por el caller.
     * Lanza error con code '23505' si el email ya está registrado (anti-multicuenta).
     */
    async CreateOAuthPlayer(client, { username, display_name, first_name = '', last_name = '', email, provider, provider_id }) {
        const playerResult = await client.query(
            `INSERT INTO players (username, display_name, first_name, last_name, role, gold)
             VALUES ($1, $2, $3, $4, 'player', 100000)
             RETURNING player_id`,
            [username, display_name, first_name, last_name]
        );
        const playerId = playerResult.rows[0].player_id;

        await client.query(
            `INSERT INTO oauth_accounts (player_id, provider, provider_id, email)
             VALUES ($1, $2, $3, $4)`,
            [playerId, provider, provider_id, email]
        );

        return playerId;
    }
}

module.exports = new PlayerModel();
 