'use strict';

const pool = require('../../db.js');

class WorkerModel {
    /**
     * Get all worker types. No transaction needed (read-only, cacheable).
     */
    async GetWorkerTypes() {
        const result = await pool.query(
            'SELECT id, name, hp, speed, detection_range, cost FROM workers_types ORDER BY cost ASC'
        );
        return result;
    }

    /**
     * Get a single worker type by id within a transaction.
     * Returns the row or null if not found.
     */
    async GetWorkerType(client, type_id) {
        const result = await client.query(
            'SELECT id, name, hp, speed, detection_range, cost FROM workers_types WHERE id = $1',
            [type_id]
        );
        return result.rows[0] || null;
    }

    /**
     * Returns true if h3_index has a completed 'Mercado' building.
     * Follows the same JOIN pattern as ArmyModel.CheckMilitaryBuildingInFief.
     */
    async CheckMarketInFief(client, h3_index) {
        const result = await client.query(
            `SELECT 1
             FROM fief_buildings fb
             JOIN buildings b ON fb.building_id = b.id
             WHERE fb.h3_index = $1
               AND fb.is_under_construction = FALSE
               AND b.name = 'Mercado'`,
            [h3_index]
        );
        return result.rows.length > 0;
    }

    /**
     * Insert a new worker instance. Stats are copied from the worker type at purchase time
     * to allow future buffs/debuffs without losing the original template.
     */
    async CreateWorker(client, player_id, h3_index, type_id, hp, speed, detection_range) {
        const result = await client.query(
            `INSERT INTO workers (player_id, h3_index, type_id, hp, speed, detection_range)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [player_id, h3_index, type_id, hp, speed, detection_range]
        );
        return result.rows[0];
    }

    /**
     * Get workers grouped by hex for map rendering.
     * Accepts an array of h3_index strings (viewport cells).
     */
    async GetWorkersInBounds(h3CellsArray) {
        const result = await pool.query(
            `SELECT w.h3_index, w.player_id,
                    p.username        AS player_name,
                    p.color           AS player_color,
                    wt.name           AS worker_type,
                    COUNT(w.id)::int  AS worker_count,
                    MIN(w.id)::int    AS first_worker_id,
                    tt.name           AS terrain_type
             FROM workers w
             JOIN players p        ON w.player_id = p.player_id
             JOIN workers_types wt ON w.type_id   = wt.id
             LEFT JOIN h3_map m    ON w.h3_index  = m.h3_index
             LEFT JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
             WHERE w.h3_index = ANY($1::text[])
               AND w.transported_by IS NULL
             GROUP BY w.h3_index, w.player_id, p.username, p.color, wt.name, tt.name
             ORDER BY w.h3_index`,
            [h3CellsArray]
        );
        return result;
    }

    /**
     * Get all workers belonging to a player, with type metadata.
     */
    async GetMyWorkers(player_id) {
        const result = await pool.query(
            `SELECT w.id, w.h3_index, w.destination_h3, w.type_id, w.hp, w.speed, w.detection_range, w.created_at,
                    wt.name AS type_name, wt.cost,
                    tt.name AS terrain_type
             FROM workers w
             JOIN workers_types wt ON w.type_id = wt.id
             LEFT JOIN h3_map m    ON w.h3_index = m.h3_index
             LEFT JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
             WHERE w.player_id = $1
             ORDER BY w.created_at DESC`,
            [player_id]
        );
        return result;
    }

    // ─── Construction ────────────────────────────────────────────────────────

    /**
     * Get all active constructions within a set of H3 cells (for map rendering).
     */
    async GetConstructionsInBounds(h3CellsArray) {
        const result = await pool.query(
            `SELECT ac.h3_index, ac.type, ac.progress_turns, ac.total_turns, ac.player_id,
                    (ac.total_turns - ac.progress_turns) AS remaining_turns,
                    p.username AS player_name,
                    p.color    AS player_color
             FROM active_constructions ac
             JOIN players p ON ac.player_id = p.player_id
             WHERE ac.h3_index = ANY($1::text[])`,
            [h3CellsArray]
        );
        return result;
    }

    /**
     * Check whether there is already an active construction at h3_index.
     * Returns the row or null.
     */
    async GetActiveConstruction(client, h3_index) {
        const result = await client.query(
            'SELECT h3_index, type, progress_turns, total_turns FROM active_constructions WHERE h3_index = $1',
            [h3_index]
        );
        return result.rows[0] || null;
    }

    /**
     * Start a bridge construction at h3_index.
     * Atomically:
     *   1. INSERT into active_constructions (fails on conflict — duplicate guard).
     *   2. DELETE all workers owned by player_id at h3_index (consumed by the work site).
     *
     * Returns the number of workers consumed.
     */
    async StartBridgeConstruction(client, player_id, h3_index, total_turns) {
        await client.query(
            `INSERT INTO active_constructions (h3_index, type, progress_turns, total_turns, player_id)
             VALUES ($1, 'BRIDGE', 0, $2, $3)`,
            [h3_index, total_turns, player_id]
        );
        const del = await client.query(
            'DELETE FROM workers WHERE player_id = $1 AND h3_index = $2 RETURNING id',
            [player_id, h3_index]
        );
        return del.rowCount;
    }

    // ─── Movement ────────────────────────────────────────────────────────────

    /**
     * Returns all workers that have a pending destination (used by the turn engine).
     */
    async GetWorkersWithDestination(client) {
        return client.query(
            `SELECT id, player_id, h3_index, destination_h3, speed
             FROM workers
             WHERE destination_h3 IS NOT NULL`
        );
    }

    /**
     * Set the same destination for every worker owned by player at from_h3.
     * Returns the pg result so callers can inspect rowCount.
     */
    async GetWorkerById(client, player_id, worker_id) {
        const result = await client.query(
            'SELECT id, h3_index, destination_h3 FROM workers WHERE id = $1 AND player_id = $2',
            [worker_id, player_id]
        );
        return result.rows[0] || null;
    }
    async SetHexDestination(client, player_id, worker_id, destination_h3) {
        return client.query(
            `UPDATE workers SET destination_h3 = $1 WHERE id = $2 AND player_id = $3`,
            [destination_h3, worker_id, player_id]
        );
    }

    /**
     * Move a worker to new_h3; optionally clear its destination when it arrives.
     */
    async UpdateWorkerPosition(client, worker_id, new_h3, clear_destination) {
        if (clear_destination) {
            return client.query(
                `UPDATE workers SET h3_index = $1, destination_h3 = NULL WHERE id = $2`,
                [new_h3, worker_id]
            );
        }
        return client.query(
            `UPDATE workers SET h3_index = $1 WHERE id = $2`,
            [new_h3, worker_id]
        );
    }

    /**
     * Clear the destination for a single worker (arrived or cancelled).
     */
    async ClearWorkerDestination(client, worker_id) {
        return client.query(
            `UPDATE workers SET destination_h3 = NULL WHERE id = $1`,
            [worker_id]
        );
    }
}

module.exports = new WorkerModel();
