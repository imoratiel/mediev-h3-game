'use strict';

/**
 * rateLimiter.js
 *
 * Ventana deslizante en memoria para limitar peticiones por jugador (o IP en endpoints públicos).
 * Usa CacheService como backend de contadores.
 *
 * Categorías:
 *   AUTH           — login: 5 intentos / 60s (por IP)
 *   READ_FAST      — world-state, economy summary: 30 req / 10s (por jugador)
 *   WRITE_NORMAL   — construct, workers, economy settings: 10 req / 60s
 *   WRITE_MILITARY — recruit, move, merge, dismiss, reinforce: 8 req / 60s
 *   WRITE_CONQUER  — conquer, claim: 4 req / 60s
 */

const cache = require('../services/CacheService.js');

const LIMITS = {
    AUTH:           { max: 5,  windowMs: 60_000 },
    READ_FAST:      { max: 30, windowMs: 10_000 },
    WRITE_NORMAL:   { max: 10, windowMs: 60_000 },
    WRITE_MILITARY: { max: 8,  windowMs: 60_000 },
    WRITE_CONQUER:  { max: 4,  windowMs: 60_000 },
};

/**
 * Sliding-window counter backed by CacheService.
 * Returns true if the request is within limits, false if it should be blocked.
 */
function checkLimit(category, identifier) {
    const { max, windowMs } = LIMITS[category];
    const key    = `rl:${category}:${identifier}`;
    const now    = Date.now();
    const entry  = cache.get(key) || { hits: [], resetAt: now + windowMs };

    // Evict timestamps outside the window
    const cutoff = now - windowMs;
    entry.hits = entry.hits.filter(ts => ts > cutoff);
    entry.hits.push(now);

    // Always refresh TTL so the key stays alive during activity
    cache.set(key, entry, windowMs);

    return entry.hits.length <= max;
}

/**
 * Returns remaining requests allowed and window reset time.
 */
function getRateLimitHeaders(category, identifier) {
    const { max, windowMs } = LIMITS[category];
    const key   = `rl:${category}:${identifier}`;
    const entry = cache.get(key);
    if (!entry) return { remaining: max, resetMs: windowMs };
    const cutoff = Date.now() - windowMs;
    const active = (entry.hits || []).filter(ts => ts > cutoff).length;
    return {
        remaining: Math.max(0, max - active),
        resetMs:   windowMs,
    };
}

// ── Middleware factories ───────────────────────────────────────────────────────

/**
 * Rate limit by player_id (requires authenticateToken to run first).
 * @param {string} category
 */
function byPlayer(category) {
    return (req, res, next) => {
        const id = req.user?.player_id;
        if (!id) return next(); // sin auth, no aplica aquí
        if (checkLimit(category, id)) return next();
        const { remaining, resetMs } = getRateLimitHeaders(category, id);
        res.set('Retry-After', Math.ceil(resetMs / 1000));
        res.set('X-RateLimit-Remaining', remaining);
        return res.status(429).json({ success: false, message: 'Demasiadas peticiones. Espera un momento antes de continuar.' });
    };
}

/**
 * Rate limit by IP (for unauthenticated endpoints like login).
 * @param {string} category
 */
function byIp(category) {
    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        if (checkLimit(category, ip)) return next();
        res.set('Retry-After', Math.ceil(LIMITS[category].windowMs / 1000));
        return res.status(429).json({ success: false, message: 'Demasiados intentos. Espera antes de volver a intentarlo.' });
    };
}

module.exports = { byPlayer, byIp, LIMITS };
