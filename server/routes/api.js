const express = require('express');
const router = express.Router();
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

    // ============================================
    // AUTHENTICATION ENDPOINTS
    // ============================================
    router.post('/auth/login', LoginService.Login);
    router.post('/auth/logout', authenticateToken, LoginService.Logout);
    router.get('/auth/me', authenticateToken, LoginService.AuthMe);
    router.put('/auth/profile', authenticateToken, (req, res) => LoginService.UpdateProfile(req, res));

    // ============================================
    // MAP AND GAME ENDPOINTS
    // ============================================
    router.get('/map/region', TerrainService.GetRegion );
    router.get('/terrain-types', TerrainService.GetTerrainTypes );

    // ============================================
    // GAME LOGIC ENDPOINTS
    // ============================================
    router.post('/game/claim', authenticateToken, KingdomService.ClaimTerritory);
    router.get('/game/capital', authenticateToken, KingdomService.GetCapital);

    router.get('/map/cell-details/:h3_index', TerrainService.GetCellDetails);

    // Get armies in visible extent (for map icons)
    router.get('/map/armies', authenticateToken, ArmyService.GetArmiesInRegion);

    // Get completed buildings in visible extent (for map icons)
    router.get('/map/buildings', authenticateToken, (req, res) => TerrainService.GetBuildingsInBounds(req, res));

    // Get detailed army info for a specific hex (for popup)
    router.get('/map/army-details/:h3_index', authenticateToken, ArmyService.GetArmyDetails);

    router.get('/players/:id', PlayerService.GetById);

    router.get('/game/world-state', TurnService.GetWorldState);
    router.get('/game/my-fiefs', authenticateToken, KingdomService.GetMyFiefs);

    // ============================================
    // TERRITORY AND INFRASTRUCTURE
    // ============================================
    router.post('/territory/explore', authenticateToken, KingdomService.StartExploration);
    router.post('/territory/upgrade', authenticateToken, KingdomService.UpgradeBuilding);
    router.get('/territory/buildings', authenticateToken, (req, res) => KingdomService.GetBuildings(req, res));
    router.post('/territory/construct', authenticateToken, (req, res) => KingdomService.ConstructBuilding(req, res));
    router.post('/territory/upgrade-building', authenticateToken, (req, res) => KingdomService.UpgradeFiefBuilding(req, res));

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
    router.post('/military/scout', authenticateToken, (req, res) => ScoutingService.scoutArmy(req, res));
    router.post('/military/dismiss', authenticateToken, (req, res) => ArmyService.DismissTroops(req, res));
    router.post('/military/reinforce', authenticateToken, (req, res) => ArmyService.ReinforceArmy(req, res));

    // ============================================
    // ECONOMY
    // ============================================
    router.get('/economy/summary', authenticateToken, (req, res) => EconomyService.GetEconomySummary(req, res));
    router.patch('/economy/settings', authenticateToken, (req, res) => EconomyService.UpdateEconomySettings(req, res));

    // ============================================
    // ADMIN AND MESSAGES
    // ============================================
    router.post('/admin/reset', authenticateToken, requireAdmin, AdminService.ResetWorld);
    router.get('/admin/stats', authenticateToken, requireAdmin, AdminService.GetStats);
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
    // NOTIFICATIONS
    // ============================================
    router.get('/notifications', authenticateToken, (req, res) => NotificationService.getNotifications(req, res));
    // read-all MUST be registered before /:id/read to avoid Express matching 'read-all' as an id param
    router.put('/notifications/read-all', authenticateToken, (req, res) => NotificationService.markAllAsRead(req, res));
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

    // List all AI agents
    router.get('/admin/ai/agents', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const pool = require('../db.js');
            const result = await pool.query(
                `SELECT p.player_id, p.display_name, p.ai_profile, p.gold, p.color, p.capital_h3,
                        COUNT(m.h3_index)::int AS territory_count
                 FROM players p
                 LEFT JOIN h3_map m ON m.player_id = p.player_id
                 WHERE p.is_ai = TRUE
                 GROUP BY p.player_id
                 ORDER BY p.player_id`
            );
            res.json({ success: true, agents: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Spawn one or more Farmer AI agents
    router.post('/admin/ai/spawn-farmer', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { h3_index, count = 1 } = req.body;
            const spawnCount = Math.max(1, Math.min(10, parseInt(count) || 1));

            if (spawnCount === 1) {
                const result = await AIManagerService.spawnFarmerAgent(h3_index || null);
                if (result.success) return res.json(result);
                return res.status(400).json(result);
            }

            // Batch spawn: run sequentially to avoid concurrent DB contention
            const results = [];
            for (let i = 0; i < spawnCount; i++) {
                const r = await AIManagerService.spawnFarmerAgent(null);
                results.push(r);
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

    return router;
};
