/**
 * ScoutingService.js
 * Gestiona las misiones de espionaje entre ejércitos.
 *
 * PROBABILIDADES (p = cantidad de Exploradores):
 *   Éxito total   : Math.random() < 0.20 + p×0.02
 *   Éxito parcial : Math.random() < 0.50 + p×0.05  (si falla el total)
 *   Detección     : Math.random() < max(0.05, 0.30 - p×0.01)
 *
 * COSTE: EXPLORE_COST de gold_provisions del ejército atacante.
 */

const pool    = require('../../db.js');
const h3      = require('h3-js');
const { Logger }          = require('../utils/logger');
const NotificationService = require('./NotificationService.js');
const GAME_CONFIG         = require('../config/constants.js');

class ScoutingService {

    async scoutArmy(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { attacker_army_id, target_army_id } = req.body;

            // ── Validación de parámetros ──────────────────────────────────
            if (!attacker_army_id || !target_army_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Faltan parámetros: attacker_army_id, target_army_id'
                });
            }
            if (Number(attacker_army_id) === Number(target_army_id)) {
                return res.status(400).json({
                    success: false,
                    error: 'No puedes espiar tu propio ejército'
                });
            }

            await client.query('BEGIN');

            // ── 1. Verificar propiedad del ejército atacante ──────────────
            const ownResult = await client.query(
                `SELECT army_id, name, h3_index, gold_provisions
                 FROM armies WHERE army_id = $1 AND player_id = $2`,
                [attacker_army_id, player_id]
            );
            if (ownResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Ejército atacante no encontrado o no te pertenece'
                });
            }
            const ownArmy = ownResult.rows[0];

            // ── 2. Verificar que el objetivo existe y es enemigo ──────────
            const targetResult = await client.query(
                `SELECT a.army_id, a.name, a.h3_index, a.player_id, p.display_name AS player_name
                 FROM armies a
                 JOIN players p ON p.player_id = a.player_id
                 WHERE a.army_id = $1 AND a.player_id != $2`,
                [target_army_id, player_id]
            );
            if (targetResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Ejército objetivo no encontrado'
                });
            }
            const targetArmy = targetResult.rows[0];

            // ── 3. Verificar proximidad (mismo hex o adyacente) ───────────
            let distance;
            try { distance = h3.gridDistance(ownArmy.h3_index, targetArmy.h3_index); }
            catch  { distance = Infinity; }

            if (distance > 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'El ejército debe estar en el mismo hexágono o adyacente al objetivo'
                });
            }

            // ── 4. Validar unidades Explorador ────────────────────────────
            const EXPLORER_NAME = GAME_CONFIG.MILITARY.UNIT_TYPE_EXPLORER;
            const explorerResult = await client.query(
                `SELECT COALESCE(SUM(t.quantity), 0)::int AS explorer_count
                 FROM troops t
                 JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                 WHERE t.army_id = $1 AND ut.name = $2`,
                [attacker_army_id, EXPLORER_NAME]
            );
            const explorerCount = explorerResult.rows[0]?.explorer_count ?? 0;
            if (explorerCount < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: `El ejército no tiene unidades de tipo "${EXPLORER_NAME}"`
                });
            }

            // ── 5. Validar oro del ejército (gold_provisions) ─────────────
            const EXPLORE_COST = GAME_CONFIG.MILITARY.EXPLORE_COST;
            if (parseFloat(ownArmy.gold_provisions) < EXPLORE_COST) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: `Oro insuficiente para la misión (necesitas ${EXPLORE_COST} 💰 en provisiones del ejército, tienes ${Math.floor(ownArmy.gold_provisions)})`
                });
            }

            // ── 6. Restar oro del ejército ────────────────────────────────
            await client.query(
                'UPDATE armies SET gold_provisions = gold_provisions - $1 WHERE army_id = $2',
                [EXPLORE_COST, attacker_army_id]
            );

            // ── 7. Turno actual ───────────────────────────────────────────
            const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // ── 8. Calcular probabilidades ────────────────────────────────
            const points = explorerCount;
            const totalChance    = 0.20 + (points * 0.02);
            const partialChance  = 0.50 + (points * 0.05);
            const detectionChance = Math.max(0.05, 0.30 - (points * 0.01));

            const rollOutcome  = Math.random();
            const rollPartial  = Math.random();
            const rollDetected = Math.random();

            let result;
            if (rollOutcome < totalChance) {
                result = 'total';
            } else if (rollPartial < partialChance) {
                result = 'partial';
            } else {
                result = 'fail';
            }
            const detected = rollDetected < detectionChance;

            // ── 9. Obtener datos del objetivo según resultado ─────────────
            let unitData = [];
            if (result === 'total') {
                const rows = await client.query(
                    `SELECT ut.name AS unit_name, t.quantity
                     FROM troops t
                     JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                     WHERE t.army_id = $1 AND t.quantity > 0
                     ORDER BY ut.name`,
                    [target_army_id]
                );
                unitData = rows.rows;
            } else if (result === 'partial') {
                const rows = await client.query(
                    `SELECT DISTINCT ut.name AS unit_name
                     FROM troops t
                     JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                     WHERE t.army_id = $1 AND t.quantity > 0
                     ORDER BY ut.name`,
                    [target_army_id]
                );
                unitData = rows.rows;
            }

            // ── 10. Notificaciones ────────────────────────────────────────
            let notifContent;
            if (result === 'fail') {
                notifContent =
                    `🔭 MISIÓN FALLIDA (Turno ${turn})\n` +
                    `"${targetArmy.name}" no pudo ser infiltrado.\n` +
                    `Tus exploradores regresaron sin información.`;
            } else if (result === 'partial') {
                const names = unitData.map(u => u.unit_name).join(', ') || '(vacío)';
                notifContent =
                    `🔭 ESPIONAJE PARCIAL (Turno ${turn})\n` +
                    `"${targetArmy.name}" · ${targetArmy.player_name}\n` +
                    `Tipos detectados: ${names}\n` +
                    `Cantidades: clasificadas`;
            } else {
                const lines = unitData.map(u => `  ${u.unit_name}: ${u.quantity}`).join('\n') || '  (vacío)';
                notifContent =
                    `🔭 ESPIONAJE EXITOSO (Turno ${turn})\n` +
                    `"${targetArmy.name}" · ${targetArmy.player_name}\n` +
                    `Composición completa:\n${lines}`;
            }

            await NotificationService.createSystemNotification(player_id, 'Militar', notifContent, turn);

            if (detected) {
                const scoutName = req.user.display_name || req.user.username;
                await NotificationService.createSystemNotification(
                    targetArmy.player_id,
                    'Militar',
                    `👁️ EXPLORADORES DETECTADOS (Turno ${turn})\n` +
                    `Se han avistado exploradores de ${scoutName}\n` +
                    `merodeando tus tropas en ${targetArmy.h3_index}.`,
                    turn
                );
            }

            await client.query('COMMIT');

            Logger.action(
                `Espionaje: jugador ${player_id} → ejército ${target_army_id} → ${result}${detected ? ' (detectado)' : ''}`,
                player_id,
                { attacker_army_id, target_army_id, result, detected, explorerCount }
            );

            return res.json({
                success: true,
                result,
                detected,
                data: unitData,
                target_army_name: targetArmy.name,
                target_player_name: targetArmy.player_name,
                explorer_count: explorerCount
            });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, {
                context: 'ScoutingService.scoutArmy',
                player_id: req.user?.player_id,
                body: req.body
            });
            return res.status(500).json({
                success: false,
                error: 'Error interno al procesar la misión de espionaje'
            });
        } finally {
            client.release();
        }
    }
    async scoutColocated(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { army_id, target_army_id } = req.body;

            if (!army_id || !target_army_id) {
                return res.status(400).json({ success: false, error: 'Faltan parámetros: army_id, target_army_id' });
            }

            await client.query('BEGIN');

            // ── 1. Turno actual ───────────────────────────────────────────
            const worldResult = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const turn = worldResult.rows[0]?.current_turn ?? 0;

            // ── 2. Verificar propiedad y límite de un reconocimiento/turno ─
            const ownResult = await client.query(
                `SELECT army_id, h3_index, last_colocated_scout_turn
                 FROM armies WHERE army_id = $1 AND player_id = $2`,
                [army_id, player_id]
            );
            if (ownResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Ejército no encontrado o no te pertenece' });
            }
            const ownArmy = ownResult.rows[0];

            if (ownArmy.last_colocated_scout_turn === turn) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Este ejército ya ha realizado un reconocimiento este turno' });
            }

            // ── 3. Verificar que el objetivo es enemigo ───────────────────
            const targetResult = await client.query(
                `SELECT a.army_id, a.name, a.h3_index, a.player_id, p.display_name AS player_name
                 FROM armies a
                 LEFT JOIN players p ON p.player_id = a.player_id
                 WHERE a.army_id = $1 AND (a.player_id != $2 OR a.player_id IS NULL)`,
                [target_army_id, player_id]
            );
            if (targetResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Ejército objetivo no encontrado' });
            }
            const targetArmy = targetResult.rows[0];

            if (targetArmy.h3_index !== ownArmy.h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Los ejércitos deben estar en el mismo hexágono' });
            }

            // ── 4. Conteo de efectivos ────────────────────────────────────
            const [ownTroopsRes, enemyTroopsRes] = await Promise.all([
                client.query(`SELECT COALESCE(SUM(quantity), 0)::int AS total FROM troops WHERE army_id = $1`, [army_id]),
                client.query(`SELECT COALESCE(SUM(quantity), 0)::int AS total FROM troops WHERE army_id = $1`, [target_army_id])
            ]);
            const ownTroops   = ownTroopsRes.rows[0].total;
            const enemyTroops = enemyTroopsRes.rows[0].total;

            // ── 5. Marcar turno (consumir acción antes del roll) ──────────
            await client.query(
                `UPDATE armies SET last_colocated_scout_turn = $1 WHERE army_id = $2`,
                [turn, army_id]
            );

            // ── 6. Calcular probabilidad ──────────────────────────────────
            const probability = enemyTroops > 0 ? Math.min(1.0, ownTroops / enemyTroops) : 1.0;

            if (probability < 0.10) {
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    scouted: false,
                    reason: 'too_few_troops',
                    message: 'Tus tropas son demasiado escasas para aproximarse al enemigo sin ser detectados.'
                });
            }

            if (Math.random() >= probability) {
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    scouted: false,
                    reason: 'failure',
                    message: 'Tus exploradores no han conseguido aproximarse al ejército enemigo.'
                });
            }

            // ── 7. Nivel de tamaño y mensaje ──────────────────────────────
            const TIER_MESSAGES = {
                small: [
                    'Un destacamento reducido, apenas unos pocos cientos de hombres. No representan una amenaza seria.',
                    'Fuerzas escasas, quizás una vanguardia o una guarnición de apoyo. Podrían superarse en campo abierto.'
                ],
                medium: [
                    'Una fuerza respetable. Miles de soldados organizados, capaces de librar una batalla considerable.',
                    'Un contingente de combate sólido. No deben subestimarse, aunque tampoco son invencibles.'
                ],
                large: [
                    'Un ejército imponente bajo sus estandartes. Decenas de miles de hombres listos para la batalla.',
                    'Una hueste formidable. Enfrentarles directamente sería una temeridad sin refuerzos sustanciales.'
                ],
                enormous: [
                    '¡Una marea humana incontenible! Sus filas se extienden hasta el horizonte. Atacar sería una locura.',
                    'Un ejército colosal, el tipo de fuerza que reescribe el destino de los reinos. Solo los más necios se atreverían a plantarles cara.'
                ]
            };

            let tier;
            if      (enemyTroops < 1000)    tier = 'small';
            else if (enemyTroops < 5000)    tier = 'medium';
            else if (enemyTroops <= 50000)  tier = 'large';
            else                            tier = 'enormous';

            const messages = TIER_MESSAGES[tier];
            const flavor   = messages[Math.floor(Math.random() * messages.length)];

            const tierLabel = { small: 'Pequeño', medium: 'Mediano', large: 'Gran ejército', enormous: 'Enorme' }[tier];
            await NotificationService.createSystemNotification(
                player_id,
                'Militar',
                `🕵️ RECONOCIMIENTO (Turno ${turn})\n` +
                `"${targetArmy.name}" · ${targetArmy.player_name ?? 'Rebeldes'}\n` +
                `Tamaño estimado: ${tierLabel}\n` +
                `"${flavor}"`,
                turn
            );

            await client.query('COMMIT');

            Logger.action(
                `Reconocimiento colocado: jugador ${player_id} → ejército ${target_army_id} → ${tier}`,
                player_id,
                { army_id, target_army_id, ownTroops, enemyTroops, tier }
            );

            return res.json({
                success: true,
                scouted: true,
                tier,
                enemy_count: enemyTroops,
                flavor,
                target_army_name: targetArmy.name,
                target_player_name: targetArmy.player_name ?? 'Rebeldes'
            });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, {
                context: 'ScoutingService.scoutColocated',
                player_id: req.user?.player_id,
                body: req.body
            });
            return res.status(500).json({ success: false, error: 'Error interno al procesar el reconocimiento' });
        } finally {
            client.release();
        }
    }
}

module.exports = new ScoutingService();
