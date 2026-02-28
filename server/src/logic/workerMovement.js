'use strict';

/**
 * workerMovement.js
 *
 * Processes straight-line movement for all workers that have a pending destination.
 * Called once per game turn by the turn engine (inside the main transaction).
 *
 * Rules:
 *  - Workers advance `speed` cells per turn along the shortest H3 grid path.
 *  - Any hex with movement_cost < 0 (sea) or not in h3_map is impassable — the
 *    worker stops at the last valid cell reached this turn.
 *  - When the worker reaches destination_h3 the column is cleared automatically.
 */

const h3 = require('h3-js');
const WorkerModel = require('../models/WorkerModel');
const { Logger } = require('../utils/logger');

/**
 * Move all workers that have a non-null destination_h3 by up to `speed` cells.
 *
 * @param {import('pg').PoolClient} client - active transaction client
 * @param {number} turn - current turn number (for logging)
 */
async function processWorkerMovements(client, turn) {
    try {
        const workersResult = await WorkerModel.GetWorkersWithDestination(client);
        if (workersResult.rows.length === 0) return;

        Logger.engine(`[TURN ${turn}] Processing ${workersResult.rows.length} worker movement(s)...`);

        for (const worker of workersResult.rows) {
            try {
                // Already at destination (edge case — clear and continue)
                if (worker.h3_index === worker.destination_h3) {
                    await WorkerModel.ClearWorkerDestination(client, worker.id);
                    continue;
                }

                // Straight-line path: path[0] = current position, last = destination
                let path;
                try {
                    path = h3.gridPathCells(worker.h3_index, worker.destination_h3);
                } catch {
                    // Invalid H3 indices — skip this worker
                    Logger.error(new Error(`Invalid H3 for worker ${worker.id}: ${worker.h3_index} → ${worker.destination_h3}`), { context: 'processWorkerMovements' });
                    continue;
                }

                const steps = path.slice(1); // exclude current position
                if (steps.length === 0) {
                    await WorkerModel.ClearWorkerDestination(client, worker.id);
                    continue;
                }

                let newH3 = worker.h3_index;
                let stepsRemaining = worker.speed;

                for (const nextH3 of steps) {
                    if (stepsRemaining <= 0) break;

                    // Check terrain: must be in h3_map and not sea (movement_cost < 0)
                    const terrainResult = await client.query(
                        `SELECT tt.movement_cost
                         FROM h3_map m
                         JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                         WHERE m.h3_index = $1`,
                        [nextH3]
                    );

                    if (terrainResult.rows.length === 0 || terrainResult.rows[0].movement_cost < 0) {
                        break; // Sea or unmapped — stop here
                    }

                    newH3 = nextH3;
                    stepsRemaining--;
                }

                const arrived = newH3 === worker.destination_h3;
                await WorkerModel.UpdateWorkerPosition(client, worker.id, newH3, arrived);

                Logger.engine(
                    `[TURN ${turn}] Worker ${worker.id} (player ${worker.player_id}): ` +
                    `${worker.h3_index} → ${newH3}${arrived ? ' [ARRIVED]' : ` (${steps.length - (worker.speed - stepsRemaining)} steps remaining)`}`
                );
            } catch (workerErr) {
                // Resilient: log error but continue with other workers
                Logger.error(workerErr, { context: 'processWorkerMovements', workerId: worker.id, turn });
            }
        }
    } catch (err) {
        Logger.error(err, { context: 'processWorkerMovements', turn });
    }
}

module.exports = { processWorkerMovements };
