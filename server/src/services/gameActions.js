'use strict';

/**
 * gameActions.js
 *
 * Unified action layer that enforces ALL game rules for recruitment and
 * construction. Both human routes AND AI agents MUST go through these
 * functions so that rules apply equally to everyone.
 *
 * Rule: If a validation changes for players, it automatically applies to bots.
 *
 * Functions:
 *   executeRecruitment(client, playerId, params, meta?)
 *   executeConstruction(client, playerId, params, meta?)
 *
 * All functions accept an active transaction client. Callers are responsible
 * for BEGIN / COMMIT / ROLLBACK.
 *
 * On validation failure each function throws a GameActionError (user-friendly Spanish message).
 */

const h3              = require('h3-js');
const KingdomModel    = require('../models/KingdomModel');
const ArmyModel       = require('../models/ArmyModel');
const WorkerModel     = require('../models/WorkerModel');
const recruitmentNetwork = require('../logic/recruitmentNetwork');
const GAME_CONFIG     = require('../config/constants');
const { getArmyLimit } = require('../config/gameFunctions');
const { Logger }      = require('../utils/logger');

// ─── Error class ─────────────────────────────────────────────────────────────

class GameActionError extends Error {
    constructor(message, code = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'GameActionError';
        this.code = code;
    }
}

// ─── Cooldown defaults (turns) ────────────────────────────────────────────────

const COOLDOWN_TURNS = {
    attack:  1,
    conquer: 3,
};

// ─── canPerformAction ─────────────────────────────────────────────────────────

/**
 * Returns true if the army has NO active cooldown for the given action.
 * Uses the unique index on (army_id, action_type) — O(1) lookup.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} armyId
 * @param {string} actionType  e.g. 'attack' | 'conquer'
 * @returns {Promise<boolean>}
 */
async function canPerformAction(client, armyId, actionType) {
    const result = await client.query(
        `SELECT 1 FROM army_actions_cooldowns
         WHERE army_id = $1 AND action_type = $2 AND turns_remaining > 0`,
        [armyId, actionType]
    );
    return result.rows.length === 0;
}

// ─── applyCooldown ────────────────────────────────────────────────────────────

/**
 * Registers (or resets) a cooldown for an army action.
 * Must be called inside an active transaction so the write is atomic
 * with whatever action triggered it.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} armyId
 * @param {string} actionType  e.g. 'attack' | 'conquer'
 * @param {number} [turns]     overrides the default defined in COOLDOWN_TURNS
 */
async function applyCooldown(client, armyId, actionType, turns) {
    const t = turns ?? COOLDOWN_TURNS[actionType] ?? 1;
    await client.query(
        `INSERT INTO army_actions_cooldowns (army_id, action_type, turns_remaining)
         VALUES ($1, $2, $3)
         ON CONFLICT (army_id, action_type)
         DO UPDATE SET turns_remaining = EXCLUDED.turns_remaining,
                       created_at      = CURRENT_TIMESTAMP`,
        [armyId, actionType, t]
    );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function _actorLabel(meta, playerId) {
    return meta?.actorName ? `[${meta.actorName}]` : `[Jugador ${playerId}]`;
}

// ─── executeRecruitment ──────────────────────────────────────────────────────

/**
 * Recruit troops for any player (human or bot).
 * Contains ALL validations from POST /api/military/recruit.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} playerId
 * @param {{ h3_index: string, unit_type_id: number, quantity: number, army_name?: string }} params
 * @param {{ actorName?: string }} [meta]  - optional display name for logging
 * @returns {{ army_id: number, message: string }}
 * @throws {GameActionError}
 */
async function executeRecruitment(client, playerId, { h3_index, unit_type_id, quantity, army_name = null }, meta = {}) {
    if (!h3_index || !unit_type_id || !quantity || quantity <= 0) {
        throw new GameActionError('Parámetros de reclutamiento inválidos');
    }

    // ── 1. Territory must exist and belong to this player ─────────────────────
    const terrResult = await ArmyModel.GetTerritoryForRecruitment(client, h3_index);
    if (terrResult.rows.length === 0) {
        throw new GameActionError('Territorio no encontrado');
    }
    const territory = terrResult.rows[0];
    if (territory.player_id !== playerId) {
        throw new GameActionError('No posees este territorio');
    }

    // ── 2. Location must be capital or fief with completed military building ───
    const isCapital = territory.capital_h3 === h3_index;
    if (!isCapital) {
        const hasMilitary = await ArmyModel.CheckMilitaryBuildingInFief(client, h3_index);
        if (!hasMilitary) {
            throw new GameActionError(
                'Solo puedes reclutar en tu Capital o en feudos con un edificio militar (Cuartel o Fortaleza).'
            );
        }
    }

    // ── 3. Population: connected network must cover the requested quantity ─────
    const connectedH3s   = await recruitmentNetwork.getConnectedNetwork(client, h3_index, playerId);
    const fiefPops       = await recruitmentNetwork.getFiefPopulations(client, connectedH3s);
    const recruitablePool = recruitmentNetwork.calcRecruitablePool(fiefPops);
    if (recruitablePool < quantity) {
        throw new GameActionError(
            `Población insuficiente. Tu red de feudos puede aportar ${recruitablePool} reclutas ` +
            `(cada feudo reserva ${GAME_CONFIG.ECONOMY.MIN_FIEF_POPULATION} hab.).`
        );
    }

    // ── 4. Unit requirements (resources) ──────────────────────────────────────
    const reqResult   = await ArmyModel.GetUnitRequirements(client, unit_type_id);
    const requirements = reqResult.rows;

    const goldRow = await KingdomModel.GetPlayerGold(client, playerId);
    const playerGold = parseInt(goldRow?.gold) || 0;

    for (const req of requirements) {
        const needed = req.amount * quantity;
        if (req.resource_type === 'gold' && playerGold < needed) {
            throw new GameActionError(
                `Oro insuficiente. Necesitas ${needed} oro, pero solo tienes ${playerGold}.`
            );
        } else if (req.resource_type === 'wood_stored' && (territory.wood_stored || 0) < needed) {
            throw new GameActionError(
                `Madera insuficiente. Necesitas ${needed}, pero solo tienes ${territory.wood_stored || 0}.`
            );
        } else if (req.resource_type === 'stone_stored' && (territory.stone_stored || 0) < needed) {
            throw new GameActionError(
                `Piedra insuficiente. Necesitas ${needed}, pero solo tienes ${territory.stone_stored || 0}.`
            );
        } else if (req.resource_type === 'iron_stored' && (territory.iron_stored || 0) < needed) {
            throw new GameActionError(
                `Hierro insuficiente. Necesitas ${needed}, pero solo tienes ${territory.iron_stored || 0}.`
            );
        }
    }

    // ── 5. Deduct resources ───────────────────────────────────────────────────
    for (const req of requirements) {
        const cost = req.amount * quantity;
        if (req.resource_type === 'gold') {
            await ArmyModel.DeductPlayerGold(client, playerId, cost);
        } else {
            await ArmyModel.DeductTerritoryResource(client, h3_index, req.resource_type, cost);
        }
    }

    // ── 6. Deduct population from supply network ──────────────────────────────
    await recruitmentNetwork.deductFromNetwork(client, connectedH3s, fiefPops, quantity);

    // ── 7. Find or create army ────────────────────────────────────────────────
    // El límite de ejércitos viene del rango noble del jugador.
    // El check solo aplica cuando se crea un ejército nuevo; reforzar uno existente es libre.
    const finalArmyName = army_name || `Ejército de ${playerId}`;
    const existingArmy  = await ArmyModel.FindArmy(client, h3_index, finalArmyName, playerId);
    let army_id;
    if (existingArmy.rows.length === 0) {
        const capacity  = await ArmyModel.GetPlayerArmyCapacity(client, playerId);
        const armyLimit = capacity.army_limit;
        if (capacity.army_count >= armyLimit) {
            throw new GameActionError(
                `Límite de ejércitos alcanzado (${capacity.army_count}/${armyLimit}). ` +
                `Sube de rango para comandar más ejércitos.`,
                'ARMY_LIMIT_REACHED'
            );
        }
        const newArmy = await ArmyModel.CreateArmy(client, finalArmyName, playerId, h3_index);
        army_id = newArmy.rows[0].army_id;
    } else {
        army_id = existingArmy.rows[0].army_id;
    }

    // ── 8. Add troops and refresh detection range ─────────────────────────────
    await ArmyModel.AddTroops(client, army_id, unit_type_id, quantity);
    await ArmyModel.refreshDetectionRange(client, army_id);

    const label = _actorLabel(meta, playerId);
    Logger.action(
        `[ACTION]${label}: Reclutó ${quantity} unidades (tipo ${unit_type_id}) en ${h3_index}`,
        { player_id: playerId, h3_index, unit_type_id, quantity, army_id }
    );

    return { army_id, message: 'Unidades reclutadas exitosamente' };
}

// ─── executeConstruction ─────────────────────────────────────────────────────

/**
 * Start a building construction for any player (human or bot).
 * Contains ALL validations from POST /api/territory/construct.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} playerId
 * @param {{ h3_index: string, building_id: number }} params
 * @param {{ actorName?: string }} [meta]
 * @returns {{ building_name: string, turns: number, message: string }}
 * @throws {GameActionError}
 */
async function executeConstruction(client, playerId, { h3_index, building_id }, meta = {}) {
    if (!h3_index || !building_id) {
        throw new GameActionError('h3_index y building_id son requeridos');
    }

    // ── 1. Territory ownership ────────────────────────────────────────────────
    const owner = await KingdomModel.CheckTerritoryOwnership(client, h3_index);
    if (owner?.player_id !== playerId) {
        throw new GameActionError('No posees este territorio');
    }

    // ── 2. No building already built or under construction ────────────────────
    const existing = await KingdomModel.GetExistingFiefBuilding(client, h3_index);
    if (existing) {
        const msg = existing.is_under_construction
            ? `Ya hay una construcción en curso (${existing.remaining_construction_turns} turnos restantes)`
            : 'Este feudo ya tiene un edificio construido';
        throw new GameActionError(msg);
    }

    // ── 3. Building definition must exist ─────────────────────────────────────
    const building = await KingdomModel.GetBuildingDefinition(client, building_id);
    if (!building) {
        throw new GameActionError('Edificio no encontrado');
    }

    // ── 3b. Culture check ─────────────────────────────────────────────────────
    const playerCulture = await KingdomModel.GetPlayerCulture(client, playerId);
    if (building.culture_id !== null && building.culture_id !== playerCulture) {
        throw new GameActionError('Este edificio no pertenece a tu cultura');
    }

    // ── 3c. Maritime building constraints ─────────────────────────────────────
    if (building.type_name === 'maritime') {
        // Must be adjacent to at least one sea hex (terrain_type_id = 1 = Mar)
        const neighbors = h3.gridDisk(h3_index, 1).filter(n => n !== h3_index);
        const seaCheck = await client.query(
            `SELECT 1 FROM h3_map
             WHERE h3_index = ANY($1::text[])
               AND terrain_type_id = (SELECT terrain_type_id FROM terrain_types WHERE name = 'Mar')
             LIMIT 1`,
            [neighbors]
        );
        if (seaCheck.rowCount === 0) {
            throw new GameActionError('Los puertos solo se pueden construir en feudos adyacentes al mar.');
        }
        // Only one maritime building per Pagus
        const existingPort = await KingdomModel.GetMaritimeBuildingInDivision(client, h3_index);
        if (existingPort) {
            throw new GameActionError(`Tu Comarca ya tiene un puerto en ${existingPort.h3_index}.`);
        }
    }

    // ── 4. Exclusion radius: no same building type within EXCLUSION_RADIUS hexes ─
    // Maritime buildings skip this check — their uniqueness is enforced per-Pagus in step 3c.
    const exclusionRadius = GAME_CONFIG.BUILDINGS.EXCLUSION_RADIUS;
    const nearbyHexes = h3.gridDisk(h3_index, exclusionRadius);
    const conflict = building.type_name === 'maritime'
        ? null
        : await KingdomModel.GetBuildingOfTypeInRadius(client, nearbyHexes, building.type_id, h3_index);
    if (conflict) {
        throw new GameActionError(
            `Ya existe un edificio de este tipo en un radio de ${exclusionRadius} feudos (en ${conflict.h3_index})`
        );
    }

    // ── 5. Prerequisite building if required ──────────────────────────────────
    if (building.required_building_id) {
        const prereq = await KingdomModel.GetCompletedBuilding(client, h3_index, building.required_building_id);
        if (!prereq) {
            throw new GameActionError('Debes construir el edificio prerequisito primero');
        }
    }

    // ── 6. Gold check ─────────────────────────────────────────────────────────
    const player = await KingdomModel.GetPlayerGold(client, playerId);
    if ((player?.gold ?? 0) < building.gold_cost) {
        throw new GameActionError(`Oro insuficiente. Necesitas ${building.gold_cost} 💰`);
    }

    // ── 7. Worker check — se requiere un constructor en el feudo (salvo bots) ─
    if (!meta.skipWorkerCheck) {
        const workerCheck = await client.query(
            'SELECT id FROM workers WHERE player_id = $1 AND h3_index = $2 LIMIT 1',
            [playerId, h3_index]
        );
        if (workerCheck.rows.length === 0) {
            throw new GameActionError('Necesitas un constructor en este feudo para iniciar la obra');
        }
        // Consumir todos los constructores del jugador en ese feudo
        await client.query(
            'DELETE FROM workers WHERE player_id = $1 AND h3_index = $2',
            [playerId, h3_index]
        );
    }

    // ── 8. Execute ────────────────────────────────────────────────────────────
    await KingdomModel.DeductGold(client, playerId, building.gold_cost);
    await KingdomModel.StartConstruction(client, h3_index, building_id, building.construction_time_turns);

    const label = _actorLabel(meta, playerId);
    Logger.action(
        `[ACTION]${label}: Inició construcción de "${building.name}" en ${h3_index} (${building.construction_time_turns} turnos, -${building.gold_cost}💰)`,
        { player_id: playerId, h3_index, building_id, building_name: building.name }
    );

    return {
        building_name: building.name,
        turns: building.construction_time_turns,
        message: `Construcción de ${building.name} iniciada. Turnos restantes: ${building.construction_time_turns}`,
    };
}

// ─── buyWorker ────────────────────────────────────────────────────────────────

/**
 * Hire a worker for any player (human or bot).
 *
 * Valid locations: player's Capital OR a fief with a completed Mercado building.
 * Deducts gold from players table and inserts into workers table.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} playerId
 * @param {{ h3_index: string, worker_type_id: number }} params
 * @param {{ actorName?: string }} [meta]
 * @returns {{ worker_id: number, message: string }}
 * @throws {GameActionError}
 */
async function buyWorker(client, playerId, { h3_index, worker_type_id }, meta = {}) {
    if (!h3_index || !worker_type_id) {
        throw new GameActionError('h3_index y worker_type_id son requeridos');
    }

    // ── 1. Territory must exist and belong to this player ─────────────────────
    const terrResult = await ArmyModel.GetTerritoryForRecruitment(client, h3_index);
    if (terrResult.rows.length === 0) {
        throw new GameActionError('Territorio no encontrado');
    }
    const territory = terrResult.rows[0];
    if (territory.player_id !== playerId) {
        throw new GameActionError('No posees este territorio', 'FORBIDDEN');
    }

    // ── 2. Location must be Capital OR a fief with a completed Mercado ────────
    const isCapital = territory.capital_h3 === h3_index;
    if (!isCapital) {
        const hasMarket = await WorkerModel.CheckMarketInFief(client, h3_index);
        if (!hasMarket) {
            throw new GameActionError(
                'Los trabajadores solo se pueden contratar en tu Capital o en feudos con un edificio económico activo.',
                'FORBIDDEN'
            );
        }
    }

    // ── 3. Worker type must exist ─────────────────────────────────────────────
    const workerType = await WorkerModel.GetWorkerType(client, worker_type_id);
    if (!workerType) {
        throw new GameActionError('Tipo de trabajador no encontrado');
    }

    // ── 4. Gold check ─────────────────────────────────────────────────────────
    const goldRow = await KingdomModel.GetPlayerGold(client, playerId);
    const playerGold = parseInt(goldRow?.gold) || 0;
    if (playerGold < workerType.cost) {
        throw new GameActionError(
            `Oro insuficiente. Necesitas ${workerType.cost} 💰 pero tienes ${playerGold} 💰.`
        );
    }

    // ── 5. Deduct gold ────────────────────────────────────────────────────────
    await ArmyModel.DeductPlayerGold(client, playerId, workerType.cost);

    // ── 6. Create worker (stats copied from type to allow future buffs) ───────
    const worker = await WorkerModel.CreateWorker(
        client, playerId, h3_index, worker_type_id,
        workerType.hp, workerType.speed, workerType.detection_range
    );

    const label = _actorLabel(meta, playerId);
    Logger.action(
        `[ACTION]${label}: Contrató trabajador "${workerType.name}" en ${h3_index} (-${workerType.cost}💰)`,
        { player_id: playerId, h3_index, worker_type_id, worker_id: worker.id }
    );

    return { worker_id: worker.id, message: `${workerType.name} contratado exitosamente` };
}

// ─── Conquest Loot ────────────────────────────────────────────────────────────

/**
 * Returns a random integer in [min, max] inclusive.
 */
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Processes loot when an army wins or draws a conquest.
 * Must be called INSIDE an active transaction (BEGIN already issued by caller).
 *
 * Mechanic:
 *   lootPct  ∈ [10%, 30%]  — fraction of each resource taken from the fief
 *   armyPct  ∈ [40%, 60%]  — fraction of the loot that goes to the army
 *   rest of loot            — destroyed (chaos of battle)
 *
 * @param {import('pg').PoolClient} client
 * @param {number} armyId
 * @param {string} h3_index  - conquered hex
 * @returns {{ loot: Object, armyGains: Object, destroyed: Object }}
 */
async function processConquestLoot(client, armyId, h3_index) {
    // 1. Lock resource row
    const tdResult = await client.query(
        `SELECT food_stored, gold_stored
         FROM territory_details
         WHERE h3_index = $1
         FOR UPDATE`,
        [h3_index]
    );

    if (tdResult.rows.length === 0) {
        // No territory_details row yet — nothing to loot
        return { loot: {}, armyGains: {}, destroyed: {} };
    }

    const td = tdResult.rows[0];

    // 2. Roll percentages once for the whole event
    const lootPct = getRandomInt(10, 30) / 100;   // 10 – 30 %
    const armyPct = getRandomInt(40, 60) / 100;   // 40 – 60 % of loot

    const resources = ['food_stored', 'gold_stored'];
    const provisionKeys = {
        food_stored: 'food_provisions',
        gold_stored: 'gold_provisions',
    };

    const loot      = {};   // total removed from fief  (per resource)
    const armyGains = {};   // army receives             (per resource)
    const destroyed = {};   // lost to destruction       (per resource)

    for (const col of resources) {
        const available = Math.floor(parseFloat(td[col]) || 0);
        if (available <= 0) continue;

        const totalLoot  = Math.min(available, Math.floor(available * lootPct));
        if (totalLoot <= 0) continue;

        const armyShare  = Math.floor(totalLoot * armyPct);
        const lostShare  = totalLoot - armyShare;

        loot[col]      = totalLoot;
        armyGains[col] = armyShare;
        destroyed[col] = lostShare;
    }

    // 3. Deduct from fief (only columns where we actually looted)
    if (Object.keys(loot).length > 0) {
        const setClauses = Object.keys(loot)
            .map((col, i) => `${col} = GREATEST(0, ${col} - $${i + 2})`)
            .join(', ');
        const values = [h3_index, ...Object.values(loot)];
        await client.query(
            `UPDATE territory_details SET ${setClauses} WHERE h3_index = $1`,
            values
        );
    }

    // 4. Add army gains to provisions
    if (Object.keys(armyGains).length > 0) {
        const setClauses = Object.keys(armyGains)
            .map((col, i) => `${provisionKeys[col]} = ${provisionKeys[col]} + $${i + 2}`)
            .join(', ');
        const values = [armyId, ...Object.values(armyGains)];
        await client.query(
            `UPDATE armies SET ${setClauses} WHERE army_id = $1`,
            values
        );
    }

    // 5. Log
    const totalLooted    = Object.values(loot).reduce((s, v) => s + v, 0);
    const totalArmyGains = Object.values(armyGains).reduce((s, v) => s + v, 0);
    const totalDestroyed = Object.values(destroyed).reduce((s, v) => s + v, 0);
    Logger.engine(
        `[SAQUEO] Ejército ${armyId} saqueó ${h3_index}: ` +
        `total=${totalLooted} | ejército=${totalArmyGains} | destruido=${totalDestroyed} ` +
        `| lootPct=${Math.round(lootPct * 100)}% armyPct=${Math.round(armyPct * 100)}%`
    );

    return { loot, armyGains, destroyed };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    executeRecruitment, executeConstruction, buyWorker,
    canPerformAction, applyCooldown,
    processConquestLoot,
    GameActionError, COOLDOWN_TURNS,
};
