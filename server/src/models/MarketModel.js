const pool = require('../../db.js');

class MarketModel {

    // ── Catálogo y precios ────────────────────────────────────────────────────

    /**
     * Devuelve todos los recursos de mercado con su precio calculado en tiempo real.
     * Para commodities: precio según oferta/demanda.
     * Para accesos: solo el coste mensual fijo.
     */
    async GetPrices() {
        return pool.query(`
            SELECT
                rt.id,
                rt.name,
                rt.display_name,
                rt.category,
                rt.base_price,
                rt.base_reserve,
                rt.min_price,
                rt.max_price,
                rt.spread,
                rt.access_cost_monthly,
                rt.description,
                mr.current_reserve,
                -- Precio dinámico para commodities
                CASE
                    WHEN rt.category = 'commodity' AND mr.current_reserve > 0 THEN
                        GREATEST(rt.min_price,
                            LEAST(rt.max_price,
                                rt.base_price * (rt.base_reserve::float / NULLIF(mr.current_reserve, 0))
                            )
                        )
                    WHEN rt.category = 'commodity' THEN rt.max_price
                    ELSE NULL
                END AS mid_price
            FROM market_resource_types rt
            LEFT JOIN market_reserves mr ON mr.resource_type_id = rt.id
            ORDER BY rt.category, rt.id
        `);
    }

    /**
     * Devuelve la reserva actual de un recurso commodity junto con los parámetros de precio.
     * Incluye FOR UPDATE para operaciones transaccionales.
     */
    async GetReserveForUpdate(client, resourceTypeId) {
        const result = await client.query(`
            SELECT
                rt.id, rt.name, rt.category,
                rt.base_price, rt.base_reserve, rt.min_price, rt.max_price, rt.spread,
                mr.current_reserve
            FROM market_resource_types rt
            JOIN market_reserves mr ON mr.resource_type_id = rt.id
            WHERE rt.id = $1
            FOR UPDATE OF mr
        `, [resourceTypeId]);
        return result.rows[0] ?? null;
    }

    async GetResourceByName(name) {
        const result = await pool.query(
            'SELECT * FROM market_resource_types WHERE name = $1',
            [name]
        );
        return result.rows[0] ?? null;
    }

    // ── Operaciones de reserva ────────────────────────────────────────────────

    async AddToReserve(client, resourceTypeId, quantity) {
        await client.query(`
            UPDATE market_reserves
            SET current_reserve = current_reserve + $2, updated_at = NOW()
            WHERE resource_type_id = $1
        `, [resourceTypeId, quantity]);
    }

    async RemoveFromReserve(client, resourceTypeId, quantity) {
        const result = await client.query(`
            UPDATE market_reserves
            SET current_reserve = current_reserve - $2, updated_at = NOW()
            WHERE resource_type_id = $1 AND current_reserve >= $2
            RETURNING current_reserve
        `, [resourceTypeId, quantity]);
        return result.rowCount > 0;
    }

    // ── Transacciones ─────────────────────────────────────────────────────────

    async LogTransaction(client, { player_id, resource_type_id, transaction_type, quantity, unit_price, total_gold, h3_index }) {
        await client.query(`
            INSERT INTO market_transactions
                (player_id, resource_type_id, transaction_type, quantity, unit_price, total_gold, h3_index)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [player_id, resource_type_id, transaction_type, quantity ?? null, unit_price ?? null, total_gold, h3_index ?? null]);
    }

    async GetPlayerHistory(playerId, limit = 50) {
        return pool.query(`
            SELECT
                mt.id, mt.transaction_type, mt.quantity, mt.unit_price, mt.total_gold,
                mt.h3_index, mt.created_at,
                rt.display_name AS resource_name, rt.category
            FROM market_transactions mt
            JOIN market_resource_types rt ON rt.id = mt.resource_type_id
            WHERE mt.player_id = $1
            ORDER BY mt.created_at DESC
            LIMIT $2
        `, [playerId, limit]);
    }

    // ── Accesos ───────────────────────────────────────────────────────────────

    async GetPlayerAccess(playerId) {
        return pool.query(`
            SELECT
                pra.id, pra.acquired_at, pra.expires_at,
                rt.id AS resource_type_id, rt.name, rt.display_name,
                rt.access_cost_monthly, rt.description
            FROM player_resource_access pra
            JOIN market_resource_types rt ON rt.id = pra.resource_type_id
            WHERE pra.player_id = $1
            ORDER BY pra.acquired_at
        `, [playerId]);
    }

    /**
     * Devuelve los player_id que tienen acceso activo al recurso indicado.
     * Usado por el motor de turnos para aplicar los efectos.
     */
    async GetActiveAccessHolders(resourceName) {
        const result = await pool.query(`
            SELECT pra.player_id
            FROM player_resource_access pra
            JOIN market_resource_types rt ON rt.id = pra.resource_type_id
            WHERE rt.name = $1 AND pra.expires_at > NOW()
        `, [resourceName]);
        return result.rows.map(r => r.player_id);
    }

    async UpsertAccess(client, { player_id, resource_type_id, expires_at }) {
        await client.query(`
            INSERT INTO player_resource_access (player_id, resource_type_id, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (player_id, resource_type_id)
            DO UPDATE SET expires_at = EXCLUDED.expires_at
        `, [player_id, resource_type_id, expires_at]);
    }

    async DeleteExpiredAccess(client, player_id, resource_type_id) {
        await client.query(`
            DELETE FROM player_resource_access
            WHERE player_id = $1 AND resource_type_id = $2
        `, [player_id, resource_type_id]);
    }

    /**
     * Devuelve todos los accesos activos que vencen en el próximo ciclo mensual.
     * El motor de turnos los usa para cobrar la renovación.
     */
    async GetAccessesDueForRenewal() {
        const result = await pool.query(`
            SELECT
                pra.player_id, pra.resource_type_id,
                rt.name AS resource_name, rt.access_cost_monthly,
                rt.display_name
            FROM player_resource_access pra
            JOIN market_resource_types rt ON rt.id = pra.resource_type_id
            WHERE pra.expires_at <= NOW() + INTERVAL '1 turn'
              AND pra.expires_at > NOW() - INTERVAL '1 day'
        `);
        return result.rows;
    }

    /**
     * Cobra la renovación mensual de todos los accesos activos.
     * Llamado por processMonthlyTurn. Devuelve { renewed, expired } counts.
     */
    async ProcessMonthlyAccessRenewals(client) {
        // Obtener todos los accesos que deberían renovarse (expirados o próximos a expirar)
        const dueResult = await client.query(`
            SELECT
                pra.player_id, pra.resource_type_id, pra.expires_at,
                rt.name AS resource_name, rt.display_name, rt.access_cost_monthly,
                p.gold
            FROM player_resource_access pra
            JOIN market_resource_types rt ON rt.id = pra.resource_type_id
            JOIN players p ON p.player_id = pra.player_id
            WHERE pra.expires_at <= NOW() + INTERVAL '2 hours'
            FOR UPDATE OF pra
        `);

        let renewed = 0, expired = 0;
        const renewedList = [];  // { player_id, display_name, cost }
        const expiredList = [];  // { player_id, display_name }

        for (const row of dueResult.rows) {
            if (row.gold >= row.access_cost_monthly) {
                await client.query(
                    'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                    [row.access_cost_monthly, row.player_id]
                );
                await client.query(`
                    UPDATE player_resource_access
                    SET expires_at = expires_at + INTERVAL '30 days'
                    WHERE player_id = $1 AND resource_type_id = $2
                `, [row.player_id, row.resource_type_id]);
                await this.LogTransaction(client, {
                    player_id: row.player_id,
                    resource_type_id: row.resource_type_id,
                    transaction_type: 'access_renew',
                    total_gold: row.access_cost_monthly,
                });
                renewedList.push({ player_id: row.player_id, display_name: row.display_name, cost: row.access_cost_monthly });
                renewed++;
            } else {
                await client.query(`
                    DELETE FROM player_resource_access
                    WHERE player_id = $1 AND resource_type_id = $2
                `, [row.player_id, row.resource_type_id]);
                await this.LogTransaction(client, {
                    player_id: row.player_id,
                    resource_type_id: row.resource_type_id,
                    transaction_type: 'access_expired',
                    total_gold: 0,
                });
                expiredList.push({ player_id: row.player_id, display_name: row.display_name });
                expired++;
            }
        }

        return { renewed, expired, renewedList, expiredList };
    }
}

module.exports = new MarketModel();
