/**
 * Military recruitment logic
 * BASADO ESTRICTAMENTE EN DB_SCHEMA.md
 */

const { Logger } = require('../utils/logger');

/**
 * Get all unit types with their requirements
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Array>} Array of unit types with requirements
 */
// [DEAD_CODE] TODO: El módulo logic/military.js no tiene imports/referencias en el proyecto; revisar y eliminar si no se reutiliza.
async function getUnitTypes(pool) {
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
// [DEAD_CODE] TODO: El módulo logic/military.js no tiene imports/referencias en el proyecto; revisar y eliminar si no se reutiliza.
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
// [DEAD_CODE] TODO: El módulo logic/military.js no tiene imports/referencias en el proyecto; revisar y eliminar si no se reutiliza.
async function recruitUnits(pool, params, playerId) {
    const { h3_index, unit_type_id, quantity, army_name } = params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Get unit requirements - USANDO unit_type_id
        const reqQuery = await client.query(
            'SELECT resource_type, amount FROM unit_requirements WHERE unit_type_id = $1',
            [unit_type_id]
        );
        const requirements = reqQuery.rows;

        // Get territory details - USANDO h3_index como PK
        const territoryQuery = await client.query(
            `SELECT td.h3_index, td.wood_stored, td.stone_stored, td.iron_stored, m.player_id
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

        // Find or create army - USANDO army_id como PK
        const armyQuery = await client.query(
            'SELECT army_id FROM armies WHERE h3_index = $1 AND name = $2 AND player_id = $3',
            [h3_index, army_name, playerId]
        );

        let armyId;
        if (armyQuery.rows.length === 0) {
            // Create new army - USANDO army_id
            const newArmyQuery = await client.query(
                `INSERT INTO armies (name, player_id, h3_index)
                 VALUES ($1, $2, $3)
                 RETURNING army_id`,
                [army_name, playerId, h3_index]
            );
            armyId = newArmyQuery.rows[0].army_id;
        } else {
            armyId = armyQuery.rows[0].army_id;
        }

        // Insert into troops table (NOT army_instances)
        // USANDO troop_id, army_id, unit_type_id
        await client.query(
            `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina, force_rest)
             SELECT $1, $2, $3, COALESCE(ut.initial_experience, 0), 50.00, 100.00, false
             FROM unit_types ut WHERE ut.unit_type_id = $2`,
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

        // Registrar error con contexto completo
        Logger.error(error, {
            endpoint: '/api/military/recruit',
            method: 'POST',
            userId: playerId,
            payload: params
        });

        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get all troops for a player
 * @param {Pool} pool - Database connection pool
 * @param {number} playerId - Player ID
 * @returns {Promise<Array>} Array of troops with details
 */
// [DEAD_CODE] TODO: El módulo logic/military.js no tiene imports/referencias en el proyecto; revisar y eliminar si no se reutiliza.
async function getTroops(pool, playerId) {
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

    const result = await pool.query(query, [playerId]);
    return result.rows;
}

module.exports = {
    getUnitTypes,
    validateRecruitment,
    recruitUnits,
    getTroops
};
