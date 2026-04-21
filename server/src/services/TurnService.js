const { Logger } = require('../utils/logger');
const cache = require('./CacheService.js');
const WorldStateModel = require('../models/TurnModel.js');
const AdminModel = require('../models/AdminModel.js');
const pool = require('../../db.js');
const { CONFIG } = require('../config.js');
const {
    processGameTurn,
    processHarvestManually,
    processExplorationsManually,
    startTimeEngine,
    stopTimeEngine,
    restartEngine,
    isEngineActive,
    getEngineInfo,
} = require('../logic/turn_engine');

class TurnService {
    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC (non-admin)
    // ─────────────────────────────────────────────────────────────────────
    async GetWorldState(req, res) {
        const CACHE_KEY = 'world_state';
        const cached = cache.get(CACHE_KEY);
        if (cached) return res.json(cached);
        try {
            const state = await WorldStateModel.GetWorldState();
            const payload = {
                success: true,
                turn: state.current_turn,
                date: { day: state.day, month: state.month, year: state.year, era: state.era },
                is_paused: state.is_paused,
                is_processing: state.is_processing ?? false,
            };
            // No cachear si el turno está procesando (estado muy transitorio)
            if (!payload.is_processing) cache.set(CACHE_KEY, payload, 3_000);
            res.json(payload);
        } catch (error) {
            Logger.error(error, { endpoint: '/game/world-state', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN — ENGINE STATUS
    // ─────────────────────────────────────────────────────────────────────
    async GetGlobalStatus(req, res) {
        try {
            const state = await WorldStateModel.GetCurrentTurn();
            const engineInfo = getEngineInfo();
            const turnDurationSeconds = CONFIG.gameplay?.turn_duration_seconds || 60;

            Logger.action(`Admin consulta estado del motor`, req.user.player_id);
            res.json({
                success: true,
                engine: {
                    isRunning: isEngineActive(),
                    startTime: engineInfo.startTime,
                    uptimeMs: engineInfo.uptimeMs,
                },
                game: {
                    isPaused: state.is_paused,
                    currentTurn: state.current_turn,
                    lastUpdated: state.last_updated,
                },
                config: {
                    turnDurationSeconds,
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/status', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener estado del motor' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN — PROCESS STATUS (comprehensive monitor)
    // ─────────────────────────────────────────────────────────────────────
    async GetProcessStatus(req, res) {
        try {
            const state = await WorldStateModel.GetCurrentTurn();
            const engineInfo = getEngineInfo();
            const turnDurationSeconds = CONFIG.gameplay?.turn_duration_seconds || 60;
            const turnDurationMs = turnDurationSeconds * 1000;

            // Time since last turn and estimated time to next
            const lastTurnAt = state.last_updated ? new Date(state.last_updated) : null;
            const timeSinceLastMs = lastTurnAt ? Date.now() - lastTurnAt.getTime() : null;
            const nextTurnInMs = (isEngineActive() && !state.is_paused && timeSinceLastMs !== null)
                ? Math.max(0, turnDurationMs - timeSinceLastMs)
                : null;

            const engineRunning = isEngineActive();
            const gamePaused = state.is_paused;

            res.json({
                success: true,
                processes: [
                    {
                        id: 'turn_engine',
                        name: 'Motor de Turnos',
                        description: 'Bucle principal que procesa cada turno del juego',
                        status: engineRunning ? (gamePaused ? 'paused' : 'active') : 'stopped',
                        startTime: engineInfo.startTime,
                        uptimeMs: engineInfo.uptimeMs,
                    },
                    {
                        id: 'army_movement',
                        name: 'Movimiento de Ejércitos',
                        description: 'Procesa rutas y combate automático cada turno',
                        status: engineRunning && !gamePaused ? 'active' : 'inactive',
                    },
                ],
                game: {
                    isPaused: gamePaused,
                    currentTurn: state.current_turn,
                    lastTurnAt,
                    nextTurnInMs,
                    turnDurationSeconds,
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/process-status', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener estado de procesos' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN — ENGINE LIFECYCLE (start / stop)
    // ─────────────────────────────────────────────────────────────────────
    async StartEngine(req, res) {
        try {
            if (isEngineActive()) {
                return res.json({ success: true, message: 'El motor ya está en ejecución.' });
            }
            // Use startTimeEngine directly so it works even after a cold start
            // where _enginePool/_engineConfig were never set (engine_auto_start=false).
            startTimeEngine(pool, CONFIG);
            // Persist so the engine auto-starts on next container restart
            await AdminModel.UpsertConfig('system', 'engine_auto_start', 'true');
            if (!CONFIG.system) CONFIG.system = {};
            CONFIG.system.engine_auto_start = true;

            Logger.action(`Motor de turnos iniciado por admin ${req.user.player_id}`, req.user.player_id);
            res.json({ success: true, message: 'Motor de turnos iniciado correctamente.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/start', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al iniciar el motor' });
        }
    }

    async StopEngine(req, res) {
        try {
            if (!isEngineActive()) {
                return res.json({ success: true, message: 'El motor ya está detenido.' });
            }
            stopTimeEngine();
            // Persist so the engine does NOT auto-start on next container restart
            await AdminModel.UpsertConfig('system', 'engine_auto_start', 'false');
            if (!CONFIG.system) CONFIG.system = {};
            CONFIG.system.engine_auto_start = false;

            Logger.action(`Motor de turnos detenido por admin ${req.user.player_id}`, req.user.player_id);
            res.json({ success: true, message: 'Motor de turnos detenido correctamente.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/stop', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al detener el motor' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN — GAME PAUSE / RESUME (pauses logic, engine loop keeps ticking)
    // ─────────────────────────────────────────────────────────────────────
    async SetGamePaused(req, res) {
        try {
            await WorldStateModel.SetGamePaused();
            Logger.action(`Juego pausado por admin ${req.user.player_id}`, req.user.player_id);
            res.json({ success: true, message: 'Juego pausado. El motor sigue activo pero no procesará turnos.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/pause', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al pausar el juego' });
        }
    }

    async SetGameResumed(req, res) {
        try {
            await WorldStateModel.SetGameResumed();
            Logger.action(`Juego reanudado por admin ${req.user.player_id}`, req.user.player_id);
            res.json({ success: true, message: 'Juego reanudado. El motor procesará el siguiente turno.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/resume', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al reanudar el juego' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN — FORCE OPERATIONS
    // ─────────────────────────────────────────────────────────────────────
    async ForceGameTurn(req, res) {
        try {
            Logger.action(`Admin ${req.user.player_id} fuerza procesamiento de turno`, req.user.player_id);
            const result = await processGameTurn(pool, CONFIG);

            if (result.paused) {
                return res.status(400).json({
                    success: false,
                    message: 'No se puede forzar turno: el juego está pausado. Usa /admin/engine/resume primero.'
                });
            }
            if (result.success) {
                Logger.action(`Turno forzado exitosamente: turno ${result.turn}`, req.user.player_id);
                res.json({ success: true, message: `Turno ${result.turn} procesado`, turn: result.turn, date: result.date });
            } else {
                res.status(500).json({ success: false, message: 'Error al procesar turno forzado' });
            }
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/force-turn', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de turno' });
        }
    }

    async ForceGameHarvest(req, res) {
        try {
            Logger.action(`Admin ${req.user.player_id} fuerza cosecha`, req.user.player_id);
            const state = await WorldStateModel.GetCurrentTurn();
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await processHarvestManually(client, state.current_turn, CONFIG);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
            Logger.action(`Cosecha forzada en turno ${state.current_turn}`, req.user.player_id);
            res.json({ success: true, message: `Cosecha procesada en turno ${state.current_turn}`, turn: state.current_turn });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/force-harvest', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al forzar cosecha' });
        }
    }

    async ForceGameExploration(req, res) {
        try {
            Logger.action(`Admin ${req.user.player_id} fuerza exploraciones`, req.user.player_id);
            const state = await WorldStateModel.GetCurrentTurn();
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await processExplorationsManually(client, state.current_turn, CONFIG);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
            Logger.action(`Exploraciones forzadas en turno ${state.current_turn}`, req.user.player_id);
            res.json({ success: true, message: `Exploraciones procesadas en turno ${state.current_turn}`, turn: state.current_turn });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/engine/force-exploration', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al forzar exploraciones' });
        }
    }
}

module.exports = new TurnService();
