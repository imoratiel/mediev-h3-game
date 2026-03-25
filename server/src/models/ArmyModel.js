const db = require('../../db.js'); // Tu conexión a DB
const { CHARACTERS: { COMBAT_BUFF_BASE, COMBAT_BUFF_PER_LEVEL } } = require('../config/constants');

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
                a.is_garrison,
                p.display_name AS player_name,
                p.color AS player_color,
                a.destination,
                a.recovering,
                CASE WHEN c.id IS NOT NULL THEN json_build_object(
                    'id',              c.id,
                    'name',            c.name,
                    'full_title',      CONCAT(
                                           CASE WHEN p2.gender = 'F' THEN nr.title_female ELSE nr.title_male END,
                                           ' ', c.name
                                       ),
                    'level',           c.level,
                    'personal_guard',  c.personal_guard,
                    'combat_buff_pct', $2 + (c.level - 1) * $3
                ) ELSE NULL END AS commander
            FROM armies a
            JOIN players p  ON a.player_id = p.player_id
            LEFT JOIN characters c  ON c.army_id = a.army_id
            LEFT JOIN players p2    ON p2.player_id = c.player_id
            LEFT JOIN noble_ranks nr ON nr.id = p2.noble_rank_id
            WHERE a.h3_index = $1
              AND a.is_naval = FALSE
        `;
        const result = await db.query(query, [h3_index, COMBAT_BUFF_BASE, COMBAT_BUFF_PER_LEVEL]);
        return result;
    }
    async GetArmyUnits(army_id) {
        const query = `
            SELECT
                t.unit_type_id, t.quantity, t.experience, t.morale,
                ut.name AS unit_name, ut.attack, ut.health_points,
                t.stamina, t.force_rest, ut.unit_class
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
                COALESCE(SUM(CASE WHEN NOT a.is_naval THEN t.quantity ELSE 0 END), 0)::int AS total_troops,
                BOOL_OR(a.is_garrison) AS has_garrison,
                BOOL_OR(a.is_naval)    AS has_naval,
                BOOL_OR(CASE WHEN a.is_naval THEN (
                    EXISTS(SELECT 1 FROM armies    a2 WHERE a2.transported_by = a.army_id) OR
                    EXISTS(SELECT 1 FROM characters c  WHERE c.transported_by = a.army_id) OR
                    EXISTS(SELECT 1 FROM workers    w  WHERE w.transported_by = a.army_id)
                ) ELSE FALSE END) AS has_embarked_armies
            FROM armies a
            LEFT JOIN troops t ON a.army_id = t.army_id AND NOT a.is_naval
            WHERE a.h3_index = ANY($1::text[])
              AND (a.transported_by IS NULL)
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
                ut.culture_id,
                ut.unit_class,
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
                     ut.gold_upkeep, ut.food_consumption, ut.is_siege, ut.descrip, ut.culture_id, ut.unit_class
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
            `SELECT td.h3_index, td.population, td.wood_stored, td.stone_stored, td.iron_stored,
                    m.player_id, p.capital_h3, p.culture_id
             FROM territory_details td
             JOIN h3_map m ON td.h3_index = m.h3_index
             LEFT JOIN players p ON m.player_id = p.player_id
             WHERE td.h3_index = $1`,
            [h3_index]
        );
        return result;
    }
    /**
     * Returns true if h3_index has a completed military building (Cuartel, Fortaleza, etc.)
     */
    async CheckMilitaryBuildingInFief(client, h3_index) {
        const result = await client.query(
            `SELECT 1
             FROM fief_buildings fb
             JOIN buildings b ON fb.building_id = b.id
             JOIN building_types bt ON b.type_id = bt.building_type_id
             WHERE fb.h3_index = $1
               AND fb.is_under_construction = FALSE
               AND fb.conservation > 20
               AND bt.name = 'military'`,
            [h3_index]
        );
        return result.rows.length > 0;
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
    async CreateArmy(client, army_name, player_id, h3_index, is_garrison = false) {
        const result = await client.query(
            `INSERT INTO armies (name, player_id, h3_index, is_garrison)
             VALUES ($1, $2, $3, $4)
             RETURNING army_id`,
            [army_name, player_id, h3_index, is_garrison]
        );
        return result;
    }

    async GetGarrisonAtHex(client, h3_index, player_id) {
        const result = await client.query(
            `SELECT army_id FROM armies WHERE h3_index = $1 AND player_id = $2 AND is_garrison = TRUE LIMIT 1`,
            [h3_index, player_id]
        );
        return result.rows[0] || null;
    }
    async AddTroops(client, army_id, unit_type_id, quantity) {
        await client.query(
            `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina, force_rest)
             SELECT $1, $2, $3, COALESCE(ut.initial_experience, 0), 50.00, 100.00, false
             FROM unit_types ut WHERE ut.unit_type_id = $2`,
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
                ) AS enemy_count,
                COALESCE(td.grace_turns, 0)::int AS fief_grace_turns,
                (m.player_id = a.player_id) AS is_own_fief,
                a.is_garrison
            FROM armies a
            LEFT JOIN h3_map m ON a.h3_index = m.h3_index
            LEFT JOIN territory_details td ON a.h3_index = td.h3_index
            LEFT JOIN settlements s ON a.h3_index = s.h3_index
            LEFT JOIN troops t ON t.army_id = a.army_id
            LEFT JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
            WHERE a.player_id = $1
              AND (a.is_naval = FALSE OR a.is_naval IS NULL)
              AND a.transported_by IS NULL
            GROUP BY a.army_id, a.name, a.h3_index, a.destination, m.coord_x, m.coord_y, td.custom_name, s.name, td.grace_turns, m.player_id, a.is_garrison
            ORDER BY a.name
        `;
        const result = await db.query(query, [player_id]);
        return result;
    }
    async GetArmyWithPlayer(army_id) {
        const result = await db.query(
            'SELECT army_id, name, h3_index, player_id, is_garrison FROM armies WHERE army_id = $1',
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
                    COALESCE(td.grace_turns, 0) AS fief_grace_turns,
                    COALESCE(td.wood_stored, 0) AS fief_wood,
                    COALESCE(td.stone_stored, 0) AS fief_stone,
                    COALESCE(td.iron_stored, 0) AS fief_iron,
                    (m.player_id = a.player_id) AS is_own_fief,
                    a.is_garrison,
                    t.name AS terrain_name,
                    pl.capital_h3,
                    EXISTS (
                        SELECT 1 FROM fief_buildings fb
                        JOIN buildings b ON fb.building_id = b.id
                        JOIN building_types bt ON b.type_id = bt.building_type_id
                        WHERE fb.h3_index = a.h3_index
                          AND bt.name = 'military'
                          AND NOT fb.is_under_construction
                    ) AS fief_has_military
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
                    ut.name AS unit_name, ut.attack, ut.health_points, ut.speed, ut.unit_class
             FROM troops t
             JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
             WHERE t.army_id = $1
             ORDER BY ut.name`,
            [armyId]
        );

        const commanderResult = await db.query(
            `SELECT c.id, c.name, c.level, c.personal_guard, c.is_captive,
                    $2::int + (c.level - 1) * $3::int AS combat_buff_pct,
                    CONCAT(
                        CASE WHEN pl2.gender = 'F' THEN nr.title_female ELSE nr.title_male END,
                        ' ', c.name
                    ) AS full_title
             FROM characters c
             LEFT JOIN players pl2 ON pl2.player_id = c.player_id
             LEFT JOIN noble_ranks nr ON nr.id = pl2.noble_rank_id
             WHERE c.army_id = $1`,
            [armyId, COMBAT_BUFF_BASE, COMBAT_BUFF_PER_LEVEL]
        );

        return {
            army: armyResult.rows[0],
            troops: troopsResult.rows,
            commander: commanderResult.rows[0] ?? null,
        };
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

    /**
     * Returns the current army count and fief count for a player in one query.
     * Used to enforce army limits server-side.
     */
    async GetPlayerArmyCapacity(client, player_id) {
        const result = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM armies WHERE player_id = $1 AND NOT is_garrison AND NOT is_naval)::int AS army_count,
                (SELECT COUNT(*) FROM armies WHERE player_id = $1 AND is_naval = TRUE)::int                  AS fleet_count,
                (SELECT COUNT(*) FROM h3_map  WHERE player_id = $1)::int                                     AS fief_count
        `, [player_id]);
        return result.rows[0];
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

    async GetArmiesAtHex(h3_index, player_id) {
        const result = await db.query(
            `SELECT
                a.army_id, a.name, a.is_garrison,
                CASE WHEN c.id IS NOT NULL THEN json_build_object(
                    'id',              c.id,
                    'name',            c.name,
                    'full_title',      CONCAT(
                                           CASE WHEN p.gender = 'F' THEN nr.title_female ELSE nr.title_male END,
                                           ' ', c.name
                                       ),
                    'level',           c.level,
                    'personal_guard',  c.personal_guard,
                    'combat_buff_pct', $3 + (c.level - 1) * $4
                ) ELSE NULL END AS commander
             FROM armies a
             LEFT JOIN characters c ON c.army_id = a.army_id
             LEFT JOIN players p    ON p.player_id = a.player_id
             LEFT JOIN noble_ranks nr ON nr.id = p.noble_rank_id
             WHERE a.h3_index = $1 AND a.player_id = $2 AND a.destination IS NULL
             ORDER BY a.army_id`,
            [h3_index, player_id, COMBAT_BUFF_BASE, COMBAT_BUFF_PER_LEVEL]
        );
        return result.rows;
    }

    /**
     * Returns a single troop row for a specific army + unit type (with stats).
     */
    async GetTroopGroup(client, army_id, unit_type_id) {
        const result = await client.query(
            `SELECT troop_id, quantity, experience, morale, stamina, force_rest
             FROM troops WHERE army_id = $1 AND unit_type_id = $2`,
            [army_id, unit_type_id]
        );
        return result.rows[0] || null;
    }

    /**
     * Transfers quantity units of unit_type_id from fromArmyId to toArmyId.
     * Applies weighted average stats. Both armies must be fetched before calling.
     */
    async TransferTroops(client, fromArmyId, toArmyId, unitTypeId, quantity) {
        // Get source troop row
        const src = await this.GetTroopGroup(client, fromArmyId, unitTypeId);
        if (!src || parseInt(src.quantity) < quantity) {
            throw new Error(`Tropas insuficientes para transferir (tipo ${unitTypeId})`);
        }

        const srcExp     = parseFloat(src.experience);
        const srcMorale  = parseFloat(src.morale);
        const srcStamina = parseFloat(src.stamina);
        const srcRest    = src.force_rest;

        // Get target troop row (may not exist)
        const dst = await this.GetTroopGroup(client, toArmyId, unitTypeId);

        if (dst) {
            const dstQty    = parseInt(dst.quantity);
            const totalQty  = dstQty + quantity;
            const wExp      = Math.round((parseFloat(dst.experience) * dstQty + srcExp * quantity) / totalQty * 100) / 100;
            const wMorale   = Math.round((parseFloat(dst.morale)     * dstQty + srcMorale * quantity) / totalQty * 100) / 100;
            const wStamina  = Math.round((parseFloat(dst.stamina)    * dstQty + srcStamina * quantity) / totalQty * 100) / 100;
            const newRest   = dst.force_rest || srcRest;

            await client.query(
                `UPDATE troops SET quantity=$1, experience=$2, morale=$3, stamina=$4, force_rest=$5
                 WHERE army_id=$6 AND unit_type_id=$7`,
                [totalQty, wExp, wMorale, wStamina, newRest, toArmyId, unitTypeId]
            );
        } else {
            await client.query(
                `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina, force_rest)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [toArmyId, unitTypeId, quantity, srcExp, srcMorale, srcStamina, srcRest]
            );
        }

        // Decrease source
        const remaining = parseInt(src.quantity) - quantity;
        if (remaining <= 0) {
            await client.query('DELETE FROM troops WHERE troop_id = $1', [src.troop_id]);
        } else {
            await client.query('UPDATE troops SET quantity=$1 WHERE troop_id=$2', [remaining, src.troop_id]);
        }
    }

    /**
     * Adds troops to an existing army, merging with existing rows of the same unit type.
     * If no row exists for that unit_type_id, inserts a fresh one (initial_experience from unit_types, morale=50).
     */
    async ReinforceTroops(client, army_id, unit_type_id, quantity) {
        const existing = await client.query(
            'SELECT troop_id FROM troops WHERE army_id = $1 AND unit_type_id = $2',
            [army_id, unit_type_id]
        );
        if (existing.rows.length > 0) {
            await client.query(
                'UPDATE troops SET quantity = quantity + $1 WHERE army_id = $2 AND unit_type_id = $3',
                [quantity, army_id, unit_type_id]
            );
        } else {
            await client.query(
                `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina, force_rest)
                 SELECT $1, $2, $3, COALESCE(ut.initial_experience, 0), 50.00, 100.00, false
                 FROM unit_types ut WHERE ut.unit_type_id = $2`,
                [army_id, unit_type_id, quantity]
            );
        }
    }
}

module.exports = new ArmyModel();