const { Logger } = require('../utils/logger');
const CharacterModel = require('../models/CharacterModel');

class DynastyService {
    /**
     * Gestiona la sucesión cuando el personaje principal muere.
     * Prioridad: heredero designado (is_heir=true) → personaje más viejo → línea extinta.
     *
     * @param {import('pg').PoolClient} client - cliente de transacción activa
     * @param {number} playerId
     * @param {number} deceasedId - id del personaje muerto (excluido de la búsqueda)
     */
    async handleSuccession(client, playerId, deceasedId) {
        // 1. Buscar heredero designado
        const heirResult = await client.query(
            `SELECT * FROM characters
             WHERE player_id = $1 AND is_heir = TRUE AND id != $2
             LIMIT 1`,
            [playerId, deceasedId]
        );
        let successor = heirResult.rows[0];

        // 2. Fallback: personaje vivo más viejo
        if (!successor) {
            const fallbackResult = await client.query(
                `SELECT * FROM characters
                 WHERE player_id = $1 AND id != $2
                 ORDER BY age DESC LIMIT 1`,
                [playerId, deceasedId]
            );
            successor = fallbackResult.rows[0];
        }

        if (successor) {
            await CharacterModel.promoteToMain(client, playerId, successor.id);
            Logger.action(
                `Sucesión dinástica: ${successor.name} (id=${successor.id}) asume como nuevo personaje principal del jugador ${playerId}`,
                playerId
            );
            return { success: true, successor };
        }

        // 3. Sin herederos — línea dinástica extinguida
        Logger.action(
            `Jugador ${playerId}: línea dinástica extinguida. Sin personajes supervivientes.`,
            playerId
        );
        return { success: false, successor: null };
    }
}

module.exports = new DynastyService();
