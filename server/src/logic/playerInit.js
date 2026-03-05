/**
 * playerInit.js
 *
 * Epic Initialization flow for new players.
 * Runs inside a single atomic transaction:
 *  1. Idempotency guard (FOR UPDATE on players row)
 *  2. Find a free, isolated capital hex (≥10 cells from any occupied territory)
 *  3. Claim capital + ring-1 colonizable neighbors
 *  4. Create starting army (Milicia x100, Arqueros x50, Caballería Ligera x50)
 *  5. Build a completed Barracks (Cuartel) in the capital
 *  6. Set capital_h3 and is_initialized = TRUE
 */

const pool  = require('../../db.js');
const h3    = require('h3-js');
const ArmyModel    = require('../models/ArmyModel.js');
const KingdomModel = require('../models/KingdomModel.js');

const ISOLATION_RADIUS = 10; // min hex distance from any occupied territory

/**
 * Finds a free colonizable hex that is at least ISOLATION_RADIUS cells away
 * from every currently occupied hex.
 *
 * Strategy (JS-side, no custom SQL function needed):
 *  1. Load all occupied h3_index values from DB.
 *  2. Build a forbidden Set by expanding each occupied hex with gridDisk(radius).
 *  3. Fetch up to 500 random free colonizable hexes from DB.
 *  4. Return the first one not in the forbidden Set.
 */
async function findIsolatedFreeHex(client) {
    const occupiedResult = await client.query(
        'SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL'
    );
    const occupiedHexes = occupiedResult.rows.map(r => r.h3_index);

    const forbidden = new Set();
    for (const hex of occupiedHexes) {
        for (const near of h3.gridDisk(hex, ISOLATION_RADIUS)) {
            forbidden.add(near);
        }
    }

    const candidatesResult = await client.query(`
        SELECT m.h3_index
        FROM h3_map m
        JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        WHERE m.player_id IS NULL
          AND t.is_colonizable = TRUE
        ORDER BY RANDOM()
        LIMIT 500
    `);

    for (const row of candidatesResult.rows) {
        if (!forbidden.has(row.h3_index)) return row.h3_index;
    }
    return null;
}

/**
 * Main initialization function.
 * Returns { alreadyInitialized: true } if the player was already initialized,
 * or { success: true, capitalHex, bonusHexes } on first-time initialization.
 */
async function initializePlayer(player_id) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── Idempotency guard ────────────────────────────────────────────────
        const guardResult = await client.query(
            'SELECT is_initialized FROM players WHERE player_id = $1 FOR UPDATE',
            [player_id]
        );
        if (guardResult.rows[0]?.is_initialized) {
            await client.query('ROLLBACK');
            return { alreadyInitialized: true };
        }

        // ── 1. Find capital hex ──────────────────────────────────────────────
        const capitalHex = await findIsolatedFreeHex(client);
        if (!capitalHex) {
            throw new Error('No hay feudos disponibles suficientemente alejados. Contacta al administrador.');
        }

        // ── 2. Claim capital hex ─────────────────────────────────────────────
        await client.query(
            'UPDATE h3_map SET player_id = $1, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
            [player_id, capitalHex]
        );
        await KingdomModel.InsertTerritoryDetails(client, capitalHex, {
            population: Math.floor(Math.random() * 201) + 400,
            happiness:  Math.floor(Math.random() * 21)  + 60,
            food:       Math.floor(Math.random() * 2001) + 1000,
            wood:       Math.floor(Math.random() * 2001) + 500,
            stone:      Math.floor(Math.random() * 2001) + 500,
            gold:       Math.floor(Math.random() * 501)  + 300,
        });

        // ── 3. Claim ring-1 colonizable neighbors ────────────────────────────
        const ring1 = h3.gridDisk(capitalHex, 1).filter(n => n !== capitalHex);
        const neighborsResult = await client.query(`
            SELECT m.h3_index
            FROM h3_map m
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            WHERE m.h3_index = ANY($1::text[])
              AND m.player_id IS NULL
              AND t.is_colonizable = TRUE
            FOR UPDATE OF m
        `, [ring1]);

        const bonusHexes = [];
        for (const row of neighborsResult.rows) {
            await client.query(
                'UPDATE h3_map SET player_id = $1, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
                [player_id, row.h3_index]
            );
            await KingdomModel.InsertTerritoryDetails(client, row.h3_index, {
                population: Math.floor(Math.random() * 201) + 200,
                happiness:  Math.floor(Math.random() * 21)  + 50,
                food:       Math.floor(Math.random() * 2001),
                wood:       Math.floor(Math.random() * 2001),
                stone:      Math.floor(Math.random() * 2001),
                gold:       Math.floor(Math.random() * 201)  + 50,
            });
            bonusHexes.push(row.h3_index);
        }

        // ── 4. Set capital ───────────────────────────────────────────────────
        await client.query(
            'UPDATE players SET capital_h3 = $1 WHERE player_id = $2',
            [capitalHex, player_id]
        );

        // ── 5. Resolve unit type IDs by name ─────────────────────────────────
        const unitTypesResult = await client.query(
            "SELECT unit_type_id, name FROM unit_types WHERE name IN ('Milicia', 'Arqueros', 'Caballería Ligera')"
        );
        const unitMap = {};
        for (const row of unitTypesResult.rows) unitMap[row.name] = row.unit_type_id;

        if (!unitMap['Milicia'] || !unitMap['Arqueros'] || !unitMap['Caballería Ligera']) {
            throw new Error('Tipos de unidad iniciales no encontrados. Verifica la tabla unit_types.');
        }

        // ── 6. Create starting army ──────────────────────────────────────────
        const armyResult = await ArmyModel.CreateArmy(
            client, 'Guardia del Señor', player_id, capitalHex, false
        );
        const armyId = armyResult.rows[0].army_id;

        await ArmyModel.AddTroops(client, armyId, unitMap['Milicia'],            100);
        await ArmyModel.AddTroops(client, armyId, unitMap['Arqueros'],           50);
        await ArmyModel.AddTroops(client, armyId, unitMap['Caballería Ligera'],  50);
        await ArmyModel.refreshDetectionRange(client, armyId);

        // ── 7. Build completed Barracks in capital ───────────────────────────
        const barracksResult = await client.query(
            "SELECT id FROM buildings WHERE LOWER(name) IN ('cuartel', 'barracks') LIMIT 1"
        );
        if (barracksResult.rows.length > 0) {
            await client.query(
                `INSERT INTO fief_buildings (h3_index, building_id, remaining_construction_turns, is_under_construction)
                 VALUES ($1, $2, 0, FALSE)`,
                [capitalHex, barracksResult.rows[0].id]
            );
        }

        // ── 8. Mark player as initialized ────────────────────────────────────
        await client.query(
            'UPDATE players SET is_initialized = TRUE WHERE player_id = $1',
            [player_id]
        );

        await client.query('COMMIT');
        return { success: true, capitalHex, bonusHexes };

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { initializePlayer };
