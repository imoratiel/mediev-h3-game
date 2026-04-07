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
const { getSpawnCoordinates, getNearbySpawnHex } = require('./BotService');
const { calcMilitiaPower, processCapitalCollapse, GRACE_TURNS_DEFAULT } = require('../logic/conquest_system');
const { bfsExpandTerritory } = require('../logic/playerInit');
const DivisionModel          = require('../models/DivisionModel');
const { generateDivisionName } = require('../logic/CulturalNameGenerator');
const MapService             = require('./MapService');
const CharacterModel         = require('../models/CharacterModel');
const CharacterNameGenerator = require('../logic/CharacterNameGenerator');
const infrastructure = require('../logic/infrastructure');
const CONFIG         = require('../config.js');

// ── Constantes del perfil Dummy (no hace nada, solo ocupa territorio) ────────
const DUMMY = {
    STARTING_GOLD: 100_000,
    COLORS: ['#555555','#666666','#777777','#888888','#999999','#aaaaaa','#bbbbbb','#cccccc'],
};

// ── Constantes del perfil Expansionista ──────────────────────────────────────
const EXPANSIONIST = {
    STARTING_GOLD:      100_000,
    CLAIM_COST:          100,
    GOLD_TO_BUILD:       8_000,   // Build military only if well-funded
    GOLD_TO_RECRUIT:     5_000,   // Recruit unconditionally above this
    GOLD_TO_EXPAND:          0,   // No gold threshold — always tries to expand
    GOLD_RESERVE:        3_000,   // Never go below this
    RECRUIT_QUANTITY:    100,     // Larger batches for aggression
    COLORS: ['#C0392B','#1A5276','#1E8449','#7D3C98','#D4AC0D','#117A65','#BA4A00','#2E4057','#6C3483','#0E6655'],
    // Cell scoring weights for _loadCandidateHexes
    // High adjacency weight = aggressively fills gaps; low resource = not picky about terrain
    SCORE_WEIGHTS: { resource: 0.5, adjacency: 4.0 },
};

// ── Constantes del perfil Equilibrado ────────────────────────────────────────
const BALANCED = {
    STARTING_GOLD:       100_000,
    CLAIM_COST:           100,
    GOLD_TO_EXPAND:       20_000,  // More conservative than farmer (15K)
    GOLD_TO_BUILD:        5_000,
    GOLD_TO_RECRUIT:      3_000,
    GOLD_RESERVE:         3_500,
    RECRUIT_QUANTITY:     40,
    GARRISON_RATIO:       0.30,    // Maintain 30% of total population as troops
    FOOD_GOLD_RATIO_MIN:  0.30,    // food_stored / gold: below this → prioritize food terrain
    COLORS: ['#1565C0','#1976D2','#283593','#0D47A1','#0288D1','#01579B','#006064','#00695C'],
    // Cell scoring weights: balanced between resources and contiguity
    SCORE_WEIGHTS: { resource: 0.8, adjacency: 3.0 },
};

// ── Constantes del perfil Agricultor ─────────────────────────────────────────
const FARMER = {
    STARTING_GOLD:      100_000,
    CLAIM_COST:          100,
    GOLD_TO_BUILD:       4_000,   // Gold mínimo para iniciar construcción
    GOLD_TO_EXPAND:      15_000,  // Gold mínimo para colonizar
    GOLD_RESERVE:        2_000,   // Nunca gastar por debajo de este umbral
    THREAT_SCAN_RADIUS:  2,       // Radio H3 por cada feudo para detectar enemigos
    MIN_TROOPS_DEFEND:   50,      // Si hay amenaza y tiene < este valor, recluta
    MIN_TROOPS_EXPAND:   30,      // No expandir sin al menos estas tropas en casa
    RECRUIT_QUANTITY:    50,      // Tropas a reclutar en respuesta a amenaza
    FARM_MAX_LEVEL:      5,        // Nivel máximo de granja
    GOLD_TO_UPGRADE_FARM: 5_000,  // Gold mínimo para iniciar mejora de granja
    COLORS: ['#8B7355','#6B8E23','#A0522D','#556B2F','#8FBC8F','#BC8F5F','#9ACD32','#DEB887'],
    // Cell scoring weights: strong resource preference (food focus), moderate gap-fill
    SCORE_WEIGHTS: { resource: 1.0, adjacency: 2.0 },
};

class AIManagerService {

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Spawning de agentes
    // ─────────────────────────────────────────────────────────────────────────

    async spawnDummyAgent(callerPlayerId) {
        // Buscar un hex libre a <= 10 celdas de cualquier capital de pagus (political_divisions)
        const { rows: capitals } = await pool.query(
            `SELECT capital_h3 FROM political_divisions WHERE capital_h3 IS NOT NULL`
        );
        if (capitals.length === 0) return { success: false, message: 'No hay capitales de pagus definidas en el mapa' };

        // Barajar para no sesgar siempre hacia el mismo pagus
        const shuffled = capitals.sort(() => Math.random() - 0.5);
        let spawnHex = null;
        for (const { capital_h3 } of shuffled) {
            spawnHex = await getNearbySpawnHex(capital_h3, 10);
            if (spawnHex) break;
        }

        if (!spawnHex) return { success: false, message: 'No hay hexágonos libres a menos de 10 casillas de ninguna capital de pagus' };

        return this._spawnAgent('dummy', DUMMY, spawnHex);
    }

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

        // Resolve spawn location BEFORE opening the transaction (read-only, uses pool directly)
        let spawnHex      = targetH3;
        let playerTarget  = null;
        if (!spawnHex) {
            const coords = await getSpawnCoordinates();
            spawnHex     = coords.h3_index;
            playerTarget = coords.player_target;
        }
        if (!spawnHex) {
            return { success: false, message: 'No se encontró un hex disponible para el agente IA' };
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

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

            // Assign random culture to bot + matching noble rank (level 1)
            const cultureResult = await client.query(
                'SELECT id FROM cultures ORDER BY RANDOM() LIMIT 1'
            );
            const aiCultureId = cultureResult.rows[0]?.id ?? null;
            if (aiCultureId) {
                const rankResult = await client.query(
                    'SELECT id FROM noble_ranks WHERE culture_id = $1 AND level_order = 1 LIMIT 1',
                    [aiCultureId]
                );
                const aiRankId = rankResult.rows[0]?.id ?? null;
                await client.query(
                    'UPDATE players SET culture_id = $1, noble_rank_id = $2 WHERE player_id = $3',
                    [aiCultureId, aiRankId, aiPlayerId]
                );
                // Place completed level-2 military building in capital
                const lvl2Military = await KingdomModel.GetMilitaryLvl2Building(client, aiCultureId);
                if (lvl2Military) {
                    await KingdomModel.PlaceBuildingCompleted(client, spawnHex, lvl2Military.id);
                }
            }

            // BFS expansion — same target count as human players (from noble_ranks level 2)
            const senorioRank = await DivisionModel.GetSenorioRank(client, aiCultureId);
            const targetFiefCount = senorioRank?.min_fiefs_required ?? 40;
            const { bonusHexes } = await bfsExpandTerritory(client, spawnHex, targetFiefCount);
            for (const hex of bonusHexes) {
                const eco = generateInitialEconomy();
                await KingdomModel.ClaimHex(client, hex, aiPlayerId);
                await KingdomModel.InsertTerritoryDetails(client, hex, eco);
            }

            // Crear señorío con todos los feudos conquistados
            let divisionId = null;
            if (senorioRank) {
                const allFiefs = [spawnHex, ...bonusHexes];
                const terrainRows = await client.query(`
                    SELECT t.name AS terrain_name, COUNT(*) AS cnt
                    FROM h3_map m
                    JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                    WHERE m.h3_index = ANY($1::text[])
                    GROUP BY t.name ORDER BY cnt DESC LIMIT 1
                `, [allFiefs]);
                const dominantTerrain = terrainRows.rows[0]?.terrain_name ?? null;
                const divisionName = generateDivisionName(aiCultureId, spawnHex, dominantTerrain);

                const division = await DivisionModel.CreateDivision(client, {
                    player_id:     aiPlayerId,
                    name:          divisionName,
                    noble_rank_id: senorioRank.id,
                    capital_h3:    spawnHex
                });
                if (division) {
                    await DivisionModel.AssignFiefsToDivision(client, division.id, allFiefs);
                    divisionId = division.id;
                }
            }

            // ── Personajes iniciales del bot ─────────────────────────────────
            const turnResult  = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const currentTurn = turnResult.rows[0]?.current_turn ?? 0;
            const botGender   = Math.random() < 0.5 ? 'M' : 'F';
            const heirAge     = 16 + Math.floor(Math.random() * 7);
            const leaderAge   = heirAge + 20 + Math.floor(Math.random() * 6);
            const childAge    = 5  + Math.floor(Math.random() * 4);

            const leaderName = CharacterNameGenerator.generate(aiCultureId, botGender, aiName);
            const leader = await CharacterModel.create(client, {
                player_id:         aiPlayerId,
                name:              leaderName,
                age:               leaderAge,
                health:            100,
                level:             10,
                personal_guard:    25,
                is_main_character: true,
                is_heir:           false,
                h3_index:          spawnHex,
                birth_turn:        currentTurn - leaderAge * 365,
                xp:                0,
            });

            const heirName = CharacterNameGenerator.generate(aiCultureId, botGender, aiName);
            const heir = await CharacterModel.create(client, {
                player_id:           aiPlayerId,
                name:                heirName,
                age:                 heirAge,
                health:              100,
                level:               10,
                personal_guard:      25,
                is_main_character:   false,
                is_heir:             true,
                parent_character_id: leader.id,
                h3_index:            spawnHex,
                birth_turn:          currentTurn - heirAge * 365,
                xp:                  0,
            });

            const childGender = Math.random() < 0.5 ? 'M' : 'F';
            const childName = CharacterNameGenerator.generate(aiCultureId, childGender, aiName);
            await CharacterModel.create(client, {
                player_id:           aiPlayerId,
                name:                childName,
                age:                 childAge,
                health:              100,
                level:               10,
                personal_guard:      0,
                is_main_character:   false,
                is_heir:             false,
                parent_character_id: leader.id,
                h3_index:            spawnHex,
                birth_turn:          currentTurn - childAge * 365,
                xp:                  0,
            });

            // ── Ejércitos de prueba (solo perfil dummy) ───────────────────────
            if (profile === 'dummy' && bonusHexes.length >= 3) {
                const unitResult = await client.query(
                    `SELECT unit_type_id FROM unit_types
                     WHERE culture_id = $1 AND unit_class = 'INFANTRY_1'
                     ORDER BY unit_type_id LIMIT 1`,
                    [aiCultureId]
                );
                const basicUnitId = unitResult.rows[0]?.unit_type_id;
                if (basicUnitId) {
                    const armyHexes = bonusHexes.slice(0, 3);
                    for (const [i, qty] of [[0, 100], [1, 10], [2, 1]]) {
                        const armyResult = await client.query(
                            `INSERT INTO armies (player_id, name, h3_index, food_provisions, gold_provisions, wood_provisions)
                             VALUES ($1, $2, $3, 0, 0, 0) RETURNING army_id`,
                            [aiPlayerId, String(qty), armyHexes[i]]
                        );
                        await client.query(
                            `INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale, stamina)
                             VALUES ($1, $2, $3, 0, 100, 100)`,
                            [armyResult.rows[0].army_id, basicUnitId, qty]
                        );
                    }
                    Logger.action(`[ACTION][${aiName}]: Ejércitos dummy creados (100/10/1) en ${armyHexes.join(', ')}`);
                }
            }

            await client.query('COMMIT');

            // Calcular boundary GeoJSON (fuera de transacción)
            if (divisionId) {
                await MapService.generateDivisionBoundary(divisionId).catch(() => {});
            }

            const totalHexes = 1 + bonusHexes.length;
            const nearLabel = playerTarget
                ? `cerca de ${playerTarget.display_name} (jugador #${playerTarget.player_id})`
                : 'en posición aleatoria';
            Logger.action(
                `[ACTION][${aiName}]: Agente ${LABEL[profile]} fundado en ${spawnHex} (${totalHexes} hexes, ${nearLabel})`,
                { player_id: aiPlayerId, h3_index: spawnHex }
            );
            Logger.bot(aiPlayerId,
                `========== AGENTE CREADO: ${aiName} (${LABEL[profile]}) | Capital: ${spawnHex} | Hexes: ${totalHexes} | Spawn: ${nearLabel} ==========`
            );
            return { success: true, player_id: aiPlayerId, name: aiName,
                     h3_index: spawnHex, hexes_claimed: totalHexes };
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
                `SELECT player_id, display_name, ai_profile FROM players WHERE is_ai = TRUE AND deleted = FALSE`
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
                Logger.bot(playerId, `[TURN ${turn}] 🛡️ Amenazado pero con tropas suficientes (${state.totalTroops})`);
            }
            return;
        }

        // ── Paso B: Construcción (sin amenaza) ───────────────────────────────
        const clientB = await pool.connect();
        try {
            await clientB.query('BEGIN');
            await this._farmerConstruction(clientB, playerId, botName, state, turn);
            await clientB.query('COMMIT');
        } catch (error) {
            await clientB.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processFarmerTurn.B', playerId, turn });
        } finally {
            clientB.release();
        }

        // ── Paso C: Expansión (conservadora, solo hexes libres) ───────────────
        const clientC = await pool.connect();
        try {
            await clientC.query('BEGIN');
            await this._farmerExpansion(clientC, playerId, botName, state, turn);
            await clientC.query('COMMIT');
        } catch (error) {
            await clientC.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processFarmerTurn.C', playerId, turn });
        } finally {
            clientC.release();
        }

        // ── Paso D: Mejora de granjas ─────────────────────────────────────────
        const clientD = await pool.connect();
        try {
            await clientD.query('BEGIN');
            await this._farmerUpgradeFarms(clientD, playerId, state, turn);
            await clientD.query('COMMIT');
        } catch (error) {
            await clientD.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService._processFarmerTurn.D', playerId, turn });
        } finally {
            clientD.release();
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
                    td.farm_level,
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

            // Expansion candidates: adjacent non-owned hexes
            const ownedSet    = new Set(territories.map(t => t.h3_index));
            const candidateSet = new Set();
            for (const hex of ownedSet) {
                h3.gridDisk(hex, 1)
                  .filter(n => n !== hex && !ownedSet.has(n))
                  .forEach(n => candidateSet.add(n));
            }

            // Feudos con producción de comida y granja por debajo del máximo (candidatos a mejora)
            const farmUpgradeCandidates = territories.filter(t =>
                parseInt(t.food_output) > 0 && parseInt(t.farm_level || 0) < FARMER.FARM_MAX_LEVEL
            );

            return {
                gold, capitalH3, territories, ownedSet, territoriesWithoutBuilding,
                totalTroops, recruitLocations, isThreatened,
                candidateSet: [...candidateSet],
                farmUpgradeCandidates,
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

        // Solo Market (economic) o Church (religious)
        const buildingsResult = await client.query(`
            SELECT b.id, b.name, b.gold_cost, b.construction_time_turns,
                   bt.name AS type_name
            FROM buildings b
            JOIN building_types bt ON bt.building_type_id = b.type_id
            WHERE b.required_building_id IS NULL
              AND bt.name IN ('economic', 'religious')
            ORDER BY b.gold_cost ASC
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
            await executeConstruction(client, playerId, { h3_index: target.h3_index, building_id: building.id }, { actorName: botName, skipWorkerCheck: true });
            const emoji = building.type_name === 'economic' ? '🏪' : '⛪';
            Logger.bot(playerId, `[TURN ${turn}] ${emoji} Inició construcción de "${building.name}" en ${target.h3_index}`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.bot(playerId, `[TURN ${turn}] ⚠️ Construcción rechazada: ${err.message}`);
            } else { throw err; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase D — Mejora de granjas
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fase D — Mejora de granjas: sube el nivel de la granja en el feudo con mayor
     * food_output entre los candidatos (terreno fértil y nivel < FARM_MAX_LEVEL).
     * Solo una mejora por turno para simular toma de decisión gradual.
     */
    async _farmerUpgradeFarms(client, playerId, state, turn) {
        if (state.gold < FARMER.GOLD_TO_UPGRADE_FARM) return;
        if (state.farmUpgradeCandidates.length === 0) return;

        // Objetivo: feudo con mayor food_output base (más rentable mejorar)
        const target = state.farmUpgradeCandidates.reduce((best, t) =>
            parseInt(t.food_output) > parseInt(best.food_output) ? t : best
        );

        const currentLevel = parseInt(target.farm_level || 0);
        const cost = infrastructure.calculateFarmUpgradeCost(currentLevel, CONFIG);

        if (state.gold - cost < FARMER.GOLD_RESERVE) return;

        // Validar que el terreno tiene producción de alimentos
        const validationError = infrastructure.validateUpgrade('farm', { food_output: target.food_output });
        if (validationError) return;

        await KingdomModel.ApplyUpgrade(client, target.h3_index, playerId, 'farm', currentLevel + 1, cost);
        Logger.bot(playerId, `[TURN ${turn}] 🌾 Granja mejorada al nivel ${currentLevel + 1} en ${target.h3_index} (coste: ${cost.toLocaleString()} oro)`);
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
                Logger.bot(playerId, `[TURN ${turn}] 🛡️ Amenazado pero sin población suficiente para reclutar`);
                return;
            }

            // executeRecruitment aplica todas las validaciones + muta DB
            await executeRecruitment(
                client, playerId,
                { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: FARMER.RECRUIT_QUANTITY, army_name: 'Milicia Campesina' },
                { actorName: botName, skipWorkerCheck: true }
            );

            await client.query('COMMIT');

            const isCapital = recruitH3 === state.capitalH3;
            Logger.bot(playerId,
                `[TURN ${turn}] ⚔️ Reclutó ${FARMER.RECRUIT_QUANTITY} tropas en ${recruitH3} ` +
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
            await this._expansionistExpansion(client, playerId, botName, state, turn);  // A: Expand first
            await this._expansionistRecruitment(client, playerId, botName, state, turn); // B: Recruit
            await this._expansionistConstruction(client, playerId, botName, state, turn); // C: Build
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
            Logger.bot(playerId, `[TURN ${turn}] ⚔️ Sin población suficiente para reclutar`);
            return;
        }

        await executeRecruitment(
            client, playerId,
            { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: EXPANSIONIST.RECRUIT_QUANTITY, army_name: 'Horda Expansionista' },
            { actorName: botName, skipWorkerCheck: true }
        );

        Logger.bot(playerId, `[TURN ${turn}] ⚔️ Reclutó ${EXPANSIONIST.RECRUIT_QUANTITY} tropas en ${recruitH3}`);
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
            await executeConstruction(client, playerId, { h3_index: target.h3_index, building_id: building.id }, { actorName: botName, skipWorkerCheck: true });
            Logger.bot(playerId, `[TURN ${turn}] 🏯 Construyendo "${building.name}" en ${target.h3_index} (frontera)`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.bot(playerId, `[TURN ${turn}] ⚠️ Construcción rechazada: ${err.message}`);
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
            await this._balancedConstruction(client, playerId, botName, state, turn); // A: Build
            await this._balancedExpansion(client, playerId, botName, state, turn);    // B: Expand
            await this._balancedRecruitment(client, playerId, botName, state, turn);  // C: Recruit
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
            await executeConstruction(client, playerId, { h3_index: targetH3, building_id: building.id }, { actorName: botName, skipWorkerCheck: true });
            const emoji = { economic: '🏪', religious: '⛪', military: '🏰' }[buildingType] || '🏗️';
            Logger.bot(playerId, `[TURN ${turn}] ${emoji} Construyendo "${building.name}" en ${targetH3} (${buildingType})`);
        } catch (err) {
            if (err instanceof GameActionError) {
                Logger.bot(playerId, `[TURN ${turn}] ⚠️ Construcción rechazada: ${err.message}`);
            } else { throw err; }
        }
    }

    /**
     * Fase B — Reclutamiento de guarnición: solo recluta si las tropas actuales
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
            Logger.bot(playerId, `[TURN ${turn}] ⚖️ Sin población suficiente para guarnición`);
            return;
        }

        await executeRecruitment(
            client, playerId,
            { h3_index: recruitH3, unit_type_id: unitType.unit_type_id, quantity: toRecruit, army_name: 'Guardia Equilibrada' },
            { actorName: botName, skipWorkerCheck: true }
        );

        Logger.bot(playerId,
            `[TURN ${turn}] ⚖️ Reclutó ${toRecruit} tropas ` +
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

            case 'expand':
                if (profile === 'expansionist') {
                    await this._expansionistExpansion(client, playerId, botName, state, turn);
                } else if (profile === 'balanced') {
                    await this._balancedExpansion(client, playerId, botName, state, turn);
                } else {
                    await this._farmerExpansion(client, playerId, botName, state, turn);
                }
                break;

            case 'idle':
                Logger.bot(playerId, `[TURN ${turn}] 💤 Decidió descansar (idle) este turno`);
                break;

            default:
                Logger.bot(playerId, `[TURN ${turn}] ⚠️ Acción desconocida: ${action.action}. Ignorando.`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Expansión / Conquista
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Queries the DB for candidate expansion hexes and scores them by resources.
     * Returns sorted array (best first).
     *
     * @param {string[]} candidates - h3_index values to check
     * @param {number}   playerId
     * @param {boolean}  aggressive  - if true, enemy-owned hexes are also included
     * @param {Set}      ownedSet    - set of h3_index already owned by this bot (for adjacency scoring)
     * @param {Object}   weights     - { resource: number, adjacency: number }
     * @returns {Object[]}
     */
    async _loadCandidateHexes(candidates, playerId, aggressive = false, ownedSet = new Set(), weights = { resource: 1.0, adjacency: 0 }) {
        if (!candidates || candidates.length === 0) return [];

        const result = await pool.query(`
            SELECT m.h3_index, m.player_id,
                   COALESCE(tt.food_output,   0) AS food_output,
                   COALESCE(tt.wood_output,   0) AS wood_output,
                   COALESCE(tt.stone_output,  0) AS stone_output,
                   COALESCE(tt.iron_output,   0) AS iron_output,
                   COALESCE(tt.movement_cost, 1) AS movement_cost
            FROM h3_map m
            JOIN terrain_types tt ON tt.terrain_type_id = m.terrain_type_id
            WHERE m.h3_index = ANY($1)
              AND COALESCE(tt.movement_cost, 1) >= 0
        `, [candidates]);

        const rows = result.rows.filter(r =>
            aggressive
                ? (r.player_id === null || Number(r.player_id) !== Number(playerId))
                : r.player_id === null
        );

        return rows.sort((a, b) => {
            const resourceA = a.food_output * 3 + a.wood_output * 2 + a.stone_output + a.iron_output * 1.5;
            const resourceB = b.food_output * 3 + b.wood_output * 2 + b.stone_output + b.iron_output * 1.5;
            // Adjacency bonus: count neighbors already owned by this bot (max 6)
            const adjA = ownedSet.size > 0
                ? h3.gridDisk(a.h3_index, 1).filter(n => n !== a.h3_index && ownedSet.has(n)).length
                : 0;
            const adjB = ownedSet.size > 0
                ? h3.gridDisk(b.h3_index, 1).filter(n => n !== b.h3_index && ownedSet.has(n)).length
                : 0;
            const scoreA = weights.resource * resourceA + weights.adjacency * adjA;
            const scoreB = weights.resource * resourceB + weights.adjacency * adjB;
            return scoreB - scoreA;
        });
    }

    /**
     * Core bot conquest helper.
     * Picks the best available bot army, advances it to targetH3, and resolves
     * combat against local militia (or empty-hex resistance).
     * On defeat: retreats army to origin.
     * On victory/draw: transfers hex ownership + sets grace_turns.
     *
     * Must be called within an active DB transaction.
     *
     * @param {Object} client
     * @param {number} playerId
     * @param {string} botName
     * @param {string} targetH3
     * @param {number} turn
     * @returns {{ conquered: boolean, result?: string, reason?: string }}
     */
    async _botConquerHex(client, playerId, botName, targetH3, turn) {
        // 1. Load target hex info
        const hexResult = await client.query(`
            SELECT m.player_id,
                   COALESCE(td.custom_name, m.h3_index) AS fief_name,
                   COALESCE(td.population, 200)          AS population,
                   COALESCE(td.defense_level, 0)         AS defense_level,
                   p.capital_h3
            FROM h3_map m
            LEFT JOIN territory_details td ON td.h3_index = m.h3_index
            LEFT JOIN players p            ON p.player_id = m.player_id
            WHERE m.h3_index = $1
        `, [targetH3]);
        if (hexResult.rows.length === 0) return { conquered: false, reason: 'hex_not_found' };
        const hex = hexResult.rows[0];
        if (Number(hex.player_id) === Number(playerId)) return { conquered: false, reason: 'own_hex' };

        // 2. No enemy armies allowed at target
        const enemyCheck = await client.query(
            'SELECT COUNT(*)::int AS cnt FROM armies WHERE h3_index = $1 AND player_id != $2',
            [targetH3, playerId]
        );
        if (enemyCheck.rows[0].cnt > 0) return { conquered: false, reason: 'enemy_armies_present' };

        // 3. Find best bot army stationed in own territory (most troops)
        const armyResult = await client.query(`
            SELECT a.army_id, a.h3_index AS origin_h3, SUM(t.quantity)::int AS total_troops
            FROM armies a
            JOIN troops  t ON t.army_id  = a.army_id
            JOIN h3_map  m ON m.h3_index = a.h3_index
            WHERE a.player_id = $1 AND m.player_id = $1
            GROUP BY a.army_id, a.h3_index
            HAVING SUM(t.quantity) > 0
            ORDER BY SUM(t.quantity) DESC
            LIMIT 1
        `, [playerId]);
        if (armyResult.rows.length === 0) return { conquered: false, reason: 'no_army' };
        const army = armyResult.rows[0];

        // 4. Advance army to target
        await client.query('UPDATE armies SET h3_index = $1 WHERE army_id = $2', [targetH3, army.army_id]);

        // 5. Load troop details for combat resolution
        const troopsResult = await client.query(`
            SELECT t.troop_id, t.quantity, t.morale, t.stamina, t.force_rest, ut.attack
            FROM troops t JOIN unit_types ut ON ut.unit_type_id = t.unit_type_id
            WHERE t.army_id = $1
        `, [army.army_id]);
        const troops = troopsResult.rows;

        // 6. Calculate attacker power (same formula as KingdomService.conquestTerritory)
        let attackerPower = 0, attackerTotal = 0;
        for (const t of troops) {
            const mf = Math.max(0.5, parseFloat(t.morale)  / 100);
            const sf = t.force_rest ? 0.5 : Math.max(0.1, parseFloat(t.stamina) / 100);
            attackerPower += t.quantity * t.attack * mf * sf;
            attackerTotal += t.quantity;
        }
        attackerPower *= (0.85 + Math.random() * 0.30);

        // 7. Calculate militia / defender power
        const { militiaCount, defenderPower } = calcMilitiaPower(hex.population, hex.defense_level);
        const ratio  = attackerPower / (defenderPower || 1);
        const result = ratio >= 1.1 ? 'victory' : ratio <= 0.9 ? 'defeat' : 'draw';

        // 8. Apply attacker losses
        const lossFrac       = result === 'victory' ? 0.05 + (1 / ratio) * 0.10 : 0.20 + Math.random() * 0.15;
        const attackerLosses = Math.min(attackerTotal, Math.floor(attackerTotal * lossFrac));
        if (attackerLosses > 0) {
            for (const t of troops) {
                const deduct = Math.min(t.quantity, Math.floor(attackerLosses * (t.quantity / attackerTotal)));
                if (deduct > 0) {
                    await client.query(
                        'UPDATE troops SET quantity = quantity - $1 WHERE troop_id = $2',
                        [deduct, t.troop_id]
                    );
                }
            }
            await client.query('DELETE FROM troops WHERE army_id = $1 AND quantity <= 0', [army.army_id]);
        }

        // 9. Defeat → retreat army back to origin fief
        if (result === 'defeat') {
            await client.query('UPDATE armies SET h3_index = $1 WHERE army_id = $2', [army.origin_h3, army.army_id]);
            const remaining = await client.query(
                'SELECT COALESCE(SUM(quantity),0)::int AS total FROM troops WHERE army_id = $1',
                [army.army_id]
            );
            if ((remaining.rows[0]?.total || 0) === 0) {
                await client.query('DELETE FROM armies WHERE army_id = $1', [army.army_id]);
            }
            Logger.bot(playerId, `[TURN ${turn}] [${botName}] ❌ Conquista de ${targetH3} fallida — derrota (${attackerLosses} bajas)`);
            return { conquered: false, result: 'defeat' };
        }

        // 10. Victory / draw → transfer ownership
        const prevOwner = hex.player_id;
        await client.query('UPDATE h3_map SET player_id = $1 WHERE h3_index = $2', [playerId, targetH3]);

        // Ensure territory_details row exists, apply grace period
        const tdCheck = await client.query('SELECT 1 FROM territory_details WHERE h3_index = $1', [targetH3]);
        if (tdCheck.rows.length === 0) {
            const eco = generateInitialEconomy();
            await KingdomModel.InsertTerritoryDetails(client, targetH3, eco);
        } else {
            await client.query(
                'UPDATE territory_details SET grace_turns = $1 WHERE h3_index = $2',
                [GRACE_TURNS_DEFAULT, targetH3]
            );
        }

        // 11. Capital-collapse cascade if this was the defeated player's capital
        const isCapital = prevOwner !== null && hex.capital_h3 === targetH3;
        if (isCapital) {
            await processCapitalCollapse(client, targetH3, playerId, prevOwner, turn);
            Logger.bot(playerId, `[TURN ${turn}] 💥 ¡Capital conquistada! Cascada activada.`);
        } else if (prevOwner !== null) {
            // Si era la capital de un señorío (no del jugador), transferir el señorío y todos sus feudos
            const divRes = await client.query(
                `SELECT id FROM political_divisions WHERE player_id = $1 AND capital_h3 = $2`,
                [prevOwner, targetH3]
            );
            if (divRes.rows.length > 0) {
                const divId = divRes.rows[0].id;
                await client.query(
                    `UPDATE political_divisions SET player_id = $1 WHERE id = $2`,
                    [playerId, divId]
                );
                // Transferir todos los feudos del señorío al conquistador
                await client.query(`
                    UPDATE h3_map SET player_id = $1
                    WHERE h3_index IN (
                        SELECT h3_index FROM territory_details WHERE division_id = $2
                    ) AND player_id = $3
                `, [playerId, divId, prevOwner]);
            }
        }

        // 12. Notify previous owner
        if (prevOwner !== null) {
            const NotificationService = require('./NotificationService.js');
            const worldRow = await client.query('SELECT current_turn FROM world_state LIMIT 1');
            const currentTurn = worldRow.rows[0]?.current_turn ?? turn;
            await NotificationService.createSystemNotification(
                prevOwner, 'Militar',
                `🏴 TERRITORIO PERDIDO\nEl territorio ${hex.fief_name} ha sido conquistado (Turno ${currentTurn})`,
                currentTurn
            );
        }

        Logger.bot(playerId,
            `[TURN ${turn}] [${botName}] 🏴 Conquistó ${targetH3} (${result}, milicia: ${militiaCount}, bajas: ${attackerLosses})`
        );
        return { conquered: true, result };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase C Agricultor — Expansión conservadora
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Phase C — Farmer expansion: only unclaimed hexes, only when well-funded
     * and with enough troops to keep home territory defended.
     */
    async _farmerExpansion(client, playerId, botName, state, turn) {
        // Re-read gold (construction phase may have spent some)
        const goldRow = await client.query('SELECT gold FROM players WHERE player_id = $1', [playerId]);
        const currentGold = parseInt(goldRow.rows[0]?.gold) || 0;
        if (currentGold < FARMER.GOLD_TO_EXPAND) return;

        // Don't expand if we can't defend our existing territory
        if (state.totalTroops < FARMER.MIN_TROOPS_EXPAND) {
            Logger.bot(playerId, `[TURN ${turn}] 🌾 Sin tropas suficientes para expandir (${state.totalTroops}/${FARMER.MIN_TROOPS_EXPAND})`);
            return;
        }

        const scored = await this._loadCandidateHexes(state.candidateSet, playerId, false, state.ownedSet, FARMER.SCORE_WEIGHTS);
        if (scored.length === 0) return;

        await this._botConquerHex(client, playerId, botName, scored[0].h3_index, turn);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase A Expansionista — Expansión agresiva
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Phase A — Expansionist expansion: highest priority action.
     * Prefers unclaimed hexes; attacks enemy fiefs if none are available.
     */
    async _expansionistExpansion(client, playerId, botName, state, turn) {
        // Try unclaimed hexes first, then enemy hexes (aggressive mode)
        const scored = await this._loadCandidateHexes(state.candidateSet, playerId, true, state.ownedSet, EXPANSIONIST.SCORE_WEIGHTS);
        if (scored.length === 0) return;

        await this._botConquerHex(client, playerId, botName, scored[0].h3_index, turn);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Fase B Equilibrado — Expansión selectiva
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Phase B — Balanced expansion: only unclaimed hexes, only when well-funded.
     */
    async _balancedExpansion(client, playerId, botName, state, turn) {
        const goldRow = await client.query('SELECT gold FROM players WHERE player_id = $1', [playerId]);
        const currentGold = parseInt(goldRow.rows[0]?.gold) || 0;
        if (currentGold < BALANCED.GOLD_TO_EXPAND) return;

        const scored = await this._loadCandidateHexes(state.candidateSet, playerId, false, state.ownedSet, BALANCED.SCORE_WEIGHTS);
        if (scored.length === 0) return;

        await this._botConquerHex(client, playerId, botName, scored[0].h3_index, turn);
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

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Eliminación de un agente
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Elimina un agente IA del sistema de juego:
     *   1. Verifica que el jugador existe y es un bot no borrado.
     *   2. Elimina ejércitos (cascade → troops, army_routes).
     *   3. Elimina mensajes enviados o recibidos.
     *   4. Elimina notificaciones y estadísticas de uso de IA.
     *   5. Elimina edificios de sus feudos.
     *   6. Libera sus feudos (player_id = NULL en h3_map).
     *   7. Marca al jugador como deleted = TRUE y borra capital_h3.
     *
     * @param {number} botId - player_id del agente IA
     * @returns {{ success: boolean, message: string, botName: string }}
     */
    async deleteAgent(botId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar que es un bot activo
            const check = await client.query(
                `SELECT display_name, is_ai, deleted FROM players WHERE player_id = $1`,
                [botId]
            );
            if (check.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, message: 'Agente no encontrado' };
            }
            const { display_name: botName, is_ai, deleted } = check.rows[0];
            if (!is_ai) {
                await client.query('ROLLBACK');
                return { success: false, message: 'El jugador indicado no es un agente IA' };
            }
            if (deleted) {
                await client.query('ROLLBACK');
                return { success: false, message: `El agente "${botName}" ya ha sido eliminado` };
            }

            // 2. Eliminar ejércitos (cascade → troops, army_routes)
            await client.query('DELETE FROM armies WHERE player_id = $1', [botId]);

            // 3. Eliminar mensajes
            await client.query(
                'DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1',
                [botId]
            );

            // 4. Eliminar notificaciones y estadísticas de IA
            await client.query('DELETE FROM notifications WHERE player_id = $1', [botId]);
            await client.query('DELETE FROM ai_usage_stats WHERE bot_id = $1', [botId]);

            // 5. Eliminar edificios de sus feudos (antes de liberar la propiedad)
            await client.query(
                `DELETE FROM fief_buildings
                 WHERE h3_index IN (SELECT h3_index FROM h3_map WHERE player_id = $1)`,
                [botId]
            );

            // 6. Liberar feudos
            await client.query('UPDATE h3_map SET player_id = NULL WHERE player_id = $1', [botId]);

            // 7. Soft-delete del jugador
            await client.query(
                `UPDATE players SET deleted = TRUE, capital_h3 = NULL WHERE player_id = $1`,
                [botId]
            );

            await client.query('COMMIT');

            Logger.action(
                `[ACTION][Admin]: Agente IA "${botName}" (id=${botId}) eliminado del sistema`,
                { player_id: botId }
            );
            return { success: true, message: `Agente "${botName}" eliminado correctamente`, botName };

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { context: 'AIManagerService.deleteAgent', botId });
            return { success: false, message: error.message };
        } finally {
            client.release();
        }
    }
}

module.exports = new AIManagerService();
