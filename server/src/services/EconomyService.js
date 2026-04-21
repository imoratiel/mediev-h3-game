const { Logger } = require('../utils/logger');
const pool = require('../../db.js');
const cache = require('./CacheService.js');

class EconomyService {
    /**
     * GET /economy/summary
     * Returns aggregated resource totals across all fiefs for the requesting player,
     * plus the player's individual tax_percentage and tithe_active settings.
     */
    async GetEconomySummary(req, res) {
        const player_id = req.user.player_id;
        const cacheKey = cache.constructor.playerKey('economy', player_id);
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        try {
            const [totalsResult, playerResult] = await Promise.all([
                pool.query(`
                    SELECT
                        COUNT(td.h3_index)::int            AS fief_count,
                        COALESCE(SUM(td.food_stored),  0)  AS total_food,
                        COALESCE(SUM(td.wood_stored),  0)  AS total_wood,
                        COALESCE(SUM(td.stone_stored), 0)  AS total_stone,
                        COALESCE(SUM(td.iron_stored),  0)  AS total_iron,
                        COALESCE(SUM(td.gold_stored),  0)  AS total_gold,
                        COALESCE(SUM(td.population),   0)  AS total_population
                    FROM territory_details td
                    JOIN h3_map m ON td.h3_index = m.h3_index
                    WHERE m.player_id = $1
                `, [player_id]),
                pool.query(
                    'SELECT tax_percentage, tithe_active, gold FROM players WHERE player_id = $1',
                    [player_id]
                ),
            ]);

            const totals = totalsResult.rows[0];
            const player = playerResult.rows[0];

            const taxRate     = parseFloat(player?.tax_percentage ?? 10);
            const titheActive = player?.tithe_active === true;

            const estimatedTaxYield = Math.floor(Number(totals.total_gold) * taxRate / 100);

            const payload = {
                success: true,
                summary: {
                    fief_count:       totals.fief_count,
                    total_food:       Number(totals.total_food),
                    total_wood:       Number(totals.total_wood),
                    total_stone:      Number(totals.total_stone),
                    total_iron:       Number(totals.total_iron),
                    total_gold:       Number(totals.total_gold),
                    total_population: Number(totals.total_population),
                },
                player_gold: Number(player?.gold ?? 0),
                settings: {
                    tax_rate:            taxRate,
                    tithe_active:        titheActive,
                    estimated_tax_yield: estimatedTaxYield,
                }
            };
            cache.set(cacheKey, payload, 10_000);
            res.json(payload);
        } catch (error) {
            Logger.error(error, { context: 'EconomyService.GetEconomySummary', userId: player_id });
            res.status(500).json({ success: false, message: 'Error al obtener resumen económico' });
        }
    }
    /**
     * PATCH /economy/settings
     * Actualiza tax_percentage y/o tithe_active del jugador autenticado.
     */
    async UpdateEconomySettings(req, res) {
        const player_id = req.user.player_id;
        try {
            const { tax_rate, tithe_active } = req.body;

            const updates = [];
            const params  = [];

            if (tax_rate !== undefined) {
                const rate = Math.min(15, Math.max(1, parseFloat(tax_rate)));
                if (isNaN(rate)) {
                    return res.status(400).json({ success: false, message: 'tax_rate debe ser un número entre 1 y 15' });
                }
                params.push(rate);
                updates.push(`tax_percentage = $${params.length}`);
                // Propagar a todos los pagus del jugador
                await pool.query(
                    `UPDATE political_divisions SET tax_rate = $1 WHERE player_id = $2`,
                    [rate, player_id]
                );
            }

            if (tithe_active !== undefined) {
                const active = tithe_active === true || tithe_active === 'true' || tithe_active === 1;
                params.push(active);
                updates.push(`tithe_active = $${params.length}`);
            }

            if (updates.length === 0) {
                return res.status(400).json({ success: false, message: 'No se proporcionaron parámetros válidos' });
            }

            params.push(player_id);
            await pool.query(
                `UPDATE players SET ${updates.join(', ')} WHERE player_id = $${params.length}`,
                params
            );

            cache.delete(cache.constructor.playerKey('economy', player_id));
            Logger.action(`Configuración fiscal actualizada por jugador ${player_id}: ${updates.join(', ')}`, player_id);
            res.json({ success: true, message: 'Configuración guardada' });

        } catch (error) {
            Logger.error(error, { context: 'EconomyService.UpdateEconomySettings', userId: player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración económica' });
        }
    }
}

module.exports = new EconomyService();
