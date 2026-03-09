const pool = require('../../db.js');

class CharacterModel {
    /**
     * Obtiene un personaje por id, incluyendo sus habilidades agregadas.
     */
    async getById(id) {
        const r = await pool.query(`
            SELECT
                c.*,
                json_agg(
                    json_build_object('ability_key', ca.ability_key, 'level', ca.level)
                ) FILTER (WHERE ca.id IS NOT NULL) AS abilities
            FROM characters c
            LEFT JOIN character_abilities ca ON ca.character_id = c.id
            WHERE c.id = $1
            GROUP BY c.id
        `, [id]);
        const row = r.rows[0];
        if (!row) return null;
        row.abilities = row.abilities ?? [];
        return row;
    }

    /**
     * Todos los personajes de un jugador, con habilidades incluidas.
     */
    async getByPlayer(playerId) {
        const r = await pool.query(`
            SELECT
                c.*,
                json_agg(
                    json_build_object('ability_key', ca.ability_key, 'level', ca.level)
                ) FILTER (WHERE ca.id IS NOT NULL) AS abilities
            FROM characters c
            LEFT JOIN character_abilities ca ON ca.character_id = c.id
            WHERE c.player_id = $1
            GROUP BY c.id
            ORDER BY c.is_main_character DESC, c.created_at ASC
        `, [playerId]);
        return r.rows.map(row => ({ ...row, abilities: row.abilities ?? [] }));
    }

    async getMainCharacter(playerId) {
        const r = await pool.query(
            'SELECT * FROM characters WHERE player_id = $1 AND is_main_character = TRUE LIMIT 1',
            [playerId]
        );
        return r.rows[0] ?? null;
    }

    async getHeir(playerId) {
        const r = await pool.query(
            'SELECT * FROM characters WHERE player_id = $1 AND is_heir = TRUE LIMIT 1',
            [playerId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Crea un nuevo personaje. Acepta un client de transacción o usa el pool global.
     */
    async create(client, { player_id, name, age = 20, health = 100, level = 1,
                            personal_guard = 25, is_heir = false,
                            is_main_character = false, parent_character_id = null,
                            h3_index = null }) {
        const r = await (client || pool).query(`
            INSERT INTO characters
                (player_id, name, age, health, level, personal_guard,
                 is_heir, is_main_character, parent_character_id, h3_index)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [player_id, name, age, health, level, personal_guard,
            is_heir, is_main_character, parent_character_id, h3_index]);
        return r.rows[0];
    }

    /**
     * Actualiza la posición del personaje en el mapa.
     */
    async updatePosition(client, characterId, h3_index) {
        await (client || pool).query(
            'UPDATE characters SET h3_index = $1 WHERE id = $2',
            [h3_index, characterId]
        );
    }

    /**
     * Establece el destino de movimiento del personaje.
     */
    async setDestination(client, characterId, destination) {
        await (client || pool).query(
            'UPDATE characters SET destination = $1 WHERE id = $2',
            [destination, characterId]
        );
    }

    /**
     * Devuelve todos los personajes que tienen destino pendiente.
     */
    async getMoving() {
        const r = await pool.query(
            'SELECT * FROM characters WHERE destination IS NOT NULL AND h3_index IS NOT NULL'
        );
        return r.rows;
    }

    /**
     * Avanza la posición del personaje y limpia destino si ha llegado.
     */
    async advancePosition(client, characterId, newH3, arrived) {
        await (client || pool).query(
            `UPDATE characters
             SET h3_index   = $1,
                 destination = CASE WHEN $2 THEN NULL ELSE destination END
             WHERE id = $3`,
            [newH3, arrived, characterId]
        );
    }

    /**
     * Inserta o actualiza una habilidad del personaje.
     * Requiere constraint UNIQUE (character_id, ability_key) — migración 036.
     */
    async upsertAbility(client, characterId, abilityKey, level = 1) {
        await (client || pool).query(`
            INSERT INTO character_abilities (character_id, ability_key, level)
            VALUES ($1, $2, $3)
            ON CONFLICT (character_id, ability_key)
            DO UPDATE SET level = EXCLUDED.level
        `, [characterId, abilityKey, level]);
    }

    async getAbilities(characterId) {
        const r = await pool.query(
            'SELECT * FROM character_abilities WHERE character_id = $1 ORDER BY ability_key',
            [characterId]
        );
        return r.rows;
    }

    /**
     * Incrementa en 1 la edad de todos los personajes y devuelve los registros actualizados.
     */
    async incrementAllAges() {
        const r = await pool.query('UPDATE characters SET age = age + 1 RETURNING *');
        return r.rows;
    }

    /**
     * Regenera +GUARD_REGEN_PER_TURN a todos los personajes hasta el máximo.
     */
    async regenerateAllGuards(regen = 1, max = 25) {
        await pool.query(`
            UPDATE characters
            SET personal_guard = LEAST($1, personal_guard + $2)
            WHERE personal_guard < $1
        `, [max, regen]);
    }

    /**
     * Elimina un personaje (muerte permanente).
     */
    async delete(client, id) {
        await (client || pool).query('DELETE FROM characters WHERE id = $1', [id]);
    }

    /**
     * Sucesión: promociona el heredero a personaje principal.
     * Deselecciona el main actual y marca el nuevo.
     */
    async promoteToMain(client, playerId, newMainId) {
        await (client || pool).query(
            'UPDATE characters SET is_main_character = FALSE WHERE player_id = $1 AND is_main_character = TRUE',
            [playerId]
        );
        await (client || pool).query(
            'UPDATE characters SET is_main_character = TRUE, is_heir = FALSE WHERE id = $1',
            [newMainId]
        );
    }

    /**
     * Asigna un personaje a un ejército como comandante.
     * Limpia el comandante previo del ejército antes de asignar.
     */
    async assignToArmy(client, characterId, armyId) {
        // Desasociar cualquier comandante previo de ese ejército
        await (client || pool).query(
            'UPDATE characters SET army_id = NULL WHERE army_id = $1',
            [armyId]
        );
        await (client || pool).query(
            'UPDATE characters SET army_id = $1 WHERE id = $2',
            [armyId, characterId]
        );
    }

    /**
     * Elimina el comandante del ejército (pone army_id = NULL).
     */
    async clearArmyCommander(armyId) {
        await pool.query('UPDATE characters SET army_id = NULL WHERE army_id = $1', [armyId]);
    }

    /**
     * Devuelve el comandante actual de un ejército (o null).
     */
    async getCommanderForArmy(armyId) {
        const r = await pool.query(
            'SELECT * FROM characters WHERE army_id = $1 LIMIT 1',
            [armyId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Actualiza health garantizando que quede entre 0 y 100.
     */
    async updateHealth(client, id, health) {
        const clamped = Math.min(100, Math.max(0, health));
        await (client || pool).query(
            'UPDATE characters SET health = $1 WHERE id = $2',
            [clamped, id]
        );
    }
}

module.exports = new CharacterModel();
