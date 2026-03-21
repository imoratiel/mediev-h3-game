const pool = require('../../db.js');

class CombatModel {
    /**
     * Find all hexes with armies from two or more different players (conflict zones).
     */
    async getConflictHexes(client) {
        const result = await client.query(`
            SELECT h3_index, ARRAY_AGG(DISTINCT player_id) AS player_ids
            FROM armies
            GROUP BY h3_index
            HAVING COUNT(DISTINCT player_id) > 1
        `);
        return result.rows;
    }

    /**
     * Get all armies at a hex, each with their troops (quantity > 0) and unit type stats.
     */
    async getArmiesAtHex(client, h3Index) {
        const armiesResult = await client.query(`
            SELECT army_id, name, player_id, h3_index,
                   food_provisions, gold_provisions, wood_provisions
            FROM armies
            WHERE h3_index = $1
        `, [h3Index]);

        const armies = armiesResult.rows;

        for (const army of armies) {
            const troopsResult = await client.query(`
                SELECT t.troop_id, t.unit_type_id, t.quantity,
                       t.experience, t.morale, t.stamina, t.force_rest,
                       ut.name AS unit_name, ut.attack, ut.defense, ut.health_points
                FROM troops t
                JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                WHERE t.army_id = $1 AND t.quantity > 0
            `, [army.army_id]);
            army.troops = troopsResult.rows;
        }

        return armies;
    }

    /**
     * Get terrain type name and defense bonus for a hex.
     * Returns null if hex not found.
     */
    async getTerrainAtHex(client, h3Index) {
        const result = await client.query(`
            SELECT tt.name AS terrain_name, tt.defense_bonus
            FROM h3_map m
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            WHERE m.h3_index = $1
        `, [h3Index]);
        return result.rows[0] || null;
    }

    /**
     * Get attack/defense modifier for a unit type at a given terrain.
     * Returns null if no specific modifier exists (means 1.0, i.e. no bonus/penalty).
     */
    async getTerrainModifier(client, unitTypeId, terrainName) {
        const result = await client.query(`
            SELECT attack_modificator, defense_modificator
            FROM unit_terrain_modifiers
            WHERE unit_type_id = $1 AND terrain_type = $2
        `, [unitTypeId, terrainName]);
        return result.rows[0] || null;
    }

    /**
     * Get the damage multiplier when attacker_type attacks defender_type.
     * Returns 1.0 (no modifier) if no entry exists in the counters table.
     */
    async getCombatCounter(client, attackerTypeId, defenderTypeId) {
        const result = await client.query(`
            SELECT damage_multiplier
            FROM unit_combat_counters
            WHERE attacker_type_id = $1 AND defender_type_id = $2
        `, [attackerTypeId, defenderTypeId]);
        // DECIMAL returned as string by node-postgres — parse it
        return parseFloat(result.rows[0]?.damage_multiplier ?? 1.0);
    }

    /**
     * Update a troop's quantity.
     * Deletes the row if newQuantity <= 0 (troop annihilated).
     */
    async updateTroopQuantity(client, troopId, newQuantity) {
        if (newQuantity <= 0) {
            await client.query('DELETE FROM troops WHERE troop_id = $1', [troopId]);
        } else {
            await client.query(
                'UPDATE troops SET quantity = $1 WHERE troop_id = $2',
                [newQuantity, troopId]
            );
        }
    }

    /**
     * Update a troop's experience, capped at 100.
     */
    async updateTroopExperience(client, troopId, newExperience) {
        await client.query(
            'UPDATE troops SET experience = LEAST(100, $1) WHERE troop_id = $2',
            [newExperience, troopId]
        );
    }

    /**
     * Transfer a fraction of provisions from the loser army to the winner army.
     * Returns the loot amounts actually transferred.
     */
    async transferProvisions(client, fromArmyId, toArmyId, fraction) {
        const result = await client.query(
            'SELECT food_provisions, gold_provisions, wood_provisions FROM armies WHERE army_id = $1',
            [fromArmyId]
        );
        if (result.rows.length === 0) return { food: 0, gold: 0, wood: 0 };

        const prov = result.rows[0];
        const loot = {
            food:  Math.floor(parseFloat(prov.food_provisions)  * fraction),
            gold:  Math.floor(parseFloat(prov.gold_provisions)  * fraction),
            wood:  Math.floor(parseFloat(prov.wood_provisions)  * fraction),
        };

        await client.query(`
            UPDATE armies SET
                food_provisions  = GREATEST(0, food_provisions  - $1),
                gold_provisions  = GREATEST(0, gold_provisions  - $2),
                wood_provisions  = GREATEST(0, wood_provisions  - $3)
            WHERE army_id = $4
        `, [loot.food, loot.gold, loot.wood, fromArmyId]);

        await client.query(`
            UPDATE armies SET
                food_provisions  = food_provisions  + $1,
                gold_provisions  = gold_provisions  + $2,
                wood_provisions  = wood_provisions  + $3
            WHERE army_id = $4
        `, [loot.food, loot.gold, loot.wood, toArmyId]);

        return loot;
    }

    /**
     * Delete an army (and its route) if it has no surviving troops.
     * Returns true if the army was deleted.
     */
    async deleteArmyIfEmpty(client, armyId) {
        const result = await client.query(
            'SELECT COUNT(*) AS count FROM troops WHERE army_id = $1 AND quantity > 0',
            [armyId]
        );
        if (parseInt(result.rows[0].count) === 0) {
            await client.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);
            await client.query('DELETE FROM armies WHERE army_id = $1', [armyId]);
            return true;
        }
        return false;
    }
}

module.exports = new CombatModel();
