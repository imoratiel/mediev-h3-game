const pool = require('../../db.js');
const h3   = require('h3-js');
const NavalModel = require('../models/NavalModel.js');
const ArmyModel = require('../models/ArmyModel.js');
const ArmySimulationService = require('./ArmySimulationService.js');
const { getFleetLimit } = require('../config/gameFunctions.js');
const { generateFleetName } = require('../config/fleetNames.js');
const { Logger } = require('../utils/logger.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Splits a troops array so that `slots` capacity is filled proportionally.
 * Priority order within the slots is preserved by unit (largest remainder method).
 *
 * @param {{ unit_type_id, quantity, experience, morale, last_fed_turn, stamina, force_rest }[]} troops
 * @param {number} slots - available capacity for troops
 * @returns {{ embarked: typeof troops, leftover: typeof troops }}
 */
function _splitTroopsProportionally(troops, slots) {
    const total = troops.reduce((s, t) => s + t.quantity, 0);
    if (slots >= total) return { embarked: troops.map(t => ({ ...t })), leftover: [] };
    if (slots <= 0)     return { embarked: [], leftover: troops.map(t => ({ ...t })) };

    const ratio = slots / total;
    // Floor pass
    const items = troops.map(t => ({
        ...t,
        eq: Math.floor(t.quantity * ratio),
        frac: (t.quantity * ratio) % 1,
    }));

    let allocated = items.reduce((s, t) => s + t.eq, 0);
    let remainder = slots - allocated;

    // Distribute remaining slots by largest fractional part
    items.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < items.length && remainder > 0; i++) {
        items[i].eq++;
        remainder--;
    }
    // Restore original order
    items.sort((a, b) => a.unit_type_id - b.unit_type_id);

    const embarked = [];
    const leftover = [];
    for (const t of items) {
        const lq = t.quantity - t.eq;
        if (t.eq > 0) embarked.push({ unit_type_id: t.unit_type_id, quantity: t.eq,
            experience: t.experience, morale: t.morale, last_fed_turn: t.last_fed_turn,
            stamina: t.stamina, force_rest: t.force_rest });
        if (lq > 0)   leftover.push({ unit_type_id: t.unit_type_id, quantity: lq,
            experience: t.experience, morale: t.morale, last_fed_turn: t.last_fed_turn,
            stamina: t.stamina, force_rest: t.force_rest });
    }
    return { embarked, leftover };
}

async function _getPlayerCulture(player_id) {
    const r = await pool.query('SELECT culture_id FROM players WHERE player_id = $1', [player_id]);
    return r.rows[0]?.culture_id ?? 1;
}

async function _checkPortAtHex(client, h3_index, player_id) {
    const r = await client.query(`
        SELECT 1
        FROM fief_buildings fb
        JOIN buildings      b  ON fb.building_id = b.id
        JOIN building_types bt ON b.type_id = bt.building_type_id
        JOIN h3_map         m  ON fb.h3_index = m.h3_index
        WHERE fb.h3_index = $1
          AND bt.name = 'maritime'
          AND m.player_id = $2
          AND fb.is_under_construction = FALSE
    `, [h3_index, player_id]);
    return r.rows.length > 0;
}

// ── Service ───────────────────────────────────────────────────────────────────

class NavalService {

    // ── GET /naval/ship-types ─────────────────────────────────────────────────

    async GetShipTypes(req, res) {
        try {
            const culture_id = await _getPlayerCulture(req.user.player_id);
            const types = await NavalModel.GetShipTypesByCulture(culture_id);
            res.json({ success: true, ship_types: types });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/ship-types', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener tipos de barcos.' });
        }
    }

    // ── GET /naval/fleets ─────────────────────────────────────────────────────

    async GetFleets(req, res) {
        const client = await pool.connect();
        try {
            const fleets = await NavalModel.GetPlayerFleets(client, req.user.player_id);
            res.json({ success: true, fleets });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/fleets', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener flotas.' });
        } finally { client.release(); }
    }

    // ── GET /naval/fleets/:id ─────────────────────────────────────────────────

    async GetFleetDetail(req, res) {
        const client = await pool.connect();
        try {
            const fleet_id  = parseInt(req.params.id, 10);
            const player_id = req.user.player_id;

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) return res.status(404).json({ success: false, message: 'Flota no encontrada.' });

            const detail = await NavalModel.GetFleetById(client, fleet_id);
            const cargo  = await NavalModel.GetFleetCargo(client, fleet_id);
            res.json({ success: true, fleet: { ...detail, cargo } });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/fleets/:id', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener detalles de flota.' });
        } finally { client.release(); }
    }

    // ── GET /naval/capacity ───────────────────────────────────────────────────

    async GetCapacity(req, res) {
        const client = await pool.connect();
        try {
            const cap = await NavalModel.GetPlayerFleetCapacity(client, req.user.player_id);
            const fleet_limit = getFleetLimit(cap.fief_count);
            res.json({ success: true, fleet_count: cap.fleet_count, fief_count: cap.fief_count, fleet_limit });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/capacity', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener capacidad naval.' });
        } finally { client.release(); }
    }

    // ── GET /naval/embarkable/:fleet_id ──────────────────────────────────────

    async GetEmbarkable(req, res) {
        const client = await pool.connect();
        try {
            const fleet_id  = parseInt(req.params.fleet_id, 10);
            const player_id = req.user.player_id;

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) return res.status(404).json({ success: false, message: 'Flota no encontrada.' });

            const hex_candidates = h3.gridDisk(fleet.h3_index, 1);
            const [armies, cargo, standalone] = await Promise.all([
                NavalModel.GetEmbarkableArmies(client, player_id, fleet.h3_index, hex_candidates),
                NavalModel.GetFleetCargo(client, fleet_id),
                NavalModel.GetStandaloneEntitiesAtHex(client, player_id, hex_candidates),
            ]);
            res.json({ success: true, armies, cargo,
                standalone_characters: standalone.characters,
                standalone_workers:    standalone.workers });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/embarkable', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos embarcables.' });
        } finally { client.release(); }
    }

    // ── POST /naval/create-fleet ──────────────────────────────────────────────
    // Body: { h3_index, name, ships: [{ ship_type_id, quantity }] }
    // ships is optional but must have at least one entry to create a non-empty fleet.

    async CreateFleet(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { h3_index, name, ships = [] } = req.body;

            if (!h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'h3_index es obligatorio.' });
            }

            // Fleet limit check (same cap as armies, separate count)
            const cap = await NavalModel.GetPlayerFleetCapacity(client, player_id);
            const fleet_limit = getFleetLimit(cap.fief_count);
            if (cap.fleet_count >= fleet_limit) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    success: false,
                    message: `Has alcanzado el límite de flotas (${cap.fleet_count}/${fleet_limit}). Necesitas más feudos para comandar más flotas.`,
                });
            }

            // Port check: must be player-owned, completed maritime building
            if (!(await _checkPortAtHex(client, h3_index, player_id))) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Solo puedes crear una flota en un Puerto propio ya construido.' });
            }

            // Validate and cost initial ships
            const culture_id = await _getPlayerCulture(player_id);
            let totalCost = 0;
            const resolvedShips = [];

            for (const entry of ships) {
                const { ship_type_id, quantity = 1 } = entry;
                if (!ship_type_id || quantity < 1) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'Cada barco debe tener ship_type_id y quantity ≥ 1.' });
                }
                const stRes = await client.query(
                    'SELECT id, name, gold_cost, culture_id FROM ship_types WHERE id = $1',
                    [ship_type_id]
                );
                if (stRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, message: `Tipo de barco ${ship_type_id} no encontrado.` });
                }
                const st = stRes.rows[0];
                if (st.culture_id !== culture_id) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ success: false, message: `El barco "${st.name}" no pertenece a tu cultura.` });
                }
                totalCost += st.gold_cost * quantity;
                resolvedShips.push({ ship_type_id: st.id, name: st.name, quantity });
            }

            // Gold check
            if (totalCost > 0) {
                const goldRes = await client.query('SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [player_id]);
                const gold = parseInt(goldRes.rows[0].gold, 10);
                if (gold < totalCost) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        message: `Oro insuficiente. Necesitas ${totalCost.toLocaleString()} y tienes ${gold.toLocaleString()}.`,
                    });
                }
                await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [totalCost, player_id]);
            }

            // Create fleet
            const fleetName = (name || '').trim() || await generateFleetName(client, player_id, culture_id);
            const fleet = await NavalModel.CreateFleet(client, player_id, h3_index, fleetName);

            // Add initial ships
            for (const s of resolvedShips) {
                await NavalModel.AddShipsToFleet(client, fleet.army_id, s.ship_type_id, s.quantity);
            }

            await client.query('COMMIT');

            const shipSummary = resolvedShips.map(s => `${s.quantity}x ${s.name}`).join(', ');
            Logger.action(`Flota ${fleet.army_id} creada (${fleetName}) en ${h3_index} por player ${player_id}. Barcos: [${shipSummary || 'ninguno'}]. Coste: ${totalCost}`);
            res.json({ success: true, fleet_id: fleet.army_id, name: fleetName, gold_spent: totalCost });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/create-fleet', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al crear la flota.' });
        } finally { client.release(); }
    }

    // ── POST /naval/recruit-ships ─────────────────────────────────────────────

    async RecruitShips(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { fleet_id, ship_type_id, quantity = 1 } = req.body;

            if (!fleet_id || !ship_type_id || quantity < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'fleet_id, ship_type_id y quantity (≥1) son obligatorios.' });
            }

            // Fleet ownership
            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Flota no encontrada.' });
            }

            // Port must be at fleet's current hex
            if (!(await _checkPortAtHex(client, fleet.h3_index, player_id))) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'La flota debe estar en un Puerto propio para reclutar barcos.' });
            }

            // Ship type: must exist and match player's culture
            const culture_id  = await _getPlayerCulture(player_id);
            const stRes = await client.query(
                'SELECT id, name, gold_cost, culture_id FROM ship_types WHERE id = $1',
                [ship_type_id]
            );
            if (stRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Tipo de barco no encontrado.' });
            }
            const shipType = stRes.rows[0];
            if (shipType.culture_id !== culture_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Este tipo de barco no pertenece a tu cultura.' });
            }

            // Gold check
            const totalCost = shipType.gold_cost * quantity;
            const goldRes = await client.query('SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [player_id]);
            if (parseInt(goldRes.rows[0].gold, 10) < totalCost) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Oro insuficiente. Necesitas ${totalCost.toLocaleString()} y tienes ${parseInt(goldRes.rows[0].gold, 10).toLocaleString()}.`,
                });
            }

            await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [totalCost, player_id]);
            const updated = await NavalModel.AddShipsToFleet(client, fleet_id, ship_type_id, quantity);
            await client.query('COMMIT');

            Logger.action(`${quantity}x ${shipType.name} reclutados en flota ${fleet_id} por player ${player_id}. Coste: ${totalCost}`);
            res.json({ success: true, fleet_ships: updated, gold_spent: totalCost });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/recruit-ships', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al reclutar barcos.' });
        } finally { client.release(); }
    }

    // ── POST /naval/embark ────────────────────────────────────────────────────

    async EmbarkArmy(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { fleet_id, army_id } = req.body;

            // ── Validate fleet & army ─────────────────────────────────────────
            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Flota no encontrada.' });
            }

            const armyRes = await client.query(
                `SELECT army_id, name, h3_index, transported_by FROM armies
                 WHERE army_id = $1 AND player_id = $2 AND is_naval = FALSE AND is_garrison = FALSE`,
                [army_id, player_id]
            );
            if (armyRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército no encontrado.' });
            }
            const army = armyRes.rows[0];
            if (army.transported_by !== null) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este ejército ya está embarcado.' });
            }
            const sameHex = army.h3_index === fleet.h3_index;
            if (!sameHex) {
                // Allow pickup from adjacent land hex (beach embarkation)
                const neighbors = h3.gridDisk(fleet.h3_index, 1);
                if (!neighbors.includes(army.h3_index)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'El ejército no está en el mismo hex ni en un hex adyacente a la flota.' });
                }
                const landCheck = await client.query(
                    `SELECT 1 FROM h3_map m
                     JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                     WHERE m.h3_index = $1 AND tt.is_naval_passable = FALSE`,
                    [army.h3_index]
                );
                if (landCheck.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'El ejército debe estar en tierra para embarcar desde la orilla.' });
                }
            }

            // ── Gather everything that wants to board ─────────────────────────
            const [cargo, charsRes, troopsRes, workersAtHex] = await Promise.all([
                NavalModel.GetFleetCargo(client, fleet_id),
                client.query(
                    `SELECT id FROM characters WHERE army_id = $1`, [army_id]
                ),
                client.query(
                    `SELECT unit_type_id, quantity, experience, morale, last_fed_turn, stamina, force_rest
                     FROM troops WHERE army_id = $1 ORDER BY unit_type_id`,
                    [army_id]
                ),
                NavalModel.GetWorkersAtHex(client, player_id, army.h3_index),
            ]);

            const available    = cargo.max_capacity - cargo.used_capacity;
            const chars        = charsRes.rows;          // always travel with army
            const troops       = troopsRes.rows;
            const workers      = workersAtHex;

            const char_count   = chars.length;
            const worker_count = workers.length;
            const troop_total  = troops.reduce((s, t) => s + t.quantity, 0);
            const needed       = char_count + worker_count + troop_total;

            if (available <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'La flota no tiene capacidad de transporte disponible.' });
            }

            let workers_to_embark = workers;
            let garrison_leftover = null;  // { unit_type_id, quantity, ... }[]
            let warning = null;

            if (needed > available) {
                // ── Prioritize: characters → workers → troops (proportional) ──
                let remaining = available;

                // 1. Characters always board (up to capacity — edge case)
                remaining -= Math.min(char_count, remaining);

                // 2. Workers fill next slots
                const workers_fit  = Math.min(worker_count, remaining);
                workers_to_embark  = workers.slice(0, workers_fit);
                remaining         -= workers_fit;

                // 3. Troops: proportional split
                if (remaining < troop_total) {
                    const split   = _splitTroopsProportionally(troops, remaining);
                    garrison_leftover = split.leftover;

                    // Update embarking army to only hold the embarked portion
                    for (const t of split.embarked) {
                        await client.query(
                            `UPDATE troops SET quantity = $1 WHERE army_id = $2 AND unit_type_id = $3`,
                            [t.quantity, army_id, t.unit_type_id]
                        );
                    }
                    // Remove unit types that are entirely in the garrison
                    const embarkIds = new Set(split.embarked.map(t => t.unit_type_id));
                    for (const t of troops) {
                        if (!embarkIds.has(t.unit_type_id)) {
                            await client.query(
                                `DELETE FROM troops WHERE army_id = $1 AND unit_type_id = $2`,
                                [army_id, t.unit_type_id]
                            );
                        }
                    }

                    // Create garrison army at the port hex with leftover troops
                    const garRes = await client.query(
                        `INSERT INTO armies (player_id, h3_index, name, is_garrison)
                         VALUES ($1, $2, $3, TRUE) RETURNING army_id`,
                        [player_id, army.h3_index, `Guarnición de ${army.name}`]
                    );
                    const garrison_id = garRes.rows[0].army_id;

                    for (const t of garrison_leftover) {
                        await client.query(
                            `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, last_fed_turn, stamina, force_rest)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                            [garrison_id, t.unit_type_id, t.quantity, t.experience, t.morale,
                             t.last_fed_turn, t.stamina, t.force_rest]
                        );
                    }

                    const leftover_total = garrison_leftover.reduce((s, t) => s + t.quantity, 0);
                    warning = `${leftover_total} tropas acuarteladas en el puerto por falta de espacio en la flota.`;
                    Logger.action(`Guarnición ${garrison_id} creada en ${army.h3_index} con ${leftover_total} tropas sobrantes`);
                }
                // Workers that don't fit simply stay at the hex (no action needed)
            }

            // ── Commit embarkation ────────────────────────────────────────────
            await NavalModel.EmbarkArmy(client, army_id, fleet_id);
            if (workers_to_embark.length) {
                await NavalModel.EmbarkWorkers(client, workers_to_embark.map(w => w.id), fleet_id);
            }
            await client.query('COMMIT');

            Logger.action(`Ejército ${army_id} embarcado en flota ${fleet_id} (${workers_to_embark.length} constructores)${warning ? ' — ' + warning : ''}`);
            res.json({ success: true, warning });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/embark', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al embarcar el ejército.' });
        } finally { client.release(); }
    }

    // ── POST /naval/disembark ─────────────────────────────────────────────────

    async DisembarkArmy(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { army_id, target_h3 } = req.body;

            // Fetch army + fleet hex + fleet_id in one join
            const armyRes = await client.query(
                `SELECT a.army_id, a.transported_by AS fleet_id, f.h3_index AS fleet_hex
                 FROM armies a
                 JOIN armies f ON a.transported_by = f.army_id
                 WHERE a.army_id = $1 AND a.player_id = $2`,
                [army_id, player_id]
            );
            if (armyRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército no encontrado o no está embarcado.' });
            }
            const { fleet_hex, fleet_id } = armyRes.rows[0];

            // Determine landing hex based on fleet's terrain
            const terrainRes = await client.query(
                `SELECT tt.name FROM h3_map m
                 JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                 WHERE m.h3_index = $1`,
                [fleet_hex]
            );
            const fleetTerrain = terrainRes.rows[0]?.name;

            let land_hex;
            if (fleetTerrain === 'Mar') {
                // Sea hex: target_h3 must be an adjacent land hex
                if (!target_h3) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'Especifica una celda de tierra adyacente para desembarcar.' });
                }
                const neighbors = h3.gridDisk(fleet_hex, 1);
                if (!neighbors.includes(target_h3)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'La celda de destino no es adyacente a la flota.' });
                }
                const landCheck = await client.query(
                    `SELECT 1 FROM h3_map m
                     JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                     WHERE m.h3_index = $1 AND tt.is_naval_passable = FALSE`,
                    [target_h3]
                );
                if (landCheck.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, message: 'Solo puedes desembarcar en hexes de tierra.' });
                }
                land_hex = target_h3;
            } else if (fleetTerrain === 'Costa') {
                // Coastal hex: land here
                land_hex = fleet_hex;
            } else {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'La flota debe estar en mar o costa para desembarcar.' });
            }

            await NavalModel.DisembarkArmy(client, army_id);
            await client.query('UPDATE armies SET h3_index = $1 WHERE army_id = $2', [land_hex, army_id]);

            if (fleet_id) {
                await NavalModel.DisembarkWorkers(client, fleet_id, land_hex);
                await NavalModel.DisembarkStandaloneChars(client, fleet_id, land_hex);
            }

            await client.query('COMMIT');

            Logger.action(`Ejército ${army_id} desembarcado en ${land_hex}`);
            res.json({ success: true, landed_at: land_hex });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/disembark', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al desembarcar el ejército.' });
        } finally { client.release(); }
    }

    // ── POST /naval/embark-character ─────────────────────────────────────────
    // Body: { fleet_id, char_id }

    async EmbarkCharacter(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { fleet_id, char_id } = req.body;
            if (!fleet_id || !char_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'fleet_id y char_id son obligatorios.' });
            }

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Flota no encontrada.' });
            }

            // Character must belong to player and be standalone (no army) and at an adjacent-or-same hex
            const charRes = await client.query(
                `SELECT id, name, h3_index FROM characters
                 WHERE id = $1 AND player_id = $2 AND army_id IS NULL AND transported_by IS NULL AND is_captive = FALSE`,
                [char_id, player_id]
            );
            if (charRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje no encontrado o no está disponible.' });
            }
            const char = charRes.rows[0];
            const hex_candidates = h3.gridDisk(fleet.h3_index, 1);
            if (!hex_candidates.includes(char.h3_index)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El personaje no está en el hex de la flota ni en uno adyacente.' });
            }

            // Capacity check
            const cargo = await NavalModel.GetFleetCargo(client, fleet_id);
            if (cargo.used_capacity >= cargo.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'La flota no tiene capacidad disponible.' });
            }

            const embarked = await NavalModel.EmbarkCharacter(client, char_id, fleet_id);
            if (!embarked) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, message: 'El personaje ya está embarcado.' });
            }
            await client.query('COMMIT');
            Logger.action(`Personaje ${char.name} (${char_id}) embarcado en flota ${fleet_id} por player ${player_id}`);
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/embark-character', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al embarcar el personaje.' });
        } finally { client.release(); }
    }

    // ── POST /naval/embark-worker ─────────────────────────────────────────────
    // Body: { fleet_id, worker_id }

    async EmbarkWorkerDirect(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const player_id = req.user.player_id;
            const { fleet_id, worker_id } = req.body;
            if (!fleet_id || !worker_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'fleet_id y worker_id son obligatorios.' });
            }

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Flota no encontrada.' });
            }

            const workerRes = await client.query(
                `SELECT w.id, w.h3_index FROM workers w
                 WHERE w.id = $1 AND w.player_id = $2 AND w.transported_by IS NULL`,
                [worker_id, player_id]
            );
            if (workerRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Constructor no encontrado o ya embarcado.' });
            }
            const worker = workerRes.rows[0];
            const hex_candidates = h3.gridDisk(fleet.h3_index, 1);
            if (!hex_candidates.includes(worker.h3_index)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El constructor no está en el hex de la flota ni en uno adyacente.' });
            }

            // Capacity check
            const cargo = await NavalModel.GetFleetCargo(client, fleet_id);
            if (cargo.used_capacity >= cargo.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'La flota no tiene capacidad disponible.' });
            }

            const embarked = await NavalModel.EmbarkWorker(client, worker_id, fleet_id);
            if (!embarked) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, message: 'El constructor ya está embarcado.' });
            }
            await client.query('COMMIT');
            Logger.action(`Constructor ${worker_id} embarcado en flota ${fleet_id} por player ${player_id}`);
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/embark-worker', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al embarcar el constructor.' });
        } finally { client.release(); }
    }

    // ── POST /naval/disembark-character ──────────────────────────────────────

    async DisembarkStandaloneChar(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { char_id, target_h3 } = req.body;
            if (!char_id) return res.status(400).json({ success: false, message: 'char_id es obligatorio.' });

            await client.query('BEGIN');

            const charRes = await client.query(
                `SELECT c.id, c.transported_by FROM characters c
                 WHERE c.id = $1 AND c.player_id = $2 AND c.transported_by IS NOT NULL AND c.army_id IS NULL`,
                [char_id, player_id]
            );
            if (charRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje no encontrado o no embarcado.' });
            }
            const fleet_id = charRes.rows[0].transported_by;

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Flota no encontrada.' });
            }

            const land_hex = await this._resolveLandHex(client, fleet.h3_index, target_h3);
            if (!land_hex) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Especifica un hex de desembarco válido.' });
            }

            await client.query(
                `UPDATE characters SET h3_index = $1, transported_by = NULL WHERE id = $2`,
                [land_hex, char_id]
            );
            await client.query('COMMIT');
            Logger.action(`Personaje ${char_id} desembarcado en ${land_hex} por player ${player_id}`);
            res.json({ success: true, h3_index: land_hex });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/disembark-character', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al desembarcar el personaje.' });
        } finally { client.release(); }
    }

    // ── POST /naval/disembark-worker ──────────────────────────────────────────

    async DisembarkStandaloneWorker(req, res) {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { worker_id, target_h3 } = req.body;
            if (!worker_id) return res.status(400).json({ success: false, message: 'worker_id es obligatorio.' });

            await client.query('BEGIN');

            const workerRes = await client.query(
                `SELECT w.id, w.transported_by FROM workers w
                 WHERE w.id = $1 AND w.player_id = $2 AND w.transported_by IS NOT NULL`,
                [worker_id, player_id]
            );
            if (workerRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Constructor no encontrado o no embarcado.' });
            }
            const fleet_id = workerRes.rows[0].transported_by;

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Flota no encontrada.' });
            }

            const land_hex = await this._resolveLandHex(client, fleet.h3_index, target_h3);
            if (!land_hex) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Especifica un hex de desembarco válido.' });
            }

            await client.query(
                `UPDATE workers SET h3_index = $1, transported_by = NULL, destination_h3 = NULL WHERE id = $2`,
                [land_hex, worker_id]
            );
            await client.query('COMMIT');
            Logger.action(`Constructor ${worker_id} desembarcado en ${land_hex} por player ${player_id}`);
            res.json({ success: true, h3_index: land_hex });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: '/naval/disembark-worker', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al desembarcar el constructor.' });
        } finally { client.release(); }
    }

    /** Helper: resolve the landing hex given fleet position and optional target. */
    async _resolveLandHex(client, fleet_h3, target_h3) {
        const terrainRes = await client.query(
            `SELECT tt.name FROM h3_map m
             JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
             WHERE m.h3_index = $1`,
            [fleet_h3]
        );
        const terrain = terrainRes.rows[0]?.name;
        if (terrain !== 'Mar') return fleet_h3;  // coastal — land here
        if (!target_h3) return null;               // sea — need explicit target

        // Verify target_h3 is adjacent and is land
        const neighbors = h3.gridDisk(fleet_h3, 1);
        if (!neighbors.includes(target_h3)) return null;
        const landRes = await client.query(
            `SELECT m.h3_index FROM h3_map m
             JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
             WHERE m.h3_index = $1 AND tt.is_naval_passable = FALSE`,
            [target_h3]
        );
        return landRes.rows[0]?.h3_index ?? null;
    }

    // ── GET /naval/landing-hexes/:fleet_id ───────────────────────────────────
    // Returns adjacent land hexes where the fleet can disembark troops.
    // is_sea=false → fleet is at a coastal hex, land directly here.
    // is_sea=true  → fleet is at open sea, returns list of adjacent land hexes.

    async GetLandingHexes(req, res) {
        const client = await pool.connect();
        try {
            const fleet_id  = parseInt(req.params.fleet_id, 10);
            const player_id = req.user.player_id;

            const fleet = await NavalModel.GetFleetByIdAndOwner(client, fleet_id, player_id);
            if (!fleet) return res.status(404).json({ success: false, message: 'Flota no encontrada.' });

            const terrainRes = await client.query(
                `SELECT tt.name FROM h3_map m
                 JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                 WHERE m.h3_index = $1`,
                [fleet.h3_index]
            );
            const fleetTerrain = terrainRes.rows[0]?.name;

            if (fleetTerrain !== 'Mar') {
                // Coastal: land directly at fleet hex
                return res.json({ success: true, is_sea: false, landing_hexes: [], fleet_hex: fleet.h3_index });
            }

            // Sea hex: find adjacent land hexes
            const neighbors = h3.gridDisk(fleet.h3_index, 1).filter(n => n !== fleet.h3_index);
            const landRes = await client.query(
                `SELECT m.h3_index, tt.name AS terrain_name, m.player_id
                 FROM h3_map m
                 JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                 WHERE m.h3_index = ANY($1) AND tt.is_naval_passable = FALSE`,
                [neighbors]
            );

            res.json({ success: true, is_sea: true, fleet_hex: fleet.h3_index, landing_hexes: landRes.rows });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/landing-hexes/:fleet_id', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener hexes de desembarco.' });
        } finally { client.release(); }
    }

    // ── POST /naval/move-fleet ────────────────────────────────────────────────

    async MoveFleet(req, res) {
        try {
            const player_id = req.user.player_id;
            const { fleet_id, target_h3 } = req.body;

            if (!fleet_id || !target_h3) {
                return res.status(400).json({ success: false, message: 'fleet_id y target_h3 son requeridos.' });
            }

            const fleet = await NavalModel.GetFleetByIdAndOwner(null, fleet_id, player_id);
            if (!fleet) {
                return res.status(404).json({ success: false, message: 'Flota no encontrada.' });
            }

            const routeResult = await ArmySimulationService.calculateAndSaveRoute(fleet_id, target_h3);
            if (!routeResult.success) {
                return res.status(400).json({ success: false, message: routeResult.message || 'No se pudo calcular la ruta.' });
            }

            Logger.action(`Flota ${fleet_id} (${fleet.name}) en marcha hacia ${target_h3}`, player_id);
            res.json({
                success: true,
                message: `${fleet.name} en marcha hacia ${target_h3} (${routeResult.steps} pasos)`,
                data: { from: fleet.h3_index, to: target_h3, steps: routeResult.steps, path: routeResult.path },
            });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/move-fleet', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al mover la flota.' });
        }
    }

    // ── POST /naval/stop-fleet ────────────────────────────────────────────────

    async StopFleet(req, res) {
        try {
            const player_id = req.user.player_id;
            const { fleet_id } = req.body;

            if (!fleet_id) {
                return res.status(400).json({ success: false, message: 'fleet_id es requerido.' });
            }

            const fleet = await ArmyModel.stopArmy(fleet_id, player_id);
            if (!fleet) {
                return res.status(404).json({ success: false, message: 'Flota no encontrada o no te pertenece.' });
            }

            Logger.action(`Flota ${fleet_id} (${fleet.name}) detenida`, player_id);
            res.json({ success: true, message: `Flota "${fleet.name}" detenida correctamente.` });
        } catch (err) {
            Logger.error(err, { endpoint: '/naval/stop-fleet', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al detener la flota.' });
        }
    }
}

module.exports = new NavalService();
