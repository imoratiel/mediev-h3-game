const { Logger, logGameEvent } = require('../utils/logger');
const KingdomModel = require('../models/KingdomModel.js');
const { CONFIG } = require('../config.js');
const infrastructure = require('../logic/infrastructure.js');
const conquest = require('../logic/conquest.js');
const pool = require('../../db.js');

class KingdomService {
    async StartExploration(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.user.player_id;

            await client.query('BEGIN');

            const territory = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (territory?.player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const exploration = await KingdomModel.GetExplorationStatus(client, h3_index);
            if (exploration.discovered_resource !== null || exploration.exploration_end_turn !== null) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Exploración ya realizada o en curso' });
            }

            const player = await KingdomModel.GetPlayerGold(client, player_id);
            const cost = CONFIG.exploration.gold_cost;
            if (player.gold < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }

            const world = await KingdomModel.GetCurrentTurn(client);
            const end_turn = world.current_turn + CONFIG.exploration.turns_required;

            await KingdomModel.StartExploration(client, h3_index, player_id, cost, end_turn);
            await client.query('COMMIT');

            logGameEvent(`[EXPLORACIÓN] Jugador ${player_id} inició exploración en ${h3_index}`);

            const updated = await KingdomModel.GetPlayerGold(client, player_id);
            res.json({
                success: true,
                message: `Exploración iniciada, finaliza en turno ${end_turn}`,
                exploration_end_turn: end_turn,
                new_gold_balance: updated.gold,
                gold_spent: cost
            });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/territory/explore', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async UpgradeBuilding(req, res) {
        const client = await pool.connect();
        try {
            const { h3_index, building_type } = req.body;
            const player_id = req.user.player_id;

            const territory_owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
            if (territory_owner?.player_id !== player_id) {
                return res.status(403).json({ success: false, message: 'No posees este territorio' });
            }

            const territory = await KingdomModel.GetTerritoryForUpgrade(client, h3_index);
            const validation_error = infrastructure.validateUpgrade(building_type, territory);
            if (validation_error) {
                return res.status(400).json({ success: false, message: validation_error });
            }

            const current_level = territory[`${building_type}_level`] || 0;
            const cost = infrastructure.calculateUpgradeCost(building_type, current_level, CONFIG);

            const player = await KingdomModel.GetPlayerGold(client, player_id);
            if (player.gold < cost) {
                return res.status(400).json({ success: false, message: 'Oro insuficiente' });
            }

            await client.query('BEGIN');
            await KingdomModel.ApplyUpgrade(client, h3_index, player_id, building_type, current_level + 1, cost);
            await client.query('COMMIT');

            logGameEvent(`[INFRAESTRUCTURA] Jugador ${player_id} mejoró ${building_type} en ${h3_index}`);
            res.json({ success: true, message: `${building_type} mejorada al nivel ${current_level + 1}` });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/territory/upgrade', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async GetMyFiefs(req, res) {
        try {
            const result = await KingdomModel.GetMyFiefs(req.user.player_id);

            const fiefs = result.rows.map(row => ({
                ...row,
                is_capital: (row.h3_index === row.capital_h3)
            }));

            res.json({ success: true, fiefs });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/my-fiefs', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener feudos' });
        }
    }
    async ClaimTerritory(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.body;
            if (!h3_index) return res.status(400).json({ success: false, message: 'Falta parámetro: h3_index' });

            await client.query('BEGIN');

            const territoryCount = await KingdomModel.GetTerritoryCount(client, player_id);
            const isFirstTerritory = territoryCount === 0;

            const hex = await KingdomModel.GetHexForClaim(client, h3_index);
            if (!hex) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Hexágono no encontrado' }); }
            if (hex.terrain_type_id === 1 || hex.terrain_type_id === 3) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🌊 No puedes construir en el agua' }); }
            if (hex.player_id !== null) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🛡️ Este territorio ya está ocupado' }); }

            const player = await KingdomModel.GetPlayerGoldForUpdate(client, player_id);
            const CLAIM_COST = 100;
            if (player.gold < CLAIM_COST) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '💰 Oro insuficiente' }); }

            if (!isFirstTerritory && !(await conquest.checkContiguity(h3_index, player_id, pool))) {
                await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '📍 Debes colonizar territorios contiguos' });
            }

            const eco = conquest.generateInitialEconomy();
            await KingdomModel.ClaimHex(client, h3_index, player_id);
            await KingdomModel.InsertTerritoryDetails(client, h3_index, eco);
            await KingdomModel.DeductGold(client, player_id, CLAIM_COST);

            if (isFirstTerritory) {
                await KingdomModel.SetCapital(client, h3_index, player_id);
                Logger.action(`Primera capital fundada en ${h3_index}`, player_id);
            }

            await client.query('COMMIT');
            logGameEvent(`[Claim] Jugador ${player_id} reclamó ${h3_index}${isFirstTerritory ? ' (CAPITAL)' : ''}`);

            const hasIron = hex.iron_output && hex.iron_output > 0;
            const message = isFirstTerritory ? '👑 ¡Capital fundada!' : '🏰 ¡Territorio colonizado!';
            res.json({
                success: true,
                is_capital: isFirstTerritory,
                iron_vein_found: hasIron,
                iron_message: hasIron ? `⛏️ ¡Filón de hierro descubierto! (+${hex.iron_output} hierro/mes)` : null,
                message
            });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/game/claim', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, error: error.message });
        } finally {
            client.release();
        }
    }
    async GetCapital(req, res) {
        try {
            const row = await KingdomModel.GetCapital(req.user.player_id);
            if (!row || !row.capital_h3) return res.status(200).json({ success: false, message: 'No tienes capital' });
            res.json({ success: true, h3_index: row.capital_h3 });
        } catch (error) {
            Logger.error(error, { endpoint: '/game/capital', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener información de capital' });
        }
    }
}

module.exports = new KingdomService();
