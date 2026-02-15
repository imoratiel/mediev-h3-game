const pool = require('../../db.js');

class KingdomModel {
    async CheckTerritoryOwnership(client, h3_index) {
        const result = await client.query('SELECT player_id FROM h3_map WHERE h3_index = $1', [h3_index]);
        return result.rows[0];
    }
    async GetExplorationStatus(client, h3_index) {
        const result = await client.query('SELECT exploration_end_turn, discovered_resource FROM territory_details WHERE h3_index = $1', [h3_index]);
        return result.rows[0];
    }
    async GetPlayerGold(client, player_id) {
        const result = await client.query('SELECT gold FROM players WHERE player_id = $1', [player_id]);
        return result.rows[0];
    }
    async GetCurrentTurn(client) {
        const result = await client.query('SELECT current_turn FROM world_state WHERE id = 1');
        return result.rows[0];
    }
    async StartExploration(client, h3_index, player_id, exploration_cost, end_turn) {
        await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [exploration_cost, player_id]);
        await client.query('UPDATE territory_details SET exploration_end_turn = $1 WHERE h3_index = $2', [end_turn, h3_index]);
    }
    async GetTerritoryForUpgrade(client, h3_index) {
        const query = `
            SELECT td.*, t.name AS terrain_type, t.food_output, t.wood_output, m.is_coast
            FROM territory_details td
            JOIN h3_map m ON td.h3_index = m.h3_index
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            WHERE td.h3_index = $1
        `;
        const result = await client.query(query, [h3_index]);
        return result.rows[0];
    }
    async ApplyUpgrade(client, h3_index, player_id, building_type, new_level, cost) {
        await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [cost, player_id]);
        await client.query(`UPDATE territory_details SET ${building_type}_level = $1 WHERE h3_index = $2`, [new_level, h3_index]);
    }
    async GetTerritoryCount(client, player_id) {
        const result = await client.query('SELECT COUNT(*) as count FROM h3_map WHERE player_id = $1', [player_id]);
        return parseInt(result.rows[0].count);
    }
    async GetHexForClaim(client, h3_index) {
        const result = await client.query(
            `SELECT m.h3_index, m.player_id, m.terrain_type_id, t.iron_output, t.name as terrain_name
             FROM h3_map m
             LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
             WHERE m.h3_index = $1 FOR UPDATE OF m`,
            [h3_index]
        );
        return result.rows[0];
    }
    async GetPlayerGoldForUpdate(client, player_id) {
        const result = await client.query('SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [player_id]);
        return result.rows[0];
    }
    async ClaimHex(client, h3_index, player_id) {
        await client.query(
            'UPDATE h3_map SET player_id = $1, building_type_id = 0, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
            [player_id, h3_index]
        );
    }
    async InsertTerritoryDetails(client, h3_index, eco) {
        await client.query(
            `INSERT INTO territory_details (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, gold_stored)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (h3_index) DO UPDATE SET
                 population = EXCLUDED.population, happiness = EXCLUDED.happiness,
                 food_stored = EXCLUDED.food_stored, wood_stored = EXCLUDED.wood_stored,
                 stone_stored = EXCLUDED.stone_stored, iron_stored = EXCLUDED.iron_stored,
                 gold_stored = EXCLUDED.gold_stored`,
            [h3_index, eco.population, eco.happiness, eco.food, eco.wood, eco.stone, 0, 0]
        );
    }
    async DeductGold(client, player_id, amount) {
        await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [amount, player_id]);
    }
    async SetCapital(client, h3_index, player_id) {
        await client.query('UPDATE players SET capital_h3 = $1 WHERE player_id = $2', [h3_index, player_id]);
    }
    async GetCapital(player_id) {
        const result = await pool.query('SELECT capital_h3 FROM players WHERE player_id = $1', [player_id]);
        return result.rows[0];
    }
    async GetMyFiefs(player_id) {
        const query = `
            SELECT
                m.h3_index,
                m.coord_x,
                m.coord_y,
                COALESCE(td.custom_name, s.name, m.h3_index) AS location_name,
                td.*,
                t.name AS terrain_name,
                t.food_output,
                COALESCE(garrison.total_troops, 0) AS total_troops,
                p.capital_h3
            FROM h3_map m
            JOIN territory_details td ON m.h3_index = td.h3_index
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            JOIN players p ON m.player_id = p.player_id
            LEFT JOIN settlements s ON m.h3_index = s.h3_index
            LEFT JOIN (
                SELECT a.h3_index, SUM(tr.quantity) AS total_troops
                FROM armies a
                JOIN troops tr ON a.army_id = tr.army_id
                WHERE a.player_id = $1
                GROUP BY a.h3_index
            ) garrison ON m.h3_index = garrison.h3_index
            WHERE m.player_id = $1
            ORDER BY td.population DESC
        `;
        const result = await pool.query(query, [player_id]);
        return result;
    }
}

module.exports = new KingdomModel();
