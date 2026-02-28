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
                    p.username   AS player_name,
                    p.color      AS player_color,
                    wt.name      AS worker_type,
                    COUNT(w.id)::int AS worker_count
             FROM workers w
             JOIN players p       ON w.player_id = p.player_id
             JOIN workers_types wt ON w.type_id   = wt.id
             WHERE w.h3_index = ANY($1::text[])
             GROUP BY w.h3_index, w.player_id, p.username, p.color, wt.name
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
                    wt.name AS type_name, wt.cost
             FROM workers w
             JOIN workers_types wt ON w.type_id = wt.id
             WHERE w.player_id = $1
             ORDER BY w.created_at DESC`,
            [player_id]
        );
        return result;
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
    async SetHexDestination(client, player_id, from_h3, destination_h3) {
        return client.query(
            `UPDATE workers
             SET destination_h3 = $1
             WHERE player_id = $2 AND h3_index = $3`,
            [destination_h3, player_id, from_h3]
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
