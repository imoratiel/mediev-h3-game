const express = require('express');
const router = express.Router();
const h3 = require('h3-js');
const { requireAuth, requireAdmin } = require('../src/middleware/auth');

// This file will contain all the endpoints moved from index.js
// It expects to be passed the pool, config, and logic modules if needed
// For now, I'll export a function that configures the router

module.exports = function (pool, config, logic) {
    const { logGameEvent } = require('../src/utils/logger');
    const { formatDaysToYearsAndDays, getTerrainColor } = logic.territory;
    const military = require('../src/logic/military');

    // ============================================
    // AUTHENTICATION ENDPOINTS
    // ============================================
    router.post('/auth/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });

            const result = await pool.query('SELECT player_id, username, password, role FROM players WHERE username = $1', [username]);
            if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });

            const user = result.rows[0];
            if (password !== user.password) return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });

            req.session.user = { player_id: user.player_id, username: user.username, role: user.role || 'player' };
            console.log(`✓ User logged in: ${user.username} (${user.role})`);
            res.json({ success: true, user: req.session.user });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor' });
        }
    });

    router.post('/auth/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
            res.json({ success: true, message: 'Sesión cerrada exitosamente' });
        });
    });

    router.get('/auth/me', (req, res) => {
        if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'No hay sesión activa' });
        res.json({ success: true, user: req.session.user });
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
        SELECT h3_index, terrain_type_id, terrain_color, has_road, player_id, player_color, building_type_id, icon_slug, location_name, settlement_type
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
                settlement_type: row.settlement_type || null
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
    router.post('/game/claim', requireAuth, async (req, res) => {
        const client = await pool.connect();
        try {
            const player_id = req.session.user.player_id;
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
            await client.query('UPDATE h3_map SET player_id = $1, building_type_id = 0, is_capital = $2, last_update = CURRENT_TIMESTAMP WHERE h3_index = $3', [player_id, isFirstTerritory, h3_index]);
            await client.query('INSERT INTO territory_details (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, gold_stored) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (h3_index) DO UPDATE SET population = EXCLUDED.population, happiness = EXCLUDED.happiness, food_stored = EXCLUDED.food_stored, wood_stored = EXCLUDED.wood_stored, stone_stored = EXCLUDED.stone_stored, iron_stored = EXCLUDED.iron_stored, gold_stored = EXCLUDED.gold_stored', [h3_index, eco.population, eco.happiness, eco.food, eco.wood, eco.stone, 0, 0]);
            await client.query('UPDATE players SET gold = gold - $1 WHERE player_id = $2', [CLAIM_COST, player_id]);
            await client.query('COMMIT');

            logGameEvent(`[Claim] Jugador ${player_id} reclamó ${h3_index}`);
            res.json({ success: true, is_capital: isFirstTerritory, message: isFirstTerritory ? '👑 ¡Capital fundada!' : '🏰 ¡Territorio colonizado!' });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            res.status(500).json({ success: false, error: error.message });
        } finally { client.release(); }
    });

    router.get('/game/capital', requireAuth, async (req, res) => {
        const result = await pool.query('SELECT h3_index FROM h3_map WHERE player_id = $1 AND is_capital = TRUE LIMIT 1', [req.session.user.player_id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No tienes capital' });
        res.json({ success: true, h3_index: result.rows[0].h3_index });
    });

    router.get('/map/cell-details/:h3_index', async (req, res) => {
        const { h3_index } = req.params;
        const query = `
      SELECT m.*, t.name AS terrain_type, t.color AS terrain_color, t.food_output, t.wood_output, p.username AS player_name, p.color AS player_color, b.name AS building_type, s.name AS settlement_name, s.type AS settlement_type, td.*
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
        res.json({
            h3_index, terrain_type: cell.terrain_type, terrain_color: cell.terrain_color, food_output: cell.food_output || 0, wood_output: cell.wood_output || 0,
            player_id: cell.player_id, player_name: cell.player_name, building_type: cell.building_type, is_capital: cell.is_capital,
            settlement_name: cell.settlement_name, territory: cell.population ? { population: cell.population, happiness: cell.happiness, food: cell.food_stored, wood: cell.wood_stored, stone: cell.discovered_resource ? cell.stone_stored : 0, iron: cell.discovered_resource ? cell.iron_stored : 0, gold: cell.discovered_resource ? cell.gold_stored : 0, discovered_resource: cell.discovered_resource, exploration_end_turn: cell.exploration_end_turn, farm_level: cell.farm_level, mine_level: cell.mine_level, lumber_level: cell.lumber_level, port_level: cell.port_level } : null
        });
    });

    router.get('/players/:id', async (req, res) => {
        const result = await pool.query('SELECT player_id, username, gold, color FROM players WHERE player_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
        res.json(result.rows[0]);
    });

    router.get('/game/world-state', async (req, res) => {
        const result = await pool.query('SELECT current_turn, game_date, is_paused FROM world_state WHERE id = 1');
        res.json({ success: true, turn: result.rows[0].current_turn, date: result.rows[0].game_date, is_paused: result.rows[0].is_paused });
    });

    router.get('/game/my-fiefs', requireAuth, async (req, res) => {
        const query = `
      SELECT m.h3_index, COALESCE(td.custom_name, s.name, 'Territorio sin nombre') AS location_name, td.*, t.name AS terrain_name, t.food_output
      FROM h3_map m
      JOIN territory_details td ON m.h3_index = td.h3_index
      JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      LEFT JOIN settlements s ON m.h3_index = s.h3_index
      WHERE m.player_id = $1
      ORDER BY td.population DESC
    `;
        const result = await pool.query(query, [req.session.user.player_id]);
        res.json({ success: true, fiefs: result.rows });
    });

    // ============================================
    // TERRITORY AND INFRASTRUCTURE
    // ============================================
    router.post('/territory/explore', requireAuth, async (req, res) => {
        const client = await pool.connect();
        try {
            const { h3_index } = req.body;
            const player_id = req.session.user.player_id;
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
        } catch (e) { if (client) await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
        finally { client.release(); }
    });

    router.post('/territory/upgrade', requireAuth, async (req, res) => {
        const client = await pool.connect();
        try {
            const { h3_index, building_type } = req.body;
            const player_id = req.session.user.player_id;
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
        } catch (e) { if (client) await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); }
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
            console.error('Error fetching unit types:', error);
            res.status(500).json({ success: false, message: 'Error al obtener tipos de unidades' });
        }
    });

    router.post('/military/recruit', requireAuth, async (req, res) => {
        try {
            const player_id = req.session.user.player_id;
            const { h3_index, unit_type_id, quantity, army_name } = req.body;

            if (!h3_index || !unit_type_id || !quantity || !army_name) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos' });
            }

            if (quantity <= 0) {
                return res.status(400).json({ success: false, message: 'La cantidad debe ser mayor a 0' });
            }

            const result = await military.recruitUnits(pool, req.body, player_id);

            if (result.success) {
                logGameEvent(`[RECLUTAMIENTO] Jugador ${player_id} reclutó ${quantity} unidades tipo ${unit_type_id} en ${h3_index}`);
            }

            res.json(result);
        } catch (error) {
            console.error('Error recruiting units:', error);
            res.status(500).json({ success: false, message: 'Error al reclutar unidades', error: error.message });
        }
    });

    // ============================================
    // ADMIN AND MESSAGES
    // ============================================
    router.post('/admin/reset', requireAdmin, async (req, res) => {
        try {
            await pool.query("UPDATE world_state SET current_turn = 0, game_date = '1039-03-01' WHERE id = 1");
            res.json({ success: true, message: 'Mundo reseteado' });
        } catch (error) {
            console.error('Admin reset error:', error);
            res.status(500).json({ success: false, message: 'Error al resetear mundo' });
        }
    });

    router.get('/admin/stats', requireAdmin, async (req, res) => {
        try {
            const world = (await pool.query('SELECT current_turn, game_date, turn_duration_seconds FROM world_state WHERE id = 1')).rows[0];
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
                    turn_interval_seconds: world.turn_duration_seconds
                }
            });
        } catch (error) {
            console.error('Admin stats error:', error);
            res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
        }
    });

    router.post('/admin/reset-explorations', requireAdmin, async (req, res) => {
        try {
            await pool.query('UPDATE territory_details SET exploration_end_turn = NULL, discovered_resource = NULL');
            res.json({ success: true, message: 'Todas las exploraciones han sido reseteadas' });
        } catch (error) {
            console.error('Admin reset-explorations error:', error);
            res.status(500).json({ success: false, message: 'Error al resetear exploraciones' });
        }
    });

    router.post('/admin/config', requireAdmin, async (req, res) => {
        try {
            const { turn_interval_seconds } = req.body;
            if (!turn_interval_seconds) return res.status(400).json({ success: false, message: 'turn_interval_seconds requerido' });

            await pool.query('UPDATE world_state SET turn_duration_seconds = $1 WHERE id = 1', [turn_interval_seconds]);
            // Also update in game_config for persistence across reloads if applicable
            await pool.query('INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value', ['gameplay', 'turn_duration_seconds', turn_interval_seconds.toString()]);

            res.json({ success: true, message: 'Configuración actualizada. Reinicie el servidor para aplicar el nuevo intervalo de tiempo.' });
        } catch (error) {
            console.error('Admin config error:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar configuración' });
        }
    });

    router.get('/admin/game-config', requireAdmin, async (req, res) => {
        try {
            res.json({ success: true, config: config });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Error al obtener configuración' });
        }
    });

    router.put('/admin/game-config', requireAdmin, async (req, res) => {
        try {
            const { group, key, value } = req.body;
            if (!group || !key || value === undefined) return res.status(400).json({ success: false, message: 'Faltan parámetros' });

            await pool.query('INSERT INTO game_config ("group", "key", "value") VALUES ($1, $2, $3) ON CONFLICT ("group", "key") DO UPDATE SET value = EXCLUDED.value', [group, key, value.toString()]);

            // Dynamically update the in-memory config object
            if (!config[group]) config[group] = {};
            config[group][key] = !isNaN(value) ? Number(value) : value;

            res.json({ success: true, message: 'Configuración de juego actualizada' });
        } catch (error) {
            console.error('Admin update-game-config error:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar configuración de juego' });
        }
    });

    router.get('/messages', requireAuth, async (req, res) => {
        const result = await pool.query('SELECT m.*, s.username as sender_username FROM messages m LEFT JOIN players s ON m.sender_id = s.player_id WHERE m.receiver_id = $1 OR m.sender_id = $1 ORDER BY m.sent_at DESC', [req.session.user.player_id]);
        res.json({ success: true, messages: result.rows });
    });

    router.post('/messages', requireAuth, async (req, res) => {
        const { recipient_username, subject, body } = req.body;
        const receiver = await pool.query('SELECT player_id FROM players WHERE username = $1', [recipient_username]);
        if (receiver.rows.length === 0) return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });
        await pool.query('INSERT INTO messages (sender_id, receiver_id, subject, body) VALUES ($1, $2, $3, $4)', [req.session.user.player_id, receiver.rows[0].player_id, subject, body]);
        res.json({ success: true, message: 'Mensaje enviado' });
    });

    return router;
};
