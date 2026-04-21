'use strict';

const h3 = require('h3-js');
const pool = require('../../db.js');
const cache = require('./CacheService.js');
const WorkerModel = require('../models/WorkerModel.js');
const ArmyModel = require('../models/ArmyModel.js');
const CharacterModel = require('../models/CharacterModel.js');
const GAME_CONFIG = require('../config/constants.js');
const { buyWorker, GameActionError } = require('./gameActions.js');
const { Logger } = require('../utils/logger.js');

class WorkerService {
    /**
     * GET /api/workers/types
     * Returns all worker type definitions (costs, stats).
     * Public — no auth required (same as unit-types).
     */
    async GetTypes(req, res) {
        const CACHE_KEY = 'static:worker_types';
        const cached = cache.get(CACHE_KEY);
        if (cached) return res.json(cached);
        try {
            const result = await WorkerModel.GetWorkerTypes();
            const payload = { success: true, worker_types: result.rows };
            cache.set(CACHE_KEY, payload, 0);
            res.json(payload);
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
     * GET /api/workers/hire-locations
     * Returns all hexes where the player can hire workers:
     * Capital + fiefs with a completed Mercado (conservation > 20).
     */
    async GetHireLocations(req, res) {
        try {
            const locations = await WorkerModel.GetHireLocations(req.user.player_id);
            res.json({ success: true, locations });
        } catch (error) {
            Logger.error(error, { endpoint: '/workers/hire-locations', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener ubicaciones de contratación' });
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
            const h3Cells = Array.from(h3.polygonToCells(polygon, 7)).slice(0, 50000);

            if (h3Cells.length === 0) {
                return res.json({ success: true, workers: [], current_player_id: req.user.player_id });
            }

            const playerId = req.user.player_id;

            const [result, ownArmyVision, ownFiefPositions, characterPositions, workerPositions, fleetPositions] = await Promise.all([
                WorkerModel.GetWorkersInBounds(h3Cells),
                ArmyModel.GetPlayerArmiesWithDetection(playerId),
                ArmyModel.GetPlayerFiefPositions(playerId),
                CharacterModel.getStandalonePositions(playerId),
                WorkerModel.GetPlayerWorkerPositions(playerId),
                ArmyModel.GetPlayerFleetPositions(playerId),
            ]);

            const FLEET_DETECTION_RANGE = 10;
            const visibleHexes = new Set();
            for (const army of ownArmyVision) {
                h3.gridDisk(army.h3_index, army.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fiefH3 of ownFiefPositions) {
                h3.gridDisk(fiefH3, GAME_CONFIG.MILITARY.FIEF_DETECTION_RANGE).forEach(hex => visibleHexes.add(hex));
            }
            for (const charH3 of characterPositions) {
                h3.gridDisk(charH3, GAME_CONFIG.CHARACTERS.DETECTION_RANGE).forEach(hex => visibleHexes.add(hex));
            }
            for (const w of workerPositions) {
                h3.gridDisk(w.h3_index, w.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fleetH3 of fleetPositions) {
                h3.gridDisk(fleetH3, FLEET_DETECTION_RANGE).forEach(hex => visibleHexes.add(hex));
            }

            // Own workers always visible; enemy workers only if in visible zone
            const visibleWorkers = result.rows.filter(
                w => w.player_id === playerId || visibleHexes.has(w.h3_index)
            );

            res.json({ success: true, workers: visibleWorkers, current_player_id: playerId });
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
     * Body: { worker_id, destination_h3 }
     *
     * Sets the destination for a single worker identified by worker_id.
     * The turn engine will advance it straight-line toward destination_h3
     * each turn, skipping sea / out-of-map hexes.
     */
    async SetHexDestination(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { worker_id, destination_h3 } = req.body;

            if (!worker_id || !destination_h3) {
                return res.status(400).json({ success: false, message: 'worker_id y destination_h3 son requeridos' });
            }

            await client.query('BEGIN');

            // Verify ownership and get current position for same-hex check
            const worker = await WorkerModel.GetWorkerById(client, player_id, worker_id);
            if (!worker) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Trabajador no encontrado o no te pertenece' });
            }
            if (worker.h3_index === destination_h3) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El destino debe ser diferente al origen' });
            }

            const result = await WorkerModel.SetHexDestination(client, player_id, worker_id, destination_h3);
            await client.query('COMMIT');

            if (result.rowCount === 0) {
                return res.json({ success: false, message: 'No se pudo establecer el destino' });
            }

            Logger.action(
                `[ACTION][Jugador ${player_id}]: Trabajador #${worker_id} (${worker.h3_index}) → destino ${destination_h3}`,
                { player_id, worker_id, from_h3: worker.h3_index, destination_h3 }
            );

            res.json({ success: true, message: `Trabajador en ruta hacia ${destination_h3}` });
        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error(error, { endpoint: '/workers/set-hex-destination', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al establecer destino' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/workers/start-construction
     * Body: { h3_index }
     *
     * Starts a bridge construction at h3_index.
     * Requirements:
     *   - Player must own workers at h3_index.
     *   - Terrain must be 'Río' or 'Agua'.
     *   - No active construction already at h3_index.
     *
     * On success: inserts into active_constructions and consumes (deletes) all
     * workers of this player at the hex.
     */
    async StartConstruction(req, res) {
        const BRIDGE_TURNS = 30;
        const BUILDABLE_TERRAINS = ['Río', 'Agua'];

        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.body;

            if (!h3_index) {
                return res.status(400).json({ success: false, message: 'h3_index es requerido' });
            }

            await client.query('BEGIN');

            // 1. Verify the player has at least one worker at this hex
            const workerCheck = await client.query(
                'SELECT COUNT(*)::int AS cnt FROM workers WHERE player_id = $1 AND h3_index = $2',
                [player_id, h3_index]
            );
            if (workerCheck.rows[0].cnt === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No tienes trabajadores en ese hexágono' });
            }

            // 2. Validate terrain type (Río or Agua only)
            const terrainResult = await client.query(
                `SELECT tt.name AS terrain_type
                 FROM h3_map m
                 JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                 WHERE m.h3_index = $1`,
                [h3_index]
            );
            if (terrainResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Hexágono no encontrado en el mapa' });
            }
            const terrainName = terrainResult.rows[0].terrain_type;
            if (!BUILDABLE_TERRAINS.includes(terrainName)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Los puentes solo se pueden construir en terreno de Río o Agua (terreno actual: ${terrainName})`
                });
            }

            // 3. Check for existing active construction
            const existing = await WorkerModel.GetActiveConstruction(client, h3_index);
            if (existing) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Ya hay una construcción en curso en este hexágono (${existing.progress_turns}/${existing.total_turns} turnos)`
                });
            }

            // 4. Start construction & consume workers (atomic)
            const workersConsumed = await WorkerModel.StartBridgeConstruction(client, player_id, h3_index, BRIDGE_TURNS);

            await client.query('COMMIT');

            Logger.action(
                `[ACTION][Jugador ${player_id}]: Inicio construcción de puente en ${h3_index} (${workersConsumed} trabajador(es) consumido(s), ${BRIDGE_TURNS} turnos)`,
                { player_id, h3_index, workers_consumed: workersConsumed, total_turns: BRIDGE_TURNS }
            );

            res.json({
                success: true,
                message: `Construcción iniciada. El puente estará listo en ${BRIDGE_TURNS} turnos.`,
                workers_consumed: workersConsumed,
                total_turns: BRIDGE_TURNS,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') { // unique_violation on active_constructions PK
                return res.status(400).json({ success: false, message: 'Ya hay una construcción en curso en este hexágono' });
            }
            Logger.error(error, { endpoint: '/workers/start-construction', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al iniciar la construcción' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/map/constructions?minLat=&maxLat=&minLng=&maxLng=
     * Returns active bridge constructions in the viewport for map icon rendering.
     */
    async GetConstructionsInRegion(req, res) {
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
            const h3Cells = Array.from(h3.polygonToCells(polygon, 7)).slice(0, 50000);

            if (h3Cells.length === 0) {
                return res.json({ success: true, constructions: [], current_player_id: req.user.player_id });
            }

            const result = await WorkerModel.GetConstructionsInBounds(h3Cells);
            res.json({ success: true, constructions: result.rows, current_player_id: req.user.player_id });
        } catch (error) {
            Logger.error(error, { endpoint: '/map/constructions', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener construcciones del mapa' });
        }
    }
}

module.exports = new WorkerService();
