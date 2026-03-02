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
    // ARMY_RATIO: no player (human or bot) may have more armies than floor(fiefs / RATIO).
    // The check only fires when a *new* army would be created; reinforcing an existing one is free.
    const finalArmyName = army_name || `Ejército de ${playerId}`;
    const existingArmy  = await ArmyModel.FindArmy(client, h3_index, finalArmyName, playerId);
    let army_id;
    if (existingArmy.rows.length === 0) {
        const capacity  = await ArmyModel.GetPlayerArmyCapacity(client, playerId);
        const armyLimit = getArmyLimit(capacity.fief_count);
        if (capacity.army_count >= armyLimit) {
            throw new GameActionError(
                `Límite de ejércitos alcanzado (${capacity.army_count}/${armyLimit}). ` +
                `Se necesita 1 feudo adicional por cada ${GAME_CONFIG.ARMY_LIMITS.RATIO} feudos para comandar más ejércitos.`,
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

    // ── 4. Exclusion radius: no same building type within EXCLUSION_RADIUS hexes ─
    const exclusionRadius = GAME_CONFIG.BUILDINGS.EXCLUSION_RADIUS;
    const nearbyHexes = h3.gridDisk(h3_index, exclusionRadius);
    const conflict = await KingdomModel.GetBuildingOfTypeInRadius(client, nearbyHexes, building.type_id, h3_index);
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

    // ── 6. Execute ────────────────────────────────────────────────────────────
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
                'Los trabajadores solo se pueden contratar en tu Capital o en feudos con un Mercado construido.',
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { executeRecruitment, executeConstruction, buyWorker, GameActionError };
