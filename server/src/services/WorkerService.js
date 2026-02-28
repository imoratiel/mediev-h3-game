'use strict';

const h3 = require('h3-js');
const pool = require('../../db.js');
const WorkerModel = require('../models/WorkerModel.js');
const { buyWorker, GameActionError } = require('./gameActions.js');
const { Logger } = require('../utils/logger.js');

class WorkerService {
    /**
     * GET /api/workers/types
     * Returns all worker type definitions (costs, stats).
     * Public — no auth required (same as unit-types).
     */
    async GetTypes(req, res) {
        try {
            const result = await WorkerModel.GetWorkerTypes();
            res.json({ success: true, worker_types: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/workers/types', method: 'GET' });
            res.status(500).json({ success: false, message: 'Error al obtener tipos de trabajadores' });
        }
    }

    /**
     * POST /api/workers/buy
     * Body: { h3_index, worker_type_id }
     *
     * Validates location (Capital or Mercado) and gold, then creates the worker.
     * Returns 403 when the location rule is violated — protects against manual POST abuse.
     */
    async Buy(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index, worker_type_id } = req.body;

            await client.query('BEGIN');
            const result = await buyWorker(client, player_id, { h3_index, worker_type_id });
            await client.query('COMMIT');

            res.json({ success: true, ...result });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof GameActionError) {
                const status = error.code === 'FORBIDDEN' ? 403 : 400;
                return res.status(status).json({ success: false, message: error.message });
            }
            Logger.error(error, { endpoint: '/workers/buy', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error interno al contratar trabajador' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/map/workers?minLat=&maxLat=&minLng=&maxLng=
     * Returns workers grouped by hex for map icon rendering.
     * Same bounding-box approach as /api/map/armies.
     */
    async GetInRegion(req, res) {
        try {
            const { minLat, maxLat, minLng, maxLng } = req.query;
            if (!minLat || !maxLat || !minLng || !maxLng) {
                return res.status(400).json({ success: false, message: 'Parámetros de bounding box requeridos' });
            }

            const polygon = [
                [parseFloat(minLat), parseFloat(minLng)],
                [parseFloat(minLat), parseFloat(maxLng)],
                [parseFloat(maxLat), parseFloat(maxLng)],
                [parseFloat(maxLat), parseFloat(minLng)],
            ];
            const h3Cells = Array.from(h3.polygonToCells(polygon, 8)).slice(0, 50000);

            if (h3Cells.length === 0) {
                return res.json({ success: true, workers: [], current_player_id: req.user.player_id });
            }

            const result = await WorkerModel.GetWorkersInBounds(h3Cells);
            res.json({ success: true, workers: result.rows, current_player_id: req.user.player_id });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/workers', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener trabajadores del mapa' });
        }
    }

    /**
     * GET /api/workers/my
     * Returns all workers owned by the authenticated player.
     */
    async GetMyWorkers(req, res) {
        try {
            const player_id = req.user.player_id;
            const result = await WorkerModel.GetMyWorkers(player_id);
            res.json({ success: true, workers: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/workers/my', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener trabajadores' });
        }
    }

    /**
     * POST /api/workers/set-hex-destination
     * Body: { from_h3, destination_h3 }
     *
     * Sets the same destination for all workers the player owns at from_h3.
     * The turn engine will then advance them straight-line toward destination_h3
     * each turn, skipping sea / out-of-map hexes.
     */
    async SetHexDestination(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { from_h3, destination_h3 } = req.body;

            if (!from_h3 || !destination_h3) {
                return res.status(400).json({ success: false, message: 'from_h3 y destination_h3 son requeridos' });
            }

            // Basic sanity: reject same-hex orders
            if (from_h3 === destination_h3) {
                return res.status(400).json({ success: false, message: 'El destino debe ser diferente al origen' });
            }

            await client.query('BEGIN');
            const result = await WorkerModel.SetHexDestination(client, player_id, from_h3, destination_h3);
            await client.query('COMMIT');

            const count = result.rowCount;
            if (count === 0) {
                return res.json({ success: false, message: 'No tienes trabajadores en ese hexágono' });
            }

            Logger.action(
                `[ACTION][Jugador ${player_id}]: ${count} trabajador(es) en ${from_h3} → destino ${destination_h3}`,
                { player_id, from_h3, destination_h3, workers_updated: count }
            );

            res.json({ success: true, message: `${count} trabajador(es) en ruta`, workers_updated: count });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/workers/set-hex-destination', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al establecer destino' });
        } finally {
            client.release();
        }
    }
}

module.exports = new WorkerService();
