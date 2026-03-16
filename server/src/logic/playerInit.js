/**
 * playerInit.js
 *
 * Epic Initialization flow for new players.
 * Runs inside a single atomic transaction:
 *  1. Idempotency guard (FOR UPDATE on players row)
 *  2. Find a free, isolated capital hex (≥10 cells from any occupied territory)
 *  3. Claim capital + BFS-expanded territory (≤30 hexes, bounded by rivers/sea)
 *  4. Create starting army (Milicia x100, Arqueros x50, Caballería Ligera x50)
 *  5. Build completed Cuartel + Fortaleza in the capital
 *  6. Create starting character and assign to army
 *  7. Create initial Señorío (political division) with all claimed hexes
 *  8. Set capital_h3, noble_rank and is_initialized = TRUE
 */

const pool  = require('../../db.js');
const h3    = require('h3-js');
const { Logger } = require('../utils/logger');
const ArmyModel      = require('../models/ArmyModel.js');
const KingdomModel   = require('../models/KingdomModel.js');
const CharacterModel = require('../models/CharacterModel.js');
const DivisionModel  = require('../models/DivisionModel.js');
const MapService     = require('../services/MapService.js');
const { suggestDivisionName } = require('../logic/contiguitySearch.js');
const { getUniqueDivisionName } = require('../logic/NamingService.js');
const { assignCultureByLocation, getStartingTroopsByCulture } = require('../services/PlayerService.js');

const ISOLATION_RADIUS  = 10; // min hex distance from any occupied territory

/**
 * Force-initializes territory_details for a hex during player init.
 * Uses ON CONFLICT DO UPDATE (not DO NOTHING) so pre-existing rows with
 * stale/zero population are overwritten with the correct starting values.
 */
async function upsertTerritoryDetails(client, h3_index, eco) {
    await client.query(`
        INSERT INTO territory_details
            (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, gold_stored)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (h3_index) DO UPDATE SET
            population   = EXCLUDED.population,
            happiness    = EXCLUDED.happiness,
            food_stored  = EXCLUDED.food_stored,
            wood_stored  = EXCLUDED.wood_stored,
            stone_stored = EXCLUDED.stone_stored,
            iron_stored  = EXCLUDED.iron_stored,
            gold_stored  = EXCLUDED.gold_stored
    `, [h3_index, eco.population, eco.happiness, eco.food, eco.wood, eco.stone, 0, eco.gold ?? 0]);
}
// TARGET_HEX_COUNT is read from noble_ranks.max_fiefs_limit (level_order = 2) at runtime
const BFS_MAX_RADIUS    = 7;  // max search radius for BFS expansion

// Terrain type IDs that act as impassable barriers in the BFS
const RIVER_TERRAIN_ID = 4;
const SEA_TERRAIN_ID   = 1;

/**
 * Finds a free colonizable hex that is at least ISOLATION_RADIUS cells away
 * from every currently occupied hex.
 */
async function findIsolatedFreeHex(client, cultureId = null) {
    const occupiedResult = await client.query(
        'SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL'
    );
    const forbidden = new Set();
    for (const hex of occupiedResult.rows.map(r => r.h3_index)) {
        for (const near of h3.gridDisk(hex, ISOLATION_RADIUS)) {
            forbidden.add(near);
        }
    }

    // ── Culture-weighted spawn ───────────────────────────────────────────────
    // If a culture is specified, prefer hexes with high weight for that culture.
    // geo_culture_weights can have overlapping zones so different cultures may
    // share border hexes — this is intentional to allow mixed-culture regions.
    // Falls back to pure random if geo_culture_weights is empty or has no entries
    // for this culture.
    if (cultureId !== null) {
        const weighted = await client.query(`
            SELECT m.h3_index, gcw.weight
            FROM h3_map m
            JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            JOIN geo_culture_weights gcw
                ON gcw.h3_index = m.h3_index AND gcw.culture_id = $1
            WHERE m.player_id IS NULL
              AND t.is_colonizable = TRUE
            ORDER BY RANDOM()
            LIMIT 800
        `, [cultureId]);

        const valid = weighted.rows.filter(r => !forbidden.has(r.h3_index));

        if (valid.length > 0) {
            // Weighted random: hexes in the culture's core zone (high weight)
            // are picked more often than border/overlap zones (low weight).
            const total = valid.reduce((s, r) => s + Number(r.weight), 0);
            let rng = Math.random() * total;
            for (const row of valid) {
                rng -= Number(row.weight);
                if (rng <= 0) return row.h3_index;
            }
            return valid[0].h3_index;
        }
        // No geo weights for this culture — fall through to random
        Logger.action(`[Init] geo_culture_weights vacío para cultura ${cultureId} — spawn aleatorio`, null);
    }

    // ── Pure random spawn (no culture or empty table) ────────────────────────
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
 * BFS expansion from the capital hex.
 * Rivers (RIVER_TERRAIN_ID) and Sea (SEA_TERRAIN_ID) act as impassable walls —
 * the BFS cannot enter them, so the territory naturally stops at these boundaries.
 * Expands outward until TARGET_HEX_COUNT - 1 bonus (non-capital) colonizable hexes
 * are found within BFS_MAX_RADIUS.
 *
 * Returns an array of bonus hex indices (not including the capital).
 * Also returns hexInfo map for name generation later.
 */
async function bfsExpandTerritory(client, capitalHex, targetCount) {
    const allCandidates = h3.gridDisk(capitalHex, BFS_MAX_RADIUS);

    const result = await client.query(`
        SELECT m.h3_index, m.terrain_type_id, m.player_id,
               t.is_colonizable, t.name AS terrain_name
        FROM h3_map m
        JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        WHERE m.h3_index = ANY($1::text[])
    `, [allCandidates]);

    const hexInfo = new Map(result.rows.map(r => [r.h3_index, r]));

    const visited    = new Set([capitalHex]);
    const queue      = [capitalHex];
    const bonusHexes = [];

    while (queue.length > 0 && bonusHexes.length < targetCount - 1) {
        const current = queue.shift();
        const info    = hexInfo.get(current);

        if (!info) continue;

        // Collect as bonus territory: colonizable, unclaimed, not the capital
        if (current !== capitalHex && info.is_colonizable && !info.player_id) {
            bonusHexes.push(current);
        }

        // Rivers and sea are walls: don't expand further from them
        if (info.terrain_type_id === RIVER_TERRAIN_ID ||
            info.terrain_type_id === SEA_TERRAIN_ID) {
            continue;
        }

        // Expand to h3 ring-1 neighbors
        for (const neighbor of h3.gridDisk(current, 1).filter(n => n !== current)) {
            if (!visited.has(neighbor) && hexInfo.has(neighbor)) {
                // Don't enter sea hexes at all (permanent barrier)
                if (hexInfo.get(neighbor).terrain_type_id !== SEA_TERRAIN_ID) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
    }

    return { bonusHexes, hexInfo };
}

/**
 * Main initialization function.
 * Returns { alreadyInitialized: true } if the player was already initialized,
 * or { success: true, capitalHex, allHexes, senorio } on first-time initialization.
 */
async function initializePlayer(player_id, { forceCultureId = null, randomBonus = false } = {}) {
    const client = await pool.connect();
    let divisionId = null;
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

        // ── 0. Fetch target fief count from DB (max_fiefs_limit of Señorío rank) ──
        const senorioRankMeta = await DivisionModel.GetSenorioRank(client);
        const targetFiefCount = senorioRankMeta?.min_fiefs_required ?? 40;

        // ── 1. Find capital hex ──────────────────────────────────────────────
        const capitalHex = await findIsolatedFreeHex(client, forceCultureId);
        if (!capitalHex) {
            throw new Error('No hay feudos disponibles suficientemente alejados. Contacta al administrador.');
        }

        // ── 2. Claim capital hex ─────────────────────────────────────────────
        await client.query(
            'UPDATE h3_map SET player_id = $1, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
            [player_id, capitalHex]
        );
        await upsertTerritoryDetails(client, capitalHex, {
            population: Math.floor(Math.random() * 201) + 400,
            happiness:  Math.floor(Math.random() * 21)  + 60,
            food:       Math.floor(Math.random() * 2001) + 1000,
            wood:       Math.floor(Math.random() * 2001) + 500,
            stone:      Math.floor(Math.random() * 2001) + 500,
            gold:       Math.floor(Math.random() * 501)  + 300,
        });

        // ── 3. BFS expansion: claim up to 29 bonus hexes (total 30) ──────────
        //    Rivers and sea act as barriers; territory stays on one side of them.
        const { bonusHexes, hexInfo } = await bfsExpandTerritory(client, capitalHex, targetFiefCount);

        // Lock rows we're about to claim
        if (bonusHexes.length > 0) {
            await client.query(
                'SELECT 1 FROM h3_map WHERE h3_index = ANY($1::text[]) AND player_id IS NULL FOR UPDATE',
                [bonusHexes]
            );
        }

        for (const hex of bonusHexes) {
            await client.query(
                'UPDATE h3_map SET player_id = $1, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
                [player_id, hex]
            );
            await upsertTerritoryDetails(client, hex, {
                population: Math.floor(Math.random() * 201) + 200,
                happiness:  Math.floor(Math.random() * 21)  + 50,
                food:       Math.floor(Math.random() * 2001),
                wood:       Math.floor(Math.random() * 2001),
                stone:      Math.floor(Math.random() * 2001),
                gold:       Math.floor(Math.random() * 201)  + 50,
            });
        }

        const allHexes = [capitalHex, ...bonusHexes];

        // ── 4. Set capital ───────────────────────────────────────────────────
        await client.query(
            'UPDATE players SET capital_h3 = $1 WHERE player_id = $2',
            [capitalHex, player_id]
        );

        // ── 5. Assign culture ────────────────────────────────────────────────
        // If the player explicitly chose a culture, use it directly.
        // Otherwise fall back to geo-weight lookup, then random.
        let cultureId = forceCultureId ?? assignCultureByLocation(capitalHex);

        if (!cultureId) {
            const fallback = await client.query(
                'SELECT id FROM cultures ORDER BY RANDOM() LIMIT 1'
            );
            cultureId = fallback.rows[0]?.id ?? null;
            if (cultureId) Logger.action(`[Init] No geo weight for ${capitalHex} — random culture assigned: ${cultureId}`, player_id);
        }

        const troopMultiplier = randomBonus ? 2 : 1;
        const startingTroopsBase = getStartingTroopsByCulture(cultureId);
        const startingTroops = startingTroopsBase.map(t => ({ ...t, quantity: t.quantity * troopMultiplier }));

        if (cultureId) {
            await client.query(
                'UPDATE players SET culture_id = $1 WHERE player_id = $2',
                [cultureId, player_id]
            );
        }

        // ── 6. Create starting army ──────────────────────────────────────────
        const armyResult = await ArmyModel.CreateArmy(
            client, 'Guardia del Señor', player_id, capitalHex, false
        );
        const armyId = armyResult.rows[0].army_id;

        for (const troop of startingTroops) {
            await ArmyModel.AddTroops(client, armyId, troop.unit_type_id, troop.quantity);
        }
        await ArmyModel.refreshDetectionRange(client, armyId);

        // ── 7. Build completed Fortaleza in capital ───────────────────────────
        // Fortaleza satisfies both the military-building check (recruitment) and
        // the HasFortress check (required to proclaim a Señorío).
        // fief_buildings uses h3_index as PK, so only one building per hex.
        const fortressResult = await client.query(
            "SELECT id FROM buildings WHERE LOWER(name) IN ('fortaleza', 'fortress') LIMIT 1"
        );
        const fortressId = fortressResult.rows[0]?.id;

        if (fortressId) {
            await client.query(
                `INSERT INTO fief_buildings (h3_index, building_id, remaining_construction_turns, is_under_construction)
                 VALUES ($1, $2, 0, FALSE)
                 ON CONFLICT (h3_index) DO UPDATE
                   SET building_id = EXCLUDED.building_id,
                       remaining_construction_turns = 0,
                       is_under_construction = FALSE`,
                [capitalHex, fortressId]
            );
        } else {
            // Fallback: build barracks if no fortaleza exists in DB
            const barracksResult = await client.query(
                "SELECT id FROM buildings WHERE LOWER(name) IN ('cuartel', 'barracks') LIMIT 1"
            );
            if (barracksResult.rows.length > 0) {
                await client.query(
                    `INSERT INTO fief_buildings (h3_index, building_id, remaining_construction_turns, is_under_construction)
                     VALUES ($1, $2, 0, FALSE)
                     ON CONFLICT DO NOTHING`,
                    [capitalHex, barracksResult.rows[0].id]
                );
            }
        }

        // ── 8. Create starting character and assign to army ──────────────────
        const playerResult = await client.query(
            'SELECT username FROM players WHERE player_id = $1',
            [player_id]
        );
        const username = playerResult.rows[0]?.username ?? 'Señor';
        const character = await CharacterModel.create(client, {
            player_id,
            name:               username,
            age:                25,
            health:             100,
            level:              1,
            personal_guard:     25,
            is_main_character:  true,
            is_heir:            false,
            h3_index:           capitalHex,
        });
        await CharacterModel.assignToArmy(client, character.id, armyId);

        // ── 9. Create initial Señorío ────────────────────────────────────────
        let senorioName = null;
        if (allHexes.length >= (senorioRankMeta?.min_fiefs_required ?? 30)) {
            const senorioRank = senorioRankMeta;
            if (senorioRank) {
                // Gather terrain names from hexInfo for name generation
                const fiefsForName = allHexes
                    .map(h => hexInfo.get(h))
                    .filter(Boolean)
                    .map(info => ({ terrain_name: info.terrain_name }));

                const baseName     = suggestDivisionName(fiefsForName, senorioRank.territory_name);
                const divisionName = await getUniqueDivisionName(client, baseName, player_id);

                const division = await DivisionModel.CreateDivision(client, {
                    player_id,
                    name:          divisionName,
                    noble_rank_id: senorioRank.id,
                    capital_h3:    capitalHex,
                });

                if (division) {
                    divisionId  = division.id;
                    senorioName = divisionName;
                    await DivisionModel.AssignFiefsToDivision(client, division.id, allHexes);
                    // Promote player to Señor rank
                    await client.query(
                        'UPDATE players SET noble_rank_id = $1 WHERE player_id = $2',
                        [senorioRank.id, player_id]
                    );
                }
            }
        }

        // ── 10. Mark player as initialized and set starting gold ─────────────
        const startingGold = randomBonus ? 200000 : 100000;
        await client.query(
            'UPDATE players SET is_initialized = TRUE, gold = $1 WHERE player_id = $2',
            [startingGold, player_id]
        );

        await client.query('COMMIT');

        // Pre-calculate señorío boundary (pure h3 computation, runs after COMMIT)
        if (divisionId) {
            await MapService.generateDivisionBoundary(divisionId);
        }

        return { success: true, capitalHex, allHexes, senorioName };

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { initializePlayer };
