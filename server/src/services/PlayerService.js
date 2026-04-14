const pool   = require('../../db.js');
const { Logger } = require('../utils/logger');
const PlayerModel = require('../models/PlayerModel.js');
const GAME_CONFIG = require('../config/constants.js');

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache: Map<h3_index, Array<{ culture_id: number, weight: number }>>
// Loaded once at server start via loadGeoCultureCache().
// ─────────────────────────────────────────────────────────────────────────────
let _geoCultureCache = null;

/**
 * Loads geo_culture_weights into memory.
 * Call once during server startup (app.js / index.js).
 */
async function loadGeoCultureCache() {
    try {
        const result = await pool.query(
            'SELECT h3_index, culture_id, weight FROM geo_culture_weights'
        );
        _geoCultureCache = new Map();
        for (const row of result.rows) {
            if (!_geoCultureCache.has(row.h3_index)) {
                _geoCultureCache.set(row.h3_index, []);
            }
            _geoCultureCache.get(row.h3_index).push({
                culture_id: row.culture_id,
                weight:     parseInt(row.weight, 10),
            });
        }
        Logger.engine(`[CultureCache] ${result.rows.length} pesos cargados para ${_geoCultureCache.size} hexágonos`);
    } catch (error) {
        Logger.error(error, { context: 'PlayerService.loadGeoCultureCache' });
        _geoCultureCache = new Map(); // Empty cache — non-fatal
    }
}

/**
 * Forces a cache reload (useful after admin edits to geo_culture_weights).
 */
async function reloadGeoCultureCache() {
    _geoCultureCache = null;
    await loadGeoCultureCache();
}

// ─────────────────────────────────────────────────────────────────────────────
// CULTURA POR LOCALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a culture_id for the given h3Index using weighted random selection.
 *
 * - If the cache has no entry for this hex, returns null (caller decides default).
 * - If there is only one entry, returns it immediately (no RNG needed).
 * - If multiple entries, picks one proportionally to their weight.
 *
 * @param {string} h3Index
 * @returns {number|null} culture_id or null
 */
function assignCultureByLocation(h3Index) {
    if (!_geoCultureCache) {
        Logger.error(new Error('CultureCache not loaded'), { context: 'assignCultureByLocation', h3Index });
        return null;
    }

    const entries = _geoCultureCache.get(h3Index);
    if (!entries || entries.length === 0) return null;
    if (entries.length === 1) return entries[0].culture_id;

    // Weighted random — O(n) walk
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    let rng = Math.random() * totalWeight;
    for (const entry of entries) {
        rng -= entry.weight;
        if (rng <= 0) return entry.culture_id;
    }
    // Floating-point safety fallback
    return entries[entries.length - 1].culture_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// TROPAS DE INICIO POR CULTURA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the starting troop list for a culture from GAME_CONFIG.STARTING_TROOPS.
 * Each entry: { unit_type_id, quantity }
 *
 * Falls back to culture 1 (Roma) if the culture has no entry configured.
 *
 * @param {number|null} cultureId
 * @returns {Array<{ unit_type_id, quantity }>}
 */
function getStartingTroopsByCulture(cultureId) {
    const troops = GAME_CONFIG.STARTING_TROOPS[cultureId];
    if (troops && troops.length > 0) return troops;

    // Fallback to Roma if culture not found in constants
    Logger.action(`[PlayerService] No starting troops config for culture ${cultureId} — falling back to Roma`, null);
    return GAME_CONFIG.STARTING_TROOPS[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

class PlayerService {
    async GetById(req, res) {
        try {
            const player = await PlayerModel.GetById(req.params.id);
            if (!player) return res.status(404).json({ error: 'Player not found' });
            res.json(player);
        } catch (error) {
            Logger.error(error, { endpoint: '/players/:id', method: 'GET', userId: req.params?.id });
            res.status(500).json({ error: 'Error al obtener jugador' });
        }
    }

    /**
     * GET /api/players/search?q=texto
     * Busca jugadores por display_name o username (parcial, máx 10 resultados).
     * Excluye al propio jugador si está autenticado.
     */
    async Search(req, res) {
        const q      = (req.query.q ?? '').trim();
        const selfId = req.user?.player_id ?? null;
        // q vacío → devuelve todos (usado para precarga de autocomplete)
        // q < 2 caracteres y no vacío → sin resultados
        if (q.length > 0 && q.length < 2) return res.json({ players: [] });
        try {
            const result = await pool.query(`
                SELECT p.player_id,
                       COALESCE(p.display_name, p.username) AS name,
                       nr.title_male AS rank_title
                FROM players p
                LEFT JOIN noble_ranks nr ON nr.id = p.noble_rank_id
                WHERE p.is_ai = FALSE
                  AND (p.is_exiled IS NULL OR p.is_exiled = FALSE)
                  AND ($1 = '' OR LOWER(p.display_name) LIKE '%' || $1 || '%')
                  AND ($2::int IS NULL OR p.player_id <> $2)
                ORDER BY p.display_name
                LIMIT 50
            `, [q.toLowerCase(), selfId]);
            res.json({ players: result.rows });
        } catch (error) {
            Logger.error(error, { endpoint: '/players/search', q });
            res.status(500).json({ error: 'Error en la búsqueda' });
        }
    }

    /**
     * GET /api/players/culture-cache/reload  (admin only)
     * Forces a cache reload without restarting the server.
     */
    async ReloadCultureCache(req, res) {
        try {
            await reloadGeoCultureCache();
            res.json({ success: true, message: 'Caché de culturas recargada' });
        } catch (error) {
            Logger.error(error, { endpoint: 'culture-cache/reload' });
            res.status(500).json({ error: 'Error al recargar caché' });
        }
    }
}

module.exports = new PlayerService();
module.exports.loadGeoCultureCache    = loadGeoCultureCache;
module.exports.reloadGeoCultureCache  = reloadGeoCultureCache;
module.exports.assignCultureByLocation = assignCultureByLocation;
module.exports.getStartingTroopsByCulture = getStartingTroopsByCulture;
