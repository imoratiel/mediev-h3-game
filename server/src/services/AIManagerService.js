/**
 * AIManagerService.js
 *
 * Gestiona los agentes NPC (reinos no-humanos) con ciclos de decisión
 * orientados por perfil de personalidad.
 *
 * Perfiles disponibles:
 *   - farmer: Expansión pacífica, producción de alimentos, defensa reactiva.
 *
 * Ciclo del Agricultor (por orden de prioridad):
 *   A. Amenaza    → recluta en capital/edificio militar si hay enemigos cerca.
 *   B. Construcción → levanta Market o Church si no hay amenaza y tiene oro.
 *   C. Expansión  → coloniza el mejor hex adyacente libre si tiene suficiente oro.
 */

'use strict';

const pool               = require('../../db.js');
const h3                 = require('h3-js');
const { Logger }         = require('../utils/logger');
const { generateAIName } = require('../utils/npcGenerator');
const KingdomModel       = require('../models/KingdomModel');
const { generateInitialEconomy } = require('../logic/conquest');
const recruitmentNetwork = require('../logic/recruitmentNetwork');

// ── Constantes del perfil Agricultor ─────────────────────────────────────────
const FARMER = {
    STARTING_GOLD:       50_000,
    CLAIM_COST:          100,
    GOLD_TO_BUILD:       4_000,   // Gold mínimo para iniciar construcción
    GOLD_TO_EXPAND:      15_000,  // Gold mínimo para colonizar
    GOLD_RESERVE:        2_000,   // Nunca gastar por debajo de este umbral
    THREAT_SCAN_RADIUS:  2,       // Radio H3 por cada feudo para detectar enemigos
    MIN_TROOPS_DEFEND:   50,      // Si hay amenaza y tiene < este valor, recluta
    RECRUIT_QUANTITY:    50,      // Tropas a reclutar en respuesta a amenaza
    COLORS: ['#8B7355','#6B8E23','#A0522D','#556B2F','#8FBC8F','#BC8F5F','#9ACD32','#DEB887'],
};

class AIManagerService {

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Spawning de un agente Agricultor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Crea un agente Agricultor en el hex indicado (o en uno auto-seleccionado).
     * Reclama el hex capital y los vecinos colonizables de radio 1.
     * @param {string|null} targetH3
     */
    async spawnFarmerAgent(targetH3 = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const spawnHex = targetH3 || await this._findSuitableSpawnHex(client);
            if (!spawnHex) {
                await client.query('ROLLBACK');
                return { success: false, message: 'No se encontró un hex disponible para el agente IA' };
            }

            const hexCheck = await client.query(
                `SELECT h3_index FROM h3_map
                 JOIN terrain_types tt ON h3_map.terrain_type_id = tt.terrain_type_id
                 WHERE h3_map.h3_index = $1
                   AND h3_map.player_id IS NULL
                   AND COALESCE(tt.is_colonizable, TRUE) = TRUE`,
                [spawnHex]
            );
            if (hexCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: `El hex ${spawnHex} no está disponible` };
            }

            const aiName     = generateAIName('farmer');
            const aiColor    = FARMER.COLORS[Math.floor(Math.random() * FARMER.COLORS.length)];
            const aiUsername = `ai_farmer_${Date.now()}`;

            const playerResult = await client.query(
                `INSERT INTO players (username, password, display_name, color, gold, is_ai, ai_profile, role)
                 VALUES ($1, 'NO_LOGIN', $2, $3, $4, TRUE, 'farmer', 'player')
                 RETURNING player_id`,
                [aiUsername, aiName, aiColor, FARMER.STARTING_GOLD]
            );
            const aiPlayerId = playerResult.rows[0].player_id;

            const capitalEco = generateInitialEconomy();
            await KingdomModel.ClaimHex(client, spawnHex, aiPlayerId);
            await KingdomModel.InsertTerritoryDetails(client, spawnHex, capitalEco);
            await KingdomModel.SetCapital(client, spawnHex, aiPlayerId);

            const ring1      = h3.gridDisk(spawnHex, 1).filter(n => n !== spawnHex);
            const neighbors  = await KingdomModel.GetColonizableNeighbors(client, ring1);
            for (const neighbor of neighbors) {
                const eco = generateInitialEconomy();
                await KingdomModel.ClaimHex(client, neighbor.h3_index, aiPlayerId);
                await KingdomModel.InsertTerritoryDetails(client, neighbor.h3_index, eco);
            }

            await client.query('COMMIT');

            Logger.action(
                `[AI] 🌾 Agente Agricultor "${aiName}" (id=${aiPlayerId}) fundado en ${spawnHex} (${neighbors.length + 1} hexes)`,
                { player_id: aiPlayerId, h3_index: spawnHex }
            );
            return { success: true, player_id: aiPlayerId, name: aiName,
                     h3_index: spawnHex, hexes_claimed: neighbors.length + 1 };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService.spawnFarmerAgent', targetH3 });
            return { success: false, message: error.message };
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Procesar un turno para todos los agentes activos
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Llamado por el motor de turnos cada N turnos.
     * Itera todos los agentes IA y ejecuta su ciclo de decisión.
     * @param {number} turn - Número de turno actual
     */
    async processAITurn(turn) {
        let agents = [];
        const qClient = await pool.connect();
        try {
            const result = await qClient.query(
                `SELECT player_id, display_name, ai_profile FROM players WHERE is_ai = TRUE`
            );
            agents = result.rows;
        } finally {
            qClient.release();
        }

        if (agents.length === 0) return;
        Logger.engine(`[TURN ${turn}] 🤖 AI: procesando ${agents.length} agente(s)...`);

        for (const agent of agents) {
            try {
                if (agent.ai_profile === 'farmer') {
                    await this._processFarmerTurn(agent.player_id, turn);
                }
            } catch (agentError) {
                Logger.error(agentError, {
                    context: 'AIManagerService.processAITurn',
                    turn, playerId: agent.player_id,
                });
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Ciclo completo del Agricultor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ciclo de decisión del perfil Agricultor.
     * Prioridad: A (amenaza) → B (construcción) → C (expansión)
     */
    async _processFarmerTurn(playerId, turn) {
        // ── Paso A: Análisis + detección de amenaza ──────────────────────────
        const state = await this._farmerAnalysis(playerId);
        if (!state || state.territories.length === 0) return; // IA sin territorios

        if (state.isThreatened) {
            // En modo defensivo: solo recluta, omite construcción y expansión
            if (state.totalTroops < FARMER.MIN_TROOPS_DEFEND) {
                await this._farmerThreatResponse(state, playerId, turn);
            } else {
                Logger.engine(`[TURN ${turn}] 🛡️ AI Agricultor (${playerId}) amenazado pero con tropas suficientes (${state.totalTroops})`);
            }
            return;
        }

        // ── Pasos B + C: Construcción y expansión (sin amenaza) ──────────────
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await this._farmerConstruction(client, playerId, state, turn);
            await this._farmerExpansion(client, playerId, state, turn);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processFarmerTurn.BC', playerId, turn });
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fases de análisis
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fase A — Lee el estado completo del agente y detecta amenazas.
     * Sin transacción (solo lectura).
     * @returns {Object|null} state
     */
    async _farmerAnalysis(playerId) {
        const client = await pool.connect();
        try {
            // Foto del reino: territorios, gold, edificios, tropas propias
            const kingdomResult = await client.query(`
                SELECT
                    m.h3_index,
                    td.population,
                    td.food_stored,
                    tt.food_output,
                    tt.name               AS terrain_name,
                    p.gold,
                    p.capital_h3,
                    fb.building_id        AS existing_building_id,
                    fb.is_under_construction,
                    bt.name               AS building_type_name
                FROM territory_details td
                JOIN h3_map m          ON td.h3_index = m.h3_index
                JOIN terrain_types tt  ON m.terrain_type_id = tt.terrain_type_id
                JOIN players p         ON p.player_id = m.player_id
                LEFT JOIN fief_buildings fb  ON fb.h3_index = td.h3_index
                LEFT JOIN buildings bld      ON bld.id = fb.building_id
                LEFT JOIN building_types bt  ON bt.building_type_id = bld.type_id
                WHERE m.player_id = $1
            `, [playerId]);

            if (kingdomResult.rows.length === 0) return null;

            const gold       = parseInt(kingdomResult.rows[0].gold) || 0;
            const capitalH3  = kingdomResult.rows[0].capital_h3;
            const territories = kingdomResult.rows;

            // Troop count
            const troopResult = await client.query(`
                SELECT COALESCE(SUM(tr.quantity), 0)::int AS total
                FROM armies a
                JOIN troops tr ON tr.army_id = a.army_id
                WHERE a.player_id = $1
            `, [playerId]);
            const totalTroops = parseInt(troopResult.rows[0].total) || 0;

            // Feudos sin edificio (candidatos para construir)
            const territoriesWithoutBuilding = territories.filter(t => !t.existing_building_id);

            // Localizaciones válidas para reclutar: capital + feudos con edificio militar completado
            const recruitLocations = [];
            if (capitalH3) recruitLocations.push(capitalH3);
            for (const t of territories) {
                if (t.h3_index !== capitalH3 &&
                    t.building_type_name === 'military' &&
                    t.existing_building_id &&
                    !t.is_under_construction) {
                    recruitLocations.push(t.h3_index);
                }
            }

            // Detección de amenaza: escanear radio THREAT_SCAN_RADIUS alrededor de TODOS los feudos
            const scanAreaSet = new Set();
            for (const t of territories) {
                h3.gridDisk(t.h3_index, FARMER.THREAT_SCAN_RADIUS).forEach(cell => scanAreaSet.add(cell));
            }
            const scanArea = [...scanAreaSet];

            const threatResult = await client.query(`
                SELECT COUNT(*)::int AS enemy_count
                FROM armies
                WHERE h3_index = ANY($1) AND player_id != $2
            `, [scanArea, playerId]);
            const isThreatened = parseInt(threatResult.rows[0].enemy_count) > 0;

            return {
                gold, capitalH3, territories, territoriesWithoutBuilding,
                totalTroops, recruitLocations, isThreatened,
            };
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase B — Construcción de infraestructura
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fase B — Construcción: levanta un Market o Church (edificios con food_bonus)
     * en el feudo con más food_stored entre los que no tienen edificio.
     * Solo un edificio por turno para simular decisión de ahorro.
     */
    async _farmerConstruction(client, playerId, state, turn) {
        if (state.gold < FARMER.GOLD_TO_BUILD) return;
        if (state.territoriesWithoutBuilding.length === 0) return;

        // Solo Market (economic) o Church (religious): buildings con food_bonus > 0
        const buildingsResult = await client.query(`
            SELECT b.id, b.name, b.gold_cost, b.construction_time_turns, b.food_bonus,
                   bt.name AS type_name
            FROM buildings b
            JOIN building_types bt ON bt.building_type_id = b.type_id
            WHERE b.required_building_id IS NULL
              AND b.food_bonus > 0
            ORDER BY b.food_bonus DESC, b.gold_cost ASC
        `);
        if (buildingsResult.rows.length === 0) return;

        // El edificio más rentable que el agente puede permitirse respetando la reserva
        const building = buildingsResult.rows.find(
            b => state.gold - parseInt(b.gold_cost) >= FARMER.GOLD_RESERVE
        );
        if (!building) return;

        // Territorio objetivo: sin edificio + mayor food_stored (sitio más activo)
        const target = state.territoriesWithoutBuilding.reduce((best, t) =>
            parseInt(t.food_stored) > parseInt(best.food_stored) ? t : best
        );

        await client.query(
            'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
            [building.gold_cost, playerId]
        );
        await client.query(`
            INSERT INTO fief_buildings (h3_index, building_id, remaining_construction_turns, is_under_construction)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (h3_index) DO NOTHING
        `, [target.h3_index, building.id, building.construction_time_turns]);

        const emoji = building.type_name === 'economic' ? '🏪' : '⛪';
        Logger.engine(
            `[TURN ${turn}] ${emoji} AI Agricultor (${playerId}) inició construcción de "${building.name}" en ${target.h3_index} (-${building.gold_cost}💰)`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase C — Expansión agrícola
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fase C — Expansión: coloniza el hex adyacente libre con mayor food_output
     * si el agente supera el umbral de oro para expansión.
     */
    async _farmerExpansion(client, playerId, state, turn) {
        if (state.gold < FARMER.GOLD_TO_EXPAND) return;

        const ownedSet = new Set(state.territories.map(t => t.h3_index));

        // Todos los vecinos de todos los feudos propios que no son propios
        const candidateSet = new Set();
        for (const hex of ownedSet) {
            h3.gridDisk(hex, 1)
              .filter(n => n !== hex && !ownedSet.has(n))
              .forEach(n => candidateSet.add(n));
        }
        if (candidateSet.size === 0) return;

        const candidates = [...candidateSet];
        const result = await client.query(`
            SELECT m.h3_index, tt.food_output, tt.name AS terrain_name
            FROM h3_map m
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            WHERE m.h3_index = ANY($1)
              AND m.player_id IS NULL
              AND COALESCE(tt.is_colonizable, TRUE) = TRUE
            ORDER BY tt.food_output DESC
            LIMIT 1
            FOR UPDATE OF m
        `, [candidates]);
        if (result.rows.length === 0) return;

        const target = result.rows[0];
        const eco    = generateInitialEconomy();

        await client.query(
            'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
            [FARMER.CLAIM_COST, playerId]
        );
        await KingdomModel.ClaimHex(client, target.h3_index, playerId);
        await KingdomModel.InsertTerritoryDetails(client, target.h3_index, eco);

        const terrainLower = (target.terrain_name || '').toLowerCase();
        const emoji = terrainLower.includes('bosque') ? '🌲'
                    : terrainLower.includes('llanura') || terrainLower.includes('cultivo') ? '🌾'
                    : '🗺️';
        Logger.engine(
            `[TURN ${turn}] ${emoji} AI Agricultor (${playerId}) expandió a ${target.h3_index} (${target.terrain_name}, food=${target.food_output})`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase A — Respuesta a amenaza con reclutamiento
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Respuesta a amenaza: recluta tropas básicas en la primera ubicación válida
     * (capital o feudo con edificio militar) que tenga población suficiente en
     * su red de suministro.
     *
     * Cumple la Regla de Red de Suministro: usa recruitmentNetwork para
     * verificar y detraer población de los feudos conectados.
     *
     * @param {Object} state     - Estado pre-calculado por _farmerAnalysis
     * @param {number} playerId
     * @param {number} turn
     */
    async _farmerThreatResponse(state, playerId, turn) {
        if (state.recruitLocations.length === 0) return;

        // Obtener tipo de unidad más barata (Milicia)
        const unitResult = await pool.query(`
            SELECT ut.unit_type_id, COALESCE(r.amount, 0)::int AS gold_cost
            FROM unit_types ut
            LEFT JOIN unit_requirements r
              ON r.unit_type_id = ut.unit_type_id AND r.resource_type = 'gold'
            ORDER BY COALESCE(r.amount, 0) ASC
            LIMIT 1
        `);
        if (unitResult.rows.length === 0) return;

        const unitType      = unitResult.rows[0];
        const totalGoldCost = unitType.gold_cost * FARMER.RECRUIT_QUANTITY;

        // Verificación rápida de gold antes de abrir transacción
        if (state.gold < totalGoldCost + FARMER.GOLD_RESERVE) return;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Re-verificar gold con bloqueo para evitar condiciones de carrera
            const freshGoldResult = await client.query(
                'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE',
                [playerId]
            );
            const currentGold = parseInt(freshGoldResult.rows[0]?.gold) || 0;
            if (currentGold < totalGoldCost + FARMER.GOLD_RESERVE) {
                await client.query('ROLLBACK');
                return;
            }

            // Buscar primera ubicación válida con población suficiente en red conectada
            let recruitH3        = null;
            let connectedH3s     = null;
            let lockedFiefPops   = null;

            for (const locationH3 of state.recruitLocations) {
                const network       = await recruitmentNetwork.getConnectedNetwork(client, locationH3, playerId);
                const fiefPops      = await recruitmentNetwork.getFiefPopulations(client, network);  // FOR UPDATE
                const availablePop  = recruitmentNetwork.calcRecruitablePool(fiefPops);

                if (availablePop >= FARMER.RECRUIT_QUANTITY) {
                    recruitH3      = locationH3;
                    connectedH3s   = network;
                    lockedFiefPops = fiefPops;
                    break;
                }
            }

            if (!recruitH3) {
                await client.query('ROLLBACK');
                Logger.engine(`[TURN ${turn}] 🛡️ AI Agricultor (${playerId}) amenazado pero sin población suficiente para reclutar`);
                return;
            }

            // Encontrar o crear ejército en la ubicación de reclutamiento
            const existingArmy = await client.query(
                'SELECT army_id FROM armies WHERE player_id = $1 AND h3_index = $2 LIMIT 1',
                [playerId, recruitH3]
            );
            let armyId;
            if (existingArmy.rows.length > 0) {
                armyId = existingArmy.rows[0].army_id;
            } else {
                const newArmy = await client.query(`
                    INSERT INTO armies (name, player_id, h3_index)
                    VALUES ('Milicia Campesina', $1, $2)
                    RETURNING army_id
                `, [playerId, recruitH3]);
                armyId = newArmy.rows[0].army_id;
            }

            // Añadir tropas (UPSERT)
            await client.query(`
                INSERT INTO troops (army_id, unit_type_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (army_id, unit_type_id)
                DO UPDATE SET quantity = troops.quantity + EXCLUDED.quantity
            `, [armyId, unitType.unit_type_id, FARMER.RECRUIT_QUANTITY]);

            // Deducir oro
            if (totalGoldCost > 0) {
                await client.query(
                    'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                    [totalGoldCost, playerId]
                );
            }

            // Deducir población de la red (regla de suministro)
            await recruitmentNetwork.deductFromNetwork(
                client, connectedH3s, lockedFiefPops, FARMER.RECRUIT_QUANTITY
            );

            await client.query('COMMIT');

            const isCapital = recruitH3 === state.capitalH3;
            Logger.engine(
                `[TURN ${turn}] ⚔️ AI Agricultor (${playerId}) reclutó ${FARMER.RECRUIT_QUANTITY} tropas en ${recruitH3} ` +
                `(${isCapital ? 'capital' : 'cuartel'}, amenaza detectada, -${totalGoldCost}💰)`
            );
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._farmerThreatResponse', playerId, turn });
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Encuentra un hex colonizable y con producción de comida > 0 para spawn.
     * Devuelve uno aleatoriamente entre los 20 mejores candidatos.
     */
    async _findSuitableSpawnHex(client) {
        const result = await client.query(`
            SELECT m.h3_index
            FROM h3_map m
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            WHERE m.player_id IS NULL
              AND COALESCE(tt.is_colonizable, TRUE) = TRUE
              AND tt.food_output > 0
            ORDER BY RANDOM()
            LIMIT 20
        `);
        return result.rows[0]?.h3_index || null;
    }
}

module.exports = new AIManagerService();
