'use strict';

/**
 * RelationModel.js
 * Capa de persistencia del sistema de relaciones políticas.
 * Solo SQL — sin lógica de negocio.
 */

class RelationModel {

    // ── Lectura ───────────────────────────────────────────────

    /**
     * Devuelve una relación por su ID, incluyendo datos del tipo.
     */
    async getById(client, relationId) {
        const { rows } = await client.query(`
            SELECT pr.*,
                   rt.code, rt.name AS type_name,
                   rt.oath_payer_template, rt.oath_receiver_template,
                   rt.tribute_rate    AS default_rate,
                   rt.exclusive_payer, rt.exclusive_receiver,
                   rt.creator_cultures,
                   rt.breakable_by_payer, rt.breakable_by_receiver,
                   pf.display_name AS from_display_name,
                   pt.display_name AS to_display_name
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            JOIN players pf ON pf.player_id = pr.from_player_id
            JOIN players pt ON pt.player_id = pr.to_player_id
            WHERE pr.relation_id = $1
        `, [relationId]);
        return rows[0] ?? null;
    }

    /**
     * Todas las relaciones activas (status='active') donde el jugador es parte.
     * Incluye nombre resuelto del juramento según el rol del jugador.
     */
    async getActiveByPlayer(client, playerId) {
        const { rows } = await client.query(`
            SELECT pr.*,
                   rt.code, rt.name AS type_name,
                   rt.oath_payer_template, rt.oath_receiver_template,
                   rt.breakable_by_payer, rt.breakable_by_receiver,
                   pf.display_name AS from_display_name,
                   pt.display_name AS to_display_name
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            JOIN players pf ON pf.player_id = pr.from_player_id
            JOIN players pt ON pt.player_id = pr.to_player_id
            WHERE pr.status = 'active'
              AND (pr.from_player_id = $1 OR pr.to_player_id = $1)
            ORDER BY pr.started_at DESC
        `, [playerId]);
        return rows;
    }

    /**
     * Todas las relaciones activas de cualquier tipo entre dos jugadores.
     */
    async getActiveBetween(client, playerA, playerB) {
        const { rows } = await client.query(`
            SELECT pr.*, rt.code, rt.name AS type_name
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND (
                  (pr.from_player_id = $1 AND pr.to_player_id = $2) OR
                  (pr.from_player_id = $2 AND pr.to_player_id = $1)
              )
        `, [playerA, playerB]);
        return rows;
    }

    /**
     * Comprueba si el jugador ya tiene una relación activa de un tipo como pagador.
     * Usado para validar exclusividad (devotio, clientela, tributo).
     */
    async getActiveAsPayerByType(client, playerId, typeCode) {
        const { rows } = await client.query(`
            SELECT pr.relation_id
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND pr.from_player_id = $1
              AND rt.code = $2
            LIMIT 1
        `, [playerId, typeCode]);
        return rows[0] ?? null;
    }

    /**
     * Todos los seguidores devotio activos de un patrón.
     * Usado en la cascade de muerte del main_character del patrón.
     */
    async getActiveDevotioFollowers(client, patronPlayerId) {
        const { rows } = await client.query(`
            SELECT pr.relation_id, pr.from_player_id AS follower_id
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND rt.code = 'devotio'
              AND pr.to_player_id = $1
        `, [patronPlayerId]);
        return rows;
    }

    /**
     * Todas las relaciones activas que generan tributo porcentual.
     * Usado por el motor de turnos para el cobro mensual.
     * Devuelve también el rate efectivo (override del contrato o default del tipo).
     */
    async getActiveTributeRelations(client) {
        const { rows } = await client.query(`
            SELECT pr.relation_id,
                   rt.code,
                   pr.from_player_id,
                   pr.to_player_id,
                   COALESCE(pr.terms_rate, rt.tribute_rate) AS effective_rate
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND (COALESCE(pr.terms_rate, rt.tribute_rate) > 0)
        `);
        return rows;
    }

    /**
     * Todas las relaciones de mercenariado activas con pago fijo pendiente.
     */
    async getActiveMercenaryContracts(client) {
        const { rows } = await client.query(`
            SELECT pr.relation_id, pr.from_player_id, pr.to_player_id,
                   pr.terms_fixed_pay
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND rt.code = 'mercenariado'
              AND pr.terms_fixed_pay > 0
        `);
        return rows;
    }

    /**
     * Relaciones activas que han llegado a su turno de expiración.
     */
    async getExpired(client, currentTurn) {
        const { rows } = await client.query(`
            SELECT pr.relation_id, pr.from_player_id, pr.to_player_id,
                   rt.code
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND pr.expires_at_turn IS NOT NULL
              AND pr.expires_at_turn <= $1
        `, [currentTurn]);
        return rows;
    }

    /**
     * Devuelve los jugadores en guerra con el jugador dado (1 nivel).
     * Incluye directos + aliados de cada bando.
     */
    async getWarEnemyBlock(client, playerId) {
        // Encuentra todos los jugadores con quienes player está en guerra (directa)
        const { rows: wars } = await client.query(`
            SELECT CASE WHEN from_player_id = $1 THEN to_player_id
                        ELSE from_player_id END AS enemy_id
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND rt.code = 'guerra'
              AND (pr.from_player_id = $1 OR pr.to_player_id = $1)
        `, [playerId]);

        if (wars.length === 0) return new Set();

        const directEnemies = wars.map(r => r.enemy_id);

        // Nivel 1: aliados, clientes y devotios de esos enemigos
        const { rows: extended } = await client.query(`
            SELECT DISTINCT
                CASE WHEN pr.from_player_id = ANY($1::int[]) THEN pr.to_player_id
                     ELSE pr.from_player_id END AS extended_enemy
            FROM player_relations pr
            JOIN relation_types rt ON rt.id = pr.type_id
            WHERE pr.status = 'active'
              AND rt.code IN ('alianza', 'clientela', 'devotio')
              AND (pr.from_player_id = ANY($1::int[]) OR pr.to_player_id = ANY($1::int[]))
        `, [directEnemies]);

        const enemyBlock = new Set([...directEnemies, ...extended.map(r => r.extended_enemy)]);
        enemyBlock.delete(playerId); // nunca incluirse a sí mismo
        return enemyBlock;
    }

    // ── Escritura ──────────────────────────────────────────────

    /**
     * Crea una relación en estado 'pending'.
     */
    async create(client, {
        type_id, from_player_id, to_player_id,
        terms_rate = null, terms_fixed_pay = null, terms_duration_months = null,
        hostage_character_id = null,
    }) {
        const { rows } = await client.query(`
            INSERT INTO player_relations
                (type_id, from_player_id, to_player_id,
                 terms_rate, terms_fixed_pay, terms_duration_months,
                 hostage_character_id, status, proposed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
            RETURNING *
        `, [type_id, from_player_id, to_player_id,
            terms_rate, terms_fixed_pay, terms_duration_months,
            hostage_character_id]);
        return rows[0];
    }

    /**
     * Activa una relación pendiente → 'active'.
     * Calcula expires_at_turn si la relación tiene duración definida.
     */
    async activate(client, relationId, currentTurn, turnsPerMonth) {
        const rel = await this.getById(client, relationId);
        let expiresAtTurn = null;
        if (rel.terms_duration_months) {
            expiresAtTurn = currentTurn + rel.terms_duration_months * turnsPerMonth;
        }

        const { rows } = await client.query(`
            UPDATE player_relations
            SET status = 'active',
                started_at = NOW(),
                expires_at_turn = $2
            WHERE relation_id = $1
            RETURNING *
        `, [relationId, expiresAtTurn]);
        return rows[0];
    }

    /**
     * Finaliza una relación → 'ended'.
     */
    async end(client, relationId, reason) {
        const { rows } = await client.query(`
            UPDATE player_relations
            SET status = 'ended',
                ended_at = NOW(),
                end_reason = $2
            WHERE relation_id = $1
            RETURNING *
        `, [relationId, reason]);
        return rows[0];
    }

    // ── Eventos ────────────────────────────────────────────────

    /**
     * Registra un evento en el historial de la relación.
     */
    async logEvent(client, {
        relation_id, event_type, actor_player_id = null,
        amount = null, turn_number = null, details = null,
    }) {
        await client.query(`
            INSERT INTO relation_events
                (relation_id, event_type, actor_player_id, amount, turn_number, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [relation_id, event_type, actor_player_id, amount, turn_number,
            details ? JSON.stringify(details) : null]);
    }

    // ── Consulta del tipo ──────────────────────────────────────

    /**
     * Devuelve un tipo de relación por código.
     */
    async getType(client, code) {
        const { rows } = await client.query(
            `SELECT * FROM relation_types WHERE code = $1`, [code]
        );
        return rows[0] ?? null;
    }

    async getAllTypes(client) {
        const { rows } = await client.query(
            `SELECT * FROM relation_types ORDER BY id`
        );
        return rows;
    }
}

module.exports = new RelationModel();
