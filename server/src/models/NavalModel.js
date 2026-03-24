const pool = require('../../db.js');

class NavalModel {

    // ── Ship types ────────────────────────────────────────────────────────

    async GetShipTypesByCulture(culture_id) {
        const result = await pool.query(`
            SELECT id, name, culture_id, category, transport_capacity,
                   gold_cost, upkeep_gold, attack, defense, speed, description
            FROM ship_types
            WHERE culture_id = $1
            ORDER BY category DESC, id
        `, [culture_id]);
        return result.rows;
    }

    // ── Fleet queries ─────────────────────────────────────────────────────

    /**
     * Single fleet with its ships composition.
     */
    async GetFleetById(client, fleet_id) {
        const fleetRes = await (client || pool).query(`
            SELECT army_id, name, h3_index, player_id, destination, anchored_at_h3
            FROM armies
            WHERE army_id = $1 AND is_naval = TRUE
        `, [fleet_id]);
        if (fleetRes.rows.length === 0) return null;

        const shipsRes = await (client || pool).query(`
            SELECT fs.id, fs.ship_type_id, fs.quantity,
                   st.name, st.category, st.transport_capacity,
                   st.attack, st.defense, st.speed
            FROM fleet_ships fs
            JOIN ship_types st ON fs.ship_type_id = st.id
            WHERE fs.army_id = $1
        `, [fleet_id]);

        return { ...fleetRes.rows[0], ships: shipsRes.rows };
    }

    /**
     * All fleets for a player with aggregate ship/capacity totals.
     */
    async GetPlayerFleets(client, player_id) {
        const result = await (client || pool).query(`
            SELECT
                a.army_id, a.name, a.h3_index, a.destination, a.anchored_at_h3,
                COALESCE(SUM(fs.quantity), 0)::int AS total_ships,
                COALESCE(SUM(
                    CASE WHEN st.category = 'transport'
                    THEN fs.quantity * st.transport_capacity ELSE 0 END
                ), 0)::int AS total_capacity
            FROM armies a
            LEFT JOIN fleet_ships fs  ON a.army_id = fs.army_id
            LEFT JOIN ship_types  st  ON fs.ship_type_id = st.id
            WHERE a.player_id = $1 AND a.is_naval = TRUE
            GROUP BY a.army_id
            ORDER BY a.army_id
        `, [player_id]);
        return result.rows;
    }

    /**
     * Fleet count + fief count for limit enforcement.
     * Fleet limit uses the same formula as army limit.
     */
    async GetPlayerFleetCapacity(client, player_id) {
        const result = await (client || pool).query(`
            SELECT
                (SELECT COUNT(*) FROM armies  WHERE player_id = $1 AND is_naval = TRUE)::int AS fleet_count,
                (SELECT COUNT(*) FROM h3_map  WHERE player_id = $1)::int                     AS fief_count
        `, [player_id]);
        return result.rows[0];
    }

    /**
     * Total transport capacity and currently embarked load for a fleet.
     * Capacity is consumed by: troops + army-attached chars + standalone chars + workers.
     */
    async GetFleetCargo(client, fleet_id) {
        const capRes = await (client || pool).query(`
            SELECT COALESCE(SUM(
                CASE WHEN st.category = 'transport' THEN fs.quantity * st.transport_capacity ELSE 0 END
            ), 0)::int AS max_capacity
            FROM fleet_ships fs
            JOIN ship_types st ON fs.ship_type_id = st.id
            WHERE fs.army_id = $1
        `, [fleet_id]);

        const embarkRes = await (client || pool).query(`
            SELECT
                a.army_id, a.name,
                COALESCE(SUM(t.quantity), 0)::int AS troop_count,
                (SELECT COUNT(*) FROM characters c WHERE c.army_id = a.army_id)::int AS char_count
            FROM armies a
            LEFT JOIN troops t ON a.army_id = t.army_id
            WHERE a.transported_by = $1
            GROUP BY a.army_id, a.name
        `, [fleet_id]);

        const workerRes = await (client || pool).query(
            `SELECT w.id, wt.name AS type_name FROM workers w
             JOIN workers_types wt ON w.type_id = wt.id
             WHERE w.transported_by = $1`,
            [fleet_id]
        );

        const standaloneCharRes = await (client || pool).query(
            `SELECT id, name FROM characters WHERE transported_by = $1 AND army_id IS NULL`,
            [fleet_id]
        );

        const troops_used      = embarkRes.rows.reduce((s, r) => s + r.troop_count, 0);
        const chars_used       = embarkRes.rows.reduce((s, r) => s + r.char_count,  0);
        const workers_used     = workerRes.rows.length;
        const standalone_chars = standaloneCharRes.rows.length;
        const used_capacity    = troops_used + chars_used + workers_used + standalone_chars;

        return {
            max_capacity:         capRes.rows[0].max_capacity,
            used_capacity,
            embarked_armies:      embarkRes.rows,
            standalone_workers:   workerRes.rows,
            standalone_chars:     standaloneCharRes.rows,
        };
    }

    /**
     * Workers at a hex belonging to a player that are not already on a fleet.
     */
    async GetWorkersAtHex(client, player_id, h3_index) {
        const result = await (client || pool).query(`
            SELECT w.id, wt.name AS type_name
            FROM workers w
            JOIN workers_types wt ON w.type_id = wt.id
            WHERE w.player_id = $1
              AND w.h3_index  = $2
              AND w.transported_by IS NULL
        `, [player_id, h3_index]);
        return result.rows;
    }

    /**
     * Mark workers as transported by a fleet.
     */
    async EmbarkWorkers(client, worker_ids, fleet_id) {
        if (!worker_ids.length) return;
        await client.query(
            `UPDATE workers SET transported_by = $1 WHERE id = ANY($2::int[])`,
            [fleet_id, worker_ids]
        );
    }

    /**
     * Move workers on a fleet to their landing hex and clear transported_by.
     */
    async DisembarkWorkers(client, fleet_id, h3_index) {
        await client.query(
            `UPDATE workers SET h3_index = $1, transported_by = NULL, destination_h3 = NULL
             WHERE transported_by = $2`,
            [h3_index, fleet_id]
        );
    }

    /**
     * Standalone characters (no army) and free workers at given hexes.
     */
    async GetStandaloneEntitiesAtHex(client, player_id, hexes) {
        const charsRes = await (client || pool).query(`
            SELECT id, name
            FROM characters
            WHERE player_id = $1
              AND h3_index = ANY($2)
              AND army_id IS NULL
              AND transported_by IS NULL
              AND is_captive = FALSE
        `, [player_id, hexes]);

        const workersRes = await (client || pool).query(`
            SELECT w.id, wt.name AS type_name
            FROM workers w
            JOIN workers_types wt ON w.type_id = wt.id
            WHERE w.player_id = $1
              AND w.h3_index = ANY($2)
              AND w.transported_by IS NULL
        `, [player_id, hexes]);

        return { characters: charsRes.rows, workers: workersRes.rows };
    }

    /** Mark a standalone character as transported by a fleet. */
    async EmbarkCharacter(client, char_id, fleet_id) {
        const result = await client.query(
            `UPDATE characters SET transported_by = $1
             WHERE id = $2 AND army_id IS NULL AND transported_by IS NULL
             RETURNING id`,
            [fleet_id, char_id]
        );
        return result.rows[0] ?? null;
    }

    /** Mark a single worker as transported by a fleet. */
    async EmbarkWorker(client, worker_id, fleet_id) {
        const result = await client.query(
            `UPDATE workers SET transported_by = $1
             WHERE id = $2 AND transported_by IS NULL
             RETURNING id`,
            [fleet_id, worker_id]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Disembark standalone characters from a fleet to a landing hex.
     */
    async DisembarkStandaloneChars(client, fleet_id, h3_index) {
        await client.query(
            `UPDATE characters SET h3_index = $1, transported_by = NULL
             WHERE transported_by = $2 AND army_id IS NULL`,
            [h3_index, fleet_id]
        );
    }

    // ── Ownership helper ──────────────────────────────────────────────────

    async GetFleetByIdAndOwner(client, fleet_id, player_id) {
        const result = await (client || pool).query(
            `SELECT army_id, h3_index, name
             FROM armies
             WHERE army_id = $1 AND player_id = $2 AND is_naval = TRUE`,
            [fleet_id, player_id]
        );
        return result.rows[0] ?? null;
    }

    // ── Mutations ─────────────────────────────────────────────────────────

    async CreateFleet(client, player_id, h3_index, name) {
        const result = await client.query(`
            INSERT INTO armies (player_id, h3_index, name, is_naval)
            VALUES ($1, $2, $3, TRUE)
            RETURNING army_id
        `, [player_id, h3_index, name]);
        return result.rows[0];
    }

    /**
     * Adds ships to a fleet (upsert: increments quantity if already present).
     */
    async AddShipsToFleet(client, fleet_id, ship_type_id, quantity) {
        const result = await client.query(`
            INSERT INTO fleet_ships (army_id, ship_type_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (army_id, ship_type_id)
            DO UPDATE SET quantity = fleet_ships.quantity + EXCLUDED.quantity
            RETURNING *
        `, [fleet_id, ship_type_id, quantity]);
        return result.rows[0];
    }

    async EmbarkArmy(client, army_id, fleet_id) {
        const result = await client.query(`
            UPDATE armies SET transported_by = $1
            WHERE army_id = $2 AND transported_by IS NULL
            RETURNING army_id
        `, [fleet_id, army_id]);
        return result.rows[0] ?? null;
    }

    async DisembarkArmy(client, army_id) {
        const result = await client.query(`
            UPDATE armies SET transported_by = NULL
            WHERE army_id = $1
            RETURNING army_id
        `, [army_id]);
        return result.rows[0] ?? null;
    }

    // ── Embarkation helpers ───────────────────────────────────────────────

    /**
     * Land armies at the fleet's hex, owned by the player, not yet embarked.
     * Includes troop count, character count and (per-hex) worker count for UI display.
     */
    /**
     * Armies that can be embarked: at the fleet's hex or at adjacent land hexes.
     * hex_candidates includes the fleet hex + all ring-1 neighbors.
     */
    async GetEmbarkableArmies(client, player_id, fleet_hex, hex_candidates) {
        const hexes = hex_candidates || [fleet_hex];
        const result = await (client || pool).query(`
            SELECT
                a.army_id, a.name, a.h3_index,
                COALESCE(SUM(t.quantity), 0)::int AS troop_count,
                (SELECT COUNT(*) FROM characters c WHERE c.army_id = a.army_id)::int AS char_count
            FROM armies a
            LEFT JOIN troops t ON a.army_id = t.army_id
            WHERE a.player_id = $1
              AND a.h3_index  = ANY($2)
              AND a.is_naval  = FALSE
              AND a.is_garrison = FALSE
              AND a.transported_by IS NULL
            GROUP BY a.army_id, a.name, a.h3_index
        `, [player_id, hexes]);
        return result.rows;
    }
}

module.exports = new NavalModel();
