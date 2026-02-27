'use strict';

/**
 * gameActions.js
 *
 * Unified action layer that enforces ALL game rules for recruitment,
 * construction and colonization. Both human routes AND AI agents MUST go
 * through these functions so that rules apply equally to everyone.
 *
 * Rule: If a validation changes for players, it automatically applies to bots.
 *
 * Functions:
 *   executeRecruitment(client, playerId, params, meta?)
 *   executeConstruction(client, playerId, params, meta?)
 *   executeColonization(client, playerId, params, meta?)
 *
 * All functions accept an active transaction client. Callers are responsible
 * for BEGIN / COMMIT / ROLLBACK.
 *
 * On validation failure each function throws a GameActionError (user-friendly Spanish message).
 */

const h3              = require('h3-js');
const KingdomModel    = require('../models/KingdomModel');
const ArmyModel       = require('../models/ArmyModel');
const recruitmentNetwork = require('../logic/recruitmentNetwork');
const conquest        = require('../logic/conquest');
const GAME_CONFIG     = require('../config/constants');
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
    const finalArmyName = army_name || `Ejército de ${playerId}`;
    const existingArmy  = await ArmyModel.FindArmy(client, h3_index, finalArmyName, playerId);
    let army_id;
    if (existingArmy.rows.length === 0) {
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

    // ── 4. Prerequisite building if required ──────────────────────────────────
    if (building.required_building_id) {
        const prereq = await KingdomModel.GetCompletedBuilding(client, h3_index, building.required_building_id);
        if (!prereq) {
            throw new GameActionError('Debes construir el edificio prerequisito primero');
        }
    }

    // ── 5. Gold check ─────────────────────────────────────────────────────────
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

// ─── executeColonization ─────────────────────────────────────────────────────

/**
 * Claim a first territory (capital founding) for a human player.
 * Contains ALL validations from POST /api/game/claim.
 *
 * IMPORTANT: Bots CANNOT use this function — they receive territory at spawn and
 * expand into adjacent unclaimed hexes through their own conquest logic.
 * Any attempt by a bot to call this function throws a GameActionError.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} playerId
 * @param {{ h3_index: string }} params
 * @param {{ actorName?: string }} [meta]
 * @returns {{ is_capital: boolean, was_exiled: boolean, claimed_count: number, message: string }}
 * @throws {GameActionError}
 */
async function executeColonization(client, playerId, { h3_index }, meta = {}) {
    const CLAIM_COST = 100;

    // ── Guard: bots are FORBIDDEN from colonizing ─────────────────────────────
    const playerRow = await client.query(
        'SELECT is_ai, display_name FROM players WHERE player_id = $1',
        [playerId]
    );
    const playerInfo = playerRow.rows[0];
    if (!playerInfo) throw new GameActionError('Jugador no encontrado');
    if (playerInfo.is_ai) {
        throw new GameActionError(
            `Los agentes IA no pueden colonizar. El bot "${playerInfo.display_name}" ` +
            `(id=${playerId}) se expande mediante su lógica de conquista interna.`
        );
    }

    // ── 1. Exile status ───────────────────────────────────────────────────────
    const isExiled = await KingdomModel.GetPlayerExileStatus(client, playerId);

    // ── 2. Non-exiled players can only found one capital ──────────────────────
    if (!isExiled) {
        const territoryCount = await KingdomModel.GetTerritoryCount(client, playerId);
        if (territoryCount > 0) {
            throw new GameActionError('👑 Ya tienes una capital. Usa la conquista para expandirte.');
        }
    }

    // ── 3. Validate hex ───────────────────────────────────────────────────────
    const hex = await KingdomModel.GetHexForClaim(client, h3_index);
    if (!hex)               throw new GameActionError('Hexágono no encontrado');
    if (!hex.is_colonizable) throw new GameActionError('🌊 Este terreno no puede ser colonizado');
    if (hex.player_id !== null) throw new GameActionError('🛡️ Este territorio ya está ocupado');

    // ── 4. Gold check ─────────────────────────────────────────────────────────
    const player = await KingdomModel.GetPlayerGoldForUpdate(client, playerId);
    if (player.gold < CLAIM_COST) throw new GameActionError('💰 Oro insuficiente');

    // ── 5. Claim capital hex ──────────────────────────────────────────────────
    const eco = conquest.generateInitialEconomy();
    await KingdomModel.ClaimHex(client, h3_index, playerId);
    await KingdomModel.InsertTerritoryDetails(client, h3_index, eco);
    await KingdomModel.SetCapital(client, h3_index, playerId);
    await KingdomModel.DeductGold(client, playerId, CLAIM_COST);

    if (isExiled) {
        await KingdomModel.ClearExileStatus(client, playerId);
    }

    // ── 6. Radial expansion: colonize ring-1 unclaimed colonizable neighbors ───
    const ring1 = h3.gridDisk(h3_index, 1).filter(n => n !== h3_index);
    const colonizableNeighbors = await KingdomModel.GetColonizableNeighbors(client, ring1);
    for (const neighbor of colonizableNeighbors) {
        await KingdomModel.ClaimHex(client, neighbor.h3_index, playerId);
        await KingdomModel.InsertTerritoryDetails(client, neighbor.h3_index, conquest.generateInitialEconomy());
    }

    const label = _actorLabel(meta, playerId);
    Logger.action(
        `[ACTION]${label}: ${isExiled ? 'Exilio refundado' : 'Capital fundada'} en ${h3_index} (${colonizableNeighbors.length + 1} hexes)`,
        { player_id: playerId, h3_index, claimed_count: colonizableNeighbors.length + 1 }
    );

    return {
        is_capital:    true,
        was_exiled:    isExiled,
        claimed_count: colonizableNeighbors.length + 1,
        message: isExiled
            ? `🏕️ ¡Nuevo asentamiento fundado! Tu reino renace en ${h3_index}.`
            : `👑 ¡Capital fundada! Se han reclamado ${colonizableNeighbors.length} territorios adyacentes.`,
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { executeRecruitment, executeConstruction, executeColonization, GameActionError };
