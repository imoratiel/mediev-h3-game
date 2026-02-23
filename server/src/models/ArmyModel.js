const db = require('../../db.js'); // Tu conexión a DB

class ArmyModel {
    async findById(armyId) {
        const query = 'SELECT * FROM armies WHERE id = $1';
        const { rows } = await db.query(query, [armyId]);
        return rows[0];
    }

    async getArmyUnits(armyId) {
        const query = 'SELECT * FROM army_units WHERE army_id = $1';
        const { rows } = await db.query(query, [armyId]);
        return rows;
    }

    async updatePositionAndStamina(armyId, h3Index, staminaUpdates) {
        // staminaUpdates sería un array de {unitId, stamina}
        // Aquí usarías una transacción para actualizar posición y fatiga
    }

    async saveRoute(armyId, pathJson) {
        const query = `
            INSERT INTO army_routes (army_id, path)
            VALUES ($1, $2)
            ON CONFLICT (army_id) DO UPDATE SET path = $2`;
        await db.query(query, [armyId, JSON.stringify(pathJson)]);
    }
    async GetArmyDetailsByHex(h3_index) {
        const query = `
            SELECT
                a.army_id, a.name, a.player_id,
                a.gold_provisions, a.food_provisions, a.wood_provisions,
                p.display_name AS player_name,
                p.color AS player_color,
                a.destination,
                a.recovering
            FROM armies a
            JOIN players p ON a.player_id = p.player_id
            WHERE a.h3_index = $1
        `;
        const result = await db.query(query, [h3_index]);
        return result;
    }
    async GetArmyUnits(army_id) {
        const query = `
            SELECT
                t.unit_type_id, t.quantity, t.experience, t.morale,
                ut.name AS unit_name, ut.attack, ut.health_points,
                t.stamina, t.force_rest
            FROM troops t
            JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
            WHERE t.army_id = $1
        `;
        const result = await db.query(query, [army_id]);
        return result;
    }
    async GetArmyForDismiss(client, army_id) {
        const result = await client.query(
            `SELECT a.army_id, a.player_id, a.h3_index,
                    a.food_provisions, a.gold_provisions,
                    a.wood_provisions, a.stone_provisions, a.iron_provisions,
                    m.player_id AS fief_owner,
                    td.population AS fief_population,
                    t.name AS terrain_name,
                    p.capital_h3
             FROM armies a
             JOIN h3_map m ON a.h3_index = m.h3_index
             JOIN territory_details td ON a.h3_index = td.h3_index
             JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
             JOIN players p ON m.player_id = p.player_id
             WHERE a.army_id = $1`,
            [army_id]
        );
        return result.rows[0] ?? null;
    }
    async GetTroopGroup(client, army_id, unit_type_id) {
        const result = await client.query(
            'SELECT quantity FROM troops WHERE army_id = $1 AND unit_type_id = $2',
            [army_id, unit_type_id]
        );
        return result.rows[0] ?? null;
    }
    async GetArmiesInBounds(h3CellsArray) {
        const query = `
            SELECT
                a.h3_index,
                a.player_id,
                COUNT(DISTINCT a.army_id) AS army_count,
                SUM(t.quantity) AS total_troops
            FROM armies a
            LEFT JOIN troops t ON a.army_id = t.army_id
            WHERE a.h3_index = ANY($1::text[])
            GROUP BY a.h3_index, a.player_id
            ORDER BY a.h3_index
        `;
        const result = await db.query(query, [h3CellsArray]);
        return result;
    }
    /**
     * Recalculates and caches armies.detection_range for one army.
     * Must be called within an active transaction whenever troops are added or removed.
     * Falls back to 1 if the army has no troops (e.g. all just died).
     */
    async refreshDetectionRange(client, armyId) {
        await client.query(`
            UPDATE armies
            SET detection_range = COALESCE((
                SELECT MAX(ut.detection_range)
                FROM troops t
                JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
                WHERE t.army_id = $1
            ), 1)
            WHERE army_id = $1
        `, [armyId]);
    }
    /**
     * Returns each own army's h3_index and cached detection_range.
     * Reads from the pre-computed column — no troops/unit_types JOIN needed.
     */
    async GetPlayerArmiesWithDetection(playerId) {
        const result = await db.query(
            'SELECT h3_index, COALESCE(detection_range, 1) AS detection_range FROM armies WHERE player_id = $1',
            [playerId]
        );
        return result.rows;
    }
    /**
     * Returns all h3_index values owned by a player (their fiefs).
     * Used as vision origins for fog-of-war.
     */
    async GetPlayerFiefPositions(playerId) {
        const result = await db.query(
            'SELECT h3_index FROM h3_map WHERE player_id = $1',
            [playerId]
        );
        return result.rows.map(r => r.h3_index);
    }
    async GetUnitTypes() {
        const query = `
            SELECT
                ut.unit_type_id,
                ut.name,
                ut.attack,
                ut.health_points,
                ut.speed,
                ut.gold_upkeep,
                ut.food_consumption,
                ut.is_siege,
                ut.descrip,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'resource_type', ur.resource_type,
                            'amount', ur.amount
                        )
                    ) FILTER (WHERE ur.unit_type_id IS NOT NULL),
                    '[]'
                ) AS requirements
            FROM unit_types ut
            LEFT JOIN unit_requirements ur ON ut.unit_type_id = ur.unit_type_id
            GROUP BY ut.unit_type_id, ut.name, ut.attack, ut.health_points, ut.speed,
                     ut.gold_upkeep, ut.food_consumption, ut.is_siege, ut.descrip
            ORDER BY ut.unit_type_id
        `;
        const result = await db.query(query);
        return result;
    }
    async GetPlayerGold(client, player_id) {
        const result = await client.query('SELECT gold FROM players WHERE player_id = $1', [player_id]);
        return result;
    }
    async GetUnitRequirements(client, unit_type_id) {
        const result = await client.query(
            'SELECT resource_type, amount FROM unit_requirements WHERE unit_type_id = $1',
            [unit_type_id]
        );
        return result;
    }
    async GetTerritoryForRecruitment(client, h3_index) {
        const result = await client.query(
            `SELECT td.h3_index, td.population, td.wood_stored, td.stone_stored, td.iron_stored, m.player_id
             FROM territory_details td
             JOIN h3_map m ON td.h3_index = m.h3_index
             WHERE td.h3_index = $1`,
            [h3_index]
        );
        return result;
    }
    async DeductPopulation(client, h3_index, amount) {
        await client.query(
            'UPDATE territory_details SET population = population - $1 WHERE h3_index = $2',
            [amount, h3_index]
        );
    }
    async FindArmy(client, h3_index, army_name, player_id) {
        const result = await client.query(
            'SELECT army_id FROM armies WHERE h3_index = $1 AND name = $2 AND player_id = $3',
            [h3_index, army_name, player_id]
        );
        return result;
    }
    async CreateArmy(client, army_name, player_id, h3_index) {
        const result = await client.query(
            `INSERT INTO armies (name, player_id, h3_index)
             VALUES ($1, $2, $3)
             RETURNING army_id`,
            [army_name, player_id, h3_index]
        );
        return result;
    }
    async AddTroops(client, army_id, unit_type_id, quantity) {
        await client.query(
            `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina, force_rest)
             VALUES ($1, $2, $3, 10.00, 50.00, 100.00, false)`,
            [army_id, unit_type_id, quantity]
        );
    }
    async DeductPlayerGold(client, player_id, amount) {
        await client.query(
            'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
            [amount, player_id]
        );
    }
    async DeductTerritoryResource(client, h3_index, resource_column, amount) {
        await client.query(
            `UPDATE territory_details SET ${resource_column} = ${resource_column} - $1 WHERE h3_index = $2`,
            [amount, h3_index]
        );
    }
    async GetBulkUnitRequirements(client, unitTypeIds) {
        const result = await client.query(
            `SELECT unit_type_id, resource_type, amount
             FROM unit_requirements
             WHERE unit_type_id = ANY($1::int[])`,
            [unitTypeIds]
        );
        return result;
    }
    async GetTroops(player_id) {
        const query = `
            SELECT
                t.troop_id,
                t.quantity,
                t.experience,
                t.morale,
                ut.unit_type_id,
                ut.name AS unit_name,
                ut.attack,
                ut.health_points,
                ut.speed,
                a.army_id,
                a.name AS army_name,
                a.h3_index
            FROM troops t
            INNER JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
            INNER JOIN armies a ON t.army_id = a.army_id
            WHERE a.player_id = $1
            ORDER BY a.name, ut.name
        `;
        const result = await db.query(query, [player_id]);
        return result;
    }
    async GetArmies(player_id) {
        const query = `
            SELECT
                a.army_id,
                a.name,
                a.h3_index,
                a.destination,
                m.coord_x,
                m.coord_y,
                COALESCE(td.custom_name, s.name) AS location_name,
                COALESCE(SUM(t.quantity), 0)::int AS total_troops,
                COALESCE(SUM(t.quantity * ut.attack), 0)::int AS total_combat_power,
                COALESCE(ROUND(AVG(t.morale)), 0)::int AS average_moral,
                COALESCE(MIN(t.stamina), 0)::int AS min_stamina,
                (
                    SELECT COUNT(*)::int
                    FROM armies ea
                    WHERE ea.h3_index = a.h3_index AND ea.player_id != a.player_id
                ) AS enemy_count
            FROM armies a
            LEFT JOIN h3_map m ON a.h3_index = m.h3_index
            LEFT JOIN territory_details td ON a.h3_index = td.h3_index
            LEFT JOIN settlements s ON a.h3_index = s.h3_index
            LEFT JOIN troops t ON t.army_id = a.army_id
            LEFT JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
            WHERE a.player_id = $1
            GROUP BY a.army_id, a.name, a.h3_index, a.destination, m.coord_x, m.coord_y, td.custom_name, s.name
            ORDER BY a.name
        `;
        const result = await db.query(query, [player_id]);
        return result;
    }
    async GetArmyWithPlayer(army_id) {
        const result = await db.query(
            'SELECT army_id, name, h3_index, player_id FROM armies WHERE army_id = $1',
            [army_id]
        );
        return result;
    }
    async GetMyRoutes(player_id) {
        const result = await db.query(
            `SELECT a.army_id, a.name, a.h3_index, a.destination, ar.path
             FROM armies a
             JOIN army_routes ar ON ar.army_id = a.army_id
             WHERE a.player_id = $1`,
            [player_id]
        );
        return result;
    }
    async updateName(armyId, playerId, newName) {
        const result = await db.query(
            'UPDATE armies SET name = $1 WHERE army_id = $2 AND player_id = $3 RETURNING *',
            [newName, armyId, playerId]
        );
        return result.rows[0];
    }

    async GetArmyFullDetail(armyId, playerId) {
        const armyResult = await db.query(
            `SELECT a.army_id, a.name, a.h3_index, a.destination, a.recovering,
                    a.gold_provisions, a.food_provisions, a.wood_provisions,
                    COALESCE(td.population, 0) AS fief_population,
                    t.name AS terrain_name,
                    pl.capital_h3
             FROM armies a
             LEFT JOIN h3_map m ON a.h3_index = m.h3_index
             LEFT JOIN territory_details td ON a.h3_index = td.h3_index
             LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
             LEFT JOIN players pl ON a.player_id = pl.player_id
             WHERE a.army_id = $1 AND a.player_id = $2`,
            [armyId, playerId]
        );
        if (armyResult.rows.length === 0) return null;

        const troopsResult = await db.query(
            `SELECT t.unit_type_id, t.quantity, t.experience, t.morale, t.stamina, t.force_rest,
                    ut.name AS unit_name, ut.attack, ut.health_points, ut.speed
             FROM troops t
             JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
             WHERE t.army_id = $1
             ORDER BY ut.name`,
            [armyId]
        );

        return { army: armyResult.rows[0], troops: troopsResult.rows };
    }

    async GetArmiesAtHexForMerge(client, h3_index, player_id, host_army_id) {
        const result = await client.query(
            `SELECT army_id, name, gold_provisions, food_provisions, wood_provisions
             FROM armies
             WHERE h3_index = $1 AND player_id = $2 AND army_id != $3`,
            [h3_index, player_id, host_army_id]
        );
        return result;
    }

    async GetTroopsByArmies(client, army_ids) {
        const result = await client.query(
            `SELECT troop_id, army_id, unit_type_id, quantity,
                    experience, morale, stamina, force_rest
             FROM troops
             WHERE army_id = ANY($1::int[])`,
            [army_ids]
        );
        return result;
    }

    async stopArmy(armyId, playerId) {
        // Verify ownership and clear movement state atomically
        const result = await db.query(
            `UPDATE armies
             SET destination = NULL
             WHERE army_id = $1 AND player_id = $2
             RETURNING army_id, name`,
            [armyId, playerId]
        );
        if (result.rows.length === 0) return null; // Not found or not owner
        // Remove pre-calculated route
        await db.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);
        return result.rows[0];
    }
}

module.exports = new ArmyModel();