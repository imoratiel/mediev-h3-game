const pool = require('../../db.js');
const MarketModel = require('../models/MarketModel.js');
const { Logger } = require('../utils/logger');

/**
 * Calcula precio de compra y venta a partir de los parámetros del recurso.
 *   mid  = base_price × (base_reserve / current_reserve)   [clampado entre min y max]
 *   buy  = mid × (1 + spread)
 *   sell = mid × (1 - spread)
 */
function calcPrices(resource) {
    const reserve = resource.current_reserve > 0 ? resource.current_reserve : 1;
    const mid = Math.min(
        parseFloat(resource.max_price),
        Math.max(
            parseFloat(resource.min_price),
            parseFloat(resource.base_price) * (resource.base_reserve / reserve)
        )
    );
    const spread = parseFloat(resource.spread);
    return {
        mid:       Math.round(mid * 100) / 100,
        buy_price: Math.round(mid * (1 + spread) * 100) / 100,
        sell_price: Math.round(mid * (1 - spread) * 100) / 100,
    };
}

class MarketService {

    // ── GET /api/market/my-locations ─────────────────────────────────────────
    // Devuelve la capital del jugador + todos sus feudos con Mercado activo (conservation > 20).
    // Incluye trabajadores presentes en cada ubicación.

    async GetMyLocations(req, res) {
        const playerId = req.user.player_id;
        try {
            const result = await pool.query(`
                SELECT
                    m.h3_index,
                    COALESCE(s.name, td.custom_name, m.h3_index) AS location_name,
                    (m.h3_index = p.capital_h3)                  AS is_capital,
                    b.name                                        AS building_name,
                    fb.conservation,
                    fb.is_under_construction
                FROM h3_map m
                JOIN players p ON p.player_id = m.player_id
                JOIN territory_details td ON td.h3_index = m.h3_index
                LEFT JOIN settlements s ON s.h3_index = m.h3_index
                LEFT JOIN fief_buildings fb ON fb.h3_index = m.h3_index
                LEFT JOIN buildings b ON b.id = fb.building_id
                LEFT JOIN building_types bt ON bt.building_type_id = b.type_id
                WHERE m.player_id = $1
                  AND (
                    m.h3_index = p.capital_h3
                    OR (
                      bt.name = 'economic'
                      AND fb.is_under_construction = FALSE
                    )
                  )
                ORDER BY (m.h3_index = p.capital_h3) DESC, location_name
            `, [playerId]);

            // Para cada ubicación, incluir sus trabajadores presentes
            const locations = await Promise.all(result.rows.map(async loc => {
                const workers = await pool.query(`
                    SELECT w.id, w.h3_index, w.destination_h3, w.type_id, w.speed,
                           wt.name AS type_name,
                           tt.name AS terrain_type,
                           COALESCE(s2.name, tt.name, w.h3_index) AS location_name,
                           COALESCE(s_dst.name, tt_dst.name, w.destination_h3) AS destination_name
                    FROM workers w
                    JOIN workers_types wt  ON w.type_id = wt.id
                    LEFT JOIN h3_map mw    ON mw.h3_index = w.h3_index
                    LEFT JOIN terrain_types tt ON tt.terrain_type_id = mw.terrain_type_id
                    LEFT JOIN settlements s2   ON s2.h3_index = w.h3_index
                    LEFT JOIN h3_map m_dst      ON m_dst.h3_index = w.destination_h3
                    LEFT JOIN terrain_types tt_dst ON tt_dst.terrain_type_id = m_dst.terrain_type_id
                    LEFT JOIN settlements s_dst ON s_dst.h3_index = w.destination_h3
                    WHERE w.player_id = $1 AND w.h3_index = $2
                `, [playerId, loc.h3_index]);
                return { ...loc, workers: workers.rows };
            }));

            res.json({ success: true, locations });
        } catch (error) {
            Logger.error(error, { endpoint: 'GET /api/market/my-locations', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al obtener ubicaciones de mercado' });
        }
    }

    // ── GET /api/market/prices ────────────────────────────────────────────────

    async GetPrices(req, res) {
        try {
            const pricesResult = await MarketModel.GetPrices();
            const playerId = req.user?.player_id ?? null;

            // Añadir precios de compra/venta calculados
            const resources = pricesResult.rows.map(r => {
                if (r.category === 'commodity') {
                    return { ...r, ...calcPrices(r) };
                }
                return r;
            });

            // Si el usuario está autenticado, incluir sus accesos activos
            let myAccess = [];
            if (playerId) {
                const accessResult = await MarketModel.GetPlayerAccess(playerId);
                myAccess = accessResult.rows;
            }

            res.json({ success: true, resources, my_access: myAccess });
        } catch (error) {
            Logger.error(error, { endpoint: 'GET /api/market/prices', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener precios del mercado' });
        }
    }

    // ── POST /api/market/sell ────────────────────────────────────────────────
    // Body: { h3_index, resource: 'food', quantity: 500 }

    async Sell(req, res) {
        const playerId = req.user.player_id;
        const { h3_index, resource, quantity } = req.body;

        if (!h3_index || !resource || !quantity || quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Parámetros inválidos' });
        }
        const qty = Math.floor(quantity);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar que el feudo es del jugador
            const fiefResult = await client.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (!fiefResult.rows[0] || fiefResult.rows[0].player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees ese feudo' });
            }

            // 2. Obtener reserva con lock
            const rtResult = await client.query('SELECT id FROM market_resource_types WHERE name = $1', [resource]);
            const resourceRow = await MarketModel.GetReserveForUpdate(client, rtResult.rows[0]?.id);
            if (!resourceRow || resourceRow.category !== 'commodity') {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Recurso no válido para venta' });
            }

            // 3. Verificar stock en el feudo
            const stockResult = await client.query(
                'SELECT food_stored FROM territory_details WHERE h3_index = $1 FOR UPDATE',
                [h3_index]
            );
            const foodStored = parseInt(stockResult.rows[0]?.food_stored) || 0;
            if (foodStored < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Stock insuficiente. Tienes ${foodStored} unidades, intentas vender ${qty}`
                });
            }

            // 4. Calcular precio de venta (snapshot actual)
            const { sell_price } = calcPrices(resourceRow);
            const totalGold = Math.floor(sell_price * qty);

            // 5. Deducir comida del feudo
            await client.query(
                'UPDATE territory_details SET food_stored = food_stored - $1 WHERE h3_index = $2',
                [qty, h3_index]
            );

            // 6. Añadir a reserva del mercado
            await MarketModel.AddToReserve(client, resourceRow.id, qty);

            // 7. Acreditar oro al jugador
            await client.query(
                'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                [totalGold, playerId]
            );

            // 8. Registrar transacción
            await MarketModel.LogTransaction(client, {
                player_id: playerId,
                resource_type_id: resourceRow.id,
                transaction_type: 'sell',
                quantity: qty,
                unit_price: sell_price,
                total_gold: totalGold,
                h3_index,
            });

            await client.query('COMMIT');

            Logger.action(
                `Mercado: vendió ${qty} comida de ${h3_index} por ${totalGold} oro (${sell_price}/u)`,
                playerId
            );

            res.json({
                success: true,
                message: `Vendiste ${qty} de comida por ${totalGold} oro`,
                unit_price: sell_price,
                total_gold: totalGold,
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: 'POST /api/market/sell', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al procesar la venta' });
        } finally {
            client.release();
        }
    }

    // ── POST /api/market/buy ─────────────────────────────────────────────────
    // Body commodity:  { resource: 'food', quantity: 200, h3_index: '...' }
    // Body access:     { resource: 'stone' }

    async Buy(req, res) {
        const playerId = req.user.player_id;
        const { resource, quantity, h3_index } = req.body;

        if (!resource) {
            return res.status(400).json({ success: false, message: 'Parámetro resource requerido' });
        }

        const resourceType = await MarketModel.GetResourceByName(resource);
        if (!resourceType) {
            return res.status(404).json({ success: false, message: 'Recurso no encontrado' });
        }

        if (resourceType.category === 'commodity') {
            return this._buyCommodity(req, res, playerId, resourceType, quantity, h3_index);
        } else {
            return this._buyAccess(req, res, playerId, resourceType);
        }
    }

    async _buyCommodity(req, res, playerId, resourceType, quantity, h3_index) {
        if (!quantity || quantity <= 0 || !h3_index) {
            return res.status(400).json({
                success: false,
                message: 'Para comprar comida necesitas quantity y h3_index de destino'
            });
        }
        const qty = Math.floor(quantity);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verificar propiedad del feudo destino
            const fiefResult = await client.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (!fiefResult.rows[0] || fiefResult.rows[0].player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees ese feudo' });
            }

            // Obtener reserva con lock
            const resourceRow = await MarketModel.GetReserveForUpdate(client, resourceType.id);
            if (resourceRow.current_reserve < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Reserva insuficiente en el mercado (${resourceRow.current_reserve} disponibles)`
                });
            }

            // Calcular precio de compra (snapshot)
            const { buy_price } = calcPrices(resourceRow);
            const totalGold = Math.ceil(buy_price * qty);

            // Verificar oro del jugador
            const goldResult = await client.query(
                'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE',
                [playerId]
            );
            const currentGold = parseInt(goldResult.rows[0]?.gold) || 0;
            if (currentGold < totalGold) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Oro insuficiente. Necesitas ${totalGold}, tienes ${currentGold}`
                });
            }

            // Deducir de la reserva
            const ok = await MarketModel.RemoveFromReserve(client, resourceType.id, qty);
            if (!ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Reserva insuficiente (concurrencia)' });
            }

            // Cobrar oro
            await client.query(
                'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                [totalGold, playerId]
            );

            // Añadir comida al feudo
            await client.query(
                'UPDATE territory_details SET food_stored = food_stored + $1 WHERE h3_index = $2',
                [qty, h3_index]
            );

            // Registrar
            await MarketModel.LogTransaction(client, {
                player_id: playerId,
                resource_type_id: resourceType.id,
                transaction_type: 'buy',
                quantity: qty,
                unit_price: buy_price,
                total_gold: totalGold,
                h3_index,
            });

            await client.query('COMMIT');

            Logger.action(
                `Mercado: compró ${qty} comida → ${h3_index} por ${totalGold} oro (${buy_price}/u)`,
                playerId
            );

            res.json({
                success: true,
                message: `Compraste ${qty} de comida por ${totalGold} oro`,
                unit_price: buy_price,
                total_gold: totalGold,
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: 'POST /api/market/buy (commodity)', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al procesar la compra' });
        } finally {
            client.release();
        }
    }

    async _buyAccess(req, res, playerId, resourceType) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const cost = resourceType.access_cost_monthly;

            // Verificar si ya tiene acceso activo
            const existingResult = await client.query(`
                SELECT expires_at FROM player_resource_access
                WHERE player_id = $1 AND resource_type_id = $2
            `, [playerId, resourceType.id]);

            const hasActive = existingResult.rows.length > 0
                && new Date(existingResult.rows[0].expires_at) > new Date();

            if (hasActive) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Ya tienes acceso activo a ${resourceType.display_name} hasta ${new Date(existingResult.rows[0].expires_at).toLocaleDateString('es-ES')}`
                });
            }

            // Verificar oro
            const goldResult = await client.query(
                'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE',
                [playerId]
            );
            const currentGold = parseInt(goldResult.rows[0]?.gold) || 0;
            if (currentGold < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Oro insuficiente. Necesitas ${cost}, tienes ${currentGold}`
                });
            }

            // Cobrar y crear/renovar acceso
            await client.query(
                'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                [cost, playerId]
            );

            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            await MarketModel.UpsertAccess(client, {
                player_id: playerId,
                resource_type_id: resourceType.id,
                expires_at: expiresAt,
            });

            await MarketModel.LogTransaction(client, {
                player_id: playerId,
                resource_type_id: resourceType.id,
                transaction_type: 'access_buy',
                total_gold: cost,
            });

            await client.query('COMMIT');

            Logger.action(
                `Mercado: compró acceso ${resourceType.name} por ${cost} oro (hasta ${expiresAt.toISOString()})`,
                playerId
            );

            res.json({
                success: true,
                message: `Acceso a ${resourceType.display_name} activado por 30 días`,
                cost,
                expires_at: expiresAt,
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: 'POST /api/market/buy (access)', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al comprar acceso' });
        } finally {
            client.release();
        }
    }

    // ── GET /api/market/history ──────────────────────────────────────────────

    async GetHistory(req, res) {
        try {
            const result = await MarketModel.GetPlayerHistory(req.user.player_id);
            res.json({ success: true, transactions: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: 'GET /api/market/history', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener historial' });
        }
    }
}

module.exports = new MarketService();
