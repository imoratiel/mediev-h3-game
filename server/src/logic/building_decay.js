const { Logger } = require('../utils/logger');
const GAME_CONFIG = require('../config/constants');

/**
 * Proceso mensual (día 5) de deterioro de edificios.
 *
 * Reglas activas:
 *  - Si hay un trabajador del propietario en el feudo, Y no hay tropas enemigas (asedio):
 *    el edificio NO se deteriora y gana +1% de conservación.
 *  - DESHABILITADO: deterioro automático (los edificios no pierden conservación por tiempo).
 *  - DESHABILITADO: acceso a piedra como condición de mantenimiento.
 */
async function processBuildingDecay(client, turn, gameDate) {
    const gd = new Date(gameDate);
    if (gd.getDate() !== 5) return;

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

    // ── 2. Deterioro normal — DESHABILITADO ──────────────────────────────────
    // Los edificios sin trabajador ya no pierden conservación automáticamente.
    // const maintainedHexes = maintained.rows.map(r => r.h3_index);
    // const decayed = await client.query(`
    //     UPDATE fief_buildings fb
    //     SET conservation = GREATEST(0, conservation - $1)
    //     WHERE fb.is_under_construction = FALSE
    //       AND fb.conservation > 0
    //       AND fb.h3_index != ALL($2)
    //     RETURNING h3_index, conservation
    // `, [decay, maintainedHexes.length > 0 ? maintainedHexes : ['__none__']]);
    // const newRuins = decayed.rows.filter(r => r.conservation === 0);

    // ── Log ──────────────────────────────────────────────────────────────────
    if (maintained.rowCount > 0) {
        Logger.engine(`[TURN ${turn}] Building decay: ${maintained.rowCount} edificio(s) mantenidos por trabajador (+1%)`);
    }
}

module.exports = { processBuildingDecay };
