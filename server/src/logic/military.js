/**
 * Military recruitment logic
 */

/**
 * Get all unit types with their requirements
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Array>} Array of unit types with requirements
 */
async function getUnitTypes(pool) {
    const query = `
        SELECT
            ut.id,
            ut.name,
            ut.attack,
            ut.health_points,
            ut.speed,
            ut.gold_upkeep,
            ut.food_consumption,
            ut.is_siege,
            ut.flavor_text,
            COALESCE(
                json_agg(
                    json_build_object(
                        'resource_type', ur.resource_type,
                        'amount', ur.amount
                    )
                ) FILTER (WHERE ur.id IS NOT NULL),
                '[]'
            ) AS requirements
        FROM unit_types ut
        LEFT JOIN unit_requirements ur ON ut.id = ur.unit_type_id
        GROUP BY ut.id
        ORDER BY ut.id
    `;

    const result = await pool.query(query);
    return result.rows;
}

/**
 * Validate if recruitment is possible
 * @param {Object} params - Recruitment parameters
 * @param {Object} territory - Territory details
 * @param {Object} player - Player details
 * @param {Array} requirements - Unit requirements
 * @returns {string|null} Error message or null if valid
 */
function validateRecruitment(params, territory, player, requirements) {
    const { quantity } = params;

    // Validate territory ownership
    if (!territory) {
        return 'Territorio no encontrado';
    }

    // Check each requirement
    for (const req of requirements) {
        const needed = req.amount * quantity;

        if (req.resource_type === 'gold') {
            if (player.gold < needed) {
                return `Oro insuficiente. Necesitas ${needed} oro, pero solo tienes ${player.gold}.`;
            }
        } else if (req.resource_type === 'wood_stored') {
            if ((territory.wood_stored || 0) < needed) {
                return `Madera insuficiente en este feudo. Necesitas ${needed}, pero solo tienes ${territory.wood_stored || 0}.`;
            }
        } else if (req.resource_type === 'stone_stored') {
            if ((territory.stone_stored || 0) < needed) {
                return `Piedra insuficiente en este feudo. Necesitas ${needed}, pero solo tienes ${territory.stone_stored || 0}.`;
            }
        } else if (req.resource_type === 'iron_stored') {
            if ((territory.iron_stored || 0) < needed) {
                return `Hierro insuficiente en este feudo. Necesitas ${needed}, pero solo tienes ${territory.iron_stored || 0}.`;
            }
        }
    }

    return null;
}

/**
 * Recruit units
 * @param {Pool} pool - Database connection pool
 * @param {Object} params - Recruitment parameters
 * @param {number} playerId - Player ID
 * @returns {Promise<Object>} Recruitment result
 */
async function recruitUnits(pool, params, playerId) {
    const { h3_index, unit_type_id, quantity, army_name } = params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Get unit requirements
        const reqQuery = await client.query(
            'SELECT resource_type, amount FROM unit_requirements WHERE unit_type_id = $1',
            [unit_type_id]
        );
        const requirements = reqQuery.rows;

        // Get territory details
        const territoryQuery = await client.query(
            `SELECT h3_index, wood_stored, stone_stored, iron_stored, player_id
             FROM territory_details td
             JOIN h3_map m ON td.h3_index = m.h3_index
             WHERE td.h3_index = $1`,
            [h3_index]
        );

        if (territoryQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Territorio no encontrado' };
        }

        const territory = territoryQuery.rows[0];

        // Verify ownership
        if (territory.player_id !== playerId) {
            await client.query('ROLLBACK');
            return { success: false, message: 'No posees este territorio' };
        }

        // Get player gold
        const playerQuery = await client.query(
            'SELECT gold FROM players WHERE player_id = $1',
            [playerId]
        );
        const player = playerQuery.rows[0];

        // Validate recruitment
        const validationError = validateRecruitment(params, territory, player, requirements);
        if (validationError) {
            await client.query('ROLLBACK');
            return { success: false, message: validationError };
        }

        // Deduct resources
        for (const req of requirements) {
            const cost = req.amount * quantity;

            if (req.resource_type === 'gold') {
                await client.query(
                    'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                    [cost, playerId]
                );
            } else if (req.resource_type === 'wood_stored') {
                await client.query(
                    'UPDATE territory_details SET wood_stored = wood_stored - $1 WHERE h3_index = $2',
                    [cost, h3_index]
                );
            } else if (req.resource_type === 'stone_stored') {
                await client.query(
                    'UPDATE territory_details SET stone_stored = stone_stored - $1 WHERE h3_index = $2',
                    [cost, h3_index]
                );
            } else if (req.resource_type === 'iron_stored') {
                await client.query(
                    'UPDATE territory_details SET iron_stored = iron_stored - $1 WHERE h3_index = $2',
                    [cost, h3_index]
                );
            }
        }

        // Find or create army
        const armyQuery = await client.query(
            'SELECT id FROM armies WHERE h3_index = $1 AND name = $2 AND player_id = $3',
            [h3_index, army_name, playerId]
        );

        let armyId;
        if (armyQuery.rows.length === 0) {
            // Create new army
            const newArmyQuery = await client.query(
                `INSERT INTO armies (name, player_id, h3_index, rest_level)
                 VALUES ($1, $2, $3, 100.00)
                 RETURNING id`,
                [army_name, playerId, h3_index]
            );
            armyId = newArmyQuery.rows[0].id;
        } else {
            armyId = armyQuery.rows[0].id;
        }

        // Create army instance
        await client.query(
            `INSERT INTO army_instances (army_id, unit_type_id, quantity, experience, morale)
             VALUES ($1, $2, $3, 10.00, 50.00)`,
            [armyId, unit_type_id, quantity]
        );

        await client.query('COMMIT');

        return {
            success: true,
            message: 'Unidades reclutadas exitosamente',
            army_id: armyId
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getUnitTypes,
    validateRecruitment,
    recruitUnits
};
