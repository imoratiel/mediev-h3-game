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
    async create(client, { player_id, name, age = 20, health = 100, level = 10,
                            personal_guard = 25, is_heir = false,
                            is_main_character = false, parent_character_id = null,
                            h3_index = null, birth_turn = 0, xp = 0,
                            birth_month = null }) {
        const month = birth_month ?? (Math.floor(Math.random() * 12) + 1);
        const r = await (client || pool).query(`
            INSERT INTO characters
                (player_id, name, age, health, level, personal_guard,
                 is_heir, is_main_character, parent_character_id, h3_index,
                 birth_turn, xp, birth_month)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [player_id, name, age, health, level, personal_guard,
            is_heir, is_main_character, parent_character_id, h3_index,
            birth_turn, xp, month]);
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
        // Asignar y limpiar destino propio (ahora viaja con el ejército)
        await (client || pool).query(
            'UPDATE characters SET army_id = $1, destination = NULL WHERE id = $2',
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
     * Acepta client transaccional para uso dentro de transacciones.
     */
    async getCommanderForArmy(client, armyId) {
        const r = await (client || pool).query(
            'SELECT * FROM characters WHERE army_id = $1 LIMIT 1',
            [armyId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Actualiza la guardia personal del personaje (tras combate de guardia).
     */
    async updateGuard(client, characterId, newGuard) {
        const clamped = Math.min(25, Math.max(0, newGuard));
        await (client || pool).query(
            'UPDATE characters SET personal_guard = $1 WHERE id = $2',
            [clamped, characterId]
        );
    }

    /**
     * Marca al personaje como capturado y lo asigna al ejército capturador.
     * Calcula un rescate proporcional al nivel del personaje.
     */
    async setCaptive(client, characterId, capturingArmyId, characterLevel = 1) {
        const ransomAmount = 1000 * characterLevel;
        await (client || pool).query(
            `UPDATE characters
             SET army_id              = $1,
                 is_captive           = TRUE,
                 captured_by_army_id  = $1,
                 destination          = NULL,
                 ransom_amount        = $2,
                 ransom_turns_remaining = 10
             WHERE id = $3`,
            [capturingArmyId, ransomAmount, characterId]
        );
    }

    /**
     * Libera al personaje (huida o rescate): limpia estado de cautiverio
     * y establece la capital como destino de movimiento.
     */
    async flee(client, characterId, capitalH3) {
        await (client || pool).query(
            `UPDATE characters
             SET army_id              = NULL,
                 is_captive           = FALSE,
                 captured_by_army_id  = NULL,
                 ransom_amount        = NULL,
                 ransom_turns_remaining = NULL,
                 destination          = $1
             WHERE id = $2`,
            [capitalH3, characterId]
        );
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

    /**
     * Returns enemy standalone characters located at any of the given hexes.
     * Used by the fog-of-war endpoint to show visible enemy characters on the map.
     */
    async getEnemyCharactersAtHexes(playerId, hexes) {
        if (hexes.length === 0) return [];
        const r = await pool.query(
            `SELECT c.id, c.name, c.h3_index, c.is_main_character,
                    p.display_name AS player_name, p.color AS player_color
             FROM characters c
             JOIN players p ON p.player_id = c.player_id
             WHERE c.player_id != $1
               AND c.army_id IS NULL
               AND c.is_captive = FALSE
               AND c.transported_by IS NULL
               AND c.h3_index IS NOT NULL
               AND c.h3_index = ANY($2::text[])`,
            [playerId, hexes]
        );
        return r.rows;
    }

    /**
     * Returns h3_index of standalone (not in army, not captive) characters for a player.
     * Used to build fog-of-war visibility — each character reveals a small disk around them.
     */
    async getStandalonePositions(playerId) {
        const r = await pool.query(
            `SELECT h3_index FROM characters
             WHERE player_id = $1
               AND army_id IS NULL
               AND is_captive = FALSE
               AND transported_by IS NULL
               AND h3_index IS NOT NULL`,
            [playerId]
        );
        return r.rows.map(row => row.h3_index);
    }

    /**
     * Devuelve el personaje de mayor nivel asignado a un ejército.
     * Usado en combate para aplicar el bonus del mejor comandante.
     */
    async getBestInArmy(client, armyId) {
        const r = await (client || pool).query(
            `SELECT * FROM characters
             WHERE army_id = $1
               AND is_captive = FALSE
               AND age >= 16
             ORDER BY level DESC
             LIMIT 1`,
            [armyId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Devuelve todos los personajes adultos (≥16) y vivos de un jugador,
     * ordenados por nivel descendente. Excluye cautivos.
     */
    async getAdults(client, playerId) {
        const r = await (client || pool).query(
            `SELECT * FROM characters
             WHERE player_id = $1
               AND age >= 16
               AND health > 0
               AND is_captive = FALSE
             ORDER BY level DESC`,
            [playerId]
        );
        return r.rows;
    }

    /**
     * Devuelve el conteo de personajes vivos de un jugador (incluye niños).
     */
    async countAlive(client, playerId) {
        const r = await (client || pool).query(
            `SELECT COUNT(*)::int AS cnt
             FROM characters
             WHERE player_id = $1 AND health > 0 AND is_captive = FALSE`,
            [playerId]
        );
        return r.rows[0].cnt;
    }

    /**
     * Promueve el heredero actual a líder (is_main_character = true).
     * Devuelve el personaje actualizado o null si no había heredero.
     */
    async promoteHeirToLeader(client, playerId) {
        const r = await (client || pool).query(
            `UPDATE characters
             SET is_main_character = TRUE, is_heir = FALSE
             WHERE player_id = $1 AND is_heir = TRUE AND health > 0
             RETURNING *`,
            [playerId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Asigna el personaje adulto de mayor nivel como nuevo heredero.
     * Excluye al líder actual. Devuelve el personaje actualizado o null.
     */
    async assignBestAsHeir(client, playerId) {
        const r = await (client || pool).query(
            `UPDATE characters
             SET is_heir = TRUE
             WHERE id = (
                 SELECT id FROM characters
                 WHERE player_id = $1
                   AND age >= 16
                   AND health > 0
                   AND is_captive = FALSE
                   AND is_main_character = FALSE
                   AND is_heir = FALSE
                 ORDER BY level DESC
                 LIMIT 1
             )
             RETURNING *`,
            [playerId]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Incrementa el XP de un personaje y sube de nivel si alcanza el umbral.
     * Umbral: level * 10. Retorna el personaje actualizado.
     */
    async addXp(client, characterId, xpAmount) {
        const r = await (client || pool).query(
            `UPDATE characters
             SET level = LEAST(100, level + FLOOR((xp + $2) / (level * 10))::int),
                 xp    = (xp + $2) % (level * 10)
             WHERE id = $1
             RETURNING id, name, level, xp`,
            [characterId, xpAmount]
        );
        return r.rows[0] ?? null;
    }

    /**
     * Devuelve todos los personajes de un jugador para el ciclo anual
     * (envejecimiento + muerte natural). Incluye niños y adultos.
     */
    async getAllAliveByPlayer(client, playerId) {
        const r = await (client || pool).query(
            `SELECT id, name, age, birth_month, health, is_main_character, is_heir, parent_character_id
             FROM characters
             WHERE player_id = $1 AND health > 0 AND is_captive = FALSE`,
            [playerId]
        );
        return r.rows;
    }

    /**
     * Incrementa la edad de un personaje en 1 año.
     */
    async incrementAge(client, characterId) {
        await (client || pool).query(
            'UPDATE characters SET age = age + 1 WHERE id = $1',
            [characterId]
        );
    }

    /**
     * Marca un personaje como muerto (health = 0).
     */
    async killCharacter(client, characterId) {
        await (client || pool).query(
            'UPDATE characters SET health = 0 WHERE id = $1',
            [characterId]
        );
    }
}

module.exports = new CharacterModel();
