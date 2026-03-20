'use strict';

// ── Mensajes épicos de diplomacia ────────────────────────────────────────────
const _DIP_MSG = {
    propose: {
        devotio:      ({ from }) => `El guerrero ${from} se arrodilla ante vuestra presencia y os ofrece el sagrado juramento de Devotio. Su espada, su vida y su honor serían vuestros. Medita bien la respuesta: un devoto es una responsabilidad ante los dioses.`,
        clientela:    ({ from }) => `El clan ${from} llega humildemente a vuestras puertas solicitando protección. A cambio, cedería el 10% de sus ingresos como señal de vasallaje. Los dioses observan si honraréis este vínculo.`,
        hospitium:    ({ from }) => `El clan ${from} os tiende la mano en señal de hospitalidad y amistad entre pueblos. El Hospitium no exige tributo ni obediencia — solo respeto mutuo y libre paso entre nuestros territorios.`,
        rehenes:      ({ from }) => `El clan ${from} propone entregar rehenes en garantía de su lealtad. Aceptar supone asumir la custodia de sus hijos. Rechazar puede interpretarse como desconfianza abierta.`,
        mercenariado: ({ from, months, pay }) => `El clan ${from} os ofrece sus lanzas a cambio de oro. El contrato propuesto dura ${months} meses a razón de ${Number(pay || 0).toLocaleString('es-ES')} de oro mensual. Las guerras se ganan con acero, pero también con plata.`,
        alianza:      ({ from }) => `El clan ${from} propone sellar una alianza entre vuestros pueblos. Unidos, podríais hacer temblar a vuestros enemigos comunes. La propuesta merece deliberación.`,
        tributo:      ({ from, rate, months }) => `El jefe del clan ${from} exige un tributo del ${rate}% de vuestros ingresos durante ${months} meses. Debéis meditar detenidamente vuestra respuesta, pues una negativa puede ser entendida como una declaración de guerra.`,
        guerra:       ({ from }) => `El clan ${from} os declara la guerra formalmente. Las fronteras ya no son seguras. Preparad vuestras defensas y encomendaos a vuestros dioses.`,
        _default:     ({ from, typeName }) => `El clan ${from} os propone un tratado de ${typeName}. Revisad la propuesta y responded con sabiduría.`,
    },
    propose_confirm: {
        _default: ({ to, typeName }) => `Vuestra propuesta de ${typeName} ha sido enviada al clan ${to}. Aguardad su respuesta con paciencia... o con la espada lista.`,
    },
    accept: {
        devotio:      ({ to }) => `El guerrero ${to} ha jurado Devotio ante vuestros dioses y vuestro estandarte. A partir de este momento, su vida es vuestra.`,
        clientela:    ({ to }) => `El clan ${to} acepta vuestra protección y entra bajo vuestro patrocinio. El 10% de sus ingresos fluirá hacia vuestras arcas cada mes.`,
        hospitium:    ({ to }) => `El clan ${to} acoge vuestra mano de amistad. El Hospitium entre vuestros pueblos queda sellado con honor.`,
        rehenes:      ({ to }) => `El clan ${to} acepta entregar rehenes. Su lealtad queda ahora garantizada con sangre.`,
        mercenariado: ({ to, months }) => `El clan ${to} acepta el contrato de mercenariado. Sus lanzas están a vuestro servicio durante ${months} meses.`,
        alianza:      ({ to }) => `El clan ${to} acepta la alianza. Vuestras tropas combatirán codo a codo contra cualquier enemigo común. Que tiemblen vuestros rivales.`,
        tributo:      ({ to, rate, months }) => `El clan ${to} acepta rendir tributo. Durante los próximos ${months} meses, el ${rate}% de sus ingresos fluirá hacia vuestras arcas.`,
        guerra:       ({ to }) => `El clan ${to} acepta el estado de guerra. Que los dioses decidan el destino de ambos pueblos. Que hablen las armas.`,
        _default:     ({ to, typeName }) => `El clan ${to} ha aceptado vuestra propuesta de ${typeName}.`,
    },
    accept_confirm: {
        _default: ({ from, typeName }) => `Habéis sellado el tratado de ${typeName} con el clan ${from}. Que los dioses sean testigos de vuestro juramento.`,
    },
    reject: {
        devotio:      ({ to }) => `El clan ${to} ha rechazado vuestro juramento de Devotio. Una herida al honor que no se olvida fácilmente.`,
        clientela:    ({ to }) => `El clan ${to} rechaza ofreceros su protección. Debéis buscar otros medios para garantizar vuestra seguridad.`,
        hospitium:    ({ to }) => `El clan ${to} ha declinado el Hospitium. Su posición queda clara.`,
        rehenes:      ({ to }) => `El clan ${to} se niega a aceptar rehenes. Ignorad la afrenta o responded con fuerza; la elección es vuestra.`,
        mercenariado: ({ to }) => `El clan ${to} ha rechazado el contrato. Sus lanzas seguirán al mejor postor.`,
        alianza:      ({ to }) => `El clan ${to} rechaza vuestra propuesta de alianza. Vuestra posición estratégica queda debilitada.`,
        tributo:      ({ to }) => `El clan ${to} se niega a pagar el tributo exigido. Esta afrenta pública no puede quedar sin respuesta.`,
        guerra:       ({ to }) => `El clan ${to} ignora vuestra declaración de guerra. Decidid si presionaréis o esperáis un momento más propicio.`,
        _default:     ({ to, typeName }) => `El clan ${to} ha rechazado vuestra propuesta de ${typeName}.`,
    },
    reject_confirm: {
        _default: ({ from, typeName }) => `Habéis rechazado la propuesta de ${typeName} del clan ${from}. Vuestros mensajeros llevan ya vuestra respuesta.`,
    },
    break: {
        devotio:      ({ breaker }) => `El clan ${breaker} ha profanado el sagrado juramento de Devotio. Los dioses no olvidarán este sacrilegio. Nuestros lazos han quedado rotos para siempre.`,
        clientela:    ({ breaker }) => `El clan ${breaker} ha decidido poner fin al vínculo de clientela. Solo los dioses saben qué estará tramando.`,
        hospitium:    ({ breaker }) => `El clan ${breaker} ha roto el Hospitium entre nuestros pueblos. La hospitalidad que nos ofrecimos queda mancillada.`,
        rehenes:      ({ breaker }) => `El clan ${breaker} ha puesto fin al acuerdo de rehenes unilateralmente. Las consecuencias de esta decisión están por ver.`,
        mercenariado: ({ breaker }) => `El clan ${breaker} ha rescindido el contrato de mercenariado. Sus lanzas ya no están a nuestro servicio.`,
        alianza:      ({ breaker }) => `El clan ${breaker} ha roto la alianza. Nuestras espadas ya no apuntan en la misma dirección. Revisad vuestras defensas.`,
        tributo:      ({ breaker }) => `El clan ${breaker} ha repudiado el tributo prometido. Esta traición justifica las más severas represalias.`,
        guerra:       ({ breaker }) => `El clan ${breaker} ha puesto fin al estado de guerra. La paz, aunque frágil, regresa a nuestras fronteras.`,
        _default:     ({ breaker, typeName }) => `El clan ${breaker} ha roto el tratado de ${typeName} unilateralmente.`,
    },
    break_confirm: {
        _default: ({ other, typeName }) => `Habéis puesto fin al tratado de ${typeName} con el clan ${other}. Vuestra reputación ha sufrido por ello.`,
    },
};

function _dipMsg(action, typeCode, params) {
    const group = _DIP_MSG[action];
    if (!group) return '';
    const fn = group[typeCode] ?? group._default;
    return fn ? fn(params) : '';
}

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

            // Notificaciones a ambas partes
            const { rows: nameRows } = await client.query(
                'SELECT player_id, display_name FROM players WHERE player_id = ANY($1)',
                [[from_player_id, to_player_id]]
            );
            const nameMap  = Object.fromEntries(nameRows.map(r => [r.player_id, r.display_name]));
            const fromName = nameMap[from_player_id] ?? String(from_player_id);
            const toName   = nameMap[to_player_id]   ?? String(to_player_id);
            const rateVal  = relation.terms_rate   ? Math.round(relation.terms_rate * 100) : null;
            const msgParams = { from: fromName, to: toName, typeName: type.name, rate: rateVal, months: relation.terms_duration_months, pay: relation.terms_fixed_pay };

            await Promise.all([
                NotificationService.createSystemNotification(to_player_id,   'General', _dipMsg('propose',         type.code, msgParams), null),
                NotificationService.createSystemNotification(from_player_id, 'General', _dipMsg('propose_confirm', type.code, msgParams), null),
            ]);

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

            // Notificaciones a ambas partes
            const rateVal2   = rel.terms_rate ? Math.round(rel.terms_rate * 100) : null;
            const msgParams2 = { from: rel.from_display_name, to: rel.to_display_name, typeName: rel.type_name, rate: rateVal2, months: rel.terms_duration_months };
            await Promise.all([
                NotificationService.createSystemNotification(rel.from_player_id, 'General', _dipMsg('accept',         rel.code, msgParams2), null),
                NotificationService.createSystemNotification(player_id,          'General', _dipMsg('accept_confirm', rel.code, msgParams2), null),
            ]);

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

            // Notificaciones a ambas partes — diferenciar rechazo (pending) de ruptura (active)
            const otherPlayerId = isPayer ? rel.to_player_id   : rel.from_player_id;
            const otherName     = isPayer ? rel.to_display_name : rel.from_display_name;
            const breakerName   = isPayer ? rel.from_display_name : rel.to_display_name;
            const isRejection   = rel.status === 'pending';
            const action        = isRejection ? 'reject' : 'break';
            const confirmAction = isRejection ? 'reject_confirm' : 'break_confirm';
            const msgParams3    = { from: rel.from_display_name, to: rel.to_display_name, breaker: breakerName, other: otherName, typeName: rel.type_name };

            await Promise.all([
                NotificationService.createSystemNotification(otherPlayerId, 'General', _dipMsg(action,        rel.code, msgParams3), null),
                NotificationService.createSystemNotification(player_id,     'General', _dipMsg(confirmAction, rel.code, msgParams3), null),
            ]);

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
