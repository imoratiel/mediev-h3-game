const { Logger } = require('../utils/logger');
const GAME_CONFIG = require('../config/constants');

/**
 * Proceso mensual (día 5) de deterioro de edificios.
 *
 * Reglas:
 *  - Si hay un trabajador del propietario en el feudo Y no hay tropas enemigas
 *    (asedio): el edificio NO se deteriora y gana +1% de conservación.
 *  - En cualquier otro caso: pierde CONSERVATION_DECAY_PERCENT % de conservación.
 *  - Al llegar a 0% el edificio queda "En Ruinas" (no se destruye).
 *  - Un trabajador puede recuperar un edificio en ruinas (+1%/ciclo).
 */
async function processBuildingDecay(client, turn, gameDate) {
    const gd = new Date(gameDate);
    if (gd.getDate() !== 5) return;

    const decay = GAME_CONFIG.BUILDINGS.CONSERVATION_DECAY_PERCENT;

    // ── 1. Mantenimiento por trabajador (sin asedio) ─────────────────────────
    // El edificio recupera +1%, incluso si está en ruinas (conservation = 0).
    const maintained = await client.query(`
        UPDATE fief_buildings fb
        SET conservation = LEAST(100, conservation + 1)
        FROM h3_map m
        WHERE m.h3_index = fb.h3_index
          AND fb.is_under_construction = FALSE
          AND EXISTS (
              SELECT 1 FROM workers w
              WHERE w.h3_index = fb.h3_index
                AND w.player_id = m.player_id
                AND w.transported_by IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM armies a
              WHERE a.h3_index = fb.h3_index
                AND a.player_id != m.player_id
                AND a.is_naval = FALSE
          )
        RETURNING fb.h3_index
    `);

    // ── 2. Deterioro normal (sin trabajador o bajo asedio) ───────────────────
    // Solo en edificios con conservation > 0 (las ruinas ya están a 0).
    const maintainedHexes = maintained.rows.map(r => r.h3_index);

    const decayed = await client.query(`
        UPDATE fief_buildings fb
        SET conservation = GREATEST(0, conservation - $1)
        WHERE fb.is_under_construction = FALSE
          AND fb.conservation > 0
          AND fb.h3_index != ALL($2)
        RETURNING h3_index, conservation
    `, [decay, maintainedHexes.length > 0 ? maintainedHexes : ['__none__']]);

    const newRuins = decayed.rows.filter(r => r.conservation === 0);

    // ── Log ──────────────────────────────────────────────────────────────────
    if (newRuins.length > 0) {
        Logger.engine(`[TURN ${turn}] Building decay: ${newRuins.length} edificio(s) en ruinas (${newRuins.map(r => r.h3_index).join(', ')})`);
    }
    if (maintained.rowCount > 0) {
        Logger.engine(`[TURN ${turn}] Building decay: ${maintained.rowCount} edificio(s) mantenidos por trabajadores (+1%)`);
    }
    Logger.engine(`[TURN ${turn}] Building decay: -${decay}% aplicado a ${decayed.rowCount} edificios`);
}

module.exports = { processBuildingDecay };
