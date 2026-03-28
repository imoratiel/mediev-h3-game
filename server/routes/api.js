const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticateToken, requireAdmin, generateToken } = require('../src/middleware/auth');

// This file will contain all the endpoints moved from index.js
// It expects to be passed the pool, config, and logic modules if needed
// For now, I'll export a function that configures the router

module.exports = function () {
    const TurnService = require('../src/services/TurnService.js');
    const MessageService = require('../src/services/MessageService.js');
    const NotificationService = require('../src/services/NotificationService.js');
    const LoginService = require('../src/services/LoginService.js');
    const TerrainService = require('../src/services/TerrainService.js');
    const ArmyService = require('../src/services/ArmyService.js');
    const CombatService = require('../src/services/CombatService.js');
    const KingdomService = require('../src/services/KingdomService.js');
    const AdminService = require('../src/services/AdminService.js');
    const PlayerService = require('../src/services/PlayerService.js');
    const ScoutingService = require('../src/services/ScoutingService.js');
    const EconomyService = require('../src/services/EconomyService.js');
    const WorkerService = require('../src/services/WorkerService.js');
    const DivisionService = require('../src/services/DivisionService.js');
    const MapService = require('../src/services/MapService.js');
    const CharacterService = require('../src/services/CharacterService.js');
    const OAuthService = require('../src/services/OAuthService.js');
    const NavalService = require('../src/services/NavalService.js');

    // ============================================
    // AUTHENTICATION ENDPOINTS
    // ============================================
    router.post('/auth/login', LoginService.Login);
    router.post('/auth/logout', authenticateToken, LoginService.Logout);
    router.get('/auth/me', authenticateToken, LoginService.AuthMe);
    router.put('/auth/profile', authenticateToken, (req, res) => LoginService.UpdateProfile(req, res));

    // OAuth — Google
    router.get('/auth/google',          OAuthService.redirectToGoogle);
    router.get('/auth/google/callback', OAuthService.handleGoogleCallback);

    // ============================================
    // MAP AND GAME ENDPOINTS
    // ============================================
    router.get('/map/region', TerrainService.GetRegion );
    router.get('/terrain-types', TerrainService.GetTerrainTypes );

    // ============================================
    // GAME LOGIC ENDPOINTS
    // ============================================
    router.get('/game/capital', authenticateToken, KingdomService.GetCapital);
    router.post('/game/claim', authenticateToken, (req, res) => KingdomService.ClaimTerritory(req, res));
    router.post('/game/initialize', authenticateToken, (req, res) => KingdomService.InitializePlayer(req, res));

    router.get('/map/cell-details/:h3_index', TerrainService.GetCellDetails);

    // Get armies in visible extent (for map icons)
    router.get('/map/armies', authenticateToken, ArmyService.GetArmiesInRegion);

    // Get completed buildings in visible extent (for map icons)
    router.get('/map/buildings', authenticateToken, (req, res) => TerrainService.GetBuildingsInBounds(req, res));

    // Get detailed army info for a specific hex (for popup)
    router.get('/map/army-details/:h3_index', authenticateToken, ArmyService.GetArmyDetails);

    router.get('/players/search',   authenticateToken, (req, res) => PlayerService.Search(req, res));
    router.get('/players/:id',      PlayerService.GetById);

    router.get('/game/world-state', TurnService.GetWorldState);
    router.get('/game/my-fiefs', authenticateToken, KingdomService.GetMyFiefs);

    // ============================================
    // TERRITORY AND INFRASTRUCTURE
    // ============================================
    router.post('/territory/explore', authenticateToken, KingdomService.StartExploration);
    router.post('/territory/upgrade', authenticateToken, KingdomService.UpgradeBuilding);
    router.post('/fiefs/:h3_index/upgrade-farm', authenticateToken, (req, res) => KingdomService.UpgradeFarm(req, res));
    router.get('/territory/buildings', authenticateToken, (req, res) => KingdomService.GetBuildings(req, res));
    router.post('/territory/construct', authenticateToken, (req, res) => KingdomService.ConstructBuilding(req, res));
    router.post('/territory/upgrade-building', authenticateToken, (req, res) => KingdomService.UpgradeFiefBuilding(req, res));
    router.post('/territory/repair-building', authenticateToken, (req, res) => KingdomService.RepairBuilding(req, res));

    // ============================================
    // MILITARY RECRUITMENT
    // ============================================
    router.get('/military/unit-types', ArmyService.GetUnitTypes);
    router.post('/military/recruit', authenticateToken, ArmyService.Recruit);
    router.get('/military/troops', authenticateToken, ArmyService.GetTroops);
    router.get('/military/armies', authenticateToken, (req, res) => ArmyService.GetArmies(req, res));
    router.get('/military/armies/:id', authenticateToken, (req, res) => ArmyService.GetArmyDetail(req, res));
    router.get('/military/capacity', authenticateToken, (req, res) => ArmyService.GetCapacity(req, res));
    router.post('/military/bulk-recruit', authenticateToken, (req, res) => ArmyService.BulkRecruit(req, res));
    router.post('/military/move-army', authenticateToken, ArmyService.MoveArmy);
    router.get('/military/my-routes', authenticateToken, ArmyService.GetMyRoutes);
    router.patch('/military/rename', authenticateToken, (req, res) => ArmyService.renameArmy(req, res));
    router.post('/military/stop', authenticateToken, (req, res) => ArmyService.StopArmy(req, res));
    router.post('/military/attack', authenticateToken, (req, res) => CombatService.manualAttack(req, res));
    router.post('/military/attack-army', authenticateToken, (req, res) => CombatService.attackSpecificArmy(req, res));
    router.post('/military/conquer', authenticateToken, (req, res) => KingdomService.conquestTerritory(req, res));
    router.post('/military/conquer-fief', authenticateToken, (req, res) => KingdomService.conquerFief(req, res));
    router.post('/military/merge', authenticateToken, (req, res) => ArmyService.MergeArmies(req, res));
    router.post('/military/transfer', authenticateToken, (req, res) => ArmyService.TransferArmy(req, res));
    router.get('/military/armies-at-hex/:h3_index', authenticateToken, (req, res) => ArmyService.GetArmiesAtHex(req, res));
    router.get('/military/recruitable-pool', authenticateToken, (req, res) => ArmyService.GetRecruitablePool(req, res));
    router.post('/military/scout', authenticateToken, (req, res) => ScoutingService.scoutArmy(req, res));
    router.post('/military/dismiss', authenticateToken, (req, res) => ArmyService.DismissTroops(req, res));
    router.post('/military/reinforce', authenticateToken, (req, res) => ArmyService.ReinforceArmy(req, res));

    // ============================================
    // NAVAL
    // ============================================
    router.get('/naval/ship-types',              authenticateToken, (req, res) => NavalService.GetShipTypes(req, res));
    router.get('/naval/fleets',                  authenticateToken, (req, res) => NavalService.GetFleets(req, res));
    router.get('/naval/fleets/:id',              authenticateToken, (req, res) => NavalService.GetFleetDetail(req, res));
    router.get('/naval/capacity',                authenticateToken, (req, res) => NavalService.GetCapacity(req, res));
    router.get('/naval/embarkable/:fleet_id',    authenticateToken, (req, res) => NavalService.GetEmbarkable(req, res));
    router.get('/naval/landing-hexes/:fleet_id', authenticateToken, (req, res) => NavalService.GetLandingHexes(req, res));
    router.post('/naval/create-fleet',           authenticateToken, (req, res) => NavalService.CreateFleet(req, res));
    router.post('/naval/recruit-ships',          authenticateToken, (req, res) => NavalService.RecruitShips(req, res));
    router.post('/naval/embark',                 authenticateToken, (req, res) => NavalService.EmbarkArmy(req, res));
    router.post('/naval/embark-character',       authenticateToken, (req, res) => NavalService.EmbarkCharacter(req, res));
    router.post('/naval/embark-worker',          authenticateToken, (req, res) => NavalService.EmbarkWorkerDirect(req, res));
    router.post('/naval/disembark',              authenticateToken, (req, res) => NavalService.DisembarkArmy(req, res));
    router.post('/naval/disembark-character',    authenticateToken, (req, res) => NavalService.DisembarkStandaloneChar(req, res));
    router.post('/naval/disembark-worker',       authenticateToken, (req, res) => NavalService.DisembarkStandaloneWorker(req, res));
    router.post('/naval/move-fleet',             authenticateToken, (req, res) => NavalService.MoveFleet(req, res));
    router.post('/naval/stop-fleet',             authenticateToken, (req, res) => NavalService.StopFleet(req, res));

    // ============================================
    // ECONOMY
    // ============================================
    router.get('/economy/summary', authenticateToken, (req, res) => EconomyService.GetEconomySummary(req, res));
    router.patch('/economy/settings', authenticateToken, (req, res) => EconomyService.UpdateEconomySettings(req, res));

    // ============================================
    // DIVISIONES POLITICAS (FUEROS Y LEYES)
    // ============================================
    router.get('/territory/:h3_index/laws', authenticateToken, (req, res) => DivisionService.GetTerritoryLaws(req, res));
    router.get('/divisions/propose-name', authenticateToken, (req, res) => DivisionService.ProposeName(req, res));
    router.patch('/divisions/:id/tax', authenticateToken, (req, res) => DivisionService.UpdateDivisionTax(req, res));
    router.post('/divisions/proclaim', authenticateToken, (req, res) => DivisionService.ProclaimDivision(req, res));
    router.get('/divisions/my', authenticateToken, (req, res) => DivisionService.GetMyDivisions(req, res));
    router.get('/divisions/boundaries', authenticateToken, (req, res) => MapService.GetAllBoundaries(req, res));

    // ============================================
    // RELACIONES POLÍTICAS
    // ============================================
    const RelationService = require('../src/services/RelationService.js');

    router.get('/relations/types',           (req, res) => RelationService.getTypes(req, res));
    router.get('/relations/my',              authenticateToken, (req, res) => RelationService.getMy(req, res));
    router.get('/relations/pending',         authenticateToken, (req, res) => RelationService.getPending(req, res));
    router.get('/relations/:playerId',       (req, res) => RelationService.getByPlayer(req, res));
    router.post('/relations/propose',        authenticateToken, (req, res) => RelationService.propose(req, res));
    router.post('/relations/:id/accept',     authenticateToken, (req, res) => RelationService.accept(req, res));
    router.post('/relations/:id/break',      authenticateToken, (req, res) => RelationService.breakRelation(req, res));

    // ============================================
    // ADMIN AND MESSAGES
    // ============================================
    router.post('/admin/reset', authenticateToken, requireAdmin, AdminService.ResetWorld);
    router.post('/admin/reset-game', authenticateToken, requireAdmin, (req, res) => AdminService.ResetGame(req, res));
    router.get('/admin/stats', authenticateToken, requireAdmin, AdminService.GetStats);

    // ── Auditoría Kafka (toggle en caliente, sin reinicio) ───────────────────
    const { setAuditEnabled, getAuditStatus } = require('../src/infrastructure/kafkaAuditor');
    const { auditEvent, TOPICS } = require('../src/infrastructure/kafkaFacade');
    router.get('/admin/audit/status',   authenticateToken, requireAdmin, (_req, res) => res.json(getAuditStatus()));
    router.post('/admin/audit/enable',  authenticateToken, requireAdmin, async (_req, res) => { await setAuditEnabled(true);  res.json({ ok: true, ...getAuditStatus() }); });
    router.post('/admin/audit/disable', authenticateToken, requireAdmin, async (_req, res) => { await setAuditEnabled(false); res.json({ ok: true, ...getAuditStatus() }); });
    router.post('/admin/audit/test', authenticateToken, requireAdmin, async (req, res) => {
        const { channel } = req.body; // 'tax' | 'military'
        const now = new Date().toISOString();
        try {
            if (channel === 'tax') {
                await auditEvent('TAX_COLLECTION', { player_id: 0, amount: 999, tax_rate: 5, turn: 0, _test: true }, TOPICS.TAX);
                return res.json({ ok: true, message: `Mensaje de prueba enviado a ${TOPICS.TAX}` });
            }
            if (channel === 'military') {
                await auditEvent('ARMY_MOVED', { army_id: 0, player_id: 0, from: 'test', to: 'test', steps: 1, force_exhausted: false, arrived: false, _test: true }, TOPICS.MILITARY);
                return res.json({ ok: true, message: `Mensaje de prueba enviado a ${TOPICS.MILITARY}` });
            }
            if (channel === 'harvest') {
                await auditEvent('HARVEST_COMPLETE', { player_id: 0, turn: 0, territories: 3, food_produced: 500, wood_produced: 120, stone_produced: 80, iron_produced: 40, gold_produced: 200, food_consumed: 50, gold_consumed: 30, net_food: 450, net_gold: 170, miracle_harvests: 0, _test: true }, TOPICS.HARVEST);
                return res.json({ ok: true, message: `Mensaje de prueba enviado a ${TOPICS.HARVEST}` });
            }
            if (channel === 'production') {
                await auditEvent('MONTHLY_PRODUCTION', { player_id: 0, turn: 0, territories: 3, wood_produced: 90, stone_produced: 60, iron_produced: 25, fishing_produced: 15, _test: true }, TOPICS.HARVEST);
                return res.json({ ok: true, message: `Mensaje de prueba enviado a ${TOPICS.HARVEST}` });
            }
            if (channel === 'salary') {
                await auditEvent('SALARY_PAYMENT', { player_id: 0, turn: 0, total_troops: 250, gold_paid: 1250, _test: true }, TOPICS.SALARY);
                return res.json({ ok: true, message: `Mensaje de prueba enviado a ${TOPICS.SALARY}` });
            }
            return res.status(400).json({ ok: false, message: 'channel debe ser "tax", "military", "harvest", "production" o "salary"' });
        } catch (err) {
            return res.status(500).json({ ok: false, message: err.message });
        }
    });
    router.post('/admin/create-pagus', authenticateToken, requireAdmin, (req, res) => AdminService.CreateAdminPagus(req, res));
    router.post('/admin/reset-explorations', authenticateToken, requireAdmin, AdminService.ResetExplorations);
    router.post('/admin/config', authenticateToken, requireAdmin, AdminService.UpdateConfig);
    router.get('/admin/game-config', authenticateToken, requireAdmin, AdminService.GetGameConfig);
    router.put('/admin/game-config', authenticateToken, requireAdmin, AdminService.UpdateGameConfig);

    // ============================================
    // MESSAGES
    // ============================================

    router.get('/messages', authenticateToken,  MessageService.GetMessagesByUserId );
    router.post('/messages', authenticateToken, MessageService.SendMessage );

    // Mark message as read
    router.put('/messages/:id/read', authenticateToken, MessageService.MarkMessageAsRead );

    // Get thread messages
    router.get('/messages/thread/:thread_id', authenticateToken, async (req, res) => {
        
    });

    // ============================================
    // WORKERS
    // ============================================
    router.get('/workers/types', (req, res) => WorkerService.GetTypes(req, res));
    router.get('/workers/hire-locations', authenticateToken, (req, res) => WorkerService.GetHireLocations(req, res));
    router.post('/workers/buy', authenticateToken, (req, res) => WorkerService.Buy(req, res));
    router.get('/map/workers', authenticateToken, (req, res) => WorkerService.GetInRegion(req, res));
    router.get('/map/constructions', authenticateToken, (req, res) => WorkerService.GetConstructionsInRegion(req, res));
    router.get('/workers/my', authenticateToken, (req, res) => WorkerService.GetMyWorkers(req, res));
    router.post('/workers/set-hex-destination', authenticateToken, (req, res) => WorkerService.SetHexDestination(req, res));
    router.post('/workers/start-construction', authenticateToken, (req, res) => WorkerService.StartConstruction(req, res));

    // ============================================
    // NOTIFICATIONS
    // ============================================
    router.get('/notifications', authenticateToken, (req, res) => NotificationService.getNotifications(req, res));
    // read-all MUST be registered before /:id/read to avoid Express matching 'read-all' as an id param
    router.put('/notifications/read-all', authenticateToken, (req, res) => NotificationService.markAllAsRead(req, res));
    router.put('/notifications/read-type', authenticateToken, (req, res) => NotificationService.markTypeAsRead(req, res));
    router.put('/notifications/unread-all', authenticateToken, (req, res) => NotificationService.markAllAsUnread(req, res));
    router.put('/notifications/:id/read', authenticateToken, (req, res) => NotificationService.markAsRead(req, res));

    // ============================================
    // GAME ENGINE CONTROL (ADMIN ONLY)
    // ============================================

    // Process monitor — comprehensive status of all background processes
    router.get('/admin/process-status', authenticateToken, requireAdmin, (req, res) => TurnService.GetProcessStatus(req, res));

    // Engine lifecycle — start/stop the JS turn loop (persisted across restarts)
    router.post('/admin/engine/start', authenticateToken, requireAdmin, (req, res) => TurnService.StartEngine(req, res));
    router.post('/admin/engine/stop',  authenticateToken, requireAdmin, (req, res) => TurnService.StopEngine(req, res));

    router.get('/admin/engine/status',  authenticateToken, requireAdmin, (req, res) => TurnService.GetGlobalStatus(req, res));
    router.post('/admin/engine/pause',  authenticateToken, requireAdmin, (req, res) => TurnService.SetGamePaused(req, res));
    router.post('/admin/engine/resume', authenticateToken, requireAdmin, (req, res) => TurnService.SetGameResumed(req, res));
    router.post('/admin/engine/force-turn',        authenticateToken, requireAdmin, (req, res) => TurnService.ForceGameTurn(req, res));
    router.post('/admin/engine/force-harvest',     authenticateToken, requireAdmin, (req, res) => TurnService.ForceGameHarvest(req, res));
    router.post('/admin/engine/force-exploration', authenticateToken, requireAdmin, (req, res) => TurnService.ForceGameExploration(req, res));

    // ============================================
    // AI AGENTS (ADMIN ONLY)
    // ============================================
    const AIManagerService = require('../src/services/AIManagerService');
    const AIProxyService   = require('../src/services/AIProxyService');

    // List all AI agents
    router.get('/admin/ai/agents', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const pool = require('../db.js');
            const result = await pool.query(
                `SELECT p.player_id, p.display_name, p.ai_profile, p.gold, p.color, p.capital_h3,
                        COUNT(m.h3_index)::int AS territory_count
                 FROM players p
                 LEFT JOIN h3_map m ON m.player_id = p.player_id
                 WHERE p.is_ai = TRUE AND p.deleted = FALSE
                 GROUP BY p.player_id
                 ORDER BY p.player_id`
            );
            res.json({ success: true, agents: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Spawn AI agents — generic endpoint supporting both profiles
    router.post('/admin/ai/spawn', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { type = 'farmer', h3_index, count = 1 } = req.body;
            const spawnCount = Math.max(1, Math.min(10, parseInt(count) || 1));

            // dummy ignores h3_index/count — spawns near the invoking admin
            if (type === 'dummy') {
                const result = await AIManagerService.spawnDummyAgent(req.user.player_id);
                if (result.success) return res.json(result);
                return res.status(400).json(result);
            }

            const spawnerFn = type === 'expansionist'
                ? (h3) => AIManagerService.spawnExpansionistAgent(h3)
                : type === 'balanced'
                ? (h3) => AIManagerService.spawnBalancedAgent(h3)
                : (h3) => AIManagerService.spawnFarmerAgent(h3);

            if (spawnCount === 1) {
                const result = await spawnerFn(h3_index || null);
                if (result.success) return res.json(result);
                return res.status(400).json(result);
            }

            // Batch spawn: run sequentially to avoid concurrent DB contention
            const results = [];
            for (let i = 0; i < spawnCount; i++) {
                results.push(await spawnerFn(null));
            }
            const succeeded = results.filter(r => r.success).length;
            res.json({
                success: succeeded > 0,
                message: `${succeeded}/${spawnCount} agentes creados correctamente`,
                results,
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Legacy alias kept for backwards compatibility
    router.post('/admin/ai/spawn-farmer', authenticateToken, requireAdmin, async (req, res) => {
        req.body.type = 'farmer';
        const { type, h3_index, count = 1 } = req.body;
        try {
            const spawnCount = Math.max(1, Math.min(10, parseInt(count) || 1));
            const spawnerFn = (h3) => AIManagerService.spawnFarmerAgent(h3);
            if (spawnCount === 1) {
                const result = await spawnerFn(h3_index || null);
                if (result.success) return res.json(result);
                return res.status(400).json(result);
            }
            const results = [];
            for (let i = 0; i < spawnCount; i++) results.push(await spawnerFn(null));
            const succeeded = results.filter(r => r.success).length;
            res.json({ success: succeeded > 0, message: `${succeeded}/${spawnCount} agentes creados`, results });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Delete AI agent
    router.delete('/admin/bots/:botId', authenticateToken, requireAdmin, async (req, res) => {
        const botId = parseInt(req.params.botId);
        if (!botId) return res.status(400).json({ success: false, message: 'botId inválido' });
        try {
            const result = await AIManagerService.deleteAgent(botId);
            if (result.success) return res.json(result);
            return res.status(400).json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ── AI Settings (global_settings table) ──────────────────────────────────

    // GET /admin/ai/settings — devuelve la configuración de IA + último error en memoria
    router.get('/admin/ai/settings', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const settings  = await AIProxyService.getSettings();
            const lastError = AIProxyService.getLastError();
            res.json({ success: true, settings, lastError });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // POST /admin/ai/settings — actualiza un valor { key, value }
    router.post('/admin/ai/settings', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { key, value } = req.body;
            const ALLOWED_KEYS = ['ai_enabled', 'ai_provider', 'max_token_budget'];
            if (!key || !ALLOWED_KEYS.includes(key)) {
                return res.status(400).json({
                    success: false,
                    message: `Clave inválida. Permitidas: ${ALLOWED_KEYS.join(', ')}`,
                });
            }
            if (key === 'ai_provider' && !AIProxyService.VALID_PROVIDERS?.includes(value)) {
                const valid = ['procedural', 'gemini', 'openai'];
                return res.status(400).json({
                    success: false,
                    message: `Proveedor inválido. Opciones: ${valid.join(', ')}`,
                });
            }
            await AIProxyService.setSetting(key, value);
            res.json({ success: true, message: `Configuración actualizada: ${key} = ${value}` });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // GET /admin/ai/usage-stats — resumen de tokens y costes por bot
    router.get('/admin/ai/usage-stats', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const summary = await AIProxyService.getUsageSummary();
            res.json({ success: true, ...summary });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // DELETE /admin/ai/usage-stats — reinicia todos los contadores de uso
    router.delete('/admin/ai/usage-stats', authenticateToken, requireAdmin, async (req, res) => {
        try {
            await AIProxyService.resetUsageStats();
            res.json({ success: true, message: 'Estadísticas de uso de IA reiniciadas' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // POST /admin/ai/test — verifica la conexión con el proveedor configurado
    router.post('/admin/ai/test', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const result = await AIProxyService.testConnection();
            res.status(result.success ? 200 : 400).json({ success: result.success, message: result.message, provider: result.provider });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Force an AI decision cycle immediately (for testing)
    router.post('/admin/ai/force-turn', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const pool = require('../db.js');
            const turnResult = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
            const turn = turnResult.rows[0]?.current_turn ?? 0;
            await AIManagerService.processAITurn(turn);
            res.json({ success: true, message: `Ciclo IA forzado en turno ${turn}` });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================
    // PERSONAJES Y DINASTÍAS
    // ============================================
    router.get('/characters',              authenticateToken, (req, res) => CharacterService.GetMyCharacters(req, res));
    router.get('/characters/visible',      authenticateToken, (req, res) => CharacterService.GetVisibleCharacters(req, res));
    router.get('/characters/:id',          authenticateToken, (req, res) => CharacterService.GetCharacter(req, res));
    router.post('/characters/adopt',           authenticateToken, (req, res) => CharacterService.Adopt(req, res));
    router.post('/characters/:id/procreate',   authenticateToken, (req, res) => CharacterService.Procreate(req, res));
    router.patch('/characters/:id/heir',       authenticateToken, (req, res) => CharacterService.SetHeir(req, res));
    router.put('/characters/:id/move',     authenticateToken, (req, res) => CharacterService.MoveCharacter(req, res));
    router.delete('/characters/:id/move',  authenticateToken, (req, res) => CharacterService.StopCharacter(req, res));
    router.post('/characters/:id/capture', authenticateToken, (req, res) => CharacterService.CaptureCharacter(req, res));
    router.put('/armies/:id/commander',    authenticateToken, (req, res) => CharacterService.AssignCommander(req, res));

    // ============================================
    // CHANGELOG
    // ============================================
    const { Logger } = require('../src/utils/logger.js');
    router.get('/changelog', (_req, res) => {
        try {
            const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');
            if (!fs.existsSync(changelogPath)) {
                Logger.error(new Error(`CHANGELOG.md no encontrado en: ${changelogPath}`), { endpoint: '/changelog' });
                return res.json({ success: true, releases: [] });
            }
            const raw = fs.readFileSync(changelogPath, 'utf8');

            // Split by release headers "## [x.y.z]" or "## [x.y.z] - date"
            const releases = [];
            const sections = raw.split(/^## /m).slice(1); // skip content before first release

            for (const section of sections.slice(0, 10)) {
                const lines = section.split('\n');
                const header = lines[0].trim();
                // Extract version and date from "[1.0.0] - 2026-03-27" or "[1.0.0](url) (2026-03-27)"
                const versionMatch = header.match(/\[([^\]]+)\]/);
                const dateMatch = header.match(/[-–]\s*(\d{4}-\d{2}-\d{2})/) || header.match(/\((\d{4}-\d{2}-\d{2})\)/);
                const version = versionMatch ? versionMatch[1] : header;
                const date = dateMatch ? dateMatch[1] : null;
                const body = lines.slice(1).join('\n').trim();
                releases.push({ version, date, body });
            }

            res.json({ success: true, releases });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Error al leer el changelog' });
        }
    });

    return router;
};
