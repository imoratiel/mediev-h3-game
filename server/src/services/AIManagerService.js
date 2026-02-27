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
const aiProxy            = require('./AIProxyService');
const { executeRecruitment, executeConstruction, GameActionError } = require('./gameActions');

// ── Constantes del perfil Agricultor ─────────────────────────────────────────
// ── Constantes del perfil Expansionista ──────────────────────────────────────
const EXPANSIONIST = {
    STARTING_GOLD:       60_000,
    CLAIM_COST:          100,
    GOLD_TO_BUILD:       8_000,   // Build military only if well-funded
    GOLD_TO_RECRUIT:     5_000,   // Recruit unconditionally above this
    GOLD_RESERVE:        3_000,   // Never go below this
    RECRUIT_QUANTITY:    100,     // Larger batches for aggression
    COLORS: ['#8B0000','#B22222','#DC143C','#800000','#4A0E0E','#C0392B','#922B21','#641E16'],
};

// ── Constantes del perfil Equilibrado ────────────────────────────────────────
const BALANCED = {
    STARTING_GOLD:        55_000,
    CLAIM_COST:           100,
    GOLD_TO_EXPAND:       20_000,  // More conservative than farmer (15K)
    GOLD_TO_BUILD:        5_000,
    GOLD_TO_RECRUIT:      3_000,
    GOLD_RESERVE:         3_500,
    RECRUIT_QUANTITY:     40,
    GARRISON_RATIO:       0.30,    // Maintain 30% of total population as troops
    FOOD_GOLD_RATIO_MIN:  0.30,    // food_stored / gold: below this → prioritize food terrain
    COLORS: ['#1565C0','#1976D2','#283593','#0D47A1','#0288D1','#01579B','#006064','#00695C'],
};

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
    // PÚBLICO: Spawning de agentes
    // ─────────────────────────────────────────────────────────────────────────

    async spawnFarmerAgent(targetH3 = null) {
        return this._spawnAgent('farmer', FARMER, targetH3);
    }

    async spawnExpansionistAgent(targetH3 = null) {
        return this._spawnAgent('expansionist', EXPANSIONIST, targetH3);
    }

    async spawnBalancedAgent(targetH3 = null) {
        return this._spawnAgent('balanced', BALANCED, targetH3);
    }

    /**
     * Lógica de spawn compartida.
     * Crea el jugador IA, reclama el hex capital y los vecinos colonizables de radio 1.
     */
    async _spawnAgent(profile, config, targetH3 = null) {
        const LABEL = { farmer: 'Agricultor', expansionist: 'Expansionista', balanced: 'Equilibrado' };

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

            const aiName     = generateAIName(profile);
            const aiColor    = config.COLORS[Math.floor(Math.random() * config.COLORS.length)];
            const aiUsername = `ai_${profile}_${Date.now()}`;

            const playerResult = await client.query(
                `INSERT INTO players (username, password, display_name, color, gold, is_ai, ai_profile, role)
                 VALUES ($1, 'NO_LOGIN', $2, $3, $4, TRUE, $5, 'player')
                 RETURNING player_id`,
                [aiUsername, aiName, aiColor, config.STARTING_GOLD, profile]
            );
            const aiPlayerId = playerResult.rows[0].player_id;

            const capitalEco = generateInitialEconomy();
            await KingdomModel.ClaimHex(client, spawnHex, aiPlayerId);
            await KingdomModel.InsertTerritoryDetails(client, spawnHex, capitalEco);
            await KingdomModel.SetCapital(client, spawnHex, aiPlayerId);

            const ring1     = h3.gridDisk(spawnHex, 1).filter(n => n !== spawnHex);
            const neighbors = await KingdomModel.GetColonizableNeighbors(client, ring1);
            for (const neighbor of neighbors) {
                const eco = generateInitialEconomy();
                await KingdomModel.ClaimHex(client, neighbor.h3_index, aiPlayerId);
                await KingdomModel.InsertTerritoryDetails(client, neighbor.h3_index, eco);
            }

            await client.query('COMMIT');

            Logger.action(
                `[ACTION][${aiName}]: Agente ${LABEL[profile]} fundado en ${spawnHex} (${neighbors.length + 1} hexes)`,
                { player_id: aiPlayerId, h3_index: spawnHex }
            );
            return { success: true, player_id: aiPlayerId, name: aiName,
                     h3_index: spawnHex, hexes_claimed: neighbors.length + 1 };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: `AIManagerService._spawnAgent[${profile}]`, targetH3 });
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

        // Check proxy availability once per cycle (cached 30s) — avoids per-agent DB hits
        const { available: aiAvailable, provider: aiProvider } = await aiProxy.checkAvailability();

        for (const agent of agents) {
            try {
                if (aiAvailable) {
                    await this._processAIGuidedTurn(agent, turn);
                } else {
                    // Procedural fallback (default behavior)
                    if (agent.ai_profile === 'farmer') {
                        await this._processFarmerTurn(agent, turn);
                    } else if (agent.ai_profile === 'expansionist') {
                        await this._processExpansionistTurn(agent, turn);
                    } else if (agent.ai_profile === 'balanced') {
                        await this._processBalancedTurn(agent, turn);
                    }
                }
            } catch (agentError) {
                Logger.error(agentError, {
                    context: 'AIManagerService.processAITurn',
                    turn, playerId: agent.player_id, provider: aiProvider,
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
    async _processFarmerTurn(agent, turn) {
        const { player_id: playerId, display_name: botName } = agent;
        // ── Paso A: Análisis + detección de amenaza ──────────────────────────
        const state = await this._farmerAnalysis(playerId);
        if (!state || state.territories.length === 0) return; // IA sin territorios

        if (state.isThreatened) {
            // En modo defensivo: solo recluta, omite construcción y expansión
            if (state.totalTroops < FARMER.MIN_TROOPS_DEFEND) {
                await this._farmerThreatResponse(state, playerId, botName, turn);
            } else {
                Logger.engine(`[TURN ${turn}] 🛡️ AI Agricultor (${playerId}) amenazado pero con tropas suficientes (${state.totalTroops})`);
            }
            return;
        }

        // ── Pasos B + C: Construcción y expansión (sin amenaza) ──────────────
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await this._farmerConstruction(client, playerId, botName, state, turn);
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
    async _farmerConstruction(client, playerId, botName, state, turn) {
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

        try {
            await executeConstruction(client, playerId, { h3_index: target.h3_index, building_id: building.id }, { actorName: botName });
            const emoji = building.type_name === 'economic' ? '🏪' : '⛪';
            Logger.engine(`[TURN ${turn}] ${emoji} AI Agricultor (${playerId}) inició construcción de "${building.name}" en ${target.h3_index}`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.engine(`[TURN ${turn}] ⚠️ AI Agricultor (${playerId}) construcción rechazada: ${err.message}`);
            } else { throw err; }
        }
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

        await KingdomModel.DeductGold(client, playerId, FARMER.CLAIM_COST);
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
    async _farmerThreatResponse(state, playerId, botName, turn) {
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
            let recruitH3 = null;
            for (const locationH3 of state.recruitLocations) {
                const network      = await recruitmentNetwork.getConnectedNetwork(client, locationH3, playerId);
                const fiefPops     = await recruitmentNetwork.getFiefPopulations(client, network);
                const availablePop = recruitmentNetwork.calcRecruitablePool(fiefPops);
                if (availablePop >= FARMER.RECRUIT_QUANTITY) {
                    recruitH3 = locationH3;
                    break;
                }
            }

            if (!recruitH3) {
                await client.query('ROLLBACK');
                Logger.engine(`[TURN ${turn}] 🛡️ AI Agricultor (${playerId}) amenazado pero sin población suficiente para reclutar`);
                return;
            }

            // executeRecruitment aplica todas las validaciones + muta DB
            await executeRecruitment(
                client, playerId,
                { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: FARMER.RECRUIT_QUANTITY, army_name: 'Milicia Campesina' },
                { actorName: botName }
            );

            await client.query('COMMIT');

            const isCapital = recruitH3 === state.capitalH3;
            Logger.engine(
                `[TURN ${turn}] ⚔️ AI Agricultor (${playerId}) reclutó ${FARMER.RECRUIT_QUANTITY} tropas en ${recruitH3} ` +
                `(${isCapital ? 'capital' : 'cuartel'}, amenaza detectada)`
            );
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._farmerThreatResponse', playerId, turn });
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Ciclo completo del Expansionista
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ciclo de decisión del perfil Expansionista.
     * Prioridad: A (colonizar) → B (reclutar) → C (construir cuarteles en la frontera)
     * No espera amenazas: siempre recluta si hay oro y población suficiente.
     */
    async _processExpansionistTurn(agent, turn) {
        const { player_id: playerId, display_name: botName } = agent;
        const state = await this._expansionistAnalysis(playerId);
        if (!state || state.territories.length === 0) return;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await this._expansionistColonization(client, playerId, state, turn);
            await this._expansionistRecruitment(client, playerId, botName, state, turn);
            await this._expansionistConstruction(client, playerId, botName, state, turn);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processExpansionistTurn', playerId, turn });
        } finally {
            client.release();
        }
    }

    /**
     * Fase de análisis del Expansionista (solo lectura).
     * Calcula territorios, frontera, candidatos de expansión y ubicaciones de reclutamiento.
     */
    async _expansionistAnalysis(playerId) {
        const client = await pool.connect();
        try {
            const kingdomResult = await client.query(`
                SELECT
                    m.h3_index,
                    td.population,
                    p.gold,
                    p.capital_h3,
                    fb.building_id        AS existing_building_id,
                    fb.is_under_construction,
                    bt.name               AS building_type_name
                FROM territory_details td
                JOIN h3_map m         ON td.h3_index = m.h3_index
                JOIN players p        ON p.player_id = m.player_id
                LEFT JOIN fief_buildings fb ON fb.h3_index = td.h3_index
                LEFT JOIN buildings bld     ON bld.id = fb.building_id
                LEFT JOIN building_types bt ON bt.building_type_id = bld.type_id
                WHERE m.player_id = $1
            `, [playerId]);

            if (kingdomResult.rows.length === 0) return null;

            const gold      = parseInt(kingdomResult.rows[0].gold) || 0;
            const capitalH3 = kingdomResult.rows[0].capital_h3;
            const territories = kingdomResult.rows;
            const ownedSet  = new Set(territories.map(t => t.h3_index));

            // Expansion candidates: adjacent unclaimed hexes
            const candidateSet = new Set();
            for (const hex of ownedSet) {
                h3.gridDisk(hex, 1)
                  .filter(n => n !== hex && !ownedSet.has(n))
                  .forEach(n => candidateSet.add(n));
            }

            // Frontier hexes: own hexes with at least one non-owned neighbor
            const frontierHexes = territories.filter(t =>
                h3.gridDisk(t.h3_index, 1).some(n => n !== t.h3_index && !ownedSet.has(n))
            );

            // Territories without buildings (frontier priority for construction)
            const territoriesWithoutBuilding = territories.filter(t => !t.existing_building_id);

            // Recruit locations: capital + completed military building fiefs
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

            return {
                gold, capitalH3, territories, ownedSet,
                candidateSet: [...candidateSet],
                frontierHexes, territoriesWithoutBuilding,
                recruitLocations,
            };
        } finally {
            client.release();
        }
    }

    /**
     * Fase A — Colonización agresiva: coloniza TODOS los hexes adyacentes libres
     * que el oro permita (criterio: espacio disponible, no food_output).
     */
    async _expansionistColonization(client, playerId, state, turn) {
        if (state.candidateSet.length === 0) return;

        // Lock gold row once for the whole colonization loop
        const goldRow = await client.query(
            'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE',
            [playerId]
        );
        let currentGold = parseInt(goldRow.rows[0]?.gold) || 0;

        if (currentGold < EXPANSIONIST.CLAIM_COST + EXPANSIONIST.GOLD_RESERVE) return;

        const result = await client.query(`
            SELECT m.h3_index
            FROM h3_map m
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            WHERE m.h3_index = ANY($1)
              AND m.player_id IS NULL
              AND COALESCE(tt.is_colonizable, TRUE) = TRUE
            FOR UPDATE OF m
        `, [state.candidateSet]);

        if (result.rows.length === 0) return;

        let colonized = 0;
        for (const target of result.rows) {
            if (currentGold < EXPANSIONIST.CLAIM_COST + EXPANSIONIST.GOLD_RESERVE) break;

            await KingdomModel.DeductGold(client, playerId, EXPANSIONIST.CLAIM_COST);
            await KingdomModel.ClaimHex(client, target.h3_index, playerId);
            await KingdomModel.InsertTerritoryDetails(client, target.h3_index, generateInitialEconomy());

            currentGold -= EXPANSIONIST.CLAIM_COST;
            colonized++;
        }

        if (colonized > 0) {
            Logger.engine(
                `[TURN ${turn}] 🗺️ AI Expansionista (${playerId}) colonizó ${colonized} hex(es) (-${colonized * EXPANSIONIST.CLAIM_COST}💰)`
            );
        }
    }

    /**
     * Fase B — Reclutamiento incondicional: recluta si el oro supera el umbral,
     * sin necesidad de amenaza previa.
     * Usa la red de suministro con bloqueo FOR UPDATE.
     */
    async _expansionistRecruitment(client, playerId, botName, state, turn) {
        if (state.recruitLocations.length === 0) return;

        const unitResult = await pool.query(`
            SELECT ut.unit_type_id, COALESCE(r.amount, 0)::int AS gold_cost
            FROM unit_types ut
            LEFT JOIN unit_requirements r
              ON r.unit_type_id = ut.unit_type_id AND r.resource_type = 'gold'
            ORDER BY COALESCE(r.amount, 0) ASC
            LIMIT 1
        `);
        if (unitResult.rows.length === 0) return;

        const unitType    = unitResult.rows[0];
        const totalGoldCost = unitType.gold_cost * EXPANSIONIST.RECRUIT_QUANTITY;

        // Re-verify gold with lock
        const freshGold   = await client.query(
            'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [playerId]
        );
        const currentGold = parseInt(freshGold.rows[0]?.gold) || 0;
        if (currentGold < EXPANSIONIST.GOLD_TO_RECRUIT) return;
        if (currentGold < totalGoldCost + EXPANSIONIST.GOLD_RESERVE) return;

        // Find first recruit location with sufficient population
        let recruitH3 = null;
        for (const locationH3 of state.recruitLocations) {
            const network      = await recruitmentNetwork.getConnectedNetwork(client, locationH3, playerId);
            const fiefPops     = await recruitmentNetwork.getFiefPopulations(client, network);
            const availablePop = recruitmentNetwork.calcRecruitablePool(fiefPops);
            if (availablePop >= EXPANSIONIST.RECRUIT_QUANTITY) {
                recruitH3 = locationH3;
                break;
            }
        }

        if (!recruitH3) {
            Logger.engine(`[TURN ${turn}] ⚔️ AI Expansionista (${playerId}) sin población suficiente para reclutar`);
            return;
        }

        await executeRecruitment(
            client, playerId,
            { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: EXPANSIONIST.RECRUIT_QUANTITY, army_name: 'Horda Expansionista' },
            { actorName: botName }
        );

        Logger.engine(`[TURN ${turn}] ⚔️ AI Expansionista (${playerId}) reclutó ${EXPANSIONIST.RECRUIT_QUANTITY} tropas en ${recruitH3}`);
    }

    /**
     * Fase C — Construcción: levanta un cuartel (edificio militar base) en el feudo
     * de frontera más alejado de la capital — empuja el punto de reclutamiento al frente.
     */
    async _expansionistConstruction(client, playerId, botName, state, turn) {
        const freshGold = await client.query(
            'SELECT gold FROM players WHERE player_id = $1', [playerId]
        );
        const currentGold = parseInt(freshGold.rows[0]?.gold) || 0;

        if (currentGold < EXPANSIONIST.GOLD_TO_BUILD) return;

        // Frontier fiefs without any building
        const frontierNoBuild = state.frontierHexes.filter(t => !t.existing_building_id);
        if (frontierNoBuild.length === 0) return;

        // Get base military building
        const bldResult = await client.query(`
            SELECT b.id, b.name, b.gold_cost, b.construction_time_turns
            FROM buildings b
            JOIN building_types bt ON bt.building_type_id = b.type_id
            WHERE bt.name = 'military'
              AND b.required_building_id IS NULL
            ORDER BY b.gold_cost ASC
            LIMIT 1
        `);
        if (bldResult.rows.length === 0) return;

        const building = bldResult.rows[0];
        if (currentGold - parseInt(building.gold_cost) < EXPANSIONIST.GOLD_RESERVE) return;

        // Pick the frontier fief FURTHEST from capital (the "front line")
        let target = frontierNoBuild[0];
        if (state.capitalH3 && frontierNoBuild.length > 1) {
            try {
                target = frontierNoBuild.reduce((best, t) => {
                    const dT = h3.gridDistance(state.capitalH3, t.h3_index);
                    const dB = h3.gridDistance(state.capitalH3, best.h3_index);
                    return dT > dB ? t : best;
                });
            } catch { /* gridDistance may throw on mismatched resolutions */ }
        }

        try {
            await executeConstruction(client, playerId, { h3_index: target.h3_index, building_id: building.id }, { actorName: botName });
            Logger.engine(`[TURN ${turn}] 🏯 AI Expansionista (${playerId}) construyendo "${building.name}" en ${target.h3_index} (frontera)`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.engine(`[TURN ${turn}] ⚠️ AI Expansionista (${playerId}) construcción rechazada: ${err.message}`);
            } else { throw err; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Ciclo completo del Equilibrado
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ciclo de decisión del perfil Equilibrado.
     * Prioridad: A (construcción circular) → B (expansión selectiva) → C (reclutamiento de guarnición)
     * Evaluación del ratio food/gold para determinar prioridades de expansión.
     */
    async _processBalancedTurn(agent, turn) {
        const { player_id: playerId, display_name: botName } = agent;
        const state = await this._balancedAnalysis(playerId);
        if (!state || state.territories.length === 0) return;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await this._balancedConstruction(client, playerId, botName, state, turn);
            await this._balancedExpansion(client, playerId, state, turn);
            await this._balancedRecruitment(client, playerId, botName, state, turn);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processBalancedTurn', playerId, turn });
        } finally {
            client.release();
        }
    }

    /**
     * Fase de análisis del Equilibrado (solo lectura).
     * Calcula ratio food/gold, objetivo de guarnición y estado general del reino.
     */
    async _balancedAnalysis(playerId) {
        const client = await pool.connect();
        try {
            const kingdomResult = await client.query(`
                SELECT
                    m.h3_index,
                    td.population,
                    td.food_stored,
                    tt.food_output,
                    tt.wood_output,
                    tt.stone_output,
                    tt.name               AS terrain_name,
                    p.gold,
                    p.capital_h3,
                    fb.building_id        AS existing_building_id,
                    fb.is_under_construction,
                    bt.name               AS building_type_name
                FROM territory_details td
                JOIN h3_map m         ON td.h3_index = m.h3_index
                JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
                JOIN players p        ON p.player_id = m.player_id
                LEFT JOIN fief_buildings fb ON fb.h3_index = td.h3_index
                LEFT JOIN buildings bld     ON bld.id = fb.building_id
                LEFT JOIN building_types bt ON bt.building_type_id = bld.type_id
                WHERE m.player_id = $1
            `, [playerId]);

            if (kingdomResult.rows.length === 0) return null;

            const gold      = parseInt(kingdomResult.rows[0].gold) || 0;
            const capitalH3 = kingdomResult.rows[0].capital_h3;
            const territories = kingdomResult.rows;
            const ownedSet  = new Set(territories.map(t => t.h3_index));

            // Food ratio: compare total food_stored vs current gold
            const totalFoodStored = territories.reduce((s, t) => s + (parseInt(t.food_stored) || 0), 0);
            const foodGoldRatio   = gold > 0 ? totalFoodStored / gold : 1;

            // Garrison target: 30% of total population
            const totalPopulation = territories.reduce((s, t) => s + (parseInt(t.population) || 0), 0);
            const garrisonTarget  = Math.floor(totalPopulation * BALANCED.GARRISON_RATIO);

            const troopResult = await client.query(`
                SELECT COALESCE(SUM(tr.quantity), 0)::int AS total
                FROM armies a
                JOIN troops tr ON tr.army_id = a.army_id
                WHERE a.player_id = $1
            `, [playerId]);
            const totalTroops = parseInt(troopResult.rows[0].total) || 0;

            // Expansion candidates
            const candidateSet = new Set();
            for (const hex of ownedSet) {
                h3.gridDisk(hex, 1)
                  .filter(n => n !== hex && !ownedSet.has(n))
                  .forEach(n => candidateSet.add(n));
            }

            // Frontier hexes (own hexes with at least one non-owned neighbor)
            const frontierSet = new Set(
                territories
                    .filter(t => h3.gridDisk(t.h3_index, 1).some(n => n !== t.h3_index && !ownedSet.has(n)))
                    .map(t => t.h3_index)
            );

            // Recruit locations: capital + completed military buildings
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

            return {
                gold, capitalH3, territories, ownedSet,
                candidateSet: [...candidateSet],
                frontierSet,
                totalFoodStored, foodGoldRatio,
                totalPopulation, garrisonTarget, totalTroops,
                recruitLocations,
            };
        } finally {
            client.release();
        }
    }

    /**
     * Fase A — Construcción circular: Market en capital → Church en interior → Barracks en frontera.
     * Solo un edificio por turno.
     */
    async _balancedConstruction(client, playerId, botName, state, turn) {
        if (state.gold < BALANCED.GOLD_TO_BUILD) return;

        let targetH3     = null;
        let buildingType = null; // 'economic' | 'religious' | 'military'

        const capitalTerr = state.territories.find(t => t.h3_index === state.capitalH3);
        if (capitalTerr && !capitalTerr.existing_building_id) {
            targetH3 = state.capitalH3;
            buildingType = 'economic';
        } else {
            // Interior: not frontier, not capital, no building
            const interiorNoBuild = state.territories.filter(
                t => t.h3_index !== state.capitalH3 &&
                     !state.frontierSet.has(t.h3_index) &&
                     !t.existing_building_id
            );
            if (interiorNoBuild.length > 0) {
                interiorNoBuild.sort((a, b) => (parseInt(b.population) || 0) - (parseInt(a.population) || 0));
                targetH3 = interiorNoBuild[0].h3_index;
                buildingType = 'religious';
            } else {
                // Frontier: pick closest to capital (well-connected, not bleeding edge)
                const frontierNoBuild = state.territories.filter(
                    t => state.frontierSet.has(t.h3_index) && !t.existing_building_id
                );
                if (frontierNoBuild.length > 0 && state.capitalH3) {
                    try {
                        frontierNoBuild.sort((a, b) => {
                            const dA = h3.gridDistance(state.capitalH3, a.h3_index);
                            const dB = h3.gridDistance(state.capitalH3, b.h3_index);
                            return dA - dB;
                        });
                    } catch { /* gridDistance may throw on mismatched resolutions */ }
                    targetH3 = frontierNoBuild[0].h3_index;
                    buildingType = 'military';
                }
            }
        }

        if (!targetH3 || !buildingType) return;

        const bldResult = await client.query(`
            SELECT b.id, b.name, b.gold_cost, b.construction_time_turns
            FROM buildings b
            JOIN building_types bt ON bt.building_type_id = b.type_id
            WHERE bt.name = $1
              AND b.required_building_id IS NULL
            ORDER BY b.gold_cost ASC
            LIMIT 1
        `, [buildingType]);
        if (bldResult.rows.length === 0) return;

        const building = bldResult.rows[0];
        if (state.gold - parseInt(building.gold_cost) < BALANCED.GOLD_RESERVE) return;

        try {
            await executeConstruction(client, playerId, { h3_index: targetH3, building_id: building.id }, { actorName: botName });
            const emoji = { economic: '🏪', religious: '⛪', military: '🏰' }[buildingType] || '🏗️';
            Logger.engine(`[TURN ${turn}] ${emoji} AI Equilibrado (${playerId}) construyendo "${building.name}" en ${targetH3} (${buildingType})`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.engine(`[TURN ${turn}] ⚠️ AI Equilibrado (${playerId}) construcción rechazada: ${err.message}`);
            } else { throw err; }
        }
    }

    /**
     * Fase B — Expansión selectiva: coloniza 1 hex por turno si gold > GOLD_TO_EXPAND.
     * Si el ratio food/gold es bajo, prioriza terrenos de alta producción alimentaria.
     * Si el ratio es aceptable, elige el terreno con mejor puntuación equilibrada.
     */
    async _balancedExpansion(client, playerId, state, turn) {
        if (state.gold < BALANCED.GOLD_TO_EXPAND) return;
        if (state.candidateSet.length === 0) return;

        const needsFood   = state.foodGoldRatio < BALANCED.FOOD_GOLD_RATIO_MIN;
        const foodWeight  = needsFood ? 0.6 : 0.4;
        const otherWeight = needsFood ? 0.2 : 0.3;

        const result = await client.query(`
            SELECT m.h3_index,
                   tt.food_output,
                   tt.wood_output,
                   tt.stone_output,
                   tt.name AS terrain_name,
                   (tt.food_output * $2::numeric + tt.wood_output * $3::numeric + tt.stone_output * $3::numeric) AS score
            FROM h3_map m
            JOIN terrain_types tt ON m.terrain_type_id = tt.terrain_type_id
            WHERE m.h3_index = ANY($1)
              AND m.player_id IS NULL
              AND COALESCE(tt.is_colonizable, TRUE) = TRUE
            ORDER BY score DESC
            LIMIT 1
            FOR UPDATE OF m
        `, [state.candidateSet, foodWeight, otherWeight]);

        if (result.rows.length === 0) return;

        const target = result.rows[0];
        await KingdomModel.DeductGold(client, playerId, BALANCED.CLAIM_COST);
        await KingdomModel.ClaimHex(client, target.h3_index, playerId);
        await KingdomModel.InsertTerritoryDetails(client, target.h3_index, generateInitialEconomy());

        Logger.engine(
            `[TURN ${turn}] 🌍 AI Equilibrado (${playerId}) expandió a ${target.h3_index} ` +
            `(${target.terrain_name}, ${needsFood ? 'prioridad alimentos' : 'balance'}, food=${target.food_output})`
        );
    }

    /**
     * Fase C — Reclutamiento de guarnición: solo recluta si las tropas actuales
     * están por debajo del 30% de la población total del reino.
     */
    async _balancedRecruitment(client, playerId, botName, state, turn) {
        if (state.recruitLocations.length === 0) return;
        if (state.totalTroops >= state.garrisonTarget) return;

        const freshGold   = await client.query(
            'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [playerId]
        );
        const currentGold = parseInt(freshGold.rows[0]?.gold) || 0;
        if (currentGold < BALANCED.GOLD_TO_RECRUIT) return;

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
        const toRecruit     = Math.min(state.garrisonTarget - state.totalTroops, BALANCED.RECRUIT_QUANTITY);
        const totalGoldCost = unitType.gold_cost * toRecruit;

        if (currentGold < totalGoldCost + BALANCED.GOLD_RESERVE) return;

        // Find first location with sufficient population
        let recruitH3 = null;
        for (const locationH3 of state.recruitLocations) {
            const network      = await recruitmentNetwork.getConnectedNetwork(client, locationH3, playerId);
            const fiefPops     = await recruitmentNetwork.getFiefPopulations(client, network);
            const availablePop = recruitmentNetwork.calcRecruitablePool(fiefPops);
            if (availablePop >= toRecruit) {
                recruitH3 = locationH3;
                break;
            }
        }

        if (!recruitH3) {
            Logger.engine(`[TURN ${turn}] ⚖️ AI Equilibrado (${playerId}) sin población suficiente para guarnición`);
            return;
        }

        await executeRecruitment(
            client, playerId,
            { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: toRecruit, army_name: 'Guardia Equilibrada' },
            { actorName: botName }
        );

        Logger.engine(
            `[TURN ${turn}] ⚖️ AI Equilibrado (${playerId}) reclutó ${toRecruit} tropas ` +
            `(guarnición: ${state.totalTroops + toRecruit}/${state.garrisonTarget})`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Ciclo guiado por IA (proveedor externo)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ciclo de turno guiado por un proveedor de IA (Gemini / OpenAI).
     * Usa el método de análisis del perfil para construir el contexto,
     * luego delega la decisión al proxy. Si el proxy devuelve 'procedural',
     * ejecuta el ciclo completo habitual del perfil.
     */
    async _processAIGuidedTurn(agent, turn) {
        const { player_id: playerId, ai_profile: profile, display_name: botName } = agent;

        // 1. Obtener estado del reino (análisis de solo lectura)
        let state;
        if (profile === 'farmer') {
            state = await this._farmerAnalysis(playerId);
        } else if (profile === 'expansionist') {
            state = await this._expansionistAnalysis(playerId);
        } else if (profile === 'balanced') {
            state = await this._balancedAnalysis(playerId);
        } else {
            return; // Perfil desconocido
        }

        if (!state || state.territories.length === 0) return;

        // 2. Solicitar decisión al proxy
        const decision = await aiProxy.requestDecision(playerId, profile, state, turn);

        // 3a. Fallback procedural si el proxy lo indica
        if (decision.mode === 'procedural') {
            if (profile === 'farmer') {
                await this._processFarmerTurn(agent, turn);
            } else if (profile === 'expansionist') {
                await this._processExpansionistTurn(agent, turn);
            } else if (profile === 'balanced') {
                await this._processBalancedTurn(agent, turn);
            }
            return;
        }

        // 3b. Ejecutar la acción decidida por la IA
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await this._executeAIDecision(client, playerId, botName, profile, state, decision.action, turn);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processAIGuidedTurn', playerId, turn });
        } finally {
            client.release();
        }
    }

    /**
     * Ejecuta la acción elegida por el LLM, enrutando al método de fase correcto
     * según el perfil y la acción indicada.
     *
     * @param {Object} client
     * @param {number} playerId
     * @param {string} profile  - 'farmer' | 'expansionist' | 'balanced'
     * @param {Object} state    - Estado pre-calculado por el análisis del perfil
     * @param {Object} action   - { action: string, params: {} }
     * @param {number} turn
     * @returns {Promise<void>}
     */
    async _executeAIDecision(client, playerId, botName, profile, state, action, turn) {
        switch (action.action) {

            case 'expand':
                if (profile === 'expansionist') {
                    await this._expansionistColonization(client, playerId, state, turn);
                } else if (profile === 'balanced') {
                    await this._balancedExpansion(client, playerId, state, turn);
                } else {
                    await this._farmerExpansion(client, playerId, state, turn);
                }
                break;

            case 'build':
                if (profile === 'expansionist') {
                    await this._expansionistConstruction(client, playerId, botName, state, turn);
                } else if (profile === 'balanced') {
                    await this._balancedConstruction(client, playerId, botName, state, turn);
                } else {
                    await this._farmerConstruction(client, playerId, botName, state, turn);
                }
                break;

            case 'recruit':
                // _farmerThreatResponse gestiona su propio cliente — usamos balancedRecruitment
                // para farmer en modo IA (interfaz compatible con client activo)
                if (profile === 'expansionist') {
                    await this._expansionistRecruitment(client, playerId, botName, state, turn);
                } else {
                    await this._balancedRecruitment(client, playerId, botName, state, turn);
                }
                break;

            case 'idle':
                Logger.engine(`[TURN ${turn}] 💤 AI ${profile} (${playerId}) decidió descansar (idle) este turno`);
                break;

            default:
                Logger.engine(`[TURN ${turn}] ⚠️ AI ${profile} (${playerId}) acción desconocida: ${action.action}. Ignorando.`);
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
