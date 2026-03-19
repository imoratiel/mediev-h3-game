'use strict';

/**
 * RelationService.js
 * Handlers HTTP y lógica de negocio del sistema de relaciones políticas.
 *
 * Endpoints:
 *   POST /api/relations/propose        → proponer una relación
 *   POST /api/relations/:id/accept     → aceptar una relación pendiente
 *   POST /api/relations/:id/break      → romper una relación activa
 *   GET  /api/relations/:playerId      → relaciones activas de un jugador (público)
 *   GET  /api/relations/my             → relaciones propias (autenticado)
 *   GET  /api/relations/types          → catálogo de tipos (público)
 */

const pool = require('../../db.js');
const { Logger } = require('../utils/logger');
const RelationModel = require('../models/RelationModel.js');
const NotificationService = require('./NotificationService.js');
const {
    TRIBUTO_MIN_RATE, TRIBUTO_MAX_RATE,
    TRIBUTO_MIN_MONTHS, TRIBUTO_MAX_MONTHS,
    MERCENARIOS_MIN_MONTHS, MERCENARIOS_MAX_MONTHS, MERCENARIOS_MIN_PAY,
    REPUTATION_BREAK_PENALTY,
    TURNS_PER_MONTH,
} = require('../config/RelationConfig.js');

class RelationService {

    // ── Helpers privados ──────────────────────────────────────

    /**
     * Resuelve el texto del juramento sustituyendo {payer} y {receiver}
     * por los nombres reales de los jugadores.
     */
    _resolveOath(template, payerName, receiverName) {
        if (!template) return null;
        return template
            .replace('{payer}',    payerName)
            .replace('{receiver}', receiverName);
    }

    /**
     * Construye la vista de una relación con los juramentos resueltos
     * desde la perspectiva de un jugador.
     */
    _buildRelationView(rel, viewerPlayerId) {
        const isPayer = rel.from_player_id === viewerPlayerId;
        const oath = isPayer
            ? this._resolveOath(rel.oath_payer_template,   rel.from_display_name, rel.to_display_name)
            : this._resolveOath(rel.oath_receiver_template, rel.from_display_name, rel.to_display_name);

        return {
            relation_id:    rel.relation_id,
            type_code:      rel.code,
            type_name:      rel.type_name,
            oath,
            from_player_id: rel.from_player_id,
            from_name:      rel.from_display_name,
            to_player_id:   rel.to_player_id,
            to_name:        rel.to_display_name,
            status:         rel.status,
            effective_rate: rel.effective_rate ?? null,
            terms_fixed_pay:        rel.terms_fixed_pay,
            terms_duration_months:  rel.terms_duration_months,
            expires_at_turn:        rel.expires_at_turn,
            started_at:     rel.started_at,
            proposed_at:    rel.proposed_at,
            can_break:      isPayer ? rel.breakable_by_payer : rel.breakable_by_receiver,
        };
    }

    // ── Validación ────────────────────────────────────────────

    /**
     * Verifica que la nueva relación no viola ninguna restricción.
     * Devuelve { ok: true } o { ok: false, message: '...' }.
     */
    async _validateNewRelation(client, fromId, toId, type, terms = {}) {
        // 1. Restricción de cultura
        if (type.creator_cultures && type.creator_cultures.length > 0) {
            const { rows } = await client.query(
                'SELECT culture_id FROM players WHERE player_id = $1', [fromId]
            );
            if (!rows[0] || !type.creator_cultures.includes(rows[0].culture_id)) {
                return { ok: false, message: `Solo las culturas ${type.creator_cultures.join(',')} pueden proponer esta relación.` };
            }
        }

        // 2. Exclusividad del pagador
        if (type.exclusive_payer) {
            const existing = await RelationModel.getActiveAsPayerByType(client, fromId, type.code);
            if (existing) {
                return { ok: false, message: `Ya tienes una relación activa de tipo "${type.name}". Debes romperla primero.` };
            }
        }

        // 3. No relación duplicada entre los mismos jugadores y del mismo tipo
        const between = await RelationModel.getActiveBetween(client, fromId, toId);
        const duplicate = between.find(r => r.code === type.code);
        if (duplicate) {
            return { ok: false, message: `Ya existe una relación "${type.name}" activa entre estos jugadores.` };
        }

        // 4. Bloqueo de guerra: si alguno de los dos (o sus aliados nivel-1) está en guerra con el otro
        const myEnemyBlock    = await RelationModel.getWarEnemyBlock(client, fromId);
        const theirEnemyBlock = await RelationModel.getWarEnemyBlock(client, toId);

        if (myEnemyBlock.has(toId) || theirEnemyBlock.has(fromId)) {
            return { ok: false, message: 'No puedes firmar un tratado mientras estás en guerra con ese jugador o su bloque.' };
        }

        // 5. Tributo: no se puede entrar en clientela con un dominador mientras hay tributo activo
        if (type.code === 'clientela') {
            const hasActiveTributo = between.find(r => r.code === 'tributo');
            if (hasActiveTributo) {
                return { ok: false, message: 'No puedes entrar en clientela con tu dominador mientras el tributo esté activo.' };
            }
        }

        // 6. Validación de términos por tipo
        if (type.code === 'tributo') {
            const rate = parseFloat(terms.terms_rate ?? 0);
            if (rate < TRIBUTO_MIN_RATE || rate > TRIBUTO_MAX_RATE) {
                return { ok: false, message: `La tasa del tributo debe estar entre ${TRIBUTO_MIN_RATE * 100}% y ${TRIBUTO_MAX_RATE * 100}%.` };
            }
            const months = parseInt(terms.terms_duration_months ?? 0);
            if (months < TRIBUTO_MIN_MONTHS || months > TRIBUTO_MAX_MONTHS) {
                return { ok: false, message: `La duración del tributo debe estar entre ${TRIBUTO_MIN_MONTHS} y ${TRIBUTO_MAX_MONTHS} meses.` };
            }
        }

        if (type.code === 'mercenariado') {
            const pay = parseInt(terms.terms_fixed_pay ?? 0);
            if (pay < MERCENARIOS_MIN_PAY) {
                return { ok: false, message: `El pago mensual del mercenariado debe ser al menos ${MERCENARIOS_MIN_PAY} de oro.` };
            }
            const months = parseInt(terms.terms_duration_months ?? 0);
            if (months < MERCENARIOS_MIN_MONTHS || months > MERCENARIOS_MAX_MONTHS) {
                return { ok: false, message: `La duración del contrato debe ser entre ${MERCENARIOS_MIN_MONTHS} y ${MERCENARIOS_MAX_MONTHS} meses.` };
            }
        }

        return { ok: true };
    }

    // ── Endpoints ─────────────────────────────────────────────

    /**
     * POST /api/relations/propose
     * Body: { to_player_id, type_code, terms_rate?, terms_fixed_pay?, terms_duration_months?, hostage_character_id? }
     */
    async propose(req, res) {
        const from_player_id = req.user.player_id;
        const { to_player_id, type_code, terms_rate, terms_fixed_pay, terms_duration_months, hostage_character_id } = req.body;

        if (!to_player_id || !type_code) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros: to_player_id y type_code.' });
        }
        if (to_player_id === from_player_id) {
            return res.status(400).json({ success: false, message: 'No puedes proponer una relación contigo mismo.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const type = await RelationModel.getType(client, type_code);
            if (!type) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Tipo de relación desconocido: ${type_code}` });
            }

            // Tributo: los términos los fija el receptor (to), no el proponente (from)
            // Si lo propone el pagador, se permite; el receptor los puede revisar al aceptar
            const terms = { terms_rate, terms_fixed_pay, terms_duration_months };
            const validation = await this._validateNewRelation(client, from_player_id, to_player_id, type, terms);
            if (!validation.ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: validation.message });
            }

            const relation = await RelationModel.create(client, {
                type_id: type.id,
                from_player_id,
                to_player_id,
                terms_rate:             type.code === 'tributo'      ? parseFloat(terms_rate)           : null,
                terms_fixed_pay:        type.code === 'mercenariado' ? parseInt(terms_fixed_pay)         : null,
                terms_duration_months:  ['tributo','mercenariado'].includes(type.code) ? parseInt(terms_duration_months) : null,
                hostage_character_id:   type.code === 'rehenes' ? hostage_character_id : null,
            });

            await RelationModel.logEvent(client, {
                relation_id:     relation.relation_id,
                event_type:      'proposed',
                actor_player_id: from_player_id,
            });

            // Notificación al destinatario
            const fromName = (await client.query('SELECT display_name FROM players WHERE player_id = $1', [from_player_id])).rows[0]?.display_name ?? from_player_id;
            await NotificationService.createSystemNotification(
                to_player_id,
                'Nuevo Tratado',
                `⚖️ **${fromName}** te propone un tratado: **${type.name}**.\n\nRevisa tus relaciones activas para aceptar o ignorar.`,
                null
            );

            await client.query('COMMIT');
            Logger.action(`Player ${from_player_id} propone "${type.code}" a player ${to_player_id}`, { relation_id: relation.relation_id });
            return res.json({ success: true, relation_id: relation.relation_id, type_name: type.name });

        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: '/relations/propose', userId: from_player_id });
            return res.status(500).json({ success: false, message: 'Error al proponer la relación.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/relations/:id/accept
     * Solo el destinatario (to_player_id) puede aceptar.
     */
    async accept(req, res) {
        const player_id   = req.user.player_id;
        const relation_id = parseInt(req.params.id);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const rel = await RelationModel.getById(client, relation_id);
            if (!rel) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Relación no encontrada.' });
            }
            if (rel.to_player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Solo el destinatario puede aceptar esta relación.' });
            }
            if (rel.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `La relación ya está en estado "${rel.status}".` });
            }

            // Re-validar (las condiciones pueden haber cambiado mientras estaba pendiente)
            const type = await RelationModel.getType(client, rel.code);
            const recheck = await this._validateNewRelation(client, rel.from_player_id, rel.to_player_id, type, {
                terms_rate:            rel.terms_rate,
                terms_fixed_pay:       rel.terms_fixed_pay,
                terms_duration_months: rel.terms_duration_months,
            });
            if (!recheck.ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: recheck.message });
            }

            // Obtener turno actual para calcular expires_at_turn
            const { rows: ws } = await client.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn  = ws[0]?.current_turn ?? 0;

            const activated = await RelationModel.activate(client, relation_id, currentTurn, TURNS_PER_MONTH);

            await RelationModel.logEvent(client, {
                relation_id,
                event_type:      'accepted',
                actor_player_id: player_id,
            });

            // Notificar al proponente
            await NotificationService.createSystemNotification(
                rel.from_player_id,
                'Tratado Aceptado',
                `✅ **${rel.to_display_name}** ha aceptado tu propuesta de **${rel.type_name}**.`,
                null
            );

            await client.query('COMMIT');
            Logger.action(`Player ${player_id} acepta relación ${relation_id} (${rel.code})`, { relation_id });
            return res.json({ success: true, relation: activated });

        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: '/relations/accept', userId: player_id, relation_id });
            return res.status(500).json({ success: false, message: 'Error al aceptar la relación.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/relations/:id/break
     * Body: { reason? }
     * Cualquiera de las partes puede romperla (excepto devotio, que es irrompible).
     */
    async breakRelation(req, res) {
        const player_id   = req.user.player_id;
        const relation_id = parseInt(req.params.id);
        const reason      = req.body?.reason ?? 'broken';

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const rel = await RelationModel.getById(client, relation_id);
            if (!rel) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Relación no encontrada.' });
            }
            if (rel.status !== 'active' && rel.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'La relación ya ha terminado.' });
            }

            const isPayer    = rel.from_player_id === player_id;
            const isReceiver = rel.to_player_id   === player_id;
            if (!isPayer && !isReceiver) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres parte de esta relación.' });
            }

            // Devotio: irrompible por cualquiera
            if (!rel.breakable_by_payer && !rel.breakable_by_receiver) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Esta relación no puede romperse unilateralmente. Solo termina por muerte del patrón en combate.' });
            }
            if (isPayer && !rel.breakable_by_payer) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No tienes permiso para romper esta relación.' });
            }
            if (isReceiver && !rel.breakable_by_receiver) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'El receptor no puede romper esta relación unilateralmente.' });
            }

            const endReason = isPayer ? 'broken_payer' : 'broken_receiver';
            await RelationModel.end(client, relation_id, endReason);
            await RelationModel.logEvent(client, {
                relation_id,
                event_type:      'broken',
                actor_player_id: player_id,
                details:         { reason },
            });

            // Penalización de reputación al que rompe
            await client.query(
                `UPDATE players
                 SET reputation = GREATEST(-100, reputation + $1)
                 WHERE player_id = $2`,
                [REPUTATION_BREAK_PENALTY, player_id]
            );

            // Notificar a la otra parte
            const otherPlayerId = isPayer ? rel.to_player_id : rel.from_player_id;
            const breakerName   = isPayer ? rel.from_display_name : rel.to_display_name;
            await NotificationService.createSystemNotification(
                otherPlayerId,
                'Tratado Roto',
                `⚠️ **${breakerName}** ha roto el tratado de **${rel.type_name}** unilateralmente.`,
                null
            );

            await client.query('COMMIT');
            Logger.action(`Player ${player_id} rompe relación ${relation_id} (${rel.code}) — ${endReason}`, { relation_id });
            return res.json({ success: true, end_reason: endReason });

        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: '/relations/break', userId: player_id, relation_id });
            return res.status(500).json({ success: false, message: 'Error al romper la relación.' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/relations/types
     * Catálogo público de todos los tipos de relación.
     */
    async getTypes(req, res) {
        const client = await pool.connect();
        try {
            const types = await RelationModel.getAllTypes(client);
            return res.json({ success: true, types });
        } catch (err) {
            Logger.error(err, { endpoint: '/relations/types' });
            return res.status(500).json({ success: false, message: 'Error al obtener tipos de relación.' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/relations/my
     * Relaciones activas del jugador autenticado, con juramentos resueltos.
     */
    async getMy(req, res) {
        const player_id = req.user.player_id;
        const client = await pool.connect();
        try {
            const rows = await RelationModel.getActiveByPlayer(client, player_id);
            const relations = rows.map(r => this._buildRelationView(r, player_id));
            return res.json({ success: true, relations });
        } catch (err) {
            Logger.error(err, { endpoint: '/relations/my', userId: player_id });
            return res.status(500).json({ success: false, message: 'Error al obtener tus relaciones.' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/relations/:playerId
     * Relaciones activas de cualquier jugador (público).
     */
    async getByPlayer(req, res) {
        const target_id = parseInt(req.params.playerId);
        const viewer_id = req.user?.player_id ?? null; // puede ser público (sin auth)
        const client = await pool.connect();
        try {
            const rows = await RelationModel.getActiveByPlayer(client, target_id);
            // En vista pública usamos el target como "viewer" para resolver juramento
            const relations = rows.map(r => this._buildRelationView(r, target_id));
            return res.json({ success: true, relations });
        } catch (err) {
            Logger.error(err, { endpoint: '/relations/:playerId', playerId: target_id });
            return res.status(500).json({ success: false, message: 'Error al obtener relaciones del jugador.' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/relations/pending
     * Propuestas pendientes recibidas por el jugador autenticado.
     */
    async getPending(req, res) {
        const player_id = req.user.player_id;
        const client = await pool.connect();
        try {
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
                WHERE pr.status = 'pending'
                  AND pr.to_player_id = $1
                ORDER BY pr.proposed_at DESC
            `, [player_id]);
            const pending = rows.map(r => this._buildRelationView(r, player_id));
            return res.json({ success: true, pending });
        } catch (err) {
            Logger.error(err, { endpoint: '/relations/pending', userId: player_id });
            return res.status(500).json({ success: false, message: 'Error al obtener propuestas pendientes.' });
        } finally {
            client.release();
        }
    }

    // ── Hook: muerte del personaje principal ──────────────────

    /**
     * Llamar cuando el main_character de un jugador muere en combate.
     * Dispara la cascade de devotio: los seguidores pierden su propio main_character
     * y el 10% de sus tropas.
     *
     * @param {object} client         - pg client con transacción activa
     * @param {number} patronPlayerId - jugador cuyo main_character murió
     * @param {number} currentTurn
     */
    async onMainCharacterDeath(client, patronPlayerId, currentTurn) {
        const followers = await RelationModel.getActiveDevotioFollowers(client, patronPlayerId);
        if (followers.length === 0) return;

        const { DEVOTIO_TROOP_LOSS_FRACTION } = require('../config/RelationConfig.js');

        for (const { relation_id, follower_id } of followers) {
            // 1. Matar al main_character del seguidor
            await client.query(`
                UPDATE characters SET health = 0
                WHERE player_id = $1 AND is_main_character = TRUE AND health > 0
            `, [follower_id]);

            // 2. Quitar DEVOTIO_TROOP_LOSS_FRACTION de sus tropas
            await client.query(`
                UPDATE troops t
                SET quantity = GREATEST(0, FLOOR(t.quantity * $1))
                FROM armies a
                WHERE t.army_id = a.army_id AND a.player_id = $2
            `, [1 - DEVOTIO_TROOP_LOSS_FRACTION, follower_id]);

            // Limpiar tropas a 0
            await client.query(`
                DELETE FROM troops t
                USING armies a
                WHERE t.army_id = a.army_id AND a.player_id = $1 AND t.quantity <= 0
            `, [follower_id]);

            // 3. Finalizar la relación
            await RelationModel.end(client, relation_id, 'patron_death');
            await RelationModel.logEvent(client, {
                relation_id,
                event_type:  'patron_death',
                turn_number: currentTurn,
            });

            // 4. Notificar al seguidor
            await NotificationService.createSystemNotification(
                follower_id,
                'El Patrón ha caído',
                `💀 Tu patrón ha muerto en combate. Según el juramento de Devotio, tu personaje principal ha perecido y tus tropas han sufrido bajas.`,
                currentTurn
            );
        }

        Logger.engine(`[TURN ${currentTurn}] Devotio cascade: patrón ${patronPlayerId} murió → ${followers.length} seguidor(es) afectados`);
    }
}

module.exports = new RelationService();
