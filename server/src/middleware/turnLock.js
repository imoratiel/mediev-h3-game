'use strict';

/**
 * turnLock.js
 *
 * Middleware que rechaza acciones de escritura mientras se procesa un turno.
 * Solo bloquea métodos mutantes (POST, PUT, PATCH, DELETE).
 * GET queda libre para que el frontend siga leyendo el estado del mapa.
 *
 * Uso en api.js:
 *   const { requireTurnUnlocked } = require('../src/middleware/turnLock');
 *   router.post('/game/claim', authenticateToken, requireTurnUnlocked, ...);
 */

const pool = require('../../db.js');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function requireTurnUnlocked(req, res, next) {
    // Lecturas nunca bloqueadas
    if (SAFE_METHODS.has(req.method)) return next();

    try {
        const result = await pool.query('SELECT is_processing FROM world_state WHERE id = 1');
        if (result.rows[0]?.is_processing === true) {
            return res.status(503).json({
                success: false,
                turn_processing: true,
                message: 'El servidor está calculando el turno. Inténtalo en unos segundos.',
            });
        }
        next();
    } catch (err) {
        // Si falla la consulta, dejamos pasar (fail-open) para no romper el juego
        next();
    }
}

module.exports = { requireTurnUnlocked };
