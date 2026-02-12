const express = require('express');
const router = express.Router();
const h3 = require('h3-js');
const { authenticateToken, requireAdmin, generateToken } = require('../src/middleware/auth');

// This file will contain all the endpoints moved from index.js
// It expects to be passed the pool, config, and logic modules if needed
// For now, I'll export a function that configures the router

module.exports = function (pool, config, logic) {
    const { logGameEvent, Logger } = require('../src/utils/logger');
    const { formatDaysToYearsAndDays, getTerrainColor } = logic.territory;
    const military = require('../src/logic/military');
    const ArmySimulationService = require('../services/ArmySimulationService');

    // ============================================
    // AUTHENTICATION ENDPOINTS
    // ============================================
    router.post('/auth/login', async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                Logger.error(new Error('Login attempt without credentials'), {
                    endpoint: '/api/auth/login',
                    method: 'POST'
                });
                return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
            }

            const result = await pool.query('SELECT player_id, username, password, role, capital_h3, gold FROM players WHERE username = $1', [username]);

            if (result.rows.length === 0) {
                Logger.error(new Error('Login attempt with non-existent user'), {
                    endpoint: '/api/auth/login',
                    method: 'POST',
                    username
                });
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }

            const user = result.rows[0];

            if (password !== user.password) {
                Logger.error(new Error('Login attempt with incorrect password'), {
                    endpoint: '/api/auth/login',
                    method: 'POST',
                    userId: user.player_id,
                    username: user.username
                });
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }

            // Generate JWT token
            const payload = {
                player_id: user.player_id,
                username: user.username,
                role: user.role || 'player',
                capital_h3: user.capital_h3
            };

            const token = generateToken(payload);

            // Send token as HttpOnly cookie
            res.cookie('access_token', token, {
                httpOnly: true,        // Prevents client-side JS from accessing
                secure: false,         // Set to true in production with HTTPS
                sameSite: 'lax',       // CSRF protection
                maxAge: 24 * 60 * 60 * 1000  // 24 hours
            });

            // Log successful login
            Logger.action(`JWT generado y enviado para usuario ${username} (${user.role})`, user.player_id);
            console.log(`✓ User logged in: ${user.username} (${user.role}) - JWT issued`);

            res.json({
                success: true,
                user: {
                    player_id: user.player_id,
                    username: user.username,
                    role: user.role || 'player',
                    capital_h3: user.capital_h3,
                    gold: user.gold
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            Logger.error(error, {
                endpoint: '/api/auth/login',
                method: 'POST'
            });
            res.status(500).json({ success: false, message: 'Error interno del servidor' });
        }
    });

    router.post('/auth/logout', authenticateToken, (req, res) => {
        const userId = req.user?.player_id;
        const username = req.user?.username;

        // Clear the JWT cookie
        res.clearCookie('access_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax'
        });

        // Log successful logout
        if (userId) {
            Logger.action(`Cerró sesión (JWT invalidado)`, userId);
            console.log(`✓ User logged out: ${username}`);
        }

        res.json({ success: true, message: 'Sesión cerrada exitosamente' });
    });

    router.get('/auth/me', authenticateToken, (req, res) => {
        // authenticateToken middleware already verified the JWT and set req.user
        res.json({
            success: true,
            user: {
                player_id: req.user.player_id,
                username: req.user.username,
                role: req.user.role
            }
        });
    });

    // ============================================
    // MAP AND GAME ENDPOINTS
    // ============================================
    router.get('/map/region', async (req, res) => {
        try {
            const { minLat, maxLat, minLng, maxLng, res: resolution } = req.query;
            if (!minLat || !maxLat || !minLng || !maxLng) return res.status(400).json({ error: 'Missing bounding box parameters' });

            const bounds = { minLat: parseFloat(minLat), maxLat: parseFloat(maxLat), minLng: parseFloat(minLng), maxLng: parseFloat(maxLng) };
            if (Object.values(bounds).some(isNaN)) return res.status(400).json({ error: 'Invalid bounding box parameters' });

            const H3_RESOLUTION = resolution ? parseInt(resolution, 10) : 8;
            const polygon = [[bounds.minLat, bounds.minLng], [bounds.minLat, bounds.maxLng], [bounds.maxLat, bounds.maxLng], [bounds.maxLat, bounds.minLng]];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, H3_RESOLUTION)).slice(0, 50000);

            if (h3CellsArray.length === 0) return res.json([]);

            const query = `
        SELECT h3_index, terrain_type_id, terrain_color, has_road, player_id, player_color, building_type_id, icon_slug, location_name, settlement_type, coord_x, coord_y
        FROM v_map_display WHERE h3_index = ANY($1::text[])
      `;
            const result = await pool.query(query, [h3CellsArray]);

            const hexagons = result.rows.map(row => ({
                h3_index: row.h3_index,
                terrain_type_id: row.terrain_type_id,
                terrain_color: row.terrain_color || '#9e9e9e',
                has_road: row.has_road || false,
                player_id: row.player_id || null,
                player_color: row.player_color || null,
                building_type_id: row.building_type_id || 0,
                icon_slug: row.icon_slug || null,
                location_name: row.location_name || null,
                settlement_type: row.settlement_type || null,
                coord_x: row.coord_x,
                coord_y: row.coord_y
            }));

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json(hexagons);
        } catch (error) {
            console.error('❌ Error fetching map data:', error);
            res.status(500).json({ error: 'Failed to fetch map data', message: error.message });
        }
    });

    router.get('/settlements', async (req, res) => {
        try {
            const result = await pool.query('SELECT name, h3_index, type, population_rank FROM settlements ORDER BY name ASC');
            if (!result.rows) return res.json([]);

            const settlements = result.rows.map((row) => {
                try {
                    const [lat, lng] = h3.cellToLatLng(row.h3_index);
                    return { name: row.name, h3_index: row.h3_index, lat, lng, type: row.type, population_rank: row.population_rank };
                } catch (e) { return null; }
            }).filter(s => s !== null);

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json(settlements);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch settlements', message: error.message });
        }
    });

    router.get('/terrain-types', async (req, res) => {
        try {
            const result = await pool.query('SELECT terrain_type_id, name, color FROM terrain_types ORDER BY terrain_type_id');
            const terrainTypes = result.rows.map(row => ({
                terrain_type_id: row.terrain_type_id,
                name: row.name,
                color: getTerrainColor(row.name, row.color)
            }));
            res.json(terrainTypes);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch terrain types', message: error.message });
        }
    });

    // ============================================
    // GAME LOGIC ENDPOINTS
    // ============================================
    router.post('/game/claim', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        try {
            const player_id = req.user.player_id;
            const { h3_index } = req.body;
            if (!h3_index) return res.status(400).json({ success: false, message: 'Falta parámetro: h3_index' });

            await client.query('BEGIN');
            const territoryCountResult = await client.query('SELECT COUNT(*) as count FROM h3_map WHERE player_id = $1', [player_id]);
            const isFirstTerritory = parseInt(territoryCountResult.rows[0].count) === 0;

            const hexResult = await client.query('SELECT m.h3_index, m.player_id, m.terrain_type_id, t.iron_output, t.name as terrain_name FROM h3_map m LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id WHERE m.h3_index = $1 FOR UPDATE OF m', [h3_index]);
            if (hexResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Hexágono no encontrado' }); }

            const hex = hexResult.rows[0];
            if (hex.terrain_type_id === 1 || hex.terrain_type_id === 3) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🌊 No puedes construir en el agua' }); }
            if (hex.player_id !== null) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '🛡️ Este territorio ya está ocupado' }); }

            const playerResult = await client.query('SELECT gold FROM players WHERE player_id = $1 FOR UPDATE', [player_id]);
            const CLAIM_COST = 100;
            if (playerResult.rows[0].gold < CLAIM_COST) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '💰 Oro insuficiente' }); }

            if (!isFirstTerritory && !(await logic.conquest.checkContiguity(h3_index, player_id, pool))) {
                await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: '📍 Debes colonizar territorios contiguos' });
            }

            const eco = logic.conquest.generateInitialEconomy();

            // Update h3_map (removed is_capital column - now in players.capital_h3)
            await client.query('UPDATE h3_map SET player_id = $1, building_type_id = 0, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2', [player_id, h3_index]);

            // Insert territory details
            await client.query('INSERT INTO territory_details (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, gold_stored) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (h3_index) DO UPDATE SET population = EXCLUDED.population, happiness = EXCLUDED.happiness, food_stored = EXCLUDED.food_stored, wood_stored = EXCLUDED.wood_stored, stone_stored = EXCLUDED.stone_stored, iron_stored = EXCLUDED.iron_stored, gold_stored = EXCLUDED.gold_stored', [h3_index, eco.population, eco.happiness, eco.food, eco.wood, eco.stone, 0, 0]);

            // Update player's gold
            await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [CLAIM_COST, player_id]);

            // If this is the first territory, set it as capital
            if (isFirstTerritory) {
                await client.query('UPDATE players SET capital_h3 = $1 WHERE player_id = $2', [h3_index, player_id]);
                Logger.action(`Primera capital fundada en ${h3_index}`, player_id);
            }

            await client.query('COMMIT');

            logGameEvent(`[Claim] Jugador ${player_id} reclamó ${h3_index}${isFirstTerritory ? ' (CAPITAL)' : ''}`);

            // Check if terrain has iron output for discovery message
            let message = isFirstTerritory ? '👑 ¡Capital fundada!' : '🏰 ¡Territorio colonizado!';
            const hasIron = hex.iron_output && hex.iron_output > 0;

            res.json({
                success: true,
                is_capital: isFirstTerritory,
                iron_vein_found: hasIron,
                iron_message: hasIron ? `⛏️ ¡Filón de hierro descubierto! (+${hex.iron_output} hierro/mes)` : null,
                message
            });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            res.status(500).json({ success: false, error: error.message });
        } finally { client.release(); }
    });

    router.get('/game/capital', authenticateToken, async (req, res) => {
        try {
            const result = await pool.query('SELECT capital_h3 FROM players WHERE player_id = $1', [req.user.player_id]);
            if (result.rows.length === 0 || !result.rows[0].capital_h3) {
                return res.status(200).json({ success: false, message: 'No tienes capital' });
            }
            res.json({ success: true, h3_index: result.rows[0].capital_h3 });
        } catch (error) {
            console.error('Get capital error:', error);
            Logger.error(error, {
                endpoint: '/game/capital',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener información de capital' });
        }
    });

    router.get('/map/cell-details/:h3_index', async (req, res) => {
        const { h3_index } = req.params;
        const query = `
      SELECT
        m.*,
        t.name AS terrain_type,
        t.color AS terrain_color,
        t.food_output,
        t.wood_output,
        p.username AS player_name,
        p.color AS player_color,
        p.capital_h3,
        b.name AS building_type,
        s.name AS settlement_name,
        s.type AS settlement_type,
        td.*,
        m.coord_x,
        m.coord_y
      FROM h3_map m
      LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      LEFT JOIN players p ON m.player_id = p.player_id
      LEFT JOIN building_types b ON m.building_type_id = b.building_type_id
      LEFT JOIN settlements s ON m.h3_index = s.h3_index
      LEFT JOIN territory_details td ON m.h3_index = td.h3_index
      WHERE m.h3_index = $1
    `;
        const result = await pool.query(query, [h3_index]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Hexágono no encontrado' });
        const cell = result.rows[0];

        // Calculate is_capital dynamically
        const is_capital = cell.player_id && cell.capital_h3 === h3_index;

        res.json({
            h3_index, terrain_type: cell.terrain_type, terrain_color: cell.terrain_color, food_output: cell.food_output || 0, wood_output: cell.wood_output || 0,
            player_id: cell.player_id, player_name: cell.player_name, building_type: cell.building_type, is_capital,
            settlement_name: cell.settlement_name, coord_x: cell.coord_x, coord_y: cell.coord_y, territory: cell.population ? { population: cell.population, happiness: cell.happiness, food: cell.food_stored, wood: cell.wood_stored, stone: cell.discovered_resource ? cell.stone_stored : 0, iron: cell.discovered_resource ? cell.iron_stored : 0, gold: cell.discovered_resource ? cell.gold_stored : 0, discovered_resource: cell.discovered_resource, exploration_end_turn: cell.exploration_end_turn, farm_level: cell.farm_level, mine_level: cell.mine_level, lumber_level: cell.lumber_level, port_level: cell.port_level } : null
        });
    });

    // Get armies in visible extent (for map icons)
    router.get('/map/armies', authenticateToken, async (req, res) => {
        try {
            const { minLat, maxLat, minLng, maxLng } = req.query;

            // Validate geographic bounds
            if (!minLat || !maxLat || !minLng || !maxLng) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing bounding box parameters'
                });
            }

            const bounds = {
                minLat: parseFloat(minLat),
                maxLat: parseFloat(maxLat),
                minLng: parseFloat(minLng),
                maxLng: parseFloat(maxLng)
            };

            if (Object.values(bounds).some(isNaN)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid bounding box parameters'
                });
            }

            // Convert geographic bounds to H3 cells (same resolution as map)
            const H3_RESOLUTION = 8;
            const polygon = [
                [bounds.minLat, bounds.minLng],
                [bounds.minLat, bounds.maxLng],
                [bounds.maxLat, bounds.maxLng],
                [bounds.maxLat, bounds.minLng]
            ];
            const h3CellsArray = Array.from(h3.polygonToCells(polygon, H3_RESOLUTION)).slice(0, 50000);

            if (h3CellsArray.length === 0) {
                return res.json({
                    success: true,
                    armies: [],
                    current_player_id: req.user.player_id
                });
            }

            // Query armies table directly - group by location and player
            const query = `
                SELECT
                    a.h3_index,
                    a.player_id,
                    COUNT(DISTINCT a.army_id) as army_count,
                    SUM(t.quantity) as total_troops
                FROM armies a
                LEFT JOIN troops t ON a.army_id = t.army_id
                WHERE a.h3_index = ANY($1::text[])
                GROUP BY a.h3_index, a.player_id
                ORDER BY a.h3_index
            `;

            const result = await pool.query(query, [h3CellsArray]);

            res.json({
                success: true,
                armies: result.rows,
                current_player_id: req.user.player_id
            });

        } catch (error) {
            Logger.error(error, {
                endpoint: '/map/armies',
                method: 'GET',
                userId: req.user?.player_id,
                payload: req.query
            });
            res.status(500).json({ success: false, message: 'Error al obtener ejércitos' });
        }
    });

    // Get detailed army info for a specific hex (for popup)
    router.get('/map/army-details/:h3_index', authenticateToken, async (req, res) => {
        try {
            const { h3_index } = req.params;

            // 1. Get armies basic info + resources + rest
            const armiesQuery = `
                SELECT 
                    a.army_id, a.name, a.player_id, 
                    a.gold_provisions, a.food_provisions, a.wood_provisions,
                    p.username as player_name,
                    p.color as player_color,
                    a.destination,
                    a.recovering,
                    a.movement_points
                FROM armies a
                JOIN players p ON a.player_id = p.player_id
                WHERE a.h3_index = $1
            `;

            const armiesResult = await pool.query(armiesQuery, [h3_index]);
            const armies = armiesResult.rows;

            // 2. For each army, get units and fatigue status
            const ArmySimulationService = require('../services/ArmySimulationService');

            for (let army of armies) {
                const unitsQuery = `
                    SELECT
                        t.quantity, t.experience, t.morale,
                        ut.name as unit_name, ut.attack, ut.health_points,
                        t.stamina, t.force_rest
                    FROM troops t
                    JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
                    WHERE t.army_id = $1
                `;
                const unitsResult = await pool.query(unitsQuery, [army.army_id]);
                army.units = unitsResult.rows;

                // Calculate total troops for summary
                army.total_count = army.units.reduce((sum, u) => sum + u.quantity, 0);

                // Get fatigue status (weakest link)
                const fatigueStatus = await ArmySimulationService.getArmyFatigueStatus(army.army_id);
                if (fatigueStatus.success) {
                    army.min_stamina = fatigueStatus.minStamina;
                    army.has_force_rest = fatigueStatus.hasForceRest;
                    army.exhausted_units = fatigueStatus.exhaustedUnits;
                } else {
                    army.min_stamina = 100;
                    army.has_force_rest = false;
                    army.exhausted_units = 0;
                }
            }

            res.json({
                success: true,
                armies: armies,
                current_player_id: req.user.player_id
            });

        } catch (error) {
            Logger.error(error, {
                endpoint: '/map/army-details',
                method: 'GET',
                userId: req.user?.player_id,
                payload: req.params
            });
            res.status(500).json({ success: false, message: 'Error al obtener detalles del ejército' });
        }
    });

    router.get('/players/:id', async (req, res) => {
        const result = await pool.query('SELECT player_id, username, gold, color FROM players WHERE player_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
        res.json(result.rows[0]);
    });

    router.get('/game/world-state', async (req, res) => {
        try {
            const result = await pool.query('SELECT current_turn, game_date, is_paused FROM world_state WHERE id = 1');
            res.json({ success: true, turn: result.rows[0].current_turn, date: result.rows[0].game_date, is_paused: result.rows[0].is_paused });
        } catch (e) {
            if (client)
                await client.query('ROLLBACK');
            Logger.error(error, {
                endpoint: '/game/world-state',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/game/my-fiefs', authenticateToken, async (req, res) => {
        const query = `
      SELECT
        m.h3_index,
        m.coord_x,
        m.coord_y,
        COALESCE(td.custom_name, s.name, m.h3_index) AS location_name,
        td.*,
        t.name AS terrain_name,
        t.food_output,
        COALESCE(garrison.total_troops, 0) AS total_troops,
        p.capital_h3
      FROM h3_map m
      JOIN territory_details td ON m.h3_index = td.h3_index
      JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      JOIN players p ON m.player_id = p.player_id
      LEFT JOIN settlements s ON m.h3_index = s.h3_index
      LEFT JOIN (
        SELECT a.h3_index, SUM(tr.quantity) AS total_troops
        FROM armies a
        JOIN troops tr ON a.army_id = tr.army_id
        WHERE a.player_id = $1
        GROUP BY a.h3_index
      ) garrison ON m.h3_index = garrison.h3_index
      WHERE m.player_id = $1
      ORDER BY td.population DESC
    `;
        const result = await pool.query(query, [req.user.player_id]);

        // Add calculated is_capital field to each fief
        const fiefsWithCapital = result.rows.map(row => ({
            ...row,
            is_capital: (row.h3_index === row.capital_h3)
        }));

        res.json({ success: true, fiefs: fiefsWithCapital });
    });

    // ============================================
    // TERRITORY AND INFRASTRUCTURE
    // ============================================
    router.post('/territory/explore', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.user.player_id;
            await client.query('BEGIN');
            const ownership = await client.query('SELECT player_id FROM h3_map WHERE h3_index = $1', [h3_index]);
            if (ownership.rows[0]?.player_id !== player_id) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: 'No posees este territorio' }); }

            const details = await client.query('SELECT exploration_end_turn, discovered_resource FROM territory_details WHERE h3_index = $1', [h3_index]);
            if (details.rows[0].discovered_resource !== null || details.rows[0].exploration_end_turn !== null) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Exploración ya realizada o en curso' }); }

            const player = await client.query('SELECT gold FROM players WHERE player_id = $1', [player_id]);
            const cost = config.exploration.gold_cost;
            if (player.rows[0].gold < cost) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Oro insuficiente' }); }

            const world = await client.query('SELECT current_turn FROM world_state WHERE id = 1');
            const endTurn = world.rows[0].current_turn + config.exploration.turns_required;

            await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [cost, player_id]);
            await client.query('UPDATE territory_details SET exploration_end_turn = $1 WHERE h3_index = $2', [endTurn, h3_index]);
            await client.query('COMMIT');
            logGameEvent(`[EXPLORACIÓN] Jugador ${player_id} inició exploración en ${h3_index}`);

            // Fetch updated player gold
            const newGoldResult = await client.query('SELECT gold FROM players WHERE player_id = $1', [player_id]);

            res.json({
                success: true,
                message: `Exploración iniciada, finaliza en turno ${endTurn}`,
                exploration_end_turn: endTurn,
                new_gold_balance: newGoldResult.rows[0].gold,
                gold_spent: cost
            });
        } catch (e) {
            if (client)
                await client.query('ROLLBACK');
            Logger.error(error, {
                endpoint: '/territory/explore',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, error: e.message });
        }
        finally { client.release(); }
    });

    router.post('/territory/upgrade', authenticateToken, async (req, res) => {
        const client = await pool.connect();
        try {
            const { h3_index, building_type } = req.body;
            const player_id = req.user.player_id;
            const ownership = await client.query('SELECT player_id FROM h3_map WHERE h3_index = $1', [h3_index]);
            if (ownership.rows[0]?.player_id !== player_id) return res.status(403).json({ success: false, message: 'No posees este territorio' });

            const territory = (await client.query(`SELECT td.*, t.name as terrain_type, t.food_output, t.wood_output, m.is_coast FROM territory_details td JOIN h3_map m ON td.h3_index = m.h3_index JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id WHERE td.h3_index = $1`, [h3_index])).rows[0];
            const error = logic.infrastructure.validateUpgrade(building_type, territory);
            if (error) return res.status(400).json({ success: false, message: error });

            const currentLevel = territory[`${building_type}_level`] || 0;
            const cost = logic.infrastructure.calculateUpgradeCost(building_type, currentLevel, config);

            const player = (await client.query('SELECT gold FROM players WHERE player_id = $1', [player_id])).rows[0];
            if (player.gold < cost) return res.status(400).json({ success: false, message: 'Oro insuficiente' });

            await client.query('BEGIN');
            await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [cost, player_id]);
            await client.query(`UPDATE territory_details SET ${building_type}_level = $1 WHERE h3_index = $2`, [currentLevel + 1, h3_index]);
            await client.query('COMMIT');
            logGameEvent(`[INFRAESTRUCTURA] Jugador ${player_id} mejoró ${building_type} en ${h3_index}`);
            res.json({ success: true, message: `${building_type} mejorada al nivel ${currentLevel + 1}` });
        } catch (e) {
            if (client)
                await client.query('ROLLBACK');
            Logger.error(error, {
                endpoint: '/territory/upgrade',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, error: e.message });
        }
        finally { client.release(); }
    });

    // ============================================
    // MILITARY RECRUITMENT
    // ============================================
    router.get('/military/unit-types', async (req, res) => {
        try {
            const unitTypes = await military.getUnitTypes(pool);
            res.json({ success: true, unit_types: unitTypes });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/api/military/unit-types',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener tipos de unidades' });
        }
    });

    router.post('/military/recruit', authenticateToken, async (req, res) => {
        try {
            const player_id = req.user.player_id;
            const { h3_index, unit_type_id, quantity, army_name } = req.body;

            if (!h3_index || !unit_type_id || !quantity || !army_name) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos' });
            }

            if (quantity <= 0) {
                return res.status(400).json({ success: false, message: 'La cantidad debe ser mayor a 0' });
            }

            const result = await military.recruitUnits(pool, req.body, player_id);

            if (result.success) {
                // Registrar acción del usuario
                Logger.action(`Reclutó ${quantity} unidades (tipo ${unit_type_id}) en ${h3_index}`, player_id, {
                    army_name,
                    unit_type_id,
                    quantity
                });
            }

            res.json(result);
        } catch (error) {
            Logger.error(error, {
                endpoint: '/api/military/recruit',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, message: 'Error al reclutar unidades', error: error.message });
        }
    });

    router.get('/military/troops', authenticateToken, async (req, res) => {
        try {
            const player_id = req.user.player_id;
            const troops = await military.getTroops(pool, player_id);

            Logger.action('Consultó panel de tropas', player_id);

            res.json({ success: true, troops: troops });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/api/military/troops',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener tropas' });
        }
    });

    router.post('/military/move-army', authenticateToken, async (req, res) => {
        try {
            const player_id = req.user.player_id;
            const { army_id, target_h3 } = req.body;

            if (!army_id || !target_h3) {
                return res.status(400).json({
                    success: false,
                    message: 'Faltan parámetros requeridos (army_id, target_h3)'
                });
            }

            // 1. Validate army exists and belongs to player
            const armyCheck = await pool.query(
                'SELECT army_id, name, h3_index, player_id FROM armies WHERE army_id = $1',
                [army_id]
            );

            if (armyCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Ejército no encontrado'
                });
            }

            const army = armyCheck.rows[0];

            if (army.player_id !== player_id) {
                return res.status(403).json({
                    success: false,
                    message: 'No tienes permiso para mover este ejército'
                });
            }

            // 2. Check if army can move (no force_rest)
            const canMove = await ArmySimulationService.canArmyMove(army_id);
            if (!canMove) {
                return res.status(400).json({
                    success: false,
                    message: 'El ejército tiene unidades agotadas y debe descansar'
                });
            }

            // 3. Calculate distance (for now, simple grid distance)
            const distance = h3.gridDistance(army.h3_index, target_h3);

            // 4. Validate destination is reachable (for now, just check it's not too far)
            const MAX_DISTANCE = 10; // TODO: Configurable
            if (distance > MAX_DISTANCE) {
                return res.status(400).json({
                    success: false,
                    message: `Destino demasiado lejano (${distance} hexágonos, máximo ${MAX_DISTANCE})`
                });
            }

            // 5. Calculate stamina cost (10 per hex moved, configurable)
            const STAMINA_COST_PER_HEX = 10; // TODO: Get from terrain modifiers
            const totalStaminaCost = distance * STAMINA_COST_PER_HEX;

            // 6. Consume stamina
            const staminaResult = await ArmySimulationService.consumeStamina(army_id, totalStaminaCost);

            if (!staminaResult.success) {
                return res.status(500).json({
                    success: false,
                    message: 'Error al procesar consumo de stamina: ' + staminaResult.message
                });
            }

            // 7. Update army destination and recovering turns
            const recoveringTurns = Math.ceil(distance / 2); // 1 turn per 2 hexes
            await pool.query(
                `UPDATE armies
                 SET destination = $1,
                     recovering = $2
                 WHERE army_id = $3`,
                [target_h3, recoveringTurns, army_id]
            );

            // 8. Log action
            Logger.action(
                `Movió ejército "${army.name}" desde ${army.h3_index} hacia ${target_h3} (${distance} hexágonos)`,
                player_id,
                {
                    army_id,
                    from: army.h3_index,
                    to: target_h3,
                    distance,
                    stamina_consumed: totalStaminaCost,
                    recovering_turns: recoveringTurns
                }
            );

            res.json({
                success: true,
                message: `${army.name} en marcha hacia ${target_h3} (${distance} hex, ${recoveringTurns} turnos)`,
                data: {
                    army_name: army.name,
                    distance,
                    stamina_consumed: totalStaminaCost,
                    recovering_turns: recoveringTurns,
                    exhausted_units: staminaResult.exhaustedUnits || 0
                }
            });

        } catch (error) {
            console.error('Error al mover ejército:', error);
            Logger.error(error, {
                endpoint: '/api/military/move-army',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({
                success: false,
                message: 'Error al mover ejército',
                error: error.message
            });
        }
    });

    // ============================================
    // ADMIN AND MESSAGES
    // ============================================
    router.post('/admin/reset', authenticateToken, requireAdmin, async (req, res) => {
        try {
            // Log admin access
            Logger.action(`Acceso administrativo a /admin/reset - Reseteando mundo`, req.user.player_id);

            await pool.query("UPDATE world_state SET current_turn = 0, game_date = '1039-03-01' WHERE id = 1");

            Logger.action(`Mundo reseteado exitosamente`, req.user.player_id);
            res.json({ success: true, message: 'Mundo reseteado' });
        } catch (error) {
            console.error('Admin reset error:', error);
            Logger.error(error, {
                endpoint: '/admin/reset',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, message: 'Error al resetear mundo' });
        }
    });

    router.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
        try {
            // Log admin access
            Logger.action(`Acceso administrativo a /admin/stats`, req.user.player_id);

            const world = (await pool.query('SELECT current_turn, game_date FROM world_state WHERE id = 1')).rows[0];
            const config = (await pool.query("SELECT value FROM game_config WHERE \"group\" = 'gameplay' and key = 'turn_duration_seconds'")).rows[0];
            const players = (await pool.query('SELECT COUNT(*) FROM players')).rows[0].count;
            const territories = (await pool.query('SELECT COUNT(*) FROM h3_map WHERE player_id IS NOT NULL')).rows[0].count;
            const messages = (await pool.query('SELECT COUNT(*) FROM messages')).rows[0].count;

            res.json({
                success: true,
                stats: {
                    current_turn: world.current_turn,
                    game_date: world.game_date,
                    players: parseInt(players),
                    territories: parseInt(territories),
                    messages: parseInt(messages),
                    turn_interval_seconds: config.value
                }
            });
        } catch (error) {
            console.error('Admin stats error:', error);
            Logger.error(error, {
                endpoint: '/admin/stats',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
        }
    });

    router.post('/admin/reset-explorations', authenticateToken, requireAdmin, async (req, res) => {
        try {
            // Log admin access
            Logger.action(`Acceso administrativo a /admin/reset-explorations - Reseteando exploraciones`, req.user.player_id);

            await pool.query('UPDATE territory_details SET exploration_end_turn = NULL, discovered_resource = NULL');

            Logger.action(`Exploraciones reseteadas exitosamente`, req.user.player_id);
            res.json({ success: true, message: 'Todas las exploraciones han sido reseteadas' });
        } catch (error) {
            console.error('Admin reset-explorations error:', error);
            Logger.error(error, {
                endpoint: '/admin/reset-explorations',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, message: 'Error al resetear exploraciones' });
        }
    });

    router.post('/admin/config', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { turn_interval_seconds } = req.body;
            if (!turn_interval_seconds) return res.status(400).json({ success: false, message: 'turn_interval_seconds requerido' });

            // Log admin access
            Logger.action(`Acceso administrativo a /admin/config - Actualizando intervalo de turnos a ${turn_interval_seconds}s`, req.user.player_id);

            // Also update in game_config for persistence across reloads if applicable
            await pool.query('INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value', ['gameplay', 'turn_duration_seconds', turn_interval_seconds.toString()]);

            Logger.action(`Configuración actualizada: turn_interval_seconds = ${turn_interval_seconds}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración actualizada. Reinicie el servidor para aplicar el nuevo intervalo de tiempo.' });
        } catch (error) {
            console.error('Admin config error:', error);
            Logger.error(error, {
                endpoint: '/api/admin/config',
                method: 'POST',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración', error: error.message });
        }
    });

    router.get('/admin/game-config', authenticateToken, requireAdmin, async (req, res) => {
        try {
            // Log admin access
            Logger.action(`Acceso administrativo a /admin/game-config - Consultando configuración`, req.user.player_id);

            res.json({ success: true, config: config });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/game-config',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener configuración' });
        }
    });

    router.put('/admin/game-config', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const { group, key, value } = req.body;
            if (!group || !key || value === undefined) return res.status(400).json({ success: false, message: 'Faltan parámetros' });

            // Log admin access
            Logger.action(`Acceso administrativo a /admin/game-config - Actualizando ${group}.${key} = ${value}`, req.user.player_id);

            await pool.query('INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value', [group, key, value.toString()]);

            // Dynamically update the in-memory config object
            if (!config[group]) config[group] = {};
            config[group][key] = !isNaN(value) ? Number(value) : value;

            Logger.action(`Configuración actualizada: ${group}.${key} = ${value}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración de juego actualizada' });
        } catch (error) {
            console.error('Admin update-game-config error:', error);
            Logger.error(error, {
                endpoint: '/admin/game-config',
                method: 'PUT',
                userId: req.user?.player_id,
                payload: req.body
            });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración de juego' });
        }
    });

    router.get('/messages', authenticateToken, async (req, res) => {
        const result = await pool.query('SELECT m.*, s.username as sender_username FROM messages m LEFT JOIN players s ON m.sender_id = s.player_id WHERE m.receiver_id = $1 OR m.sender_id = $1 ORDER BY m.sent_at DESC', [req.user.player_id]);
        res.json({ success: true, messages: result.rows });
    });

    router.post('/messages', authenticateToken, async (req, res) => {
        const { recipient_username, subject, body } = req.body;
        const receiver = await pool.query('SELECT player_id FROM players WHERE username = $1', [recipient_username]);
        if (receiver.rows.length === 0) return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });
        await pool.query('INSERT INTO messages (sender_id, receiver_id, subject, body) VALUES ($1, $2, $3, $4)', [req.user.player_id, receiver.rows[0].player_id, subject, body]);
        res.json({ success: true, message: 'Mensaje enviado' });
    });

    // Mark message as read
    router.put('/messages/:id/read', authenticateToken, async (req, res) => {
        try {
            const messageId = parseInt(req.params.id);
            const playerId = req.user.player_id;

            // Verify message exists and user is the receiver
            const messageCheck = await pool.query(
                'SELECT id, receiver_id, is_read FROM messages WHERE id = $1',
                [messageId]
            );

            if (messageCheck.rows.length === 0) {
                Logger.error(new Error('Message not found'), {
                    context: 'api.markMessageRead',
                    messageId: messageId,
                    userId: playerId
                });
                return res.status(404).json({ success: false, message: 'Mensaje no encontrado' });
            }

            const message = messageCheck.rows[0];

            // Security check: only the receiver can mark a message as read
            if (message.receiver_id !== playerId) {
                Logger.error(new Error('Unauthorized mark as read attempt'), {
                    context: 'api.markMessageRead',
                    messageId: messageId,
                    userId: playerId,
                    actualReceiverId: message.receiver_id
                });
                return res.status(403).json({ success: false, message: 'No autorizado' });
            }

            // Update message to mark as read
            await pool.query(
                'UPDATE messages SET is_read = TRUE WHERE id = $1',
                [messageId]
            );

            Logger.action(`Mensaje ${messageId} marcado como leído`, playerId);
            res.json({ success: true, message: `Mensaje id: ${messageId} marcado como leído` });
        } catch (error) {
            Logger.error(error, {
                context: 'api.markMessageRead',
                endpoint: 'PUT /api/messages/:id/read',
                userId: req.user?.player_id,
                messageId: req.params.id
            });
            res.status(500).json({ success: false, message: 'Error al marcar mensaje como leído' });
        }
    });

    // Get thread messages
    router.get('/messages/thread/:thread_id', authenticateToken, async (req, res) => {
        try {
            const threadId = parseInt(req.params.thread_id);
            const playerId = req.user.player_id;

            // Get all messages in thread where user is sender or receiver
            const result = await pool.query(`
                SELECT m.*,
                       s.username as sender_username,
                       r.username as receiver_username
                FROM messages m
                LEFT JOIN players s ON m.sender_id = s.player_id
                LEFT JOIN players r ON m.receiver_id = r.player_id
                WHERE m.thread_id = $1
                  AND (m.sender_id = $2 OR m.receiver_id = $2)
                ORDER BY m.sent_at ASC
            `, [threadId, playerId]);

            Logger.action(`Thread ${threadId} consultado`, playerId);
            res.json({ success: true, messages: result.rows });
        } catch (error) {
            Logger.error(error, {
                context: 'api.getMessageThread',
                endpoint: 'GET /api/messages/thread/:thread_id',
                userId: req.user?.player_id,
                threadId: req.params.thread_id
            });
            res.status(500).json({ success: false, message: 'Error al cargar conversación' });
        }
    });

    // ============================================
    // GAME ENGINE CONTROL (ADMIN ONLY)
    // ============================================
    const { processGameTurn, isEngineActive, processHarvestManually } = require('../src/logic/turn_engine');

    router.get('/admin/engine/status', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/status - Consultando estado del motor`, req.user.player_id);

            const worldState = await pool.query('SELECT current_turn, is_paused, last_updated FROM world_state WHERE id = 1');
            const state = worldState.rows[0];

            res.json({
                success: true,
                engine: {
                    isRunning: isEngineActive(),
                    isPaused: state.is_paused,
                    currentTurn: state.current_turn,
                    lastUpdate: state.last_updated
                }
            });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/status',
                method: 'GET',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener estado del motor' });
        }
    });

    router.post('/admin/engine/pause', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/pause - Pausando juego`, req.user.player_id);

            await pool.query('UPDATE world_state SET is_paused = true WHERE id = 1');

            Logger.action(`Juego pausado exitosamente`, req.user.player_id);
            res.json({ success: true, message: 'Juego pausado. El motor seguirá corriendo pero no procesará turnos.' });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/pause',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al pausar juego' });
        }
    });

    router.post('/admin/engine/resume', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/resume - Reanudando juego`, req.user.player_id);

            await pool.query('UPDATE world_state SET is_paused = false WHERE id = 1');

            Logger.action(`Juego reanudado exitosamente`, req.user.player_id);
            res.json({ success: true, message: 'Juego reanudado. El motor procesará el siguiente turno según el intervalo configurado.' });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/resume',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al reanudar juego' });
        }
    });

    router.post('/admin/engine/force-turn', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/force-turn - Forzando procesamiento de turno`, req.user.player_id);

            // Force process a turn manually
            const result = await processGameTurn(pool, config);

            if (result.paused) {
                Logger.action(`Intento de forzar turno bloqueado: juego está pausado`, req.user.player_id);
                return res.status(400).json({
                    success: false,
                    message: 'No se puede forzar turno: el juego está pausado. Usa /admin/engine/resume primero.'
                });
            }

            if (result.success) {
                Logger.action(`Turno forzado exitosamente: turno ${result.turn}`, req.user.player_id);
                res.json({
                    success: true,
                    message: `Turno ${result.turn} procesado exitosamente`,
                    turn: result.turn,
                    date: result.date
                });
            } else {
                Logger.action(`Error al forzar turno`, req.user.player_id);
                res.status(500).json({ success: false, message: 'Error al procesar turno' });
            }
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-turn',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de turno' });
        }
    });

    router.post('/admin/engine/force-harvest', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/force-harvest - Forzando procesamiento de cosecha`, req.user.player_id);

            const worldState = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = worldState.rows[0].current_turn;

            // Force process harvest manually
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Import processHarvest function
                const { processHarvestManually } = require('../src/logic/turn_engine');
                await processHarvestManually(client, currentTurn, config);

                await client.query('COMMIT');

                Logger.action(`Cosecha forzada exitosamente en turno ${currentTurn}`, req.user.player_id);
                res.json({
                    success: true,
                    message: `Cosecha procesada exitosamente en turno ${currentTurn}`,
                    turn: currentTurn
                });
            } catch (error) {
                if (client) await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-harvest',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de cosecha' });
        }
    });

    // Force exploration processing (admin only, for testing)
    router.post('/admin/engine/force-exploration', authenticateToken, requireAdmin, async (req, res) => {
        try {
            Logger.action(`Acceso administrativo a /admin/engine/force-exploration - Forzando procesamiento de exploraciones`, req.user.player_id);

            const worldState = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = worldState.rows[0].current_turn;

            // Force process explorations manually
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Import processExplorations function
                const { processExplorationsManually } = require('../src/logic/turn_engine');
                await processExplorationsManually(client, currentTurn, config);

                await client.query('COMMIT');

                Logger.action(`Exploraciones forzadas exitosamente en turno ${currentTurn}`, req.user.player_id);
                res.json({
                    success: true,
                    message: `Exploraciones procesadas exitosamente en turno ${currentTurn}`,
                    turn: currentTurn
                });
            } catch (error) {
                if (client) await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            Logger.error(error, {
                endpoint: '/admin/engine/force-exploration',
                method: 'POST',
                userId: req.user?.player_id
            });
            res.status(500).json({ success: false, message: 'Error al forzar procesamiento de exploraciones' });
        }
    });

    return router;
};
